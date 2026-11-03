# SQC — Formatos de importação (dimensões e medições)

Referência viva do que cada CSV/XLSX de importação do módulo `sqc` aceita. Existe porque as
regras reais (obrigatório vs. opcional, o que falha vs. o que é silenciosamente ignorado) estão
espalhadas entre `importer.py`, `router.py` e `service.py` e não são óbvias lendo só um arquivo.

**Se você mudar `DIMS_REQUIRED`/`DIMS_OPTIONAL`/`MEASUREMENT_FIXED` em `importer.py`, ou qualquer
regra de validação descrita aqui (`router.py`/`service.py`), atualize este arquivo na mesma alteração.** O teste `tests/test_import_docs.py` garante que o
*inventário* de colunas (os blocos marcados abaixo) não diverge de `importer.py` — mas não valida
a semântica em prosa, isso depende de disciplina manual.

---

## 1. CSV de dimensões (`POST /api/sqc/parts/{part_id}/import-dims`)

Parser: `parse_dims_csv` em `importer.py`. Preview (não persiste):
`POST /api/sqc/parts/{part_id}/import-dims-preview`.
Encoding aceito: UTF-8 (com ou sem BOM), Windows-1252, latin-1 (fallback). Delimitador: vírgula
ou ponto-e-vírgula (auto-detectado pela primeira linha).

### Colunas obrigatórias

<!-- DIMS_REQUIRED_COLUMNS -->
```
dim_code, nominal, tol_plus, type
```
<!-- END_DIMS_REQUIRED_COLUMNS -->

| Coluna | Regras |
|---|---|
| `dim_code` | Chave única por peça. Convertido para MAIÚSCULO automaticamente. Vazio → linha rejeitada. |
| `nominal` | Número (float). Não numérico → linha rejeitada. |
| `tol_plus` | Número (float). Para `type=POSITION`, é o **diâmetro** da zona (raio = `tol_plus/2`). |
| `type` | Um dos valores de `DimType` (`DISTANCE`, `DIAMETER`, `SLAB`, `ANGLE`, `POSITION`, `FLATNESS`, `CYLINDRICITY`, `ROUNDNESS`, `STRAIGHTNESS`, `PARALLELISM`, `PERPENDICULARITY`, `ANGULARITY`, `CONCENTRICITY`, `SYMMETRY`, `PROFILE_SURFACE`, `PROFILE_LINE`, `RUNOUT_CIRCULAR`, `RUNOUT_TOTAL`). Valor fora da lista → linha rejeitada. Só é validado ao **criar** uma dim nova — reimportar uma dim existente não atualiza `type`. |

### Colunas opcionais

<!-- DIMS_OPTIONAL_COLUMNS -->
```
tol_minus, sub_type, drawing_revision, dim_name, parent_dim_code, dim_rel_1_code, dim_rel_2_code, material_modifier, position_geometry, coordinate_axis, related_size_dim_code
```
<!-- END_DIMS_OPTIONAL_COLUMNS -->

