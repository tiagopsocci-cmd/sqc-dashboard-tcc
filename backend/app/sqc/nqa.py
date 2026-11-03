"""Cálculo NQA/AQL conforme NBR 5426 / ISO 2859-1.

Implementa:
- Tabela I: tamanho do lote → letra de código (níveis I, II, III)
- Tabela II-A: planos de amostragem simples, inspeção normal
"""

from __future__ import annotations

from dataclasses import dataclass

# ── Tabela I — Letras por nível de inspeção ────────────────────────────────────
# (min, max): [nivel_I, nivel_II, nivel_III]
_LOT_SIZE_TABLE: list[tuple[tuple[int, int], list[str]]] = [
    ((2, 8), ["A", "A", "B"]),
    ((9, 15), ["A", "B", "C"]),
    ((16, 25), ["B", "C", "D"]),
    ((26, 50), ["C", "D", "E"]),
    ((51, 90), ["C", "E", "F"]),
    ((91, 150), ["D", "F", "G"]),
    ((151, 280), ["E", "G", "H"]),
    ((281, 500), ["F", "H", "J"]),
    ((501, 1200), ["G", "J", "K"]),
    ((1201, 3200), ["H", "K", "L"]),
    ((3201, 10000), ["J", "L", "M"]),
    ((10001, 35000), ["K", "M", "N"]),
    ((35001, 150000), ["L", "N", "P"]),
    ((150001, 500000), ["M", "P", "Q"]),
    ((500001, 10**9), ["N", "Q", "R"]),
]

_LEVEL_INDEX = {"I": 0, "II": 1, "III": 2}

# ── Tabela II-A — Planos de amostragem simples (inspeção normal) ───────────────
_LETTERS_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"]

AQL_VALUES = [
    0.010,
    0.015,
    0.025,
    0.040,
    0.065,
    0.10,
    0.15,
    0.25,
    0.40,
    0.65,
    1.0,
    1.5,
    2.5,
    4.0,
    6.5,
    10,
    15,
    25,
    40,
    65,
    100,
    150,
    250,
    400,
    650,
    1000,
]

# Sentinelas para setas da tabela
_D = "down"  # ↓ usar plano abaixo (amostra maior)
_U = "up"  # ↑ usar plano acima (amostra menor)

