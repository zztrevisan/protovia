# Ponto de retomada — Protovia

Atualizado em 04/09/2026.

## Infraestrutura nova — atualização

- Projeto Vercel `protovia` criado na equipe `zztrevisans-projects`, sem deploy iniciado pelo assistente.
- Banco Turso `protovia-db` criado pelo Marketplace no plano Starter apresentado como gratuito, região US East (Virginia).
- Integração conectada somente a Production, com confirmação do usuário.
- Variáveis criadas: `PROTOVIA_TURSO_DATABASE_URL` e `PROTOVIA_TURSO_AUTH_TOKEN`. Valores não foram revelados nem copiados.
- O prefixo evita sobrescrever variáveis `TURSO_*` já detectadas na importação. O código prioriza o par dedicado e recusa configuração parcial.
- Ainda é preciso validar protocolo/driver da URL fornecida, configurar SETUP_TOKEN e CRON_SECRET próprios e homologar o primeiro deploy. Resend ainda não foi configurado.
- Ajuste de conexão preparado localmente; conferir Git antes de publicar, pois push pode iniciar deploy automático.

## Entregue

- Protovia recebeu paleta própria verde-petróleo/turquesa no login, painel, menus, marca padrão e e-mails. Cores semânticas de alerta/erro preservadas. Hiperion não recebeu essa mudança visual. Tema validado em prévia local; publicação continua pendente da infraestrutura.

- Menu administrativo de regras de entrega implementado no Protovia e também no Hiperion, com configurações independentes. GPS: desligado/obrigatório/ausência justificada. QR: exigência e alternativa pelo número configuráveis. GPS inicia desligado.
- Evidência de localização persistida atomicamente com a entrega; consulta exclusiva de administradores; não aparece em comprovantes nem listas gerais. Servidor revalida regras na sincronização e não sobrescreve evidências de entregas concluídas.
- Testes locais atuais: 6 aprovados no Protovia; 2 testes focados no Hiperion. Menu do Hiperion conferido em navegador usando banco temporário. Câmera/GPS físicos e cloud ainda não homologados.

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
