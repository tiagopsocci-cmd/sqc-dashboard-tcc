# Cálculos e validação

## Convenções

Considere uma amostra válida com valores \(x_1, \ldots, x_n\), limite inferior de especificação \(LSL\) e limite superior de especificação \(USL\). Nem todo tipo dimensional possui os dois limites.

- **Média:** \(\bar{x} = \frac{1}{n}\sum x_i\)
- **Desvio-padrão amostral:** \(s = \sqrt{\frac{\sum(x_i-\bar{x})^2}{n-1}}\), somente para \(n \ge 2\)
- **Amplitude:** \(R = \max(x_i)-\min(x_i)\)
- **Contagem não conforme:** valores abaixo de um LSL existente ou acima de um USL existente
- **Percentual não conforme:** contagem não conforme dividida pelo total de valores válidos

Arredondamento deve ocorrer apenas na apresentação. Comparações e agregações usam a precisão armazenada e uma política numérica consistente.

## Limites de especificação

Os limites vêm da dimensão cadastrada, não da amostra observada.

Para tolerância bilateral expressa como desvios do nominal:

- \(LSL = nominal + tolerância\ inferior\)
- \(USL = nominal + tolerância\ superior\)

Para dimensão unilateral, somente o lado especificado participa da validação e dos indicadores. A ausência de um limite não equivale a zero e não autoriza criar um limite artificial. Em especial, um LSL calculado não deve ser forçado a valor negativo quando isso contradiz a definição física e a regra dimensional.

## Capacidade

Quando os pré-requisitos estatísticos e de amostra forem satisfeitos, os índices de curto prazo usam `std_short` e os índices de longo prazo usam `std_long`:

- \(Cp = \frac{USL-LSL}{6\sigma_{short}}\)
- \(Cpk = \min(\frac{USL-\bar{x}}{3\sigma_{short}}, \frac{\bar{x}-LSL}{3\sigma_{short}})\)
- capacidade superior unilateral: \(Cpu = \frac{USL-\bar{x}}{3\sigma_{short}}\)
- capacidade inferior unilateral: \(Cpl = \frac{\bar{x}-LSL}{3\sigma_{short}}\)
- \(Pp = \frac{USL-LSL}{6\sigma_{long}}\)
- \(Ppk = \min(\frac{USL-\bar{x}}{3\sigma_{long}}, \frac{\bar{x}-LSL}{3\sigma_{long}})\)

A API devolve em `capability_basis` a base matemática efetivamente usada pelos índices: metodologia, `n`, limites, nominal, média e desvios de curto e longo prazo. Esses campos são canônicos para recompor os índices; os campos descritivos da resposta podem pertencer a outro espaço físico.

As metodologias possíveis são:

- `raw_measurements`: índices e descritivos usam as medições físicas;
- `bonus_normalized_ratio`: cada leitura posicional é dividida pelo limite efetivo da respectiva unidade física, incluindo o bônus MMC/LMC; os índices usam o ratio unilateral com `USL = 1`;
- `rectangle_consolidated_ratio`: cada unidade física de uma posição `RECTANGLE` é consolidada direcionalmente e os índices usam sua maior utilização absoluta normalizada, também com `USL = 1`.

Quando há normalização por bônus, `Cp`, `Cpk`, `Cpu`, `Cpl`, `Pp`, `Ppk` e DPPM pertencem todos ao mesmo espaço de ratio. Média, mínimo, máximo, amplitude e desvios apresentados como descritivos continuam em unidades físicas e não devem ser combinados com esses índices. Na capability agrupada, `mean`, `std_pooled` e `std_global` também permanecem descritivos brutos; a base normalizada está somente em `capability_basis`.

Em posições `RECTANGLE`, repetições direcionais da mesma unidade física são preservadas na importação. Para cada eixo, a consolidação escolhe a leitura de maior utilização absoluta; depois, a unidade é consolidada pela maior utilização entre os eixos. A tabela de detalhes e a exportação tabular ainda partem das leituras da dimensão-pai: uma posição composta somente por leituras direcionais participa dos cálculos e da distribuição, mas não produz linha de detalhe/exportação até existir um contrato específico para representar e editar uma linha sintética.

Não calcular ou não exibir como conclusivo quando:

- `n` está abaixo do mínimo definido pelo produto;
- o desvio aplicável é zero ou não é finito;
- faltam limites necessários para o índice escolhido;
- os dados falham em validação;
- os pressupostos do indicador não foram avaliados.

A interface deve distinguir “não calculável” de zero e identificar quando os índices estão em ratio normalizado.

## Tipos dimensionais

- **Linear:** valor em unidade linear e limites bilaterais ou unilaterais.
- **Diâmetro:** característica explicitamente circular; não deve ser inferida apenas pelo nome.
- **Slab:** característica explicitamente classificada; segue limites cadastrados.
- **Ângulo:** unidade angular e validação coerente com sua representação.
- **Unilateral:** possui apenas limite inferior ou superior aplicável.

A classificação explícita evita heurísticas por texto e torna cálculo, filtro e apresentação consistentes.

## Agregação e comparação

Comparações entre fornecedores usam o mesmo filtro, período, característica e regra estatística. Não se deve ordenar fornecedores por métricas incomparáveis, amostras insuficientes ou conjuntos com dimensões diferentes sem normalização claramente informada.

Registros ignorados são excluídos apenas das agregações para as quais a regra determina essa exclusão; permanecem rastreáveis. Ao reativar, os agregados devem ser recalculados.

## Importação

Antes de qualquer cálculo, a API valida:

- presença e formato dos campos;
- número finito, sem `NaN` ou infinito;
- unidade e tipo dimensional;
- coerência entre nominal, tolerâncias e limites;
- duplicidades no arquivo e no banco;
- referências de lote, peça, desenho e revisão;
- transação completa ou falha sem efeito parcial.

## Estratégia de validação

1. **Testes unitários:** fórmulas, limites, bordas numéricas e regras por tipo.
2. **Testes de integração:** importação, persistência, filtros, decisões e exportações.
3. **Testes e2e:** comportamento observável nos fluxos de demonstração.
4. **Oráculos manuais:** pequenos conjuntos com resultado calculável à mão.
5. **Casos metamórficos:** translação, repetição e reordenação quando matematicamente aplicáveis.

## Interpretação

Indicadores de capacidade descrevem a amostra e os pressupostos aplicados; não provam estabilidade nem causalidade. A demonstração não inclui validação de sistema de medição, normalidade, independência, estabilidade temporal ou plano de amostragem real. Toda conclusão técnica exige análise externa ao software.
