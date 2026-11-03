# Proveniência

## Identificação da referência

Esta distribuição acadêmica foi preparada a partir de uma revisão técnica identificada exclusivamente pelo hash:

```text
SOURCE_SHA=f9c359304407fd68fca16cf88f4859d03977f515
```

O hash é um identificador de proveniência permitido, não um segredo. Não se registra aqui nome de organização, URL de repositório, caminho de máquina, identidade pessoal ou referência a material de acesso restrito.

## Datas

- **2026-10-27:** seleção da revisão de referência, extração das categorias técnicas e início da sanitização.
- **2026-10-28:** consolidação da distribuição standalone, atualização da referência remota e confirmação de que as mudanças posteriores não afetavam os arquivos-fonte do SQC.

Quando uma nova consolidação for concluída, registre uma nova linha; não reescreva as datas anteriores.

## Categorias extraídas

Foram extraídas e adaptadas as seguintes categorias de funcionalidade:

- modelo de peças, dimensões, lotes, instrumentos e medições;
- importação tabular de dimensões e medições;
- estatística descritiva, capacidade, NQA, distribuição e cartas de controle;
- dimensões bilaterais e unilaterais;
- geometrias e relações dimensionais necessárias aos cálculos;
- comparação agrupada de lotes e origens fictícias;
- decisão de lote e bloqueios posteriores;
- desconsideração reversível de amostras com motivo e trilha;
- exportação tabular de medições;
- associação e visualização de PDFs;
- migrações de banco e testes técnicos relacionados.

## Transformações para a distribuição acadêmica

- remoção de login, sessões e provedores de identidade;
- substituição da identidade de auditoria por ator local imutável;
- remoção de notificações e integrações externas;
- remoção de marcas, domínios, contatos e exemplos específicos;
- substituição integral de dados por seed sintético não derivado;
- armazenamento local em volume Docker;
- endpoint único em loopback por proxy reverso;
- documentação em português com limites de uso;
- scanner de conteúdo compartilhável e CI sem segredos externos;
- testes de navegador voltados aos fluxos acadêmicos.

## Material deliberadamente não incorporado

- bases, exports, planilhas, desenhos ou relatórios operacionais;
- credenciais, tokens, cookies e configuração de serviços externos;
- logotipos, identidade visual ou nomes específicos;
- caminhos locais, histórico pessoal e materiais de pesquisa restritos;
- artefatos compilados, bancos, dumps e pacotes compactados;
- licença de código aberto.

## Limites da declaração

Este documento registra rastreabilidade técnica da revisão usada como referência. Ele não concede licença, não transfere direitos, não afirma equivalência funcional total e não autoriza redistribuição além das permissões aplicáveis ao material. Não há licença open source adicionada a esta árvore.

## Verificação

Antes de qualquer compartilhamento:

```sh
make sanitize
```

A validação deve permitir o `SOURCE_SHA` acima e bloquear identificadores e artefatos inadequados. Termos literais adicionais são fornecidos ao scanner por variável de ambiente, de modo que a lista sensível não seja gravada no próprio repositório.
