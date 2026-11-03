# Matriz de funcionalidades

## Critérios

- **Implementado:** existe código integrado para o fluxo.
- **Verificado:** há evidência automatizada ou revisão executável registrada nesta distribuição.
- **Aplicado à base sintética:** o seed fornece dados para demonstrar o fluxo. Esta coluna nunca significa aplicação em dados reais.

Os estados abaixo são conservadores em **29 de outubro de 2026**. A coluna “Verificado” só muda para “Sim” após execução registrada em [Relatório de testes](RELATORIO-DE-TESTES.md).

| Funcionalidade | Implementado | Verificado | Aplicado à base sintética | Evidência / observação |
|---|:---:|:---:|:---:|---|
| execução standalone sem login | Sim | Sim | Sim | pilha saudável; cenário e2e `smoke` aprovado no navegador |
| quatro rotas funcionais | Sim | Sim | Sim | quatro cenários e2e `routes` aprovados no navegador |
| PostgreSQL com migrações | Sim | Sim | Sim | serviço `migrate` concluiu com zero antes do backend |
| seed determinístico e idempotente | Sim | Sim | Sim | duas reaplicações mantiveram 2 peças, 12 dimensões, 4 lotes e 133 inspeções |
| listagem de peças, lotes e dimensões | Sim | Parcial | Sim | proxy retornou duas peças sintéticas; restante coberto por cenário `seed` |
| estatística descritiva | Sim | Sim | Sim | testes dourados backend aprovados em 2026-10-28 |
| capacidade bilateral e unilateral | Sim | Sim | Sim | testes dourados backend aprovados para limites bilaterais e unilaterais |
| LCL não negativo para dimensão unilateral | Sim | Sim | Sim | teste dourado backend aprovado para o piso unilateral |
| cartas de controle e distribuição | Sim | Pendente | Sim | análise por lote |
| NQA e resumo para decisão | Sim | Pendente | Sim | resumo por dimensão |
| comparação entre lotes | Sim | Sim | Sim | cenário e2e agrupou dois lotes com filtros comuns |
| comparação de fornecedores fictícios | Sim | Sim | Sim | cenário e2e `suppliers` aprovado |
| preview de importação | Sim | Parcial | Sim | preview de medições aprovado no navegador; preview dimensional coberto no backend |
| erro de importação acionável | Sim | Sim | Sim | cenário e2e `import` inválido aprovado sem persistência parcial |
| proteção contra duplicidade | Sim | Sim | Sim | retry idempotente e conflito de duplicidade aprovados no E2E e backend |
| decisão de lote | Sim | Sim | Sim | aprovação pela UI e persistência verificadas no E2E |
| bloqueio pós-decisão | Sim | Sim | Sim | importação, ignore, restore e upload retornaram conflito após decisão |
| desconsiderar medição com motivo | Sim | Sim | Sim | API E2E e testes backend verificam motivo, estado e preservação da leitura |
| restaurar medição | Sim | Sim | Sim | API E2E verificou restauração e igualdade com o estado original |
| exportar medições CSV/XLSX/TXT | Sim | Parcial | Sim | CSV filtrado aprovado no E2E; XLSX e TXT permanecem cobertos abaixo do navegador |
| upload e visualização de PDF | Sim | Sim | Sim | upload, iframe e preservação dos bytes sintéticos aprovados no E2E |
| storage local persistente | Sim | Sim | Sim | volume `app-storage` criado e seed de PDF concluído |
| reset destrutivo protegido | Sim | Sim | Sim | `make reset-demo` exige `CONFIRM_RESET=RESET` |
| API e banco somente internos | Sim | Sim | Não se aplica | Compose resolvido expõe apenas frontend em loopback |
| scanner de conteúdo compartilhável | Sim | Sim | Não se aplica | 151 arquivos aprovados após a atualização da documentação |
| CI sem segredos externos | Sim | Pendente | Sim | workflow privado com PostgreSQL; execução remota pendente |
| autenticação multiusuário | Não | Não se aplica | Não | deliberadamente fora de escopo |
| implantação pública | Não | Não se aplica | Não | proibida no perfil atual |
| inferência sobre processo ou fornecedor real | Não | Não se aplica | Não | dados não representam população real |

## Regra de atualização

Uma linha só pode ser marcada como verificada quando a evidência tem comando, data, ambiente e resultado reproduzível. Passagem de teste com API simulada não prova integração completa; o tipo de evidência deve ser indicado no relatório.
