# Formatos de importação

A especificação executável e atualizada dos campos fica junto ao importador do backend em [`backend/app/sqc/IMPORT_FORMATS.md`](../backend/app/sqc/IMPORT_FORMATS.md). Este documento apresenta as regras transversais e o procedimento seguro; não duplica cabeçalhos que possam mudar durante a implementação.

## Princípios

- aceite somente os formatos documentados pelo backend;
- use UTF-8 e separador conforme indicado na especificação executável;
- preserve cabeçalhos exatamente como documentados;
- represente números com o separador decimal definido no contrato;
- não inclua fórmulas, macros, links externos ou dados reais;
- valide toda a carga antes de persistir linhas;
- informe erros por arquivo, linha e campo sem devolver conteúdo sensível;
- trate importação repetida por regra explícita de idempotência ou duplicidade.

## Categorias de arquivo

A aplicação trabalha com duas categorias conceituais:

1. **definição dimensional** — desenho/revisão, característica, tipo, unidade, nominal e tolerâncias;
2. **resultados de inspeção** — lote, fornecedor fictício, peça e valores medidos.

A ordem de carga e os campos obrigatórios são definidos em `IMPORT_FORMATS.md`. Quando uma medição depende de uma dimensão, a dimensão deve existir ou ser criada pelo fluxo previsto antes de a medição ser aceita.

## Validações esperadas

### Estrutura

- extensão e tipo permitidos;
- arquivo não vazio e dentro do limite de tamanho;
- codificação e cabeçalhos reconhecidos;
- número consistente de colunas;
- ausência de colunas obrigatórias vazias.

### Domínio

- números finitos e unidade válida;
- tipos dimensionais conhecidos;
- limites coerentes com nominal e tolerância;
- revisão e chaves de negócio em formato aceito;
- lote e peça identificáveis;
- fornecedor pertencente apenas ao conjunto sintético de demonstração.

### Consistência

- ausência de duplicidade dentro do arquivo;
- comportamento determinístico para item já persistido;
- referências existentes;
- nenhuma gravação parcial quando a validação global falha.

## Preview e confirmação dimensional

O preview dimensional é somente leitura e usa o mesmo plano de validação da confirmação. Ele classifica cada linha como nova, inalterada ou sobrescrita, lista somente os campos efetivamente diferentes e expõe `coordinate_axis` e `related_size_dim_code` para relações direcionais.

A validação considera conjuntamente as dimensões e relações já persistidas e as linhas do CSV. Assim, conflitos com eixos existentes, terceira relação direcional, referências ausentes e natureza incompatível de dimensões de tamanho são detectados antes da escrita. Relações explicitamente reenviadas podem trocar eixos de forma atômica, inclusive X↔Y, sem conflito transitório.

A confirmação recalcula o plano a partir do arquivo. Se houver qualquer erro global ou de linha, toda a importação dimensional é rejeitada sem criar dimensões, relações ou histórico parcial. Se não houver erro, as alterações de campos e relações devem corresponder ao diff apresentado pelo preview para o mesmo estado inicial do banco.

## Erro e duplicidade

Um arquivo inválido deve produzir mensagem acionável e não alterar agregados. Uma segunda importação do mesmo arquivo deve ser rejeitada como duplicada ou tratada como operação idempotente, conforme contrato do backend. Em resultados de inspeção, repetições metrológicas legítimas não são duplicidades: a identidade idempotente combina o digest do arquivo, a linha de origem e a dimensão. O teste e2e exige que a interface comunique o resultado; ele não presume um endpoint ou código HTTP específico.

## Exemplo seguro

Use apenas os modelos e arquivos produzidos pelo seed sintético. Nunca copie planilhas operacionais para este repositório. Antes de compartilhar uma alteração, execute:

```sh
make sanitize
```

## Evolução do contrato

Ao mudar o importador:

1. atualize primeiro `backend/app/sqc/IMPORT_FORMATS.md`;
2. ajuste validadores e testes unitários;
3. atualize fixtures sintéticas e cenários e2e;
4. registre incompatibilidades neste documento somente quando forem transversais;
5. execute `make verify`.
