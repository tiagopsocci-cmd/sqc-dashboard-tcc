# Contexto para retomada do SQC Dashboard — TCC

> Documento de transferência para outra IA ou para uma sessão futura.
>
> Última atualização: 29 de outubro de 2026.
>
> **Importante:** este documento registra o estado observado na árvore local no momento da pausa. Antes de alterar código, confira a árvore atual e repita os gates afetados.

## 1. Objetivo do projeto

Este repositório contém uma aplicação acadêmica standalone de **Controle Estatístico da Qualidade (SQC)**, preparada como artefato de um TCC de MBA em Engenharia de Produção.

O projeto foi extraído e atualizado a partir de uma aplicação maior. O resultado deve permanecer restrito ao domínio SQC, sem módulos corporativos ou funcionalidades alheias ao trabalho acadêmico.

A aplicação deve ser executável localmente com Docker Compose, PostgreSQL, armazenamento local e uma base demonstrativa inteiramente sintética.

O guia simples de operação está em `docs/COMO-INICIAR.md`. A pessoa usuária decidiu preservar os dados sintéticos e as alterações feitas durante o uso para continuar avaliando a aplicação. Na operação normal, encerrar com `docker compose down`, sem `--volumes`; não executar reset destrutivo sem solicitação explícita.

## 2. Restrições permanentes

Aplicar sempre a regra:

> **Somente conteúdo sanitizado.**

Isso significa:

- nenhum dado real;
- nenhuma marca corporativa;
- nenhuma credencial real;
- nenhum domínio, URL ou e-mail interno;
- nenhuma integração corporativa;
- nenhum material restrito do curso;
- nenhum histórico Git herdado da aplicação de origem;
- nenhuma licença open source presumida;
- somente dados e documentos demonstrativos sintéticos;
- repositório remoto privado;
- nenhum convite ao orientador sem o login GitHub exato;
- nenhum deployment público;
- não alterar nem limpar os repositórios usados como fonte;
- não imprimir ou registrar termos externos usados pelo scanner de sanitização.

O projeto standalone deve continuar **sem autenticação e sem RBAC**. Não introduzir módulos externos ao SQC.

Outras restrições operacionais:

- preservar os volumes da aplicação normal durante a fase de avaliação da pessoa usuária;
- diferenciar a base normal `sqc-dashboard-tcc` da pilha descartável de testes `sqc-dashboard-e2e`;
- não usar `docker compose down --volumes` nem o reset destrutivo na aplicação normal sem solicitação explícita;
- não inicializar Git antes de todos os gates finais;
- nunca usar a base de demonstração como fallback para testes PostgreSQL;
- `TEST_DATABASE_URL` deve apontar explicitamente para um banco cujo nome contenha `test`;
- não remover `%LOCALAPPDATA%\ms-playwright\__dirlock` sem confirmar que não há instalação em andamento e obter autorização explícita para esse diretório exato;
- não criar `UNIQUE(batch_id, dim_id, part_number)`, pois repetições metrológicas são necessárias para X̄-R.

Commits e descrições de PR futuros devem terminar com as linhas de atribuição obrigatórias fornecidas pelo ambiente de execução no momento da publicação. Não duplicar os valores literais neste documento, pois o scanner exige que permaneçam fora da árvore compartilhável.

## 3. Stack e arquitetura

### Backend

- Python 3.12;
- FastAPI;
- Pydantic v2;
- SQLAlchemy 2 assíncrono;
- asyncpg;
- PostgreSQL 16;
- Alembic;
- NumPy e SciPy;
- openpyxl;
- armazenamento local com escrita segura;
- Pytest e `httpx.ASGITransport`.

### Frontend

- React 19;
- TypeScript;
- Vite;
- TanStack Router e Query;
- Plotly;
- Tailwind CSS e Radix UI;
- Vitest e Testing Library.

### Infraestrutura e qualidade

- Docker Compose;
- Nginx como SPA e reverse proxy same-origin;
- Playwright;
- Ruff e Ruff format;
- Pyright;
- Biome;
- GitHub Actions;
- scanner próprio de sanitização.

