# Protovia

## Configurações de entrega

O menu **Configurações de entrega** é exclusivo de administradores. Permite desligar o GPS, exigi-lo ou permitir ausência com justificativa de 10 a 1.000 caracteres. Também permite ligar/desligar a conferência por QR e a alternativa pelo número. Nome e assinatura continuam obrigatórios.

O padrão mantém GPS desligado, QR ligado e número permitido em emergência. As regras são aplicadas no servidor, inclusive na sincronização. É necessário consultar as regras online antes de confirmar; se a conexão cair depois, a fila preserva a evidência e o servidor revalida no envio.

GPS é coletado pontualmente, com permissão do navegador, em HTTPS ou localhost. A precisão depende do aparelho e não comprova presença de forma absoluta. O administrador consulta coordenadas, precisão e horário em **Protocolos entregues → abrir protocolo → Ver registro de localização**. Não são enviados no comprovante, no e-mail ou na listagem geral. Abrir o link Google Maps compartilha as coordenadas com esse provedor.

Gestão de protocolos, documentos e entregas, com confirmação por assinatura e QR Code.

Esta versão inicia sem empresas, usuários ou protocolos. Cada instalação pertence a uma organização e usa banco, credenciais e domínio próprios. Não é um serviço multiempresa com isolamento de locatários no mesmo banco.

## Executar localmente

Requisitos: Node.js 24 ou superior e npm.

```sh
npm ci
```

Copie `.env.example` para `.env`. Gere um token de instalação:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Coloque o resultado em `SETUP_TOKEN` e execute `npm start`. Abra `http://127.0.0.1:3000` e informe nome da organização, logo opcional, primeiro administrador e token. Não há senha padrão. Depois de concluir, remova `SETUP_TOKEN` do ambiente e reinicie o servidor.

O banco SQLite será criado vazio em `banco/protovia.db`. Não compartilhe esse arquivo nem o `.env`. Para acesso por outros computadores, configure `HOST` conscientemente e use HTTPS por um proxy reverso; a câmera exige contexto seguro no navegador.

## Identidade e operação

- Administradores podem alterar nome e logo em **Identidade da organização**.
- Cadastre empresas e usuários antes de emitir protocolos.
- A identidade configurada aparece nas impressões e nos avisos de novas entregas/vencimentos.
- Etiquetas, envelopes, assinatura, QR Code e confirmação manual de emergência fazem parte do fluxo existente.
- E-mails exigem `RESEND_API_KEY` e `EMAIL_FROM` próprios. Configure `APP_URL` com a URL desta instalação. Sem essas variáveis, o sistema registra a ausência de configuração; não usa um serviço de outra instalação.

## Vercel e Turso

A integração Marketplace desta instalação usa `PROTOVIA_TURSO_DATABASE_URL` e `PROTOVIA_TURSO_AUTH_TOKEN`. Quando esse prefixo estiver presente, o servidor exige os dois valores e não recorre às credenciais sem prefixo.

Crie **outro** projeto Vercel e **outro** banco Turso vazio. Configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` para o driver `@tursodatabase/serverless`, além das variáveis acima. A URL deve ser compatível com esse driver. O servidor cria o esquema inicial automaticamente; o modo cloud pode ser iniciado com `npm run start:cloud`.

O arquivo `vercel.json` descreve o deploy, mas este repositório não inclui vínculo com projeto ou banco de produção. O deploy e o envio real de e-mail precisam ser homologados nessa infraestrutura nova antes do uso por clientes.

Para os lembretes de vencimento, configure `CRON_SECRET`. A rota `/cron/alertas-vencimentos` exige `Authorization: Bearer <CRON_SECRET>`; sem segredo, recusa chamadas. O agendamento incluído é diário às 11h UTC. Em servidor próprio, configure um agendador externo para chamar a mesma rota. As notificações consideram documentos pendentes entre um e três dias antes do vencimento.

## Verificação

```sh
npm test
```

Os testes usam banco temporário e não enviam mensagens reais. Cobrem esquema vazio, sintaxe do HTML, proteção da instalação, administrador único, login, identidade e emissão. Não substituem uma homologação completa em dispositivo móvel, impressora e infraestrutura cloud.

`node scripts/export-schema.cjs` regenera o esquema SQL usando um banco em memória, sem consultar dados operacionais.

## Cuidados antes de comercializar

Mantenha uma instalação e um banco por cliente, estabeleça backup/restauração, monitore falhas de envio e revise permissões, privacidade e retenção de assinaturas. Não cadastre credenciais de produção em arquivos versionados. Dependências de terceiros mantêm suas próprias licenças; nenhuma licença pública de redistribuição deste produto foi definida aqui.


## Licença e uso

Este projeto é um software proprietário desenvolvido por **Guilherme Andrade dos Santos Trevisan**.

A disponibilização deste repositório não significa que o software seja open source. O código-fonte é disponibilizado exclusivamente para fins de portfólio, demonstração, avaliação técnica e apresentação comercial.

É proibido utilizar, copiar, modificar, redistribuir, sublicenciar, revender ou incorporar este código em outros projetos sem autorização expressa do autor. O software pode ser licenciado comercialmente para empresas mediante contrato ou autorização específica. A aquisição de uma licença de uso não transfers a propriedade do código-fonte ou da propriedade intelectual do sistema.

**Copyright © 2026 Guilherme Andrade dos Santos Trevisan. Todos os direitos reservados.**

<details>
<summary><b>Click here for English Version 🇺🇸</b></summary>

<br>

### English
This project is proprietary software developed by **Guilherme Andrade dos Santos Trevisan**.

Making this repository available does not mean that the software is open source. The source code is provided exclusively for portfolio, demonstration, technical evaluation, and commercial presentation purposes.

Using, copying, modifying, redistributing, sublicensing, reselling, or incorporating this code into other projects without express authorization from the author is strictly prohibited. The software may be commercially licensed to companies under a specific contract or agreement. Acquiring a usage license does not transfer ownership of the source code or intellectual property.

**Copyright © 2026 Guilherme Andrade dos Santos Trevisan. All rights reserved.**

</details>

## Módulo opcional de retiradas

O administrador pode ativar **Retiradas** em **Configurações de entrega**. A Legalização solicita a coleta e confere no escritório os documentos recebidos, com data e competência por documento e histórico por empresa, sem emitir protocolo. Consulte [o fluxo e as permissões](docs/retiradas.md).
