# Modelo de dados

## Visão conceitual

O modelo organiza dados de qualidade em uma hierarquia rastreável:

```text
Fornecedor -> Lote -> Inspeção (peça medida + valor) -> Dimensão
                    |                              |
                    |                              +-> histórico da dimensão
                    +-> decisão / pós-decisão
                    +-> histórico de desconsideração
```

Os nomes físicos e restrições definitivos são as migrações versionadas do backend. Este documento descreve o contrato conceitual para leitura acadêmica.

## Entidades principais

### Fornecedor

Representa uma origem fictícia usada na comparação. O seed usa apenas identificadores e nomes sintéticos. Não há vínculo com cadastro real.

### Lote

Agrupa peças recebidas sob um código de lote, fornecedor e contexto de inspeção. O código é identificador de negócio dentro das restrições definidas pelas migrações; chaves técnicas continuam sendo a referência entre tabelas.

Campos conceituais:

- identificador técnico;
- código do lote;
- fornecedor;
- desenho e revisão, quando aplicável;
- datas de recebimento e inspeção;
- estado de decisão;
- timestamps de criação, alteração e exclusão lógica.

### Peça medida

A unidade amostrada é representada pelo número da peça dentro dos registros de inspeção do lote. Não há necessidade de uma entidade autônoma para a peça física: a combinação lote, dimensão e número da peça sustenta ordenação e detecção de duplicidade.

### Dimensão

Define a característica inspecionada e seus limites de especificação. Inclui, conforme o tipo:

- nome ou código da característica;
- tipo dimensional;
- unidade;
- valor nominal;
- limite inferior de especificação (LSL);
- limite superior de especificação (USL);
- tolerâncias declaradas;
- desenho e revisão;
- código de rastreamento, quando aplicável.

Os tipos contemplam dimensões lineares, diâmetro, slab, ângulo e características unilaterais. O significado e as regras de cada tipo são descritos em [Cálculos e validação](CALCULOS-E-VALIDACAO.md).

### Inspeção / medição

Associa lote, número da peça e dimensão ao valor observado, além de metadados como data, instrumento, operador e cavidade. Restrições de unicidade impedem que a mesma combinação seja gravada duas vezes pelo mesmo fluxo de importação.

### Histórico da dimensão

Registra alteração de especificação ou metadados relevantes da dimensão, preservando rastreabilidade da configuração aplicada aos cálculos.

### Decisão e pós-decisão

Mantém a avaliação do lote e o acompanhamento posterior. A interface deve diferenciar claramente valor medido, classificação calculada e decisão registrada por uma pessoa na demonstração.

### Ignorar / reativar

A exclusão lógica ou marcação de ignorado retira um registro das análises aplicáveis sem apagar a evidência histórica. O motivo é obrigatório quando o contrato da API assim define. A reativação desfaz o estado e volta a incluir o registro nos agregados.

## Relacionamentos e integridade

- um fornecedor possui zero ou mais lotes;
- um lote possui zero ou mais inspeções, identificadas por número de peça e dimensão;
- cada número de peça pode ter medições para as dimensões aplicáveis;
- uma dimensão pode ser reutilizada conforme desenho e revisão permitidos;
- medições referenciam chaves existentes;
- ações de decisão e ignorar preservam timestamps e histórico;
- deleção física não faz parte do fluxo normal da demonstração.

As migrações são a fonte executável para nulabilidade, índices, enumerações, unicidade e cascatas.

## Derivações

Média, desvio-padrão, limites observados, capacidade e classificações são derivados das medições e especificações. Não devem ser tratados como fatos independentes sem versão da regra. Quando valores derivados forem materializados por desempenho, devem ser recalculáveis e ter origem identificável.

## Dados sintéticos

Todos os identificadores de negócio, medições e fornecedores do seed foram construídos para demonstração. Coincidências com entidades reais são acidentais. Veja [Base sintética](BASE-SINTETICA.md).
