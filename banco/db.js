const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// ========================================
// CONFIGURAÇÃO DO BANCO
// ========================================

const bancoDir = path.join(__dirname);
const caminhoConfigurado = String(process.env.SQLITE_DATABASE_PATH || '').trim();
const bancoPath = caminhoConfigurado
  ? path.resolve(__dirname, '..', caminhoConfigurado)
  : path.join(bancoDir, 'protovia.db');

fs.mkdirSync(path.dirname(bancoPath), { recursive: true });

if (!fs.existsSync(bancoDir)) {
  fs.mkdirSync(
    bancoDir,
    { recursive: true }
  );
}

const db = new DatabaseSync(bancoPath);

// ========================================
// CONFIGURAÇÕES DO SQLITE
// ========================================

// Melhora o funcionamento do SQLite
// quando houver várias operações próximas.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// ========================================
// TABELAS PRINCIPAIS
// ========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    departamento TEXT NOT NULL,
    perfil TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  );
`);

// ========================================
// FUNÇÃO DE MIGRAÇÃO
// ========================================

function adicionarColunaSeNaoExistir(
  tabela,
  coluna,
  definicao
) {

  const colunas = db
    .prepare(
      `PRAGMA table_info(${tabela})`
    )
    .all();

  const existe = colunas.some(
    c => c.name === coluna
  );

  if (!existe) {

    db.exec(`
      ALTER TABLE ${tabela}
      ADD COLUMN ${coluna} ${definicao}
    `);

    console.log(
      `Banco atualizado: ${tabela}.${coluna}`
    );
  }
}

// ========================================
// CAMPOS DE CANCELAMENTO
// ========================================

adicionarColunaSeNaoExistir(
  'protocolos',
  'motivo_cancelamento',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'protocolos',
  'cancelado_por',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'protocolos',
  'cancelado_em',
  'TEXT'
);

// ========================================
// CAMPOS DE EXCLUSÃO LÓGICA
// ========================================

adicionarColunaSeNaoExistir(
  'protocolos',
  'excluido',
  'INTEGER NOT NULL DEFAULT 0'
);

adicionarColunaSeNaoExistir(
  'protocolos',
  'excluido_em',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'protocolos',
  'excluido_por',
  'TEXT'
);

// Endereço de destino informado na emissão.
// A coluna é opcional para manter compatibilidade
// com todos os protocolos já existentes.
adicionarColunaSeNaoExistir(
  'protocolos',
  'endereco_empresa',
  'TEXT'
);

adicionarColunaSeNaoExistir('protocolos', 'cliente_id', 'INTEGER');
adicionarColunaSeNaoExistir('protocolos', 'cliente_box', 'TEXT');
adicionarColunaSeNaoExistir('clientes', 'emails_json', "TEXT NOT NULL DEFAULT '[]'");
adicionarColunaSeNaoExistir('protocolos', 'qr_token', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'qr_obrigatorio', 'INTEGER NOT NULL DEFAULT 0');
adicionarColunaSeNaoExistir('protocolos', 'qr_confirmado_em', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'qr_confirmado_por', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'confirmacao_entrega_metodo', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'confirmacao_numero_digitado', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'email_destinatarios', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'email_status', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'email_enviado_em', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'email_erro', 'TEXT');
adicionarColunaSeNaoExistir('usuarios', 'email', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'notificacao_entregador_destinatario', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'notificacao_entregador_status', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'notificacao_entregador_enviada_em', 'TEXT');
adicionarColunaSeNaoExistir('protocolos', 'notificacao_entregador_erro', 'TEXT');

db.exec(`
  UPDATE protocolos
  SET qr_token = lower(hex(randomblob(24)))
  WHERE qr_token IS NULL OR TRIM(qr_token) = '';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_protocolos_qr_token
  ON protocolos(qr_token);
