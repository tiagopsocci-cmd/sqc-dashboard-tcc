"""Serializacao de medicoes para exportacao (CSV/TXT/XLSX) - spec 252 + melhorias SQC.

CSV/TXT levam BOM UTF-8 (\\ufeff) para abrir corretamente acentuacao no Excel; XLSX nao
precisa (openpyxl ja escreve strings Unicode nativamente na planilha).
"""

import csv
import io

from openpyxl import Workbook

BOM = "﻿"

MEASUREMENT_COLUMNS = [
    "batch_tracking_code",
    "part_number",
    "cavity",
    "operator",
    "date_time",
    "instrument",
    "measured_value",
    "deviation",
    "bonus",
    "tolerance_used_pct",
    "is_ignored",
    "ignored_reason",
]

_FORMULA_PREFIXES = ("=", "+", "-", "@")


def _safe_cell(value: object) -> object:
    """Prevent exported user text from becoming a spreadsheet formula."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def _safe_rows(rows: list[list[object]]) -> list[list[object]]:
    return [[_safe_cell(value) for value in row] for row in rows]


def measurements_csv(rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=",")
    writer.writerow(MEASUREMENT_COLUMNS)
    writer.writerows(_safe_rows(rows))
    return BOM + buffer.getvalue()


def measurements_txt(rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    writer.writerow(MEASUREMENT_COLUMNS)
    writer.writerows(_safe_rows(rows))
    return BOM + buffer.getvalue()


def measurements_xlsx(rows: list[list[object]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "measurements"
    ws.append(MEASUREMENT_COLUMNS)
    for row in _safe_rows(rows):
        ws.append(row)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