| Coluna | Pode conter | Cuidado / o que acontece se errar |
|---|---|---|
| `tol_minus` | Número. Vazio → `NULL` (dim unilateral, sem LSL). | Não numérico (e não vazio) → linha rejeitada. |
| `sub_type` | `HOLE`, `SHAFT`, `SLOT`, `WIDTH`, `NONE`. | Em dimensão nova, valor inválido gera erro explícito no preview e bloqueia toda a confirmação. Relevante para RECTANGLE+modificador: se essa dim for usada como `related_size_dim_code`, precisa classificar interno (`HOLE`/`SLOT`) ou externo (`SHAFT`/`WIDTH`); `NONE`/vazio é rejeitado (422). |
| `drawing_revision` | Texto livre. | Participa do diff de uma dimensão existente; somente alterações efetivas são persistidas e registradas no histórico. |
| `dim_name` | Texto livre. | Participa do diff de uma dimensão existente. |
| `parent_dim_code` | `dim_code` de outra dim da mesma peça (pode aparecer depois no CSV — resolvido em 2ª passagem). | Código não encontrado gera erro explícito no preview e bloqueia toda a confirmação. Para RECTANGLE, a referência resolvida identifica a posição-pai da relação direcional. |
| `dim_rel_1_code` / `dim_rel_2_code` | `dim_code` de outra dim (mecanismo legado, independente de RECTANGLE). | Código não encontrado gera erro explícito no preview e bloqueia toda a confirmação. |
| `material_modifier` | `M` (MMC) ou `L` (LMC) — só faz sentido em `type=POSITION`. | Em dimensão nova, valor inválido gera erro explícito e bloqueia toda a confirmação. Preencher junto com `position_geometry=LINE` também é rejeitado; `material_modifier` não é aplicável a `LINE` (FR-004). |
| `position_geometry` | `CIRCULAR`, `RECTANGLE` ou `LINE` (feature 061). | É obrigatório em toda dimensão nova com `type=POSITION`; valor ausente ou inválido, ou preenchimento em outro tipo, gera erro explícito e bloqueia toda a confirmação. `LINE` não usa `coordinate_axis`/`related_size_dim_code` — nenhuma coordenada de extremidade é persistida nesta versão (ver `specs/061-sqc-line-position/spec.md`). |
| `coordinate_axis` | `X`, `Y` ou `Z` — só tem efeito na linha de uma dim cujo `parent_dim_code` resolvido aponta para uma posição RECTANGLE. | Obrigatório para uma cota nova de posição RECTANGLE. Reimportar cota existente sem repetir a coluna preserva a relação persistida. Eixo inválido, conflito com relação persistida ou planejada, ou 3ª relação numa posição gera erro no preview e bloqueia toda a confirmação. Relações explicitamente reenviadas podem trocar eixos X↔Y atomicamente. |
| `related_size_dim_code` | `dim_code` de uma dim de tamanho da mesma peça. | Pode ficar vazio quando não há bônus nessa direção. Código não encontrado gera erro explícito e bloqueia toda a confirmação. Com modificador, o `sub_type` referenciado precisa classificar interno/externo, e a natureza deve ser consistente entre as duas relações (misturar interno com externo é rejeitado, 422, FR-007). |

### Preview e confirmação

O preview é somente leitura e usa as mesmas dimensões e relações persistidas consideradas pela confirmação. Para cada linha, ele informa o status (`new`, `unchanged` ou `overwritten`), somente os campos alterados e, quando preenchidos, `coordinate_axis` e `related_size_dim_code`. Alteração apenas de eixo ou dimensão de tamanho também classifica a linha como `overwritten`.

A confirmação é all-or-nothing: qualquer erro global ou por linha retorna 422 antes da escrita, sem dimensão, relação ou histórico parcial. Para o mesmo arquivo e o mesmo estado inicial do banco, o diff confirmado corresponde ao preview. Uma reimportação sem diferenças é classificada como inalterada.

### Checklist para uma posição RECTANGLE com MMC/LMC

1. Linha da posição: `type=POSITION`, `position_geometry=RECTANGLE`, `material_modifier=M` ou `L`.
2. Duas linhas de cota de coordenada: `parent_dim_code` = código da posição, `coordinate_axis` com dois eixos **distintos**.
3. `related_size_dim_code` de cada cota apontando para dims de tamanho já cadastradas (mesmo CSV ou antes), com `sub_type` preenchido e consistente (ambas internas ou ambas externas).

### Checklist para uma posição LINE (feature 061)

Uma linha só: `type=POSITION`, `position_geometry=LINE`, `nominal`/`tol_plus` do resultado único do formato de medição tabular. Sem `parent_dim_code`, sem `coordinate_axis`, sem `related_size_dim_code`, sem `material_modifier` — nenhuma coordenada de extremidade (P1/P2) é cadastrada nem persistida nesta versão (fora de escopo, ver `specs/061-sqc-line-position/spec.md`). Preencher `material_modifier` na mesma linha é rejeitado (erro explícito no preview e na confirmação, dim não criada).

---

## 2. Medições (`POST /api/sqc/batches/{batch_id}/import-measurements`)