O frontend é o único serviço publicado no host e deve permanecer limitado ao loopback. Backend e PostgreSQL ficam apenas na rede interna do Compose.

## 4. Decisões de domínio que não devem ser alteradas

### 4.1 Importações

- Importações são all-or-nothing: qualquer erro bloqueia toda a persistência.
- O preview dimensional é somente leitura e usa o mesmo plano de validação da confirmação.
- Para o mesmo arquivo e o mesmo estado inicial do banco, o diff confirmado deve corresponder ao preview.
- O histórico registra somente campos e relações efetivamente alterados.
- Repetições metrológicas legítimas devem ser preservadas.
- A idempotência de medições usa `(batch_id, source_import_digest, source_row, dim_id)`.
- Não substituir essa identidade pela constraint global proibida por peça/dimensão.

### 4.2 Política de NQA

A unidade amostral é `part_number`:

1. cada peça conta uma única vez;
2. uma peça é não conforme se qualquer leitura válida da dimensão for não conforme;
3. leituras ignoradas não entram;
4. uma repetição ignorada não elimina a peça quando houver outra leitura ativa;
5. se todas as leituras da peça estiverem ignoradas, a peça não entra no denominador;
6. o filtro de cavidade é aplicado antes do agrupamento;
7. sem filtro de cavidade, a mesma peça presente em várias cavidades continua sendo uma única unidade;
8. `RECTANGLE` reutiliza a consolidação por peça;
9. estatísticas descritivas continuam sendo calculadas por leitura;
10. `n` no overview e heatmap representa observações quando apropriado;
11. `n_out` representa peças não conformes.

### 4.3 Tolerância efetiva e condição de material

Para bônus MMC/LMC:

- tolerância superior efetiva: `tol_plus + bonus`;
- tolerância inferior bilateral efetiva: `abs(tol_minus) + bonus`;
- dimensão unilateral: limite inferior ausente;
- `tol_minus=None` e `tol_minus=0.0` têm semântica unilateral equivalente;
- bônus e consolidações usam a unidade física `(part_number, cavity)`;
- múltiplas leituras de tamanho usam conservadoramente o menor bônus;
- múltiplas leituras direcionais usam a de maior utilização absoluta;
- uma repetição ignorada não elimina as demais leituras ativas.

Não reintroduzir a expressão incorreta `tol_minus - bonus`.

### 4.4 `RECTANGLE`

- Relações direcionais são explícitas por eixo e dimensão de coordenada.
- Uma posição aceita no máximo duas relações e não aceita eixos repetidos.
- Trocas X↔Y devem ser planejadas atomicamente, sem conflito transitório.
- Relações persistidas participam da validação de uma nova importação.
- A consolidação por unidade física usa a maior utilização entre as direções.
- Capability consolidada com bônus usa ratio normalizado.

Limitação atual documentada: detalhes e exportação tabular ainda partem das leituras da dimensão-pai. Uma posição `RECTANGLE` composta somente por leituras direcionais participa dos cálculos e da distribuição, mas não produz linha de detalhe/exportação até existir um contrato específico para representar e editar uma linha sintética. Não inventar esse contrato sem decisão de produto.

### 4.5 Capability bruta e normalizada

A API separa deliberadamente dois espaços:

- estatísticas descritivas físicas;
- base matemática usada pelos índices de capability.

`capability_basis` é a fonte canônica dos parâmetros usados nos índices e informa:

- metodologia;
- `n`;
- `usl` e `lsl`;
- nominal;
- média;
- desvios de curto e longo prazo.

Metodologias:

- `raw_measurements`;
- `bonus_normalized_ratio`;
- `rectangle_consolidated_ratio`.

Quando há bônus, `Cp`, `Cpk`, `Cpu`, `Cpl`, `Pp`, `Ppk` e DPPM devem pertencer ao mesmo espaço normalizado. Na capability agrupada, `mean`, `std_pooled` e `std_global` permanecem descritivos físicos; não os combinar com índices em ratio. `Cpu/Cpk` usam `std_short`; `Pp/Ppk` usam `std_long`.

### 4.6 Estado decidido do lote