`);

// ========================================
// LOGIN E SENHAS
// ========================================

adicionarColunaSeNaoExistir(
  'usuarios',
  'usuario',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'usuarios',
  'senha_hash',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'usuarios',
  'senha_salt',
  'TEXT'
);

adicionarColunaSeNaoExistir(
  'usuarios',
  'ultimo_login',
  'TEXT'
);

// Evita dois usuários com
// o mesmo nome de login.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS
  idx_usuarios_login
  ON usuarios(usuario)
  WHERE usuario IS NOT NULL;
`);

// ========================================
// SESSÕES
// ========================================

db.exec(`
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
`);

// ========================================
// ITENS / DOCUMENTOS DOS PROTOCOLOS
// ========================================

db.exec(`
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
`);

adicionarColunaSeNaoExistir(
  'protocolo_itens',
  'competencia',
  'TEXT'
);

// Índice para deixar rápida a busca
// dos documentos de cada protocolo.
db.exec(`
  CREATE INDEX IF NOT EXISTS
  idx_protocolo_itens_protocolo
  ON protocolo_itens(protocolo_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS alertas_vencimento_enviados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocolo_item_id INTEGER NOT NULL,
    data_referencia TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(protocolo_item_id, data_referencia)
  );
  CREATE INDEX IF NOT EXISTS idx_alertas_vencimento_data
  ON alertas_vencimento_enviados(data_referencia);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_clientes_nome
  ON clientes(nome);

  CREATE INDEX IF NOT EXISTS idx_clientes_box
  ON clientes(box);
`);

// ========================================
// MIGRAÇÃO DOS PROTOCOLOS ANTIGOS
// ========================================
//
// Protocolos que já existiam antes da
// criação de protocolo_itens ganham
// automaticamente um item.
//
// NÃO altera nem apaga o protocolo antigo.
// ========================================

const protocolosAntigos = db
  .prepare(`
    SELECT
      p.id,
      p.descricao,
      p.vencimento
    FROM protocolos p
    WHERE NOT EXISTS (
      SELECT 1
      FROM protocolo_itens pi
      WHERE pi.protocolo_id = p.id
    )
  `)
  .all();

const inserirItemAntigo = db
  .prepare(`
    INSERT INTO protocolo_itens (
      protocolo_id,
      descricao,
      vencimento,
      ordem
    )
    VALUES (?, ?, ?, ?)
  `);

for (const protocolo of protocolosAntigos) {

  if (
    protocolo.descricao &&
    protocolo.descricao.trim()
  ) {

    inserirItemAntigo.run(
      protocolo.id,
      protocolo.descricao.trim(),
      protocolo.vencimento || null,
      1
    );
  }
}

// ========================================
// INFORMAÇÃO DE INICIALIZAÇÃO
// ========================================

console.log(
  'Banco Protovia inicializado.'
);

if (protocolosAntigos.length > 0) {
  console.log(
    `${protocolosAntigos.length} protocolo(s) antigo(s) verificado(s) para migração de itens.`
  );
}

// ========================================
// EXPORTAÇÃO
// ========================================

db.exec('CREATE TABLE IF NOT EXISTS organizacao (id INTEGER PRIMARY KEY CHECK (id = 1), nome TEXT NOT NULL, logo TEXT NOT NULL DEFAULT \'\')');
adicionarColunaSeNaoExistir('organizacao','cor_primaria',"TEXT NOT NULL DEFAULT '#0f6657'");
adicionarColunaSeNaoExistir('organizacao','cor_secundaria',"TEXT NOT NULL DEFAULT '#19b89f'");
adicionarColunaSeNaoExistir('organizacao','logo_tamanho',"TEXT NOT NULL DEFAULT 'grande'");
adicionarColunaSeNaoExistir('organizacao','mostrar_contexto_login','INTEGER NOT NULL DEFAULT 1');
db.exec("CREATE TABLE IF NOT EXISTS configuracao_entrega (id INTEGER PRIMARY KEY CHECK (id = 1), regras_json TEXT NOT NULL, alterado_por TEXT NOT NULL, alterado_em TEXT NOT NULL)");
adicionarColunaSeNaoExistir('protocolos','entrega_evidencia_json','TEXT');
for (const sql of require('../lib/pickups').SCHEMA) db.exec(sql);
module.exports = db;
