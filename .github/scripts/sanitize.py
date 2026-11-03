#!/usr/bin/env python3
"""Fail closed on content that is unsuitable for a neutral, shareable demo tree.

Extra case-insensitive literal deny terms must be supplied with
SANITIZE_DENY_TERMS, separated by the platform path separator. A repository
administrator may also set SANITIZE_MAX_BYTES. Configured terms are never
written to disk or printed.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

SOURCE_SHA = "f9c359304407fd68fca16cf88f4859d03977f515"
DEFAULT_MAX_BYTES = 1_500_000
TEXT_EXTENSIONS = {
    "",
    ".cjs",
    ".conf",
    ".css",
    ".csv",
    ".dockerignore",
    ".editorconfig",
    ".env",
    ".example",
    ".gitignore",
    ".html",
    ".ini",
    ".jinja",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".lock",
    ".md",
    ".mjs",
    ".mako",
    ".py",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
PROHIBITED_SUFFIXES = {
    ".p12",
    ".pfx",
    ".pem",
    ".key",
    ".der",
    ".crt",
    ".cer",
    ".sqlite",
    ".sqlite3",
    ".db",
    ".dump",
    ".bak",
    ".zip",
    ".rar",
    ".7z",
    ".gz",
    ".tgz",
    ".tar",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar",
    ".pyc",
}
PROHIBITED_DIRS = {
    ".idea",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vscode",
    "__pycache__",
    "backups",
    "build",
    "coverage",
    "dist",
    "exports",
    "htmlcov",
    "node_modules",
    "playwright-report",
    "storage",
    "test-results",
    "uploads",
    "venv",
}
FALLBACK_EXCLUDED_DIRS = PROHIBITED_DIRS | {".git"}
SKIP_SUFFIXES = {".tsbuildinfo"}
ALLOWED_URL_HOSTS = {
    "127.0.0.1",
    "localhost",
    "github.com",
    "biomejs.dev",
    "playwright.dev",
    "docs.docker.com",
    "docs.github.com",
    "nodejs.org",
    "pnpm.io",
    "pypi.org",
    "files.pythonhosted.org",
    "registry.npmjs.org",
    "python.org",
    "www.python.org",
}
ALLOWED_EMAIL_DOMAINS = {"example.com", "example.org", "localhost", "localhost.invalid"}
URL_RE = re.compile(r"https?://[^\s<>()\]\[{}\"']+", re.IGNORECASE)
EMAIL_RE = re.compile(r"(?<![\w.+-])([\w.+-]+)@([a-z0-9.-]+\.[a-z]{2,})(?![\w.-])", re.IGNORECASE)
ABSOLUTE_PATH_RE = re.compile(
    r"(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s'\"]+)"
    r"|(?:/(?:Users|home)/[^\s/'\"]+/[^\s'\"]*)"
)
SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)"
    r"\s*[:=]\s*['\"]?(?!local_only\b|demo\b|example\b|change_me\b|\$\{|\{\{)"
    r"[A-Za-z0-9_./+=-]{12,}"
)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")


def configured_terms() -> list[str]:
    raw = os.environ.get("SANITIZE_DENY_TERMS", "")
    return [term.strip().casefold() for term in raw.split(os.pathsep) if term.strip()]


def configured_max_bytes() -> int:
    raw = os.environ.get("SANITIZE_MAX_BYTES", str(DEFAULT_MAX_BYTES))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("SANITIZE_MAX_BYTES deve ser um inteiro positivo") from exc
    if value <= 0:
        raise ValueError("SANITIZE_MAX_BYTES deve ser um inteiro positivo")
    return value


def _decode_git_paths(data: bytes) -> list[Path]:
    paths: list[Path] = []
    for raw_path in data.split(b"\0"):
        if not raw_path:
            continue
        path = Path(os.fsdecode(raw_path))
        if path.is_absolute() or ".." in path.parts:
            raise RuntimeError("Git retornou um caminho fora da raiz de verificação")
        paths.append(path)
    return paths


def _git_paths(root: Path) -> tuple[list[Path], set[Path]] | None:
    """Return tracked plus untracked/non-ignored paths, or None outside Git."""
    top_level_result = subprocess.run(
        ["git", "-C", os.fspath(root), "rev-parse", "--show-toplevel"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if top_level_result.returncode != 0:
        return None
    try:
        git_root = Path(os.fsdecode(top_level_result.stdout.rstrip(b"\r\n"))).resolve()
    except (OSError, ValueError) as exc:
        raise RuntimeError("não foi possível determinar a raiz do repositório Git") from exc
    if git_root != root:
        return None

    tracked_result = subprocess.run(
        ["git", "-C", os.fspath(root), "ls-files", "-z", "--cached"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    untracked_result = subprocess.run(
        [
            "git",
            "-C",
            os.fspath(root),
            "ls-files",
            "-z",
            "--others",
            "--exclude-standard",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if tracked_result.returncode != 0 or untracked_result.returncode != 0:
        raise RuntimeError("não foi possível enumerar os arquivos com Git")

    tracked = set(_decode_git_paths(tracked_result.stdout))
    candidates = tracked | set(_decode_git_paths(untracked_result.stdout))
    return sorted(candidates, key=lambda path: os.fsencode(path)), tracked


def _fallback_paths(root: Path) -> list[Path]:
    """Enumerate conservatively before Git exists, excluding generated trees."""
    candidates: list[Path] = []
    for current_root, dirs, files in os.walk(root, topdown=True, followlinks=False):
        current = Path(current_root)
        dirs[:] = sorted(name for name in dirs if name not in FALLBACK_EXCLUDED_DIRS)
        for name in sorted(files):
            candidates.append((current / name).relative_to(root))
        for name in dirs:
            path = current / name
            if path.is_symlink():
                candidates.append(path.relative_to(root))
    return candidates


def enumerate_paths(root: Path) -> tuple[list[Path], set[Path]]:
    try:
        git_paths = _git_paths(root)
    except FileNotFoundError:
        git_paths = None
    if git_paths is not None:
        return git_paths
    return _fallback_paths(root), set()


def validate_text(text: str, rel: str, deny_terms: list[str]) -> list[str]:
    findings: list[str] = []
    folded = text.casefold()
    if any(term in folded for term in deny_terms):
        findings.append("termo externo configurado")

    if rel != ".github/scripts/sanitize.py":
        if PRIVATE_KEY_RE.search(text):
            findings.append("material de chave privada")
        if SECRET_ASSIGNMENT_RE.search(text):
            findings.append("possível segredo atribuído em texto")

    for match in URL_RE.finditer(text):
        value = match.group(0).rstrip(".,;:")
        parsed = urlsplit(value)
        host = (parsed.hostname or "").casefold()
        is_internal_service = (
            parsed.scheme == "http"
            and parsed.username is None
            and parsed.password is None
            and "." not in host
            and host.replace("-", "").replace("_", "").isalnum()
        )
        if (
            host not in ALLOWED_URL_HOSTS
            and not host.endswith(".github.com")
            and not is_internal_service
        ):
            findings.append(f"URL para host não aprovado ({host or 'inválido'})")

    for match in EMAIL_RE.finditer(text):
        domain = match.group(2).casefold()
        if domain not in ALLOWED_EMAIL_DOMAINS:
            findings.append(f"e-mail de domínio não aprovado ({domain})")

    if ABSOLUTE_PATH_RE.search(text):
        findings.append("caminho absoluto de usuário")

    # The exact provenance SHA above is intentionally shareable.
    return sorted(set(findings))


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else ".").resolve()
    if not root.is_dir():
        print("erro: diretório de verificação inexistente", file=sys.stderr)
        return 2

    try:
        max_bytes = configured_max_bytes()
        candidates, tracked = enumerate_paths(root)
    except (RuntimeError, ValueError) as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2

    deny_terms = configured_terms()
    errors: list[tuple[str, str]] = []
    checked = 0

    for candidate in candidates:
        path = root / candidate
        rel = candidate.as_posix()
        prohibited_parts = sorted(set(candidate.parts) & PROHIBITED_DIRS)
        if candidate in tracked and prohibited_parts:
            errors.append((rel, f"artefato rastreado em diretório proibido ({prohibited_parts[0]})"))
            continue
        if prohibited_parts:
            continue
        if path.is_symlink():
            errors.append((rel, "link simbólico não permitido"))
            continue
        if not path.is_file():
            if candidate in tracked:
                errors.append((rel, "arquivo rastreado ausente ou inacessível"))
            continue

        suffix = path.suffix.casefold()
        if suffix in SKIP_SUFFIXES:
            continue
        checked += 1
        if suffix in PROHIBITED_SUFFIXES:
            errors.append((rel, f"tipo de arquivo proibido ({suffix})"))
            continue
        try:
            size = path.stat().st_size
        except OSError:
            errors.append((rel, "arquivo inacessível"))
            continue
        if size > max_bytes:
            errors.append((rel, f"arquivo excede {max_bytes} bytes"))
            continue

        try:
            data = path.read_bytes()
        except OSError:
            errors.append((rel, "arquivo inacessível"))
            continue
        if b"\x00" in data:
            errors.append((rel, "conteúdo binário não permitido"))
            continue
        if suffix not in TEXT_EXTENSIONS and path.name not in {
            "Makefile",
            "Dockerfile",
            "pnpm-lock.yaml",
        }:
            errors.append((rel, f"extensão não reconhecida ({suffix or 'sem extensão'})"))
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            errors.append((rel, "texto fora de UTF-8"))
            continue

        for finding in validate_text(text, rel, deny_terms):
            errors.append((rel, finding))

    if errors:
        print("Sanitização reprovada:", file=sys.stderr)
        for rel, reason in errors:
            print(f"- {rel}: {reason}", file=sys.stderr)
        return 1

    print(f"Sanitização aprovada: {checked} arquivos verificados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
