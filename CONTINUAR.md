# Ponto de retomada — Protovia

Atualizado em 03/09/2026.

## Entregue

- Repositório privado: https://github.com/zztrevisan/protovia
- Primeiro commit: `231e203` — instalação independente e identidade configurável.
- Pasta local: `protovia`, ao lado do projeto original.
- Cópia selecionada de código, sem banco operacional, credenciais, histórico Git antigo ou empresas pré-cadastradas.
- Configuração inicial protegida por `SETUP_TOKEN`: organização, logo opcional e administrador sem senha padrão.
- Alteração de identidade restrita a administradores.
- Impressões usam logo configurado; avisos de novas entregas e vencimentos usam a identidade da organização.
- Cookies, banco offline e caches com nomes próprios.
- Esquema vazio para SQLite local e inicialização do banco cloud.
- Cron exige segredo: não aceita apenas identificação por User-Agent.
- README com instalação, ambiente independente, testes e limitações.

## Validações realizadas

`npm test`: três testes aprovados, cobrindo esquema vazio, sintaxe do HTML, instalação protegida, administrador único, login, emissão, identidade e bloqueio de alteração por emissor. O envio de e-mail foi simulado, sem mensagens reais.

Também foi executado o caminho opcional de navegador com Playwright e Edge: a tela de configuração inicial abriu sem erros JavaScript. Não houve teste físico de câmera ou impressora.

## Ainda não realizado

- Criar/configurar uma infraestrutura nova de Vercel, Turso e Resend e homologar o deploy. Não reutilizar recursos nem segredos da instalação original.
- Validar conexão real do driver cloud com um banco novo; até aqui o esquema foi validado em memória, não em Turso real.
- Validar fluxo completo de entrega, leitura de QR, assinatura, impressão e e-mail real na infraestrutura nova.
- Homologar backup/restauração e revisar permissões e operação antes de vender a instalação.

Não existe administrador de demonstração nem `.env` com credenciais nesta cópia. Para começar localmente, seguir o README. A porta padrão é 3000; se outro servidor já a estiver usando, escolher outra em `PORT`.

## Projeto original

Os arquivos de código, o repositório remoto e o deploy originais não foram alterados. Já havia alterações locais em `banco/hiperion.db`, seus arquivos auxiliares e `node_modules/.package-lock.json`; foram preservadas. Não incluir esses arquivos em commits do Protovia.

## Ao retomar

Abrir a pasta `protovia`, conferir `git status`, ler este arquivo e o README, e executar `npm test`. Confirmar o objetivo da próxima etapa antes de criar infraestrutura ou configurar credenciais. Não é necessário refazer a separação nem recriar o repositório.
