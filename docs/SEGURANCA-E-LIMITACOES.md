# Segurança e limitações

## Perfil de uso

Esta distribuição é uma demonstração acadêmica local, sem login e preenchida apenas com dados sintéticos. O perfil de ameaça assume uma única pessoa operando em uma máquina de desenvolvimento confiável.

**Não exponha a pilha à rede, à internet ou a múltiplos usuários.** A ausência de autenticação não é adequada a implantação compartilhada.

## Controles incluídos

- frontend publicado somente em `127.0.0.1:8080`;
- API e PostgreSQL sem portas no host;
- rede interna do Compose para tráfego de aplicação;
- migrações e seed one-shot com dependências por saúde e sucesso;
- volumes Docker persistentes, sem bind de pasta de dados;
- credencial local sem valor fora do Compose;
- importador com validação de tipo, tamanho, estrutura e domínio;
- operação destrutiva apenas por CLI e com confirmação explícita;
- scanner de conteúdo compartilhável na CI e no pre-commit;
- nenhuma dependência de identidade ou serviço corporativo;
- nenhuma credencial externa exigida pela aplicação; a CI exige apenas o secret local do repositório `SANITIZE_DENY_TERMS`, usado pelo scanner sem imprimir seu conteúdo.

## Ameaças consideradas

### Exposição acidental

O bind em loopback e a ausência de portas para API/banco reduzem a superfície. Ainda assim, alterações no Compose, proxy, firewall ou ambiente de contêiner podem mudar essa garantia. Revise `docker compose config` antes de apresentar.

### Arquivos importados

Arquivos são entrada não confiável. O backend deve:

- limitar tamanho e tipos;
- validar o conteúdo no servidor;
- gerar nomes internos, sem confiar no nome enviado;
- impedir travessia de diretórios;
- não executar macros, fórmulas ou conteúdo incorporado;
- evitar mensagens que reflitam integralmente dados de entrada;
- descartar temporários após uso;
- produzir exportações com neutralização de fórmulas em células textuais.

### Injeção e autorização

Consultas devem ser parametrizadas via camada de persistência. Como não há login, toda ação disponível na interface é efetivamente autorizada para qualquer processo com acesso ao loopback. Não implemente função administrativa por endpoint oculto.

### Dependências e imagens

As imagens e lockfiles devem fixar versões. A CI constrói, testa e faz análise estática sem credenciais externas. Atualizações de dependências exigem revisão; tags de imagem de desenvolvimento não são prova de imutabilidade para produção.

### Dados e proveniência

Somente base sintética pode ser aplicada. O scanner bloqueia documentos, planilhas, bancos, arquivos compactados, binários, chaves, caminhos pessoais, e-mails e hosts não aprovados. Termos adicionais podem ser fornecidos em tempo de execução sem registrá-los no repositório.

## Limitações conhecidas

- sem autenticação, autorização ou isolamento por usuário;
- sem TLS no endpoint local;
- sem proteção voltada a exposição pública;
- credencial do banco é pública e serve apenas à rede local do Compose;
- sem backup automatizado ou recuperação de desastre;
- sem alta disponibilidade ou escalabilidade horizontal;
- sem garantia de anonimização de arquivos que uma pessoa importe manualmente;
- sem antivírus ou sandbox de conteúdo;
- sem trilha de auditoria com identidade verificável;
- sem validação metrológica ou certificação estatística;
- PDF e exportações são artefatos demonstrativos;
- browsers e Docker podem manter caches ou volumes após o encerramento.

## Operação segura

Antes da demonstração:

```sh
make sanitize
make verify
make reset-demo CONFIRM_RESET=RESET
```

Durante a demonstração, use apenas o endereço `http://127.0.0.1:8080`. Depois:

```sh
make down
```

Para remover também os dados locais, use o reset confirmado ou `docker compose down --volumes` conscientemente.

## Evolução para ambiente compartilhado

Seriam necessários, no mínimo: autenticação forte, autorização por função, TLS, gestão de segredos, CSRF, limites de requisição, logging auditável, política de retenção, backup, monitoramento, análise de dependências, hardening dos contêineres e revisão formal de privacidade. Esse trabalho está fora do escopo acadêmico desta distribuição.
