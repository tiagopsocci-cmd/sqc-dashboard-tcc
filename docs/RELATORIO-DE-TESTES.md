# Relatório de testes

## Estado do documento

Relatório iniciado em **2026-10-27** e atualizado em **2026-11-03**. Os gates locais, PostgreSQL dedicado, migrations, imagens e os 15 cenários Playwright foram revalidados após a limpeza final da árvore. Como `make` não está disponível neste host, foi executada e aprovada a sequência equivalente dos subgates.

## Estratégia

| Camada | Objetivo | Comando principal | Estado inicial |
|---|---|---|---|
| configuração | validar Compose resolvido | `make compose-config` | Aprovado em 2026-10-28 |
| sanitização | bloquear conteúdo inadequado | `make sanitize` | Aprovado em 2026-10-28 |
| backend unitário/integração | regras, API e PostgreSQL | `make test` | 40 aprovados; 1 ignorado por limitação de symlink do host |
| frontend | componentes, tipos e lint | `make lint typecheck test` | lint, tipos, 20 testes e build aprovados |
| e2e | fluxos observáveis no navegador | `make e2e` | lint e tipos aprovados; 15 de 15 cenários aprovados com Chrome local |
| imagens | confirmar build reproduzível | `make build` | Aprovado em 2026-10-28 |
| pilha integrada | healthchecks e seed visível | `docker compose up --wait` | Aprovado em 2026-10-28 |
| gate agregado | executar toda a verificação | `make verify` | Aprovado por sequência equivalente em 2026-11-03 |

## Cenários e2e previstos

A suíte Playwright cobre, por marcadores claros:

- `@smoke`: abertura em loopback sem login;
- `@routes`: quatro rotas funcionais;
- `@seed`: conteúdo sintético visível;
- `@suppliers`: comparação de fornecedores fictícios;
- `@import`: erro e duplicidade de importação;
- `@decision`: decisão e bloqueio pós-decisão;
- `@ignore`: desconsiderar e restaurar amostra;
- `@export`: download tabular;
- `@pdf`: visualização de PDF sintético.

Seletores preferem papel e nome acessível, com `data-testid` apenas como alternativa centralizada em `e2e/tests/contracts.ts`. A suíte usa somente rotas e APIs observadas na aplicação; não cria endpoint de teste divergente.

## Critérios de aprovação

O gate completo é aprovado apenas se:

1. configuração do Compose for válida;
2. scanner não encontrar item proibido;
3. lint e checagem de tipos passarem;
4. testes backend e frontend passarem com PostgreSQL isolado;
5. imagens forem construídas;
6. pilha ficar saudável;
7. todos os cenários e2e obrigatórios passarem;
8. não houver teste silenciosamente ignorado.

Testes marcados com `fixme` representam contrato ainda não estabilizado e mantêm o relatório como pendente. Em CI final, `forbidOnly` e ausência de retries locais evitam mascarar falhas.

## Registro de execuções

### Validações estáticas da infraestrutura

