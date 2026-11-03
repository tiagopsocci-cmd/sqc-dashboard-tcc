# Sanitização

## Objetivo

A sanitização impede que a árvore acadêmica compartilhável incorpore identificadores específicos, caminhos pessoais, segredos, bancos, documentos ou binários. Ela complementa — não substitui — revisão humana e regras de acesso ao material de origem.

## Execução

```sh
make sanitize
```

O comando usa somente Python padrão em modo isolado (`python -I`) e não acessa a rede. Em uma árvore Git, o scanner usa enumeração NUL-safe para verificar arquivos rastreados e arquivos não rastreados que não estejam ignorados. Antes da inicialização do Git, aplica um fallback conservador que percorre a árvore e exclui apenas diretórios locais/gerados conhecidos. Um resultado diferente de zero bloqueia pre-commit e CI.

Os testes focados do gate podem ser executados com:

```sh
cd backend && uv run python -I -m pytest -c pyproject.toml ../.github/scripts/test_sanitize.py
```

## Verificações

O scanner em `.github/scripts/sanitize.py` reprova:

- termos literais adicionais configurados pelo responsável;
- URLs com hosts fora da allowlist pública/local;
- e-mails de domínios não aprovados;
- caminhos absolutos de diretórios de usuário;
- atribuições com aparência de segredo;
- material de chave privada;
- links simbólicos;
- arquivos acima do limite;
- conteúdo binário ou fora de UTF-8;
- bancos, dumps, chaves, certificados e pacotes;
- documentos de escritório, PDFs e executáveis;
- extensões desconhecidas;
- qualquer artefato rastreado dentro de diretórios locais/gerados proibidos, mesmo se o diretório estiver no `.gitignore`.

O hash de referência `f9c359304407fd68fca16cf88f4859d03977f515` é explicitamente permitido como proveniência sanitizada.

## Termos configuráveis

Termos específicos não devem ser gravados em arquivo rastreável. Forneça-os em tempo de execução, separados pelo separador de caminhos da plataforma:

```sh
SANITIZE_DENY_TERMS='termo_externo_a:termo_externo_b' make sanitize
```

No Windows, o separador é `;`; em ambientes POSIX, `:`. Quando encontra um termo, o scanner informa somente a categoria genérica `termo externo configurado`: não imprime valor, índice nem quantidade dos termos.

O limite padrão é 1,5 MB por arquivo textual e pode ser reduzido:

```sh
SANITIZE_MAX_BYTES=500000 make sanitize
```

A CI exige `SANITIZE_DENY_TERMS` como secret do repositório. O workflow valida apenas que o valor não está vazio e desabilita rastreamento do shell antes da verificação; nunca deve ecoar, interpolar em mensagem nem persistir esse conteúdo.

## Allowlist de URLs

A allowlist contém apenas loopback e documentação pública estritamente necessária aos arquivos de configuração. Ao adicionar host:

1. confirme que é público e neutro;
2. prefira remover o link se não for essencial;
3. adicione somente o hostname, nunca credencial ou URL com token;
4. acrescente teste ao scanner;
5. revise todo o diff.

## Arquivos de demonstração

CSV e texto sintéticos podem ser rastreados se forem UTF-8, pequenos e aprovados. PDF sintético para teste deve ser gerado em memória ou em diretório temporário durante o teste; o `.gitignore` e o scanner bloqueiam o arquivo. O mesmo vale para XLSX e ZIP.

## Procedimento antes de compartilhar

1. remova volumes, downloads, relatórios e capturas locais da árvore;
2. execute `make sanitize` com a lista adicional mantida pelo responsável;
3. execute `git status --short` se a árvore estiver sob controle de versão;
4. revise nomes, textos, screenshots e dados manualmente;
5. confirme que não existe licença adicionada inadvertidamente;
6. execute `make verify`;
7. compartilhe somente os arquivos aprovados, nunca o diretório de volumes.

## Falsos positivos e exceções

Não desative a regra global para acomodar um arquivo. Prefira reformular texto, gerar fixture em tempo de teste ou reduzir a allowlist ao mínimo. Uma exceção legítima deve ser específica, revisada e testada. O `SOURCE_SHA` é um exemplo de exceção explícita e restrita.

## Limites

Padrões não detectam todo dado sensível e podem não reconhecer informação codificada, imagem textual ou relação indireta entre valores. A distribuição exige revisão humana final. O scanner também não determina direitos autorais nem concede permissão de redistribuição.