Depois que um lote é aprovado ou reprovado:

- leitura e listagem continuam permitidas;
- ignore/restore retornam conflito;
- importações mutáveis retornam conflito;
- upload ou substituição de relatório retorna conflito;
- a UI permanece em modo somente leitura;
- o backend é a autoridade final, inclusive diante de concorrência.

### 4.7 Seed sintético e preservação durante a avaliação

A inicialização normal é **insert-only**:

- usa `ON CONFLICT DO NOTHING`;
- cria apenas fixtures ausentes;
- preserva decisões, ignores, dimensões editadas, registros adicionais e PDFs existentes;
- cria PDF sintético somente quando ausente.

A restauração destrutiva é permitida apenas pelo comando de reset explícito, protegido por confirmação. Durante a avaliação atual, não executar esse reset: a pessoa usuária quer manter os dados sintéticos visíveis e preservar o que alterar ou adicionar manualmente.

## 5. Distinção acadêmica obrigatória

A documentação deve distinguir:

- **implementado:** existe no código;
- **verificado:** possui teste ou memória de cálculo independente;
- **aplicado:** foi demonstrado somente na base sintética.

Também deve declarar explicitamente:

> Os dados sintéticos não permitem inferir desempenho real de fornecedores, processos produtivos ou organizações.

## 6. Trabalho concluído nesta rodada

### 6.1 Identidade e atomicidade de importação

Arquivos principais:

- `backend/app/sqc/models.py`;
- `backend/alembic/versions/0002_inspection_import_identity.py`;
- `backend/app/sqc/importer.py`;
- `backend/app/sqc/router.py`;
- `backend/app/sqc/service.py`.

Foi implementado e verificado:

- `Inspection.source_import_digest` e `Inspection.source_row`;
- constraint `uq_sqc_inspections_import_row_dim` em `(batch_id, source_import_digest, source_row, dim_id)`;
- preservação de `source_row` pelos parsers;
- cavidade inválida como erro bloqueante;
- importação dimensional e de medições sem resultados parciais;
- repetições legítimas preservadas;
- reenvio dos mesmos bytes idempotente;
- proteção real da constraint sob duas transações concorrentes.

No teste concorrente, duas transações tentaram persistir a mesma identidade: exatamente uma confirmou, a outra recebeu violação de unicidade e apenas uma leitura permaneceu no banco.

### 6.2 Preview e confirmação dimensional

Foi implementado e verificado:

- carregamento das relações persistidas no preview e na confirmação;
- validação de conflito com eixos já persistidos;
- contagem máxima de duas relações por posição;
- troca atômica X↔Y;
- mudança de posição-pai sem deixar relação presa ao pai antigo;
- alteração somente de eixo ou dimensão de tamanho tratada como atualização real;
- preview expondo `coordinate_axis` e `related_size_dim_code`;
- confirmação bloqueada na UI quando há erro global ou por linha;
- repreview sem diferenças classificado como inalterado;
- histórico exato apenas dos campos alterados.

### 6.3 Capability e tolerância

Foi implementado e verificado:

- `CapabilityBasis` nos schemas backend e frontend;
- `capability_basis` em respostas de lote único e agrupadas;
- todos os índices migrados conjuntamente para o resultado normalizado quando há bônus;
- `insufficient_sample` e `degenerate` refletindo a base normalizada quando aplicável;
- UI identificando sigma e índices em ratio;
- regressão recompondo `Cpu` por `std_short` e `Ppk` por `std_long`;
- equivalência entre `tol_minus=None` e `tol_minus=0.0` no overview e heatmap;
- bônus conservador e isolamento por cavidade;
- preservação de repetições direcionais pela maior utilização absoluta.

### 6.4 Qualidade e documentação

- CI passou a executar `ruff format --check`.
- Fixtures frontend foram atualizadas para o novo contrato.
- `docs/CALCULOS-E-VALIDACAO.md` documenta a separação entre descritivos físicos e índices normalizados.
- `docs/FORMATOS-DE-IMPORTACAO.md` e `backend/app/sqc/IMPORT_FORMATS.md` documentam preview canônico, relações persistidas, atomicidade e idempotência.
- `docs/RELATORIO-DE-TESTES.md` foi atualizado com as evidências desta rodada, incluindo a aprovação funcional dos 15 cenários Playwright em 29 de outubro de 2026.

