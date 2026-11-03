from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).with_name("sanitize.py")


def load_sanitize() -> ModuleType:
    spec = importlib.util.spec_from_file_location("sanitize_under_test", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def sanitize() -> ModuleType:
    return load_sanitize()


def run_scanner(root: Path, *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    process_env = os.environ.copy()
    process_env.pop("SANITIZE_DENY_TERMS", None)
    process_env.pop("SANITIZE_MAX_BYTES", None)
    if env:
        process_env.update(env)
    return subprocess.run(
        [sys.executable, "-I", os.fspath(SCRIPT), os.fspath(root)],
        capture_output=True,
        check=False,
        env=process_env,
        text=True,
    )


def init_repository(root: Path) -> None:
    subprocess.run(["git", "init", "--quiet", os.fspath(root)], check=True)


def git_add(root: Path, *paths: str, force: bool = False) -> None:
    command = ["git", "-C", os.fspath(root), "add"]
    if force:
        command.append("--force")
    subprocess.run([*command, "--", *paths], check=True)


def test_configured_terms_use_platform_separator_and_casefold(
    sanitize: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SANITIZE_DENY_TERMS", os.pathsep.join([" Alpha ", "", "BETA"]))

    assert sanitize.configured_terms() == ["alpha", "beta"]


def test_configured_term_finding_never_contains_term_or_position(sanitize: ModuleType) -> None:
    sensitive_term = "ExternalIdentifier"

    findings = sanitize.validate_text(
        f"prefix {sensitive_term.casefold()} suffix", "sample.txt", [sensitive_term.casefold()]
    )

    assert findings == ["termo externo configurado"]
    assert sensitive_term.casefold() not in " ".join(findings).casefold()
    assert "#1" not in " ".join(findings)


def test_git_enumeration_includes_tracked_and_untracked_but_not_ignored(tmp_path: Path) -> None:
    init_repository(tmp_path)
    (tmp_path / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
    (tmp_path / "tracked.txt").write_text("tracked\n", encoding="utf-8")
    (tmp_path / "untracked.txt").write_text("untracked\n", encoding="utf-8")
    (tmp_path / "ignored.txt").write_text("ignored\n", encoding="utf-8")
    git_add(tmp_path, ".gitignore", "tracked.txt")

    result = run_scanner(tmp_path, env={"SANITIZE_MAX_BYTES": "9"})

    assert result.returncode == 1
    finding_paths = {
        line.removeprefix("- ").split(":", maxsplit=1)[0]
        for line in result.stderr.splitlines()
        if line.startswith("- ")
    }
    assert "untracked.txt" in finding_paths
    assert "tracked.txt" not in finding_paths
    assert "ignored.txt" not in finding_paths


def test_git_enumeration_is_nul_safe_for_spaces(tmp_path: Path) -> None:
    init_repository(tmp_path)
    unusual = "directory with spaces/file name.txt"
    path = tmp_path / unusual
    path.parent.mkdir()
    path.write_text("x" * 20, encoding="utf-8")
    git_add(tmp_path, unusual)

    result = run_scanner(tmp_path, env={"SANITIZE_MAX_BYTES": "10"})

    assert result.returncode == 1
    assert unusual in result.stderr


def test_decode_git_paths_preserves_newline_name(sanitize: ModuleType) -> None:
    assert sanitize._decode_git_paths(b"line\nbreak.txt\0plain.txt\0") == [
        Path("line\nbreak.txt"),
        Path("plain.txt"),
    ]


def test_tracked_artifact_in_prohibited_directory_fails(tmp_path: Path) -> None:
    init_repository(tmp_path)
    artifact = tmp_path / "dist" / "bundle.js"
    artifact.parent.mkdir()
    artifact.write_text("const value = 1;\n", encoding="utf-8")
    git_add(tmp_path, "dist/bundle.js", force=True)

    result = run_scanner(tmp_path)

    assert result.returncode == 1
    assert "dist/bundle.js" in result.stderr
    assert "artefato rastreado em diretório proibido" in result.stderr


def test_untracked_ignored_prohibited_directory_is_not_scanned(tmp_path: Path) -> None:
    init_repository(tmp_path)
    (tmp_path / ".gitignore").write_text("dist/\n", encoding="utf-8")
    artifact = tmp_path / "dist" / "bundle.js"
    artifact.parent.mkdir()
    artifact.write_text("x" * 100, encoding="utf-8")

    result = run_scanner(tmp_path, env={"SANITIZE_MAX_BYTES": "10"})

    assert result.returncode == 0
    assert not result.stderr


def test_pre_git_fallback_scans_regular_files_and_excludes_generated_dirs(tmp_path: Path) -> None:
    (tmp_path / "visible.txt").write_text("x" * 20, encoding="utf-8")
    generated = tmp_path / "node_modules" / "package" / "large.js"
    generated.parent.mkdir(parents=True)
    generated.write_text("x" * 100, encoding="utf-8")

    result = run_scanner(tmp_path, env={"SANITIZE_MAX_BYTES": "10"})

    assert result.returncode == 1
    assert "visible.txt" in result.stderr
    assert "node_modules" not in result.stderr


def test_nested_root_uses_pre_git_fallback_instead_of_parent_repository(tmp_path: Path) -> None:
    init_repository(tmp_path)
    nested = tmp_path / "export"
    nested.mkdir()
    (nested / "visible.txt").write_text("x" * 20, encoding="utf-8")
    (tmp_path / ".gitignore").write_text("export/\n", encoding="utf-8")

    result = run_scanner(nested, env={"SANITIZE_MAX_BYTES": "10"})

    assert result.returncode == 1
    assert "visible.txt" in result.stderr


def test_pre_git_fallback_rejects_symlink(tmp_path: Path) -> None:
    target = tmp_path / "target.txt"
    target.write_text("safe\n", encoding="utf-8")
    link = tmp_path / "link.txt"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlinks are unavailable in this environment")

    result = run_scanner(tmp_path)

    assert result.returncode == 1
    assert "link.txt" in result.stderr
    assert "link simbólico não permitido" in result.stderr


def test_external_terms_are_redacted_from_subprocess_output(tmp_path: Path) -> None:
    sensitive_term = "NeverPrintThisIdentifier"
    (tmp_path / "sample.txt").write_text(sensitive_term.casefold(), encoding="utf-8")

    result = run_scanner(tmp_path, env={"SANITIZE_DENY_TERMS": sensitive_term})

    combined_output = (result.stdout + result.stderr).casefold()
    assert result.returncode == 1
    assert "termo externo configurado" in combined_output
    assert sensitive_term.casefold() not in combined_output


@pytest.mark.parametrize(
    ("contents", "expected"),
    [
        (
            "https" + "://" + "unapproved" + ".invalid/path",
            "URL para host não aprovado",
        ),
        (
            "person" + "@" + "unapproved" + ".invalid",
            "e-mail de domínio não aprovado",
        ),
        (
            "C:" + "/" + "Users" + "/private/example.txt",
            "caminho absoluto de usuário",
        ),
        ("to" + "ken=" + "abcdefghijklmnop", "possível segredo atribuído em texto"),
        (
            "-----BEGIN " + "PRIVATE KEY-----",
            "material de chave privada",
        ),
    ],
)
def test_text_checks_reject_sensitive_patterns(
    tmp_path: Path, contents: str, expected: str
) -> None:
    (tmp_path / "sample.txt").write_text(contents, encoding="utf-8")

    result = run_scanner(tmp_path)

    assert result.returncode == 1
    assert expected in result.stderr


@pytest.mark.parametrize("suffix", [".pdf", ".sqlite", ".zip", ".pyc"])
def test_prohibited_file_types_fail(tmp_path: Path, suffix: str) -> None:
    (tmp_path / f"artifact{suffix}").write_bytes(b"not-real-binary")

    result = run_scanner(tmp_path)

    assert result.returncode == 1
    assert f"tipo de arquivo proibido ({suffix})" in result.stderr


def test_binary_unknown_extension_and_non_utf8_fail(tmp_path: Path) -> None:
    (tmp_path / "binary.txt").write_bytes(b"a\0b")
    (tmp_path / "unknown.xyz").write_text("plain text", encoding="utf-8")
    (tmp_path / "invalid.txt").write_bytes(b"\xff")

    result = run_scanner(tmp_path)

    assert result.returncode == 1
    assert "conteúdo binário não permitido" in result.stderr
    assert "extensão não reconhecida" in result.stderr
    assert "texto fora de UTF-8" in result.stderr


def test_invalid_max_bytes_is_controlled_error(tmp_path: Path) -> None:
    (tmp_path / "sample.txt").write_text("safe", encoding="utf-8")

    result = run_scanner(tmp_path, env={"SANITIZE_MAX_BYTES": "not-a-number"})

    assert result.returncode == 2
    assert "inteiro positivo" in result.stderr
    assert "Traceback" not in result.stderr


def test_allowed_provenance_sha_passes(tmp_path: Path, sanitize: ModuleType) -> None:
    (tmp_path / "provenance.txt").write_text(sanitize.SOURCE_SHA, encoding="utf-8")

    result = run_scanner(tmp_path)

    assert result.returncode == 0
    assert not result.stderr