Parser: `parse_measurements` em `importer.py` (formato "wide", uma coluna por dim — formato
formato de medição tabular). Aceita `.csv`, `.xlsx` e `.xlsm` (macro-enabled; nenhuma macro é executada, só os
valores de célula já salvos). Para `.xlsx`/`.xlsm`, `sheet_name` é opcional (default: aba ativa);
`list_xlsx_sheets` lista as abas disponíveis para a UI escolher. Preview (não persiste):
`POST /api/sqc/batches/{batch_id}/import-preview`.

### Coluna obrigatória

| Coluna | Regras |
|---|---|
| `part` (ou `Part`, case-insensitive) | Número da peça. Aceita somente inteiro positivo (inclusive representações como `1.0`); frações, zero, negativos e valores não finitos são rejeitados. Linha sem `part` é pulada silenciosamente. Valor inválido → erro explícito, linha descartada. |

### Colunas reservadas (nunca tratadas como dim_code)

<!-- MEASUREMENT_FIXED_COLUMNS -->
```
part, operator, instrument, fixture, work_order, measurement date, cavity, lote
```
<!-- END_MEASUREMENT_FIXED_COLUMNS -->

| Coluna | Pode conter | Observações |
|---|---|---|
| `operator` | Texto livre. | Opcional, um valor por linha/peça. |
| `instrument` | Texto livre (idealmente o código do instrumento cadastrado). | Opcional. |
| `fixture` | Texto livre. | Opcional. |
| `work_order` | Texto livre. | Opcional. |
| `measurement date` | Data/hora. Formatos aceitos, em ordem de tentativa: `%d/%m/%y %H:%M`, `%Y-%m-%dT%H:%M:%S`, `%Y-%m-%d %H:%M:%S`, `%d/%m/%Y %H:%M`, `%Y-%m-%d`, e por último `datetime.fromisoformat`. | Se vazio ou não reconhecido em nenhum formato → usa o instante da importação (`datetime.now()`), **sem erro**. |
| `cavity` | Número inteiro positivo da cavidade. | Vazio → `NULL` (não informado). Valor inválido → erro explícito e bloqueia integralmente a importação. |
| `lote` | — | Coluna **reservada e atualmente ignorada** pelo parser — existe só para não ser tratada como uma dim caso apareça na planilha. Não confunda com o lote (`SqcBatch`) da URL, que já vem do `batch_id`. |

### Qualquer outra coluna do cabeçalho = uma dimensão

Cada coluna que não está na lista reservada acima é tratada como `dim_code` (nome da coluna,
convertido para MAIÚSCULO). O valor da célula é a medição daquela dim para aquela peça/linha.

| Regra | Comportamento |
|---|---|
| Célula vazia | Ignorada (sem medição para aquela dim/peça, sem erro). |
| Valor não numérico | Erro explícito por célula e bloqueio integral: nenhuma medição do arquivo é gravada. |
| `dim_code` não cadastrado na peça | Aparece como `status="not_found"` no preview e bloqueia integralmente a confirmação. |
| Mesma dim + mesmo `part_number` em várias linhas | Todas as leituras são preservadas como repetições metrológicas legítimas, inclusive na mesma cavidade. |
| Reenvio dos mesmos bytes ao mesmo lote | A identidade `(digest do arquivo, linha de origem, dimensão)` torna a operação idempotente; a API responde conflito e não adiciona linhas. Um arquivo diferente pode conter novas repetições legítimas. |
| Qualquer erro de validação | A importação é all-or-nothing: retorna erro antes da persistência e não altera o lote. |
| `deviation` | Sempre calculado no momento da importação como `measured_value - dim.nominal` (usando o nominal **atual** da dim no banco, não um valor do arquivo). |

### Nota — endpoint legado

`POST /api/sqc/batches/{batch_id}/import` (`parse_csv`, formato antigo de uma linha por medição —
colunas `dim_code, part_number, measured_value, date_time` + opcionais `operator, instrument,
fixture, work_order`) ainda existe no backend, mas **não é usado pela tela atual**
(`ImportPage.tsx` chama só `import-measurements`). Mantido por compatibilidade de API, não é o
fluxo documentado/recomendado para novas importações.
