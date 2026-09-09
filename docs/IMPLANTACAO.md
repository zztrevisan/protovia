# Implantação

## Estratégia recomendada

Mantenha uma instalação por cliente. Defina antes da publicação:

- projeto de hospedagem;
- banco exclusivo;
- domínio e HTTPS;
- remetente de e-mail verificado;
- rotina de backup;
- responsável administrativo.

## Publicação do site — Vercel e Turso

1. Crie um banco Turso vazio.
2. Importe o repositório em um projeto Vercel exclusivo.
3. Configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SETUP_TOKEN`, `APP_URL` e `CRON_SECRET`.
4. Adicione `RESEND_API_KEY` e `EMAIL_FROM` se houver notificações.
5. Publique e abra a instalação inicial.
6. Crie o administrador e remova `SETUP_TOKEN`.
7. Faça novo deploy e homologue os fluxos.

O cron definido em `vercel.json` executa diariamente às 11h UTC.

## Desenvolvimento local

```powershell
npm ci --omit=dev
Copy-Item .env.example .env
npm start
```

Essa execução serve exclusivamente para desenvolvimento e testes. Ela não é oferecida como instalação interna ou modalidade comercial da ProtoVia. A operação do cliente deve usar o site publicado com HTTPS e banco hospedado próprio.

## Homologação

- login e recuperação operacional;
- criação e edição de usuários;
- identidade nos três modos;
- protocolo, etiqueta, QR e assinatura;
- retirada, GPS e conferência;
- e-mail real para destinatário externo;
- alertas de vencimento;
- backup e restauração;
- uso em celular e impressora adotados pelo cliente.

## Atualização

Registre o commit implantado, faça backup antes da mudança, publique em ambiente de validação e só então atualize produção. Não execute duas versões gravando no mesmo banco durante a atualização.