## 7. Evidências observadas nesta rodada

### 7.1 Backend local e PostgreSQL

Checks estáticos:

- Ruff: aprovado;
- Ruff format check: aprovado;
- Pyright: 0 erros e 0 avisos.

Suíte sem PostgreSQL configurado, antes do teste concorrente final:

- 40 itens coletados;
- 20 aprovados;
- 20 ignorados pelas dependências esperadas de PostgreSQL e symlink.

Suíte final com PostgreSQL 16 descartável e explicitamente dedicado:

- 41 itens coletados;
- 40 aprovados;
- 1 ignorado porque symlinks não são permitidos pelo host Windows.

O único skip não é silencioso e está ligado a uma limitação conhecida do host.

### 7.2 Alembic e schema

A sequência abaixo passou em PostgreSQL real:

1. `upgrade head`;
2. `downgrade base`;
3. novo `upgrade head`.

Inspeção final confirmou:

- revisão `0002_inspection_import_identity`;
- colunas `source_import_digest` e `source_row` em `sqc_inspections`;
- constraint `uq_sqc_inspections_import_row_dim` exatamente sobre `(batch_id, source_import_digest, source_row, dim_id)`;
- ausência da constraint global proibida por peça/dimensão.

O contêiner PostgreSQL descartável usado nesses testes foi removido ao final.

### 7.3 Frontend

- Biome: aprovado;
- TypeScript: aprovado;
- 6 arquivos de teste;
- 20 testes Vitest aprovados;
- build Vite aprovado.

Permanece um aviso não bloqueante: bundle JavaScript de aproximadamente 5,63 MB antes de gzip.

### 7.4 E2E

- Biome: aprovado;
- TypeScript: aprovado;
- 15 de 15 cenários Playwright aprovados funcionalmente em Chrome local;
- execução concluída em 23,8 segundos;
- configuração com `workers: 1`, sem paralelismo total e sem retry local.

### 7.5 Docker e Compose

Foram validados diretamente porque `make` não está instalado neste host:

- `docker compose config --quiet` para o Compose principal;
- `docker compose config --quiet` para o Compose E2E;
- build das imagens backend e frontend;
- inicialização saudável da pilha E2E;
- migrations e seed one-shot;
- backend e frontend saudáveis;
- cleanup automático dos containers, redes e volumes E2E nas execuções anteriores.

Em 2026-11-03, a aplicação normal `sqc-dashboard-tcc` foi confirmada saudável em `127.0.0.1:8080` e deve permanecer disponível para avaliação manual. A pilha descartável `sqc-dashboard-e2e`, seus volumes temporários e os artefatos gerados foram removidos após autorização explícita.

As imagens foram construídas com sucesso. O aviso de bundle do frontend permaneceu não bloqueante.

### 7.6 Sanitização

Último resultado observado:

- sanitização aprovada;
- 151 arquivos verificados.

O scanner foi reexecutado após as atualizações de documentação.

## 8. Situação exata do Playwright

A suíte possui 15 cenários e todos foram aprovados funcionalmente em 29 de outubro de 2026.

Histórico relevante:

1. a instalação do Chromium empacotado chegou a 100%, mas o processo de download ficou travado antes de concluir a instalação;
2. a árvore de processos exclusiva do instalador foi encerrada sem afetar o VS Code ou o navegador da pessoa usuária;
3. o lock externo permaneceu órfão e não foi removido;
4. a suíte foi executada com o Chrome local por meio de `PLAYWRIGHT_USE_SYSTEM_CHROME=1`;
5. a primeira execução funcional teve 6 aprovações e 9 falhas causadas por dois defeitos na infraestrutura dos próprios testes: uma linha de comentário inválida no CSV sintético e um seletor ambíguo na tela de importação;
6. os helpers e seletores E2E foram corrigidos, com Biome e TypeScript aprovados;
7. os dois cenários de importação passaram isoladamente;
8. a suíte integral terminou com **15 de 15 cenários aprovados em 23,8 segundos**, usando um worker e sem retry local.