# Estrutura: letra → (n, {aql: (Ac, Re) | "down" | "up"})
# Dados transcritos integralmente do CSV da NBR 5426 / ISO 2859-1 Tabela II-A.
_RAW_TABLE: dict[str, tuple[int, dict[float, tuple[int, int] | str]]] = {
    "A": (
        2,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: _D,
            1.0: _D,
            1.5: _D,
            2.5: _D,
            4.0: _D,
            6.5: (0, 1),
            10: _D,
            15: _D,
            25: (1, 2),
            40: (2, 3),
            65: (3, 4),
            100: (5, 6),
            150: (7, 8),
            250: (10, 11),
            400: (14, 15),
            650: (21, 22),
            1000: (30, 31),
        },
    ),
    "B": (
        3,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: _D,
            1.0: _D,
            1.5: _D,
            2.5: _D,
            4.0: (0, 1),
            6.5: _U,
            10: _D,
            15: (1, 2),
            25: (2, 3),
            40: (3, 4),
            65: (5, 6),
            100: (7, 8),
            150: (10, 11),
            250: (14, 15),
            400: (21, 22),
            650: (30, 31),
            1000: (44, 45),
        },
    ),
    "C": (
        5,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: _D,
            1.0: _D,
            1.5: _D,
            2.5: (0, 1),
            4.0: _U,
            6.5: _D,
            10: (1, 2),
            15: (2, 3),
            25: (3, 4),
            40: (5, 6),
            65: (7, 8),
            100: (10, 11),
            150: (14, 15),
            250: (21, 22),
            400: (30, 31),
            650: (44, 45),
            1000: _U,
        },
    ),
    "D": (
        8,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: _D,
            1.0: _D,
            1.5: (0, 1),
            2.5: _U,
            4.0: _D,
            6.5: (1, 2),
            10: (2, 3),
            15: (3, 4),
            25: (5, 6),
            40: (7, 8),
            65: (10, 11),
            100: (14, 15),
            150: (21, 22),
            250: (30, 31),
            400: (44, 45),
            650: _U,
            1000: _U,
        },
    ),
    "E": (
        13,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: _D,
            1.0: (0, 1),
            1.5: _U,
            2.5: _D,
            4.0: (1, 2),
            6.5: (2, 3),
            10: (3, 4),
            15: (5, 6),
            25: (7, 8),
            40: (10, 11),
            65: (14, 15),
            100: (21, 22),
            150: (30, 31),
            250: (44, 45),
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "F": (
        20,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: _D,
            0.65: (0, 1),
            1.0: _U,
            1.5: _D,
            2.5: (1, 2),
            4.0: (2, 3),
            6.5: (3, 4),
            10: (5, 6),
            15: (7, 8),
            25: (10, 11),
            40: (14, 15),
            65: (21, 22),
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "G": (
        32,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: _D,
            0.40: (0, 1),
            0.65: _U,
            1.0: _D,
            1.5: (1, 2),
            2.5: (2, 3),
            4.0: (3, 4),
            6.5: (5, 6),
            10: (7, 8),
            15: (10, 11),
            25: (14, 15),
            40: (21, 22),
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "H": (
        50,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: _D,
            0.25: (0, 1),
            0.40: _U,
            0.65: _D,
            1.0: (1, 2),
            1.5: (2, 3),
            2.5: (3, 4),
            4.0: (5, 6),
            6.5: (7, 8),
            10: (10, 11),
            15: (14, 15),
            25: (21, 22),
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "J": (
        80,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: _D,
            0.15: (0, 1),
            0.25: _U,
            0.40: _D,
            0.65: (1, 2),
            1.0: (2, 3),
            1.5: (3, 4),
            2.5: (5, 6),
            4.0: (7, 8),
            6.5: (10, 11),
            10: (14, 15),
            15: (21, 22),
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "K": (
        125,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: _D,
            0.10: (0, 1),
            0.15: _U,
            0.25: _D,
            0.40: (1, 2),
            0.65: (2, 3),
            1.0: (3, 4),
            1.5: (5, 6),
            2.5: (7, 8),
            4.0: (10, 11),
            6.5: (14, 15),
            10: (21, 22),
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "L": (
        200,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: _D,
            0.065: (0, 1),
            0.10: _U,
            0.15: _D,
            0.25: (1, 2),
            0.40: (2, 3),
            0.65: (3, 4),
            1.0: (5, 6),
            1.5: (7, 8),
            2.5: (10, 11),
            4.0: (14, 15),
            6.5: (21, 22),
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "M": (
        315,
        {
            0.010: _D,
            0.015: _D,
            0.025: _D,
            0.040: (0, 1),
            0.065: _U,
            0.10: _D,
            0.15: (1, 2),
            0.25: (2, 3),
            0.40: (3, 4),
            0.65: (5, 6),
            1.0: (7, 8),
            1.5: (10, 11),
            2.5: (14, 15),
            4.0: (21, 22),
            6.5: _U,
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "N": (
        500,
        {
            0.010: _D,
            0.015: _D,
            0.025: (0, 1),
            0.040: _U,
            0.065: _D,
            0.10: (1, 2),
            0.15: (2, 3),
            0.25: (3, 4),
            0.40: (5, 6),
            0.65: (7, 8),
            1.0: (10, 11),
            1.5: (14, 15),
            2.5: (21, 22),
            4.0: _U,
            6.5: _U,
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "P": (
        800,
        {
            0.010: _D,
            0.015: (0, 1),
            0.025: _U,
            0.040: _D,
            0.065: (1, 2),
            0.10: (2, 3),
            0.15: (3, 4),
            0.25: (5, 6),
            0.40: (7, 8),
            0.65: (10, 11),
            1.0: (14, 15),
            1.5: (21, 22),
            2.5: _U,
            4.0: _U,
            6.5: _U,
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "Q": (
        1250,
        {
            0.010: (0, 1),
            0.015: _U,
            0.025: _D,
            0.040: (1, 2),
            0.065: (2, 3),
            0.10: (3, 4),
            0.15: (5, 6),
            0.25: (7, 8),
            0.40: (10, 11),
            0.65: (14, 15),
            1.0: (21, 22),
            1.5: _U,
            2.5: _U,
            4.0: _U,
            6.5: _U,
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
    "R": (
        2000,
        {
            0.010: _U,
            0.015: _U,
            0.025: (1, 2),
            0.040: (2, 3),
            0.065: (3, 4),
            0.10: (5, 6),
            0.15: (7, 8),
            0.25: (10, 11),
            0.40: (14, 15),
            0.65: (21, 22),
            1.0: _U,
            1.5: _U,
            2.5: _U,
            4.0: _U,
            6.5: _U,
            10: _U,
            15: _U,
            25: _U,
            40: _U,
            65: _U,
            100: _U,
            150: _U,
            250: _U,
            400: _U,
            650: _U,
            1000: _U,
        },
    ),
}


def _get_letter(batch_size: int, inspection_level: str) -> str:
    idx = _LEVEL_INDEX.get(inspection_level.upper(), 1)
    for (lo, hi), letters in _LOT_SIZE_TABLE:
        if lo <= batch_size <= hi:
            return letters[idx]
    return "R"


def get_letter_from_inspected(inspected: int) -> str:
    """Retorna a letra da Tabela II-A cujo tamanho de amostra é mais próximo ao inspecionado."""
    return min(_LETTERS_ORDER, key=lambda lt: abs(_RAW_TABLE[lt][0] - inspected))


def _resolve_plan(letter: str, aql: float) -> tuple[int, int, int]:
    """Retorna (sample_size, Ac, Re) resolvendo setas da Tabela II-A.

    Seta ↓ ("down"): usar plano abaixo — avança para letras com amostras maiores.
    Seta ↑ ("up"):   usar plano acima — recua para letras com amostras menores.
    A direção é determinada pela célula original e seguida até a primeira célula
    com valores diretos (Ac, Re).
    """
    closest_aql = min(AQL_VALUES, key=lambda v: abs(v - aql))
    letter_idx = _LETTERS_ORDER.index(letter) if letter in _LETTERS_ORDER else 7

    entry = _RAW_TABLE.get(letter)
    if not entry:
        return 2, 0, 1
    n, aql_map = entry
    cell = aql_map.get(closest_aql)

    if isinstance(cell, tuple):
        return n, cell[0], cell[1]

    direction = 1 if cell == _D else -1
    idx = letter_idx + direction
    while 0 <= idx < len(_LETTERS_ORDER):
        cur_letter = _LETTERS_ORDER[idx]
        cur_entry = _RAW_TABLE.get(cur_letter)
        if not cur_entry:
            break
        cur_n, cur_aql_map = cur_entry
        cur_cell = cur_aql_map.get(closest_aql)
        if isinstance(cur_cell, tuple):
            return cur_n, cur_cell[0], cur_cell[1]
        idx += direction

    return n, 0, 1


@dataclass
class NqaResult:
    batch_size: int | None
    inspection_level: str
    aql: float
    letter: str
    required_sample_size: int
    acceptance_number: int
    rejection_number: int
    inspected: int
    non_conforming: int
    status: str  # "ACEITO" | "REJEITADO" | "AMOSTRA_INSUFICIENTE"
    achieved_aql: float | None = None
    non_evaluable_count: int = 0
    diagnostic_incomplete_count: int = 0


def calculate_nqa(
    batch_size: int,
    inspection_level: str,
    aql: float,
    inspected: int,
    non_conforming: int,
) -> NqaResult:
    letter = _get_letter(batch_size, inspection_level)
    required_n, ac, re = _resolve_plan(letter, aql)

    if inspected < required_n:
        status = "AMOSTRA_INSUFICIENTE"
    elif non_conforming <= ac:
        status = "ACEITO"
    else:
        status = "REJEITADO"

    return NqaResult(
        batch_size=batch_size,
        inspection_level=inspection_level,
        aql=aql,
        letter=letter,
        required_sample_size=required_n,
        acceptance_number=ac,
        rejection_number=re,
        inspected=inspected,
        non_conforming=non_conforming,
        status=status,
        achieved_aql=calculate_achieved_aql(inspected, non_conforming),
    )


def calculate_achieved_aql(inspected: int, non_conforming: int) -> float | None:
    """Retorna o menor AQL padrão cujo Ac acomoda as não conformidades observadas,
    considerando apenas os planos diretos (células sem seta) da letra cujo tamanho
    de amostra tabelado é o mais próximo do n real inspecionado.

    Diferente de calculate_nqa(), não usa o AQL/letra alvo do lote — resolve a
    letra pela amostra real via get_letter_from_inspected(). Não segue as setas
    ↑/↓ da Tabela II-A (usadas por _resolve_plan para montar um plano quando a
    letra alvo não tem célula direta): seguir uma seta troca implicitamente o
    tamanho de amostra para o de outra letra, o que invalidaria a premissa de
    que o cálculo é sobre o n real efetivamente inspecionado.
    """
    if inspected <= 0:
        return None

    letter = get_letter_from_inspected(inspected)
    _, aql_map = _RAW_TABLE[letter]

    for aql in AQL_VALUES:
        cell = aql_map.get(aql)
        if isinstance(cell, tuple) and non_conforming <= cell[0]:
            return aql

    return AQL_VALUES[-1]