| Data | Ambiente | Comando | Resultado | Observações |
|---|---|---|---|---|
| 2026-10-28 | Windows 11 / Docker Desktop | `docker compose config --quiet` | Aprovado | modelo Compose válido |
| 2026-10-29 | Python 3.12 isolado | scanner da árvore | Aprovado | 151 arquivos verificados após a atualização da documentação |
| 2026-10-28 | PostgreSQL 16 descartável | Alembic `upgrade head`, `downgrade base`, `upgrade head` | Aprovado | revisão final `0002`; colunas e constraint de identidade inspecionadas |
| 2026-10-28 | Docker Desktop | `docker compose build` | Aprovado | backend e frontend construídos; frontend executou `tsc -b` e Vite |
| 2026-10-28 | Docker Desktop | `docker compose up --wait --wait-timeout 180` | Aprovado | banco, backend e frontend saudáveis; migrate/seed concluídos com zero |
| 2026-10-28 | endpoint local | health/API via proxy | Aprovado | resposta saudável e duas peças sintéticas retornadas |
| 2026-10-28 | Docker Desktop | duas execuções consecutivas do seed | Aprovado | contagens estáveis: 2 peças, 12 dimensões, 4 lotes, 133 inspeções e 5 PDFs |
| 2026-10-28 | Python 3.12 / PostgreSQL 16 | suíte backend completa | Aprovado | 40 testes aprovados; 1 ignorado porque links simbólicos não são permitidos no host |
| 2026-10-28 | PostgreSQL 16 | concorrência da identidade de importação | Aprovado | duas transações simultâneas: um commit, uma violação de unicidade e uma leitura persistida |
| 2026-10-28 | Python 3.12 | Ruff, Ruff format check e Pyright | Aprovado | lint, formatação e tipos backend sem achados |
| 2026-10-28 | Node 22 / pnpm 10 | lint, tipos, testes e build frontend | Aprovado | 20 testes em 6 arquivos; build com aviso não bloqueante de tamanho do bundle |
| 2026-10-28 | TypeScript | lint e `pnpm --dir e2e typecheck` | Aprovado | suíte Playwright formatada e tipada sem erro |
| 2026-10-29 | Windows 11 / Docker Desktop / Chrome local | `PLAYWRIGHT_USE_SYSTEM_CHROME=1 E2E_BASE_URL=http://127.0.0.1:18080 pnpm --dir e2e test` | Aprovado | 15 de 15 cenários aprovados em 23,8 s, com um worker e sem retry local |
| 2026-11-03 | Windows 11 / PostgreSQL 16 temporário dedicado | suíte backend completa | Aprovado | 40 testes aprovados; 1 ignorado porque links simbólicos não são permitidos no host |
| 2026-11-03 | Windows 11 / Python 3.12 | Ruff, Ruff format check e Pyright | Aprovado | lint, formatação e tipos backend sem achados |
| 2026-11-03 | Windows 11 / Node 22 / pnpm 10 | lint, tipos, testes e build frontend | Aprovado | 20 testes em 6 arquivos; build concluído com aviso não bloqueante de tamanho do bundle |
| 2026-11-03 | Windows 11 / TypeScript | lint e tipos da suíte E2E | Aprovado | Biome e TypeScript sem erro |
| 2026-11-03 | Windows 11 / Docker Desktop / Chrome local | E2E em Compose isolado | Aprovado | 15 de 15 cenários aprovados em 35,7 s, com um worker e sem retry local; recursos descartáveis removidos após a execução |
| 2026-11-03 | Python 3.12 isolado | scanner da árvore | Aprovado | 151 arquivos verificados após remoção dos artefatos locais |

### Gate completo

| Data | Revisão | Comando | Resultado | Artefatos |
|---|---|---|---|---|
| 2026-11-03 | árvore local preparada para publicação | sequência equivalente a `make verify` | Aprovado | sanitização, Compose principal/E2E, backend, frontend, E2E e imagens validados; `make` indisponível no host |

## Como registrar nova evidência

Copie uma linha e preencha data, revisão, sistema, versões de Docker/Python/Node, comando, código de saída e resumo de testes. Não inclua nome de máquina, caminho de usuário, URL privada, e-mail, variável secreta ou dump de dados.

Exemplo neutro:

```text
2026-10-28 | revisão local | make verify | aprovado | 84 backend, 18 frontend, 9 e2e
```

O número acima é apenas formato ilustrativo; não deve ser tratado como resultado.

## Limites da evidência

- aprovação com base sintética não valida uso com dados reais;
- cobertura automatizada não prova adequação estatística do processo;
- healthcheck prova disponibilidade técnica, não correção funcional;
- browser único não garante compatibilidade universal;
- scanner reduz risco, mas não substitui revisão humana antes de compartilhar.
