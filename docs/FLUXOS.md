# Fluxos do produto

## Instalação inicial

```mermaid
flowchart LR
    A[Ambiente vazio] --> B[Informar SETUP_TOKEN]
    B --> C[Nome e identidade]
    C --> D[Criar administrador]
    D --> E[Bloquear nova instalação]
    E --> F[Remover SETUP_TOKEN]
```

## Protocolo

```mermaid
flowchart LR
    A[Nova solicitação] --> B[Empresa]
    B --> C[Responsável]
    C --> D[Documentos]
    D --> E[Protocolo + QR]
    E --> F[Etiqueta]
    F --> G[Entrega]
    G --> H[Assinatura e evidência]
    H --> I[Comprovante e histórico]
```

## Retirada opcional

```mermaid
flowchart LR
    A[Administrador ativa módulo] --> B[Nova retirada]
    B --> C[Coleta atribuída]
    C --> D[Registro de coleta]
    D --> E[Conferência no escritório]
    E --> F[Histórico por empresa]
```

A retirada não consome número de protocolo. Desativar o módulo oculta o acesso sem apagar registros.

## Personalização

```mermaid
flowchart TD
    A[Configurações] --> B[Nome e logo]
    A --> C[Cor principal]
    A --> D[Cor secundária]
    A --> E{Exibição da marca}
    E --> F[Cliente em destaque]
    E --> G[Cliente compacto]
    E --> H[ProtoVia + cliente]
```

## Vencimentos

```mermaid
sequenceDiagram
    participant C as Cron
    participant A as API
    participant D as Banco
    participant E as E-mail
    C->>A: chamada autenticada diária
    A->>D: itens a 3 e 1 dia do vencimento
    D-->>A: pendências ainda não notificadas
    A->>E: envia alertas
    A->>D: registra resultado
```
