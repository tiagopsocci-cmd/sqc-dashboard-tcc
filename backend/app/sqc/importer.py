"""Parsers de importação SQC — CSV de dimensões e Excel/CSV de medições."""

from __future__ import annotations

import csv
import io
import math
import uuid
from datetime import UTC, datetime

from app.sqc.schemas import ImportError, ImportResult

# ── Parser legado (CSV formato antigo: uma linha por medição) ──────────────────

REQUIRED_COLUMNS = {"dim_code", "part_number", "measured_value", "date_time"}
OPTIONAL_COLUMNS = {"operator", "instrument", "fixture", "work_order"}


def parse_csv(
    content: bytes,
    dims_map: dict[str, tuple[uuid.UUID, float]],
) -> tuple[list[dict], ImportResult]:
    """Parseia CSV legado (uma linha por medição) e retorna (linhas_válidas, resultado)."""
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames is None:
        return [], ImportResult(
            imported=0,
            rejected=0,
            errors=[ImportError(row=0, dim_code="", reason="arquivo CSV vazio ou sem cabeçalho")],
        )

    headers_lower = {h.lower().strip() for h in reader.fieldnames}
    missing = REQUIRED_COLUMNS - headers_lower
    if missing:
        reason = f"colunas obrigatórias ausentes: {', '.join(sorted(missing))}"
        return [], ImportResult(
            imported=0, rejected=0, errors=[ImportError(row=0, dim_code="", reason=reason)]
        )

    rows_raw = []
    for row in reader:
        rows_raw.append({k.lower().strip(): v.strip() for k, v in row.items()})

    valid: list[dict] = []
    errors: list[ImportError] = []

    for i, row in enumerate(rows_raw, start=2):
        dim_code = row.get("dim_code", "").strip()
        if not dim_code:
            errors.append(ImportError(row=i, dim_code="", reason="dim_code vazio"))
            continue

        if dim_code not in dims_map:
            errors.append(
                ImportError(
                    row=i, dim_code=dim_code, reason="dim_code não encontrado nas dims da peça"
                )
            )
            continue

        dim_id, nominal = dims_map[dim_code]

        try:
            measured_value = _finite_float(row["measured_value"])
        except (ValueError, KeyError):
            errors.append(
                ImportError(
                    row=i, dim_code=dim_code, reason="measured_value não é um número válido"
                )
            )
            continue

        try:
            part_number = int(row["part_number"])
            if part_number <= 0:
                raise ValueError
        except (ValueError, KeyError):
            errors.append(
                ImportError(
                    row=i, dim_code=dim_code, reason="part_number deve ser inteiro positivo"
                )
            )
            continue

        dt_str = row.get("date_time", "").strip()
        try:
            dt = datetime.fromisoformat(dt_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
        except ValueError:
            dt = datetime.now(UTC)

        valid.append(
            {
                "dim_id": dim_id,
                "part_number": part_number,
                "measured_value": measured_value,
                "deviation": measured_value - nominal,
                "date_time": dt,
                "operator": row.get("operator") or None,
                "instrument": row.get("instrument") or None,
                "fixture": row.get("fixture") or None,
                "work_order": row.get("work_order") or None,
                "source_row": i,
            }
        )

    return valid, ImportResult(imported=len(valid), rejected=len(errors), errors=errors)


# ── Parser de dimensões (CSV) ──────────────────────────────────────────────────

DIMS_REQUIRED = {"dim_code", "nominal", "tol_plus", "type"}
DIMS_OPTIONAL = {
    "tol_minus",
    "sub_type",
    "drawing_revision",
    "dim_name",
    "parent_dim_code",
    "dim_rel_1_code",
    "dim_rel_2_code",
    "material_modifier",
    "position_geometry",
    "coordinate_axis",
    "related_size_dim_code",
}


def _decode_csv(content: bytes) -> str:
    """Decodifica CSV tentando UTF-8-BOM, UTF-8 e Windows-1252 em sequência."""
    for enc in ("utf-8-sig", "utf-8", "windows-1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="replace")


def _detect_delimiter(text: str) -> str:
    """Detecta o delimitador do CSV (vírgula ou ponto e vírgula)."""
    first_line = text.split("\n")[0]
    return ";" if first_line.count(";") > first_line.count(",") else ","


def parse_dims_csv(content: bytes) -> tuple[list[dict], list[str]]:
    """
    Parseia CSV de dimensões.

    Retorna (lista_de_dicts_prontos, lista_de_erros).
    Os campos parent_dim_code/dim_rel_1_code/dim_rel_2_code são strings —
    a resolução para UUID é feita no router após inserir todas as dims.
    Aceita separador vírgula ou ponto e vírgula, e encodings UTF-8 ou Windows-1252.
    """
    text = _decode_csv(content)
    delimiter = _detect_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)

    if reader.fieldnames is None:
        return [], ["arquivo CSV vazio ou sem cabeçalho"]

    headers_lower = {h.lower().strip() for h in reader.fieldnames}
    missing = DIMS_REQUIRED - headers_lower
    if missing:
        return [], [f"colunas obrigatórias ausentes: {', '.join(sorted(missing))}"]

    dims: list[dict] = []
    errors: list[str] = []
    first_line_by_code: dict[str, int] = {}

    for i, row in enumerate(reader, start=2):
        r = {k.lower().strip(): (v.strip() if v else "") for k, v in row.items()}

        dim_code = r.get("dim_code", "").upper()
        if not dim_code:
            errors.append(f"linha {i}: dim_code vazio")
            continue
        if dim_code in first_line_by_code:
            errors.append(
                f"linha {i} ({dim_code}): dim_code duplicado "
                f"(primeira ocorrência na linha {first_line_by_code[dim_code]})"
            )
            continue
        first_line_by_code[dim_code] = i

        try:
            nominal = _finite_float(r["nominal"])
        except (ValueError, KeyError):
            errors.append(f"linha {i} ({dim_code}): nominal inválido")
            continue

        try:
            tol_plus = _finite_float(r["tol_plus"])
            if tol_plus < 0:
                raise ValueError
        except (ValueError, KeyError):
            errors.append(f"linha {i} ({dim_code}): tol_plus inválido")
            continue

        dim_type = r.get("type", "").strip().upper()
        if not dim_type:
            errors.append(f"linha {i} ({dim_code}): type obrigatório")
            continue

        tol_minus_raw = r.get("tol_minus", "").strip()
        tol_minus: float | None = None
        if tol_minus_raw:
            try:
                tol_minus = _finite_float(tol_minus_raw)
            except ValueError:
                errors.append(f"linha {i} ({dim_code}): tol_minus inválido")
                continue

        dims.append(
            {
                "dim_code": dim_code,
                "nominal": nominal,
                "tol_plus": tol_plus,
                "tol_minus": tol_minus,
                "type": dim_type,
                "sub_type": r.get("sub_type", "").strip().upper() or None,
                "drawing_revision": r.get("drawing_revision", "").strip() or None,
                "dim_name": r.get("dim_name", "").strip() or None,
                "material_modifier": r.get("material_modifier", "").strip().upper() or None,
                # referências por código — resolvidas depois
                "parent_dim_code": r.get("parent_dim_code", "").strip().upper() or None,
                "dim_rel_1_code": r.get("dim_rel_1_code", "").strip().upper() or None,
                "dim_rel_2_code": r.get("dim_rel_2_code", "").strip().upper() or None,
                # RECTANGLE (spec 060) — geometria/eixo/relação, resolvidos no router
                # após todas as dims existirem (mesmo padrão two-pass acima).
                "position_geometry": r.get("position_geometry", "").strip().upper() or None,
                "coordinate_axis": r.get("coordinate_axis", "").strip().upper() or None,
                "related_size_dim_code": r.get("related_size_dim_code", "").strip().upper() or None,
            }
        )

    return dims, errors


# ── Parser de medições (Excel/CSV formato ferramenta de medição) ──────────────────────────

# Colunas com semântica fixa — identificadas por nome, ordem irrelevante.
# Qualquer outra coluna no header é tratada como dim_code.
MEASUREMENT_FIXED = frozenset(
    {
        "part",
        "operator",
        "instrument",
        "fixture",
        "work_order",
        "measurement date",
        "cavity",
        "lote",
    }
)


def _positive_integer(raw: object) -> int:
    value = float(str(raw))
    if not math.isfinite(value) or value <= 0 or not value.is_integer():
        raise ValueError
    return int(value)


def _finite_float(raw: object) -> float:
    value = float(str(raw))
    if not math.isfinite(value):
        raise ValueError
    return value


def _parse_measurement_date(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(UTC)
    raw = str(raw).strip()
    # Tentar vários formatos comuns
    for fmt in (
        "%d/%m/%y %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=UTC)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except ValueError:
        return datetime.now(UTC)


def list_xlsx_sheets(content: bytes) -> list[str]:
    """Retorna lista de nomes de abas de um arquivo xlsx."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    return wb.sheetnames


def parse_measurements(
    content: bytes,
    filename: str,
    sheet_name: str | None = None,
) -> tuple[list[dict], list[str], list[str]]:
    """
    Parseia arquivo de medições no formato ferramenta de medição.

    Retorna (registros, erros, lista_de_abas).

    Cada registro: {dim_code, part_number, measured_value, date_time,
                    operator, instrument, fixture, work_order}
    deviation não é calculado aqui — precisa do nominal (feito no router).
    """
    is_xlsx = filename.lower().endswith((".xlsx", ".xlsm"))

    if is_xlsx:
        return _parse_xlsx(content, sheet_name)
    else:
        return _parse_measurement_csv(content)


def _parse_xlsx(
    content: bytes,
    sheet_name: str | None,
) -> tuple[list[dict], list[str], list[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sheets = wb.sheetnames

    ws = wb[sheet_name] if sheet_name and sheet_name in sheets else wb.active
    if ws is None:
        return [], ["planilha sem aba ativa"], sheets

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], ["planilha vazia"], sheets

    # Cabeçalho na primeira linha — mapeamento nome→índice (case-insensitive)
    header = [str(c).strip().lower() if c is not None else "" for c in rows[0]]
    col_map = {name: idx for idx, name in enumerate(header)}

    if "part" not in col_map:
        return [], ["coluna obrigatória ausente: 'part'"], sheets

    # Colunas de dim = qualquer header não presente no set fixo e não vazio
    dim_cols: list[tuple[int, str]] = [
        (idx, name.upper())
        for name, idx in col_map.items()
        if name and name not in MEASUREMENT_FIXED
    ]

    records: list[dict] = []
    errors: list[str] = []

    def _cell_str(row: tuple, col: str) -> str | None:
        idx = col_map.get(col)
        if idx is None or idx >= len(row):
            return None
        val = row[idx]
        return str(val).strip() if val is not None and str(val).strip() else None

    for row_idx, row in enumerate(rows[1:], start=2):
        part_raw = _cell_str(row, "part")
        if part_raw is None:
            continue  # linha vazia

        try:
            part_number = _positive_integer(part_raw)
        except (ValueError, TypeError):
            errors.append(f"linha {row_idx}: Part inválido ({part_raw!r})")
            continue

        operator = _cell_str(row, "operator")
        instrument = _cell_str(row, "instrument")
        fixture = _cell_str(row, "fixture")
        work_order = _cell_str(row, "work_order")
        dt = _parse_measurement_date(_cell_str(row, "measurement date"))

        cavity_raw = _cell_str(row, "cavity")
        cavity: int | None = None
        if cavity_raw is not None:
            try:
                cavity = _positive_integer(cavity_raw)
            except (ValueError, TypeError):
                errors.append(f"linha {row_idx}: cavity inválido ({cavity_raw!r})")
                continue

        for col_idx, dim_code in dim_cols:
            if col_idx >= len(row):
                continue
            val_raw = row[col_idx]
            if val_raw is None or str(val_raw).strip() == "":
                continue
            try:
                measured_value = _finite_float(val_raw)
            except (ValueError, TypeError):
                errors.append(f"linha {row_idx}, dim {dim_code}: valor inválido ({val_raw!r})")
                continue

            records.append(
                {
                    "dim_code": dim_code,
                    "part_number": part_number,
                    "measured_value": measured_value,
                    "date_time": dt,
                    "operator": operator,
                    "instrument": instrument,
                    "fixture": fixture,
                    "work_order": work_order,
                    "cavity": cavity,
                    "source_row": row_idx,
                }
            )

    return records, errors, sheets


def _parse_measurement_csv(content: bytes) -> tuple[list[dict], list[str], list[str]]:
    text = _decode_csv(content)
    delimiter = _detect_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    all_rows = list(reader)

    if not all_rows:
        return [], ["arquivo CSV vazio"], []

    header = [h.strip().lower() for h in all_rows[0]]
    col_map = {name: idx for idx, name in enumerate(header)}

    if "part" not in col_map:
        return [], ["coluna obrigatória ausente: 'part'"], []

    dim_cols: list[tuple[int, str]] = [
        (idx, name.upper())
        for name, idx in col_map.items()
        if name and name not in MEASUREMENT_FIXED
    ]

    records: list[dict] = []
    errors: list[str] = []

    def _cell(row: list[str], col: str) -> str | None:
        idx = col_map.get(col)
        if idx is None or idx >= len(row):
            return None
        v = row[idx].strip()
        return v if v else None

    for row_idx, row in enumerate(all_rows[1:], start=2):
        part_raw = _cell(row, "part")
        if part_raw is None:
            continue

        try:
            part_number = _positive_integer(part_raw)
        except (ValueError, TypeError):
            errors.append(f"linha {row_idx}: Part inválido ({part_raw!r})")
            continue

        operator = _cell(row, "operator")
        instrument = _cell(row, "instrument")
        fixture = _cell(row, "fixture")
        work_order = _cell(row, "work_order")
        dt = _parse_measurement_date(_cell(row, "measurement date"))

        cavity_raw = _cell(row, "cavity")
        cavity: int | None = None
        if cavity_raw is not None:
            try:
                cavity = _positive_integer(cavity_raw)
            except (ValueError, TypeError):
                errors.append(f"linha {row_idx}: cavity inválido ({cavity_raw!r})")
                continue

        for col_idx, dim_code in dim_cols:
            if col_idx >= len(row):
                continue
            val_raw = row[col_idx].strip() if col_idx < len(row) else ""
            if not val_raw:
                continue
            try:
                measured_value = _finite_float(val_raw)
            except ValueError:
                errors.append(f"linha {row_idx}, dim {dim_code}: valor inválido ({val_raw!r})")
                continue

            records.append(
                {
                    "dim_code": dim_code,
                    "part_number": part_number,
                    "measured_value": measured_value,
                    "date_time": dt,
                    "operator": operator,
                    "instrument": instrument,
                    "fixture": fixture,
                    "work_order": work_order,
                    "cavity": cavity,
                    "source_row": row_idx,
                }
            )

    return records, errors, []
