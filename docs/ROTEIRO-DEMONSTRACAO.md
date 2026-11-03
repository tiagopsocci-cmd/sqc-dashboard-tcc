# Roteiro de demonstração

## Preparação

1. Confirme que somente dados sintéticos estão presentes:

   ```sh
   make sanitize
   ```

2. Recrie a base de forma determinística:

   ```sh
   make reset-demo CONFIRM_RESET=RESET
   ```

3. Abra <http://127.0.0.1:8080> em uma janela limpa.
4. Mantenha visível o aviso de base sintética e não faça inferências sobre processos reais.

Tempo sugerido: 12 a 15 minutos.

## 1. Entrada sem login — 1 minuto

- Mostre que a aplicação abre diretamente, sem provedor de identidade.
- Explique que o modo sem login existe apenas para execução local e acadêmica.
- Aponte o endereço em loopback; API e banco não são publicados.

## 2. Quatro áreas — 2 minutos

Percorra as quatro rotas da aplicação:

1. **Painel SQC** (`/sqc`) — indicadores, cartas, distribuição, detalhes e modo de comparação.
2. **Importação** (`/sqc/import`) — lote, preview, confirmação e relatórios.
3. **Engenharia** (`/sqc/engenharia`) — peças, dimensões e PDF técnico.
4. **Instrumentos** (`/sqc/instruments`) — cadastro dos meios de medição usados nas inspeções.

A comparação de lotes e fornecedores fictícios é um modo do Painel SQC, selecionado pelo botão **Comparação de Lotes**; ela não inventa uma quinta rota.

## 3. Seed visível — 1 minuto

- Selecione uma peça `DEMO-*`.
- Mostre lotes, dimensões e medições já carregados.
- Destaque um caso dentro da especificação, um caso fora e uma dimensão unilateral.
- Reforce que os valores são construídos, não anonimizados de uma base real.

## 4. Comparação de fornecedores fictícios — 2 minutos

- No Painel SQC, ative **Comparação de Lotes**.
- Selecione lotes de ao menos dois fornecedores identificados como demonstração.
- Fixe peça, dimensão e filtros comuns.
- Compare tamanho amostral, média, dispersão e capacidade.
- Explique por que amostras insuficientes não devem ser ranqueadas como resultado conclusivo.

## 5. Importação e validação — 2 minutos

- Na rota de importação, selecione o arquivo sintético de exemplo indicado pela tela.
- Mostre o preview antes de persistir.
- Demonstre uma entrada inválida e localize a mensagem por linha/campo.
- Importe uma entrada válida.
- Repita a mesma importação e mostre a proteção contra duplicidade ou a resposta idempotente declarada.
- Confirme que a falha não altera os agregados.

## 6. Decisão e pós-decisão — 2 minutos

- Volte à análise de um lote em estado **Em análise**.
- Abra **Decidir lote**, revise o resumo de NQA e registre aprovação ou reprovação conforme o cenário sintético.
- Mostre o estado persistido e, no caso de reprovação, a justificativa.
- Tente editar o lote decidido e evidencie o bloqueio pós-decisão.
- Explique que a decisão registrada não substitui responsabilidade técnica real.

## 7. Desconsiderar e restaurar — 1 minuto

- Abra os detalhes de uma dimensão.
- Escolha uma medição e clique em **Desconsiderar**.
- Mostre que o motivo é obrigatório e registre um motivo sintético.
- Observe o recálculo dos indicadores e a permanência da linha na trilha.
- Clique em **Restaurar** e confirme o recálculo reverso.

## 8. Exportação e PDF — 2 minutos

- Exporte as medições filtradas em CSV e confira nome e cabeçalho do download.
- Mostre que o indicador de ignorado e o motivo aparecem na exportação quando aplicável.
- Abra os detalhes de uma peça que tenha relatório PDF sintético e use **Ver PDF**.
- Opcionalmente, mostre o desenho técnico sintético associado à revisão.
- Não use documentos reais como fixture.

## Encerramento

- Reitere as limitações estatísticas e de segurança.
- Mostre a matriz de funcionalidades e o relatório de testes.
- Encerre preservando dados com `make down` ou remova os volumes conscientemente.

## Plano de contingência

Se um fluxo estiver em evolução simultânea:

- não improvise endpoint nem dado;
- use o marcador e2e correspondente para identificar o contrato pendente;
- demonstre apenas itens marcados como **verificados** na matriz;
- registre o limite no relatório de testes antes da apresentação.
