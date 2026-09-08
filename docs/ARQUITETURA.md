# Arquitetura de software

## Visão geral

A ProtoVia é uma aplicação web monolítica com interface PWA, API Express e persistência exclusiva por instalação. O mesmo domínio de negócio opera com SQLite no servidor local ou Turso no ambiente hospedado.

```mermaid
flowchart TB
    U[Usuário] -->|HTTPS| P[PWA]
    P --> A[API Express]
    A --> I[Instalação e identidade]
    A --> R[Autenticação e permissões]
    A --> N[Protocolos e retiradas]
    N --> T[(Turso por cliente)]
    N --> S[(SQLite por cliente)]
    N --> M[Provedor de e-mail]
```

## Componentes

| Área | Arquivos | Responsabilidade |
| --- | --- | --- |
| Interface | `public/index.html`, `public/theme.css` | navegação, formulários e impressão |
| Identidade | `public/installation.js`, `lib/installation.js` | configuração inicial e marca do cliente |
| Entregas | `public/delivery-settings.js`, `lib/delivery-policy.js` | GPS, QR e contingência |
| Retiradas | `public/pickups.js`, `lib/pickups.js` | solicitação, coleta e conferência |
| E-mail | `lib/email.js` | mensagens transacionais com identidade da instalação |
| Persistência | `lib/database-config.js`, `banco/schema.sql` | conexão e esquema vazio |
| Servidores | `server.js`, `server-turso.js` | rotas locais e hospedadas |

## Instalação isolada

```mermaid
flowchart LR
    A[Cliente A] --> A1[Aplicação A] --> A2[(Banco A)]
    B[Cliente B] --> B1[Aplicação B] --> B2[(Banco B)]
```

Não há seleção de locatário dentro da aplicação. Esse limite reduz o risco de mistura de dados e simplifica backup, restauração e personalização comercial.

## Autorização

- administrador: identidade, configurações, usuários e operações administrativas;
- emissor: criação e acompanhamento de solicitações;
- entregador: entregas e coletas atribuídas;
- Legalização: emissão, entrega/coleta e conferência de retiradas.

As decisões são feitas no servidor. A interface apenas reflete o acesso recebido.

## Evolução do banco

O esquema inicial não contém clientes nem credenciais. A aplicação cria estruturas ausentes de forma aditiva. Alterações incompatíveis exigem migração explícita e backup validado.

## Decisões técnicas

- arquivos estáticos locais reduzem dependências em tempo de execução;
- duas entradas de servidor permitem nuvem e instalação própria;
- regras compartilhadas em `lib/` reduzem divergência entre persistências;
- o service worker melhora disponibilidade, mas não substitui confirmação do servidor;
- personalização visual é aplicada por variáveis CSS, preservando contraste e cores semânticas.