Em 2026-11-03, a pilha isolada `sqc-dashboard-e2e`, seus dois volumes temporários e os artefatos em `e2e/test-results/` foram removidos após autorização explícita. Ela permaneceu separada da aplicação normal `sqc-dashboard-tcc`, em `127.0.0.1:8080`, cujos volumes foram preservados. Não remover `%LOCALAPPDATA%\ms-playwright\__dirlock` sem autorização explícita.

## 9. Pontos de auditoria: estado atual

Os 15 pontos anteriormente pendentes foram cobertos por implementação e/ou testes:

1. importação dimensional plan-first ou rollback integral;
2. correspondência entre preview e confirmação;
3. histórico somente dos campos alterados;
4. recomposição de `Inspection.deviation` quando o nominal muda;
5. equivalência `tol_minus=None` / `0.0` no overview e heatmap;
6. lookup de bônus por unidade física;
7. isolamento de bônus entre cavidades;
8. profile distribution filtrada por cavidade;
9. consolidação `RECTANGLE` e relações direcionais;
10. coerência entre limites de cálculo e resposta;
11. schemas PATCH rejeitando `null` indevido;
12. separação entre métricas brutas e normalizadas;
13. Ruff format e Pyright após alterações finais;
14. Alembic upgrade/downgrade/upgrade;
15. ausência de resultados parciais em importações inválidas.

A prova PostgreSQL foi concluída, inclusive para concorrência da identidade de importação.

Revisões funcionais ainda abertas, sem correção arbitrária:

- definir um contrato de detalhes/exportação para `RECTANGLE` sem leitura-pai;
- decidir se e como uma linha sintética poderia ser identificada, exibida e editada;
- otimizar o bundle frontend, se isso passar a ser requisito bloqueante.

## 10. Próxima ordem de trabalho

A pessoa usuária iniciou a avaliação manual da aplicação com os dados sintéticos preservados e informará eventuais problemas encontrados. Não presumir que ausência de relato equivale a validação concluída e não registrar dados reais ou confidenciais na documentação.

### Etapa A — cleanup E2E concluído

Em 2026-11-03, após autorização explícita:

1. o projeto isolado `sqc-dashboard-e2e` foi removido;
2. os volumes temporários `sqc-dashboard-e2e_e2e-app-storage` e `sqc-dashboard-e2e_e2e-postgres-data` foram removidos;
3. os artefatos gerados em `e2e/test-results/` foram removidos;
4. o lock externo do Playwright foi preservado.

### Etapa B — gate final e limpeza

Concluída em 2026-11-03:

1. Ruff, Ruff format check e Pyright aprovados;
2. suíte backend com PostgreSQL dedicado: 40 aprovados, 1 skip esperado pela limitação de symlink do host;
3. Biome, TypeScript, Vitest (20 testes) e build frontend aprovados;
4. Biome e TypeScript do E2E aprovados;
5. validação dos dois Compose, build das imagens e E2E isolado (15 cenários) aprovados;
6. `test-results`, traces, reports, caches e builds gerados removidos;
7. sanitização final aprovada, com 151 arquivos verificados;
8. `docs/RELATORIO-DE-TESTES.md` atualizado com a evidência final.

Como `make` não estava disponível no host desta rodada, os comandos equivalentes foram executados diretamente. Em outro ambiente, `make verify` continua sendo o gate agregado previsto.

### Etapa C — publicação, somente após todos os gates

1. revisar manualmente a árvore compartilhável;
2. confirmar que nenhum artefato gerado permanece;
3. executar o scanner com termos externos fornecidos fora da árvore;
4. inicializar um histórico Git novo na branch `main`;
5. auditar todos os arquivos staged;
6. executar o scanner em modo Git;
7. criar o commit inicial com a atribuição obrigatória;
8. verificar a conta autenticada no GitHub;
9. confirmar que o repositório de destino não existe;
10. criar explicitamente um repositório privado, sem push automático;
11. confirmar por API o proprietário e `isPrivate=true`;
12. configurar o secret obrigatório de sanitização sem imprimir seu conteúdo;
13. enviar `main`;
14. conferir que o hash remoto é igual ao local;
15. acompanhar a CI até o resultado final;
16. não publicar deployment;
17. não convidar o orientador sem o login exato.

