# Como iniciar a aplicação

## Antes de começar

Você precisa ter o **Docker Desktop** instalado e aberto. Aguarde até ele indicar que está funcionando.

## Iniciar

1. Abra um terminal na pasta do projeto.
2. Execute:

   ```sh
   docker compose up --build --wait
   ```

3. Aguarde o comando terminar.
4. Abra no navegador:

   <http://127.0.0.1:8080>

A aplicação funciona localmente e não exige login.

## Encerrar sem perder os dados

Execute:

```sh
docker compose down
```

Esse comando encerra a aplicação, mas preserva os dados sintéticos e as alterações feitas durante o uso.

Para abrir novamente, repita o comando de inicialização.

## Atenção

Não use `docker compose down --volumes` e não execute o reset da demonstração se quiser manter os dados.

A aplicação foi preparada para conteúdo sintético e sanitizado. Não importe informações pessoais, corporativas, confidenciais ou documentos reais sem uma revisão específica de segurança e privacidade.
