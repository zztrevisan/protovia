CREATE TABLE IF NOT EXISTS alertas_vencimento_enviados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocolo_item_id INTEGER NOT NULL,
    data_referencia TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(protocolo_item_id, data_referencia)
  );

CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    nome_normalizado TEXT NOT NULL UNIQUE,
    box TEXT,
    endereco TEXT,
    numero TEXT,
    complemento TEXT,
    bairro TEXT,
    cidade TEXT,
    uf TEXT,
    cep TEXT,
    observacao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , emails_json TEXT NOT NULL DEFAULT '[]');

CREATE TABLE IF NOT EXISTS configuracao_entrega (id INTEGER PRIMARY KEY CHECK (id = 1), regras_json TEXT NOT NULL, alterado_por TEXT NOT NULL, alterado_em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS organizacao (id INTEGER PRIMARY KEY CHECK (id = 1), nome TEXT NOT NULL, logo TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS protocolo_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    protocolo_id INTEGER NOT NULL,

    descricao TEXT NOT NULL,

    competencia TEXT,

    vencimento TEXT,

    ordem INTEGER NOT NULL DEFAULT 1,

    criado_em TEXT NOT NULL
      DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(protocolo_id)
      REFERENCES protocolos(id)
      ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS protocolos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER NOT NULL UNIQUE,
    cliente TEXT NOT NULL,
    departamento TEXT NOT NULL,

    -- Mantidos para compatibilidade
    -- com protocolos antigos.
    descricao TEXT NOT NULL,
    vencimento TEXT,

    emissor TEXT NOT NULL,
    entregador TEXT NOT NULL,
    observacao TEXT,

    status TEXT NOT NULL
      DEFAULT 'Aguardando entrega',

    recebido_por TEXT,
    assinatura TEXT,

    criado_em TEXT NOT NULL
      DEFAULT CURRENT_TIMESTAMP,

    entregue_em TEXT
  , motivo_cancelamento TEXT, cancelado_por TEXT, cancelado_em TEXT, excluido INTEGER NOT NULL DEFAULT 0, excluido_em TEXT, excluido_por TEXT, endereco_empresa TEXT, cliente_id INTEGER, cliente_box TEXT, qr_token TEXT, qr_obrigatorio INTEGER NOT NULL DEFAULT 0, qr_confirmado_em TEXT, qr_confirmado_por TEXT, confirmacao_entrega_metodo TEXT, confirmacao_numero_digitado TEXT, email_destinatarios TEXT, email_status TEXT, email_enviado_em TEXT, email_erro TEXT, notificacao_entregador_destinatario TEXT, notificacao_entregador_status TEXT, notificacao_entregador_enviada_em TEXT, notificacao_entregador_erro TEXT, entrega_evidencia_json TEXT);

CREATE TABLE IF NOT EXISTS retirada_opcoes (id INTEGER PRIMARY KEY CHECK(id=1), ativo INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS retiradas (
    id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL, empresa_nome TEXT NOT NULL,
    solicitante_id INTEGER NOT NULL, solicitante_nome TEXT NOT NULL,
    entregador_id INTEGER NOT NULL, entregador_nome TEXT NOT NULL,
    solicitado_em TEXT NOT NULL, retirado_em TEXT, conferido_em TEXT,
    conferente_id INTEGER, conferente_nome TEXT, estado TEXT NOT NULL,
    documentos_json TEXT NOT NULL, conferencia_json TEXT, observacao TEXT NOT NULL, contexto_json TEXT
  );

CREATE TABLE IF NOT EXISTS sessoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    usuario_id INTEGER NOT NULL,

    criado_em TEXT NOT NULL
      DEFAULT CURRENT_TIMESTAMP,

    expira_em TEXT NOT NULL,

    FOREIGN KEY(usuario_id)
      REFERENCES usuarios(id)
  );

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    departamento TEXT NOT NULL,
    perfil TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , email TEXT, usuario TEXT, senha_hash TEXT, senha_salt TEXT, ultimo_login TEXT);

CREATE INDEX IF NOT EXISTS idx_alertas_vencimento_data
  ON alertas_vencimento_enviados(data_referencia);

CREATE INDEX IF NOT EXISTS idx_clientes_box
  ON clientes(box);

CREATE INDEX IF NOT EXISTS idx_clientes_nome
  ON clientes(nome);

CREATE INDEX IF NOT EXISTS idx_protocolo_itens_protocolo
  ON protocolo_itens(protocolo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_protocolos_qr_token
  ON protocolos(qr_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_login
  ON usuarios(usuario)
  WHERE usuario IS NOT NULL;