## 11. Condições para publicação

A publicação permanece bloqueada enquanto houver qualquer um destes estados:

- cleanup E2E pendente ou artefatos de teste remanescentes;
- falha de lint, tipos, teste, migration, build ou sanitização;
- documentação contradizendo o código;
- artefato gerado ou conteúdo não sanitizado na árvore;
- ausência do secret obrigatório da CI;
- dúvida sobre proprietário ou privacidade do repositório remoto.

Em 2026-11-03, os quatro primeiros bloqueios foram resolvidos localmente. Restam a inicialização/auditoria do Git, a criação explícita do repositório privado na conta pessoal `tiagopsocci-cmd`, a configuração do secret `SANITIZE_DENY_TERMS`, o push e a aprovação da CI remota.

## 12. Estado de publicação no momento da pausa

Em 2026-11-03, após a aprovação dos gates finais locais:

- um repositório Git novo foi inicializado localmente na branch `main`;
- a identidade local de commit foi configurada com o endereço `noreply` da conta pessoal `tiagopsocci-cmd`;
- a árvore sanitizada foi auditada e preparada para o commit inicial;
- nenhum remoto havia sido configurado;
- nenhum push havia sido realizado;
- nenhum repositório remoto havia sido criado;
- nenhum convite havia sido enviado;
- nenhum deployment havia sido publicado.

Verificar novamente esses fatos antes de agir, pois este documento é um registro de transferência, não uma fonte dinâmica.

## 13. Arquivos prioritários para leitura

### Backend

- `backend/app/sqc/router.py`;
- `backend/app/sqc/service.py`;
- `backend/app/sqc/statistics.py`;
- `backend/app/sqc/schemas.py`;
- `backend/app/sqc/models.py`;
- `backend/app/sqc/importer.py`;
- `backend/app/sqc/IMPORT_FORMATS.md`;
- `backend/tests/conftest.py`;
- `backend/tests/sqc/test_backend_regressions.py`;
- `backend/tests/sqc/test_nqa_api.py`;
- `backend/tests/test_seed.py`;
- `backend/alembic/versions/0002_inspection_import_identity.py`.

### Frontend

- `frontend/src/lib/sqc-api.ts`;
- `frontend/src/pages/sqc/EngenhariaPage.tsx`;
- `frontend/src/components/sqc/StatCards.tsx`;
- `frontend/src/components/sqc/GroupedStatisticsView.tsx`;
- `frontend/src/components/sqc/DetailsTable.tsx`;
- testes `*.test.tsx` relacionados ao SQC.

### E2E e infraestrutura

- `e2e/playwright.config.ts`;
- `e2e/tests/`;
- `docker-compose.yml`;
- `docker-compose.e2e.yml`;
- `Makefile`;
- `.github/workflows/ci.yml`.

### Sanitização e documentação

- `.github/scripts/sanitize.py`;
- `.github/scripts/test_sanitize.py`;
- `docs/CALCULOS-E-VALIDACAO.md`;
- `docs/FORMATOS-DE-IMPORTACAO.md`;
- `docs/RELATORIO-DE-TESTES.md`;
- `docs/COMO-INICIAR.md`;
- este documento.

## 14. Instrução curta para a próxima IA

Leia este documento e confira a árvore atual. O backend, PostgreSQL, migrations, frontend, Compose, imagens, sanitização e os 15 cenários Playwright passaram nos gates observados. A pessoa usuária está avaliando manualmente a aplicação normal e quer preservar seus dados sintéticos e alterações; não remova os volumes de `sqc-dashboard-tcc`. Retome pelo cleanup autorizado somente da pilha `sqc-dashboard-e2e` e pela repetição do gate final agregado. Não remova o lock externo do Playwright sem autorização explícita, não altere as decisões de domínio e não publique nada antes de todos os gates finais ficarem verdes.
