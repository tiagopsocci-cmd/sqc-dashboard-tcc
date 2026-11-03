# Painel SQC — demonstração acadêmica

Aplicação standalone para demonstrar um fluxo de **Controle Estatístico da Qualidade (SQC)**: importação de medições, análise dimensional, comparação entre fornecedores fictícios, tratamento de decisões e exportação de resultados.

> **Aviso essencial:** a distribuição usa somente dados sintéticos, fornecedores fictícios e execução local sem login. Os números não representam processo, peça, fornecedor ou decisão real e não devem ser usados para inferir desempenho real.

## Início rápido

### Pré-requisitos

- Docker Desktop ou Docker Engine com o plugin Compose v2;
- GNU Make (opcional; os comandos equivalentes de Compose também funcionam);
- portas locais livres para `127.0.0.1:8080`.

### Executar

```sh
make setup
make up
```

Abra <http://127.0.0.1:8080>. Apenas o proxy do frontend é publicado no host. API e PostgreSQL permanecem em rede interna do Compose.

Na primeira inicialização, a pilha:

1. aguarda o PostgreSQL ficar saudável;
2. aplica todas as migrações;
3. carrega um seed sintético idempotente;
4. inicia API e frontend;
5. libera o endereço local quando os healthchecks passam.

Comandos úteis:

```sh
make logs       # acompanhar logs
make down       # parar sem apagar dados
make seed       # reaplicar o seed idempotente
make e2e        # Playwright em projeto/volumes descartáveis próprios (porta 18080)
make verify     # lint, tipos, testes e sanitização
```

O alvo `e2e` usa o Compose project `sqc-dashboard-e2e`, volumes nomeados pelo próprio projeto e `E2E_FRONTEND_PORT=18080`. É possível sobrescrever a porta, por exemplo `make e2e E2E_FRONTEND_PORT=18081`. Um `trap` sempre executa `down --volumes --remove-orphans`, inclusive em falha ou interrupção, sem atuar no project `sqc-dashboard-tcc` da demonstração padrão. Use `make e2e-down` apenas para remover manualmente resíduos desse project E2E.

## Restaurar a demonstração

A restauração apaga os volumes locais do projeto e recria a base sintética. Ela não é exposta por endpoint HTTP e exige confirmação explícita:

```sh
make reset-demo CONFIRM_RESET=RESET
```

## Estrutura

```text
backend/                 API, domínio, migrações e seed
frontend/                interface web e proxy reverso
e2e/                     cenários Playwright
docs/                    documentação acadêmica e operacional
.github/workflows/       integração contínua
.github/scripts/         sanitização para compartilhamento
docker-compose.yml       orquestração local
Makefile                 interface de automação
```

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Modelo de dados](docs/MODELO-DE-DADOS.md)
- [Formatos de importação](docs/FORMATOS-DE-IMPORTACAO.md)
- [Roteiro de demonstração](docs/ROTEIRO-DEMONSTRACAO.md)
- [Base sintética](docs/BASE-SINTETICA.md)
- [Cálculos e validação](docs/CALCULOS-E-VALIDACAO.md)
- [Segurança e limitações](docs/SEGURANCA-E-LIMITACOES.md)
- [Matriz de funcionalidades](docs/MATRIZ-FUNCIONALIDADES.md)
- [Proveniência](docs/PROVENIENCIA.md)
- [Relatório de testes](docs/RELATORIO-DE-TESTES.md)
- [Sanitização](docs/SANITIZACAO.md)

## Escopo e responsabilidade

Esta é uma demonstração acadêmica autocontida. A ausência de autenticação é uma decisão deliberada para execução exclusivamente local; não publique a aplicação em rede. O software apoia exploração e apresentação do método, mas não substitui validação metrológica, estudo de sistema de medição, engenharia de processo, auditoria de fornecedor ou decisão técnica formal.

Não é adicionada licença de código aberto a esta distribuição. Consulte [Proveniência](docs/PROVENIENCIA.md) e [Segurança e limitações](docs/SEGURANCA-E-LIMITACOES.md) antes de compartilhar ou adaptar o conteúdo.
