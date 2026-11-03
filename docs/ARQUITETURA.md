# Arquitetura

## Objetivo

A aplicação empacota, para uso acadêmico local, um fluxo de Controle Estatístico da Qualidade. O desenho privilegia reprodutibilidade, isolamento dos dados, execução sem serviços externos e separação clara entre interface, API, persistência e arquivos gerados.

## Visão de contêineres

```text
Navegador
   |
   | http://127.0.0.1:8080
   v
Frontend / proxy reverso  ---- rede interna ----> API
                                                |  |
                                                |  +--> volume de storage local
                                                v
                                            PostgreSQL

Inicialização: PostgreSQL saudável -> migração concluída -> seed concluído
             -> API saudável -> frontend saudável
```

Somente o frontend/proxy reverso publica porta no host, ligada a `127.0.0.1`. A API e o banco não têm `ports`, apenas conectividade na rede interna do Compose.

## Componentes

### Frontend

- entrega a aplicação de página única;
- encaminha `/api` e recursos gerados para o backend;
- apresenta as quatro áreas funcionais da demonstração;
- centraliza estados de carregamento, vazio e erro;
- é o único ponto de entrada publicado.

### Backend

- expõe a API HTTP consumida pelo frontend;
- valida importações antes de persistir;
- executa cálculos estatísticos e regras dimensionais;
- mantém decisões, motivos de ignorar e histórico de alterações;
- produz exportações tabulares e relatórios PDF;
- grava artefatos somente no volume de storage local.

### PostgreSQL

- armazena lotes, peças, dimensões, medições e decisões;
- usa migrações versionadas;
- fica em volume persistente e rede não publicada;
- é inicializado com credencial exclusivamente local do Compose.

### Migração e seed

`migrate` e `seed` são serviços one-shot. O primeiro só inicia após o banco ficar saudável; o segundo só inicia após a migração terminar com código zero. A API depende do sucesso de ambos. O seed deve ser determinístico e idempotente.

### Storage

Arquivos temporários, importados e exportados usam volume Docker dedicado. Eles não são armazenados no repositório nem expostos diretamente como pasta do host.

## Fluxo de requisição

1. O navegador acessa o proxy em `127.0.0.1:8080`.
2. Rotas de interface retornam a aplicação web.
3. Chamadas `/api/...` são encaminhadas à API pela rede interna.
4. A API valida a entrada, consulta ou altera o PostgreSQL e, quando necessário, usa o storage.
5. O proxy devolve a resposta ao navegador.

## Persistência e reinicialização

- `make down` preserva os volumes.
- `make up` reaproveita dados existentes e reaplica etapas idempotentes.
- `make seed` reaplica apenas migração e seed.
- `make reset-demo CONFIRM_RESET=RESET` remove volumes e reconstrói toda a base.

A restauração não possui rota HTTP, reduzindo o risco de apagamento por navegação ou requisição externa.

## Observabilidade

Cada serviço fornece logs pelo Compose. Healthchecks distinguem disponibilidade do processo de prontidão. A integração contínua registra relatórios de teste como artefatos, mas não inclui bancos, uploads ou dados operacionais.

## Decisões de segurança

- bind somente em loopback;
- API e banco sem publicação de portas;
- nenhuma integração corporativa ou provedor de identidade;
- nenhuma credencial externa;
- dados exclusivamente sintéticos;
- verificação automática de conteúdo compartilhável;
- dependências entre serviços por saúde ou conclusão bem-sucedida, não por atraso fixo.

## Limites arquiteturais

O modo sem login é apropriado apenas para uma máquina local. A pilha não inclui alta disponibilidade, TLS, segregação por usuário, fila, armazenamento de objetos, backup remoto ou recuperação de desastre. Esses itens seriam obrigatórios antes de qualquer implantação compartilhada.
