# Base sintética

## Finalidade

A base sintética torna a demonstração repetível sem incorporar informação operacional, cadastro externo ou material restrito. Ela foi desenhada para exercitar estados visuais e regras de cálculo, não para reproduzir uma população real.

## Conteúdo esperado

O seed deve criar, de forma determinística:

- fornecedores com nomes inequivocamente fictícios;
- lotes em diferentes estados de decisão;
- múltiplas peças por lote;
- dimensões lineares, diâmetro, slab, ângulo e casos unilaterais;
- medições dentro, próximas e fora dos limites de especificação;
- amostras suficientes e insuficientes para métricas selecionadas;
- um caso ignorável e reversível;
- uma decisão com etapa posterior;
- dados que permitam comparar pelo menos dois fornecedores fictícios;
- registros adequados a exportação tabular e relatório PDF.

## Regras de construção

1. **Não derivação:** valores e nomes não são amostrados, mascarados ou perturbados a partir de dados reais.
2. **Determinismo:** a mesma versão do seed produz o mesmo conjunto lógico.
3. **Idempotência insert-only:** reaplicar o seed insere somente fixtures ausentes; não duplica registros, não restaura valores de registros existentes e preserva decisões, ignores, dimensões editadas e dados adicionais.
4. **PDFs create-if-absent:** cada PDF sintético é criado somente quando sua chave não existe; bytes já armazenados nunca são sobrescritos pelo seed.
5. **Clareza:** nomes e códigos indicam que se trata de demonstração.
6. **Cobertura:** casos normais, de borda e inválidos têm propósito documentado.
7. **Isolamento:** o seed não chama serviços externos nem lê arquivos fora do repositório.

## Casos estatísticos

Os valores devem cobrir ao menos:

| Caso | Propósito |
|---|---|
| distribuição centralizada | exibir resultado nominal estável |
| deslocamento da média | mostrar diferença entre centralização e dispersão |
| alta dispersão | evidenciar perda de capacidade |
| ponto fora da especificação | demonstrar classificação de não conformidade |
| tolerância unilateral | validar limite ausente sem inventar limite oposto |
| amostra pequena | impedir interpretação de indicador sem suporte |

Os números usados para esses casos são ilustrativos e não constituem benchmark.

## Fornecedores fictícios

Todo fornecedor do seed deve usar nome claramente artificial, por exemplo, com prefixo `Fornecedor Demo`. Não se usam logotipos, domínios, códigos cadastrais, endereços ou nomes de pessoas.

## Aplicação do seed

Na inicialização normal, o serviço `seed` roda após as migrações. Para reaplicar:

```sh
make seed
```

O resumo impresso informa quantas fixtures foram inseridas **na execução atual**. Em particular, `pdf_files` é a quantidade de PDFs criados nessa execução, não o total de PDFs armazenados. Assim, uma reaplicação íntegra deve reportar zero em todos os contadores; se uma fixture ou PDF esperado tiver sido removido, somente o contador correspondente aumenta.

Para apagar os volumes e reconstruir tudo:

```sh
make reset-demo CONFIRM_RESET=RESET
```

A segunda operação é destrutiva apenas para os volumes locais deste Compose.

## Limites de interpretação

A base não preserva distribuição, correlação, sazonalidade, taxa de defeitos, capacidade, variabilidade entre máquinas ou perfil de qualquer processo real. Portanto:

- não extrapole resultados;
- não classifique fornecedor real;
- não use os indicadores como evidência de processo;
- não compare os valores com metas operacionais;
- não apresente screenshots sem o aviso de caráter sintético.

## Verificação

Os testes automatizados devem confirmar que o seed aparece na interface e permite os fluxos essenciais. A sanitização impede a inclusão acidental de arquivos de banco, planilhas, documentos e binários no repositório.
