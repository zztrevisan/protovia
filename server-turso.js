const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { normalizarDestinatarios, enviarComprovanteEntrega, enviarNotificacaoNovoProtocolo, enviarAlertaVencimentos } = require('./lib/email');

const app = express();

app.disable('x-powered-by');

if (process.env.TRUST_PROXY === '1' || process.env.VERCEL) {
  app.set('trust proxy', 1);
}

const PORT =
  process.env.PORT ||
  3000;


// ============================================================
// CARREGAR .ENV
// ============================================================

if (
  !process.env.TURSO_DATABASE_URL ||
  !process.env.TURSO_AUTH_TOKEN
) {

  try {

    process.loadEnvFile('.env');

  } catch (erro) {

    console.log(
      'Arquivo .env não carregado automaticamente.'
    );

  }

}


// ============================================================
// CONEXÃO COM TURSO
// ============================================================

let db = null;
let dbInitializing = null;


async function garantirDb() {
  if (db) return db;
  if (!dbInitializing) dbInitializing = iniciarBanco().finally(() => { dbInitializing = null; });
  return dbInitializing;
}

async function iniciarBanco() {

  if (db) {

    return db;

  }

  const { url, authToken } = require('./lib/database-config').databaseConfig();


  if (
    !url ||
    !authToken
  ) {

    throw new Error(
      'TURSO_DATABASE_URL ou TURSO_AUTH_TOKEN não configurados.'
    );

  }


  const {
    connect
  } =
    await import(
      '@tursodatabase/serverless'
    );


  const connection =
    connect({

      url,

      authToken

    });

  for (const statement of require('fs').readFileSync(path.join(__dirname,'banco/schema.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean)) await connection.run(statement);
  await garantirEstruturaOperacional(connection);
  db = connection;


  return db;

}

async function adicionarColunaTurso(conexao, tabela, coluna, definicao) {
  try {
    await conexao.run(
      `ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`
    );
  } catch (erro) {
    if (!/duplicate column|already exists/i.test(String(erro?.message || erro))) {
      throw erro;
    }
  }
}

async function garantirEstruturaOperacional(conexao) {
  await conexao.run(`
    CREATE TABLE IF NOT EXISTS limites_acesso (
      chave TEXT PRIMARY KEY,
      quantidade INTEGER NOT NULL DEFAULT 0,
      expira_em INTEGER NOT NULL
    )
  `);

  await conexao.run(`
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
    )
  `);

  await conexao.run(`
    CREATE TABLE IF NOT EXISTS alertas_vencimento_enviados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocolo_item_id INTEGER NOT NULL,
      data_referencia TEXT NOT NULL,
      destinatario TEXT NOT NULL,
      enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(protocolo_item_id, data_referencia)
    )
  `);

  await adicionarColunaTurso(conexao, 'protocolos', 'endereco_empresa', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'cliente_id', 'INTEGER');
  await adicionarColunaTurso(conexao, 'protocolos', 'cliente_box', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolo_itens', 'competencia', 'TEXT');
  await adicionarColunaTurso(conexao, 'clientes', 'emails_json', "TEXT NOT NULL DEFAULT '[]'");
  await adicionarColunaTurso(conexao, 'protocolos', 'qr_token', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'qr_obrigatorio', 'INTEGER NOT NULL DEFAULT 0');
  await adicionarColunaTurso(conexao, 'protocolos', 'qr_confirmado_em', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'qr_confirmado_por', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'confirmacao_entrega_metodo', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'confirmacao_numero_digitado', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'email_destinatarios', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'email_status', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'email_enviado_em', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'email_erro', 'TEXT');
  await adicionarColunaTurso(conexao, 'usuarios', 'email', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'notificacao_entregador_destinatario', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'notificacao_entregador_status', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'notificacao_entregador_enviada_em', 'TEXT');
  await adicionarColunaTurso(conexao, 'protocolos', 'notificacao_entregador_erro', 'TEXT');

  const semQr = await conexao.all(
    "SELECT id FROM protocolos WHERE qr_token IS NULL OR TRIM(qr_token) = ''"
  );
  for (const protocolo of semQr) {
    await conexao.run(
      'UPDATE protocolos SET qr_token = ? WHERE id = ?',
      crypto.randomBytes(24).toString('hex'),
      protocolo.id
    );
  }

  await conexao.run('CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome)');
  await conexao.run('CREATE INDEX IF NOT EXISTS idx_clientes_box ON clientes(box)');
  await conexao.run('CREATE INDEX IF NOT EXISTS idx_limites_acesso_expira ON limites_acesso(expira_em)');
  await conexao.run('CREATE INDEX IF NOT EXISTS idx_alertas_vencimento_data ON alertas_vencimento_enviados(data_referencia)');

}


// ============================================================
// FUNÇÕES SQL
// ============================================================

async function sqlGet(
  conexao,
  sql,
  args = []
) {

  return await conexao.get(
    sql,
    ...args
  );

}


async function sqlAll(
  conexao,
  sql,
  args = []
) {

  return await conexao.all(
    sql,
    ...args
  );

}


async function sqlRun(
  conexao,
  sql,
  args = []
) {

  return await conexao.run(
    sql,
    ...args
  );

}

function identificadorCliente(req) {
  return String(req.ip || req.socket?.remoteAddress || 'desconhecido');
}

function hashIdentificador(valor) {
  return crypto.createHash('sha256').update(String(valor || '')).digest('hex');
}

async function consumirLimiteDistribuido(namespace, identificador, maximo, janelaMs) {
  const database = await garantirDb();
  const agora = Date.now();
  const janela = Math.floor(agora / janelaMs);
  const expiraEm = (janela + 1) * janelaMs;
  const chave = `${namespace}:${janela}:${hashIdentificador(identificador)}`;

  await sqlRun(database, `
    INSERT INTO limites_acesso (chave, quantidade, expira_em)
    VALUES (?, 1, ?)
    ON CONFLICT(chave) DO UPDATE SET quantidade = quantidade + 1
  `, [chave, expiraEm]);

  const registro = await sqlGet(
    database,
    'SELECT quantidade FROM limites_acesso WHERE chave = ?',
    [chave]
  );

  if (Math.random() < 0.02) {
    sqlRun(database, 'DELETE FROM limites_acesso WHERE expira_em < ?', [agora])
      .catch(erro => console.error('Erro ao limpar limites expirados:', erro));
  }

  return {
    permitido: Number(registro?.quantidade || 0) <= maximo,
    restante: Math.max(0, maximo - Number(registro?.quantidade || 0)),
    retryAfter: Math.max(1, Math.ceil((expiraEm - agora) / 1000))
  };
}

function responderLimiteExcedido(res, limite) {
  res.setHeader('Retry-After', String(limite.retryAfter));
  return res.status(429).json({
    erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  });
}

async function limitarLogin(req, res, next) {
  try {
    const ip = identificadorCliente(req);
    const login = String(req.body?.usuario || '').trim().toLowerCase() || 'sem-login';
    const porCredencial = await consumirLimiteDistribuido('login-credencial', `${ip}:${login}`, 8, 15 * 60 * 1000);
    if (!porCredencial.permitido) return responderLimiteExcedido(res, porCredencial);
    const porIp = await consumirLimiteDistribuido('login-ip', ip, 50, 15 * 60 * 1000);
    if (!porIp.permitido) return responderLimiteExcedido(res, porIp);
    next();
  } catch (erro) {
    console.error('Rate limit de login indisponível:', erro);
    next();
  }
}

async function limitarMutacoesApi(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  try {
    const identificador = req.usuarioLogado?.id || identificadorCliente(req);
    const limite = await consumirLimiteDistribuido('api-mutacao', identificador, 120, 5 * 60 * 1000);
    res.setHeader('X-RateLimit-Remaining', String(limite.restante));
    if (!limite.permitido) return responderLimiteExcedido(res, limite);
    next();
  } catch (erro) {
    console.error('Rate limit de mutações indisponível:', erro);
    next();
  }
}


// ============================================================
// EXPRESS
// ============================================================

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

app.use(

  express.json({

    limit:
      '5mb'

  })

);

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function origemEsperada(req) {
  const protocolo = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  return host ? `${protocolo}://${host}` : '';
}

function origensExtrasPermitidas() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origem => origem.trim())
    .filter(Boolean);
}

function protegerMesmaOrigem(req, res, next) {
  const origem = String(req.headers.origin || '').trim();
  const siteOrigem = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const permitidas = new Set([origemEsperada(req), ...origensExtrasPermitidas()].filter(Boolean));

  res.vary('Origin');

  if (origem && !permitidas.has(origem)) {
    return res.status(403).json({ erro: 'Origem não autorizada.' });
  }

  if (!METODOS_SEGUROS.has(req.method) && siteOrigem === 'cross-site') {
    return res.status(403).json({ erro: 'Requisição externa bloqueada.' });
  }

  next();
}

app.use('/api', protegerMesmaOrigem);


app.use(

  express.static(

    path.join(
      __dirname,
      'public'
    )

  )

);


// ============================================================
// LOGIN / SESSÃO
// ============================================================

const COOKIE_SESSAO =
  'protovia_session';


const DURACAO_SESSAO =
  8 *
  60 *
  60 *
  1000;


// ============================================================
// FUNÇÕES DE LOGIN
// ============================================================

function lerCookies(req) {

  const cabecalho =
    req.headers.cookie ||
    '';


  const cookies =
    {};


  cabecalho
    .split(';')
    .forEach(
      item => {

        const partes =
          item
            .trim()
            .split('=');


        const nome =
          partes.shift();


        const valor =
          partes.join('=');


        if (nome) {

          cookies[nome] =
            decodeURIComponent(
              valor ||
              ''
            );

        }

      }
    );


  return cookies;

}


// ============================================================

function hashToken(token) {

  return crypto
    .createHash(
      'sha256'
    )
    .update(
      token
    )
    .digest(
      'hex'
    );

}


// ============================================================

function verificarSenha(
  senha,
  salt,
  hashSalvo
) {

  try {

    if (
      !senha ||
      !salt ||
      !hashSalvo
    ) {

      return false;

    }


    const hashCalculado =
      crypto.scryptSync(

        senha,

        salt,

        64

      );


    const hashBanco =
      Buffer.from(

        hashSalvo,

        'hex'

      );


    if (
      hashCalculado.length !==
      hashBanco.length
    ) {

      return false;

    }


    return crypto
      .timingSafeEqual(

        hashCalculado,

        hashBanco

      );


  } catch (erro) {

    console.error(
      'Erro ao verificar senha:',
      erro
    );


    return false;

  }

}


// ============================================================

function gerarHashSenha(
  senha
) {

  const salt =
    crypto
      .randomBytes(32)
      .toString(
        'hex'
      );


  const hash =
    crypto
      .scryptSync(

        senha,

        salt,

        64

      )
      .toString(
        'hex'
      );


  return {

    salt,

    hash

  };

}


// ============================================================

async function criarSessao(
  usuarioId
) {

  const database =
    await garantirDb();


  const tokenReal =
    crypto
      .randomBytes(32)
      .toString(
        'hex'
      );


  const tokenBanco =
    hashToken(
      tokenReal
    );


  const expira =
    new Date(

      Date.now() +
      DURACAO_SESSAO

    );


  await sqlRun(

    database,

    `
      INSERT INTO sessoes (

        token,
        usuario_id,
        expira_em

      )

      VALUES (
        ?, ?, ?
      )
    `,

    [

      tokenBanco,

      usuarioId,

      expira
        .toISOString()

    ]

  );


  return {

    token:
      tokenReal,

    expira

  };

}


// ============================================================

async function obterUsuarioLogado(
  req
) {

  try {

    const database =
      await garantirDb();


    const cookies =
      lerCookies(
        req
      );


    const tokenReal =
      cookies[
        COOKIE_SESSAO
      ];


    if (!tokenReal) {

      return null;

    }


    const tokenBanco =
      hashToken(
        tokenReal
      );


    const sessao =
      await sqlGet(

        database,

        `
          SELECT

            s.id
              AS sessao_id,

            s.expira_em,

            u.id,
            u.nome,
            u.departamento,
            u.perfil,
            u.usuario,
            u.ativo

          FROM sessoes s

          INNER JOIN usuarios u

            ON u.id =
               s.usuario_id

          WHERE
            s.token = ?

          LIMIT 1
        `,

        [
          tokenBanco
        ]

      );


    if (!sessao) {

      return null;

    }


    if (
      Number(
        sessao.ativo
      ) !== 1
    ) {

      await sqlRun(

        database,

        `
          DELETE FROM sessoes

          WHERE id = ?
        `,

        [
          sessao.sessao_id
        ]

      );


      return null;

    }


    const expira =
      new Date(
        sessao.expira_em
      );


    if (
      isNaN(
        expira.getTime()
      ) ||

      expira.getTime() <=
      Date.now()
    ) {

      await sqlRun(

        database,

        `
          DELETE FROM sessoes

          WHERE id = ?
        `,

        [
          sessao.sessao_id
        ]

      );


      return null;

    }


    return {

      id:
        Number(
          sessao.id
        ),

      nome:
        sessao.nome,

      departamento:
        sessao.departamento,

      perfil:
        sessao.perfil,

      usuario:
        sessao.usuario

    };


  } catch (erro) {

    console.error(
      'Erro ao verificar sessão:',
      erro
    );


    return null;

  }

}


// ============================================================
// COOKIE
// ============================================================

function criarCookie(
  token,
  maxAge
) {

  let secure =
    '';


  if (
    process.env.VERCEL ||
    process.env.NODE_ENV ===
    'production'
  ) {

    secure =
      '; Secure';

  }


  return (

    `${COOKIE_SESSAO}=` +

    `${encodeURIComponent(
      token
    )}` +

    '; HttpOnly' +

    '; SameSite=Lax' +

    '; Path=/' +

    `; Max-Age=${maxAge}` +

    secure

  );

}


// ============================================================
// LOGIN
// ============================================================

app.post(

  '/api/login',

  limitarLogin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const {
        usuario,
        senha
      } =
        req.body;


      if (
        !usuario ||
        !senha
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Usuário e senha são obrigatórios.'

          });

      }


      const login =
        usuario
          .trim()
          .toLowerCase();


      const cadastro =
        await sqlGet(

          database,

          `
            SELECT

              id,
              nome,
              departamento,
              perfil,
              usuario,
              senha_hash,
              senha_salt,
              ativo

            FROM usuarios

            WHERE

              LOWER(usuario) =
              LOWER(?)

              AND ativo = 1

            LIMIT 1
          `,

          [
            login
          ]

        );


      if (
        !cadastro ||

        !verificarSenha(

          senha,

          cadastro.senha_salt,

          cadastro.senha_hash

        )
      ) {

        return res
          .status(401)
          .json({

            erro:
              'Usuário ou senha incorretos.'

          });

      }


      // ==============================================
      // REMOVER SESSÕES EXPIRADAS
      // ==============================================

      await sqlRun(

        database,

        `
          DELETE FROM sessoes

          WHERE expira_em <= ?
        `,

        [

          new Date()
            .toISOString()

        ]

      );


      // ==============================================
      // NOVA SESSÃO
      // ==============================================

      const novaSessao =
        await criarSessao(
          cadastro.id
        );


      await sqlRun(

        database,

        `
          UPDATE usuarios

          SET
            ultimo_login = ?

          WHERE id = ?
        `,

        [

          new Date()
            .toISOString(),

          cadastro.id

        ]

      );


      const maxAgeSegundos =
        Math.floor(

          DURACAO_SESSAO /
          1000

        );


      res.setHeader(

        'Set-Cookie',

        criarCookie(

          novaSessao.token,

          maxAgeSegundos

        )

      );


      res.json({

        ok:
          true,

        usuario: {

          id:
            Number(
              cadastro.id
            ),

          nome:
            cadastro.nome,

          departamento:
            cadastro.departamento,

          perfil:
            cadastro.perfil,

          usuario:
            cadastro.usuario

        }

      });


    } catch (erro) {

      console.error(
        'Erro ao fazer login:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao realizar login.'

        });

    }

  }

);


// ============================================================
// USUÁRIO LOGADO
// ============================================================

app.get(

  '/api/me',

  async (
    req,
    res
  ) => {

    const usuario =
      await obterUsuarioLogado(
        req
      );


    if (!usuario) {

      return res
        .status(401)
        .json({

          autenticado:
            false

        });

    }


    res.json({

      autenticado:
        true,

      usuario

    });

  }

);


// ============================================================
// LOGOUT
// ============================================================

app.post(

  '/api/logout',

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const cookies =
        lerCookies(
          req
        );


      const tokenReal =
        cookies[
          COOKIE_SESSAO
        ];


      if (tokenReal) {

        await sqlRun(

          database,

          `
            DELETE FROM sessoes

            WHERE token = ?
          `,

          [

            hashToken(
              tokenReal
            )

          ]

        );

      }


      res.setHeader(

        'Set-Cookie',

        criarCookie(
          '',
          0
        )

      );


      res.json({

        ok:
          true

      });


    } catch (erro) {

      console.error(
        'Erro ao sair:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao encerrar sessão.'

        });

    }

  }

);


// ============================================================
// PERMISSÕES
// ============================================================

async function exigirLogin(
  req,
  res,
  next
) {

  try {

    const usuario =
      await obterUsuarioLogado(
        req
      );


    if (!usuario) {

      return res
        .status(401)
        .json({

          erro:
            'Sessão inválida ou expirada. Faça login novamente.'

        });

    }


    req.usuarioLogado =
      usuario;


    next();


  } catch (erro) {

    console.error(
      'Erro ao validar login:',
      erro
    );


    res
      .status(500)
      .json({

        erro:
          'Erro ao validar sessão.'

      });

  }

}


// ============================================================

function exigirAdmin(
  req,
  res,
  next
) {

  if (
    req.usuarioLogado
      ?.perfil !==
    'admin'
  ) {

    return res
      .status(403)
      .json({

        erro:
          'Acesso permitido somente ao administrador.'

      });

  }


  next();

}


// ============================================================

function exigirEmissor(
  req,
  res,
  next
) {

  const perfil =
    req.usuarioLogado
      ?.perfil;


  if (
    perfil !==
    'admin' &&

    perfil !==
    'emissor' &&

    textoNormalizado(req.usuarioLogado?.departamento) !==
    'LEGALIZACAO'
  ) {

    return res
      .status(403)
      .json({

        erro:
          'Você não possui permissão para esta operação.'

      });

  }


  next();

}


// ============================================================

function exigirEntregador(
  req,
  res,
  next
) {

  const perfil =
    req.usuarioLogado
      ?.perfil;


  if (
    perfil !==
    'admin' &&

    perfil !==
    'entregador' &&

    textoNormalizado(req.usuarioLogado?.departamento) !==
    'LEGALIZACAO'
  ) {

    return res
      .status(403)
      .json({

        erro:
          'Você não possui permissão para esta operação.'

      });

  }


  next();

}

function textoNormalizado(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function podeGerenciarClientes(usuario) {
  return usuario?.perfil === 'admin' ||
    textoNormalizado(usuario?.departamento) === 'LEGALIZACAO';
}

function exigirGerenciaDeClientes(req, res, next) {
  if (!podeGerenciarClientes(req.usuarioLogado)) {
    return res.status(403).json({
      erro: 'Somente a Legalização e administradores podem alterar empresas.'
    });
  }
  next();
}


// ============================================================
// TODA API DAQUI PARA BAIXO EXIGE LOGIN
// ============================================================

require('./lib/installation').mountInstallation(app, {database: installationDatabase, transaction: installationTransaction, exigirLogin, exigirAdmin});

app.use('/api', exigirLogin);

app.use('/api', limitarMutacoesApi);

// Dados operacionais nunca devem ser reaproveitados pelo cache do navegador
// ou por uma camada intermediária da hospedagem.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});


// ============================================================
// TESTE TURSO
// ============================================================

function dataHojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function cronAutorizado(req) {
  const segredo = String(process.env.CRON_SECRET || '').trim();
  if (segredo) return req.headers.authorization === `Bearer ${segredo}`;
  return false;
}

app.get('/cron/alertas-vencimentos', async (req, res) => {
  if (!cronAutorizado(req)) return res.status(401).json({ erro: 'Não autorizado.' });

  try {
    const database = await garantirDb();
    const hoje = dataHojeSaoPaulo();
    const itens = await sqlAll(database, `
      SELECT pi.id AS item_id, pi.descricao, pi.vencimento,
             p.numero, p.cliente, p.entregador,
             u.id AS usuario_id, u.nome AS entregador_nome, u.email,
             CAST(julianday(pi.vencimento) - julianday(?) AS INTEGER) AS dias_restantes
      FROM protocolo_itens pi
      INNER JOIN protocolos p ON p.id = pi.protocolo_id
      INNER JOIN usuarios u ON u.ativo = 1
        AND u.perfil = 'entregador'
        AND LOWER(u.nome) = LOWER(p.entregador)
      WHERE p.status IN ('Aguardando entrega', 'Em entrega')
        AND COALESCE(p.excluido, 0) = 0
        AND TRIM(COALESCE(u.email, '')) <> ''
        AND CAST(julianday(pi.vencimento) - julianday(?) AS INTEGER) BETWEEN 1 AND 3
        AND NOT EXISTS (
          SELECT 1 FROM alertas_vencimento_enviados a
          WHERE a.protocolo_item_id = pi.id AND a.data_referencia = ?
        )
      ORDER BY u.id, pi.vencimento, p.numero, pi.ordem
    `, [hoje, hoje, hoje]);

    const grupos = new Map();
    for (const item of itens) {
      if (!grupos.has(item.usuario_id)) grupos.set(item.usuario_id, []);
      grupos.get(item.usuario_id).push(item);
    }

    let enviados = 0;
    const falhas = [];
    for (const grupo of grupos.values()) {
      const resultado = await enviarAlertaVencimentos({
        destinatario: grupo[0].email,
        nomeEntregador: grupo[0].entregador_nome,
        itens: grupo
      });
      if (resultado.status === 'enviado') {
        for (const item of grupo) {
          await sqlRun(database, `
            INSERT OR IGNORE INTO alertas_vencimento_enviados
            (protocolo_item_id, data_referencia, destinatario) VALUES (?, ?, ?)
          `, [item.item_id, hoje, grupo[0].email]);
        }
        enviados += grupo.length;
      } else {
        falhas.push({ entregador: grupo[0].entregador_nome, status: resultado.status });
      }
    }

    res.json({ ok: falhas.length === 0, data: hoje, itens_encontrados: itens.length, itens_notificados: enviados, falhas });
  } catch (erro) {
    console.error('Erro nos alertas de vencimento:', erro);
    res.status(500).json({ erro: 'Erro ao processar alertas de vencimento.' });
  }
});

app.get(

  '/teste',

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const resultado =
        await sqlGet(

          database,

          `
            SELECT
              1 AS ok
          `

        );


      res.json({

        ok:
          true,

        servidor:
          'Protovia Turso funcionando',

        banco:

          Number(
            resultado?.ok ||
            0
          ) === 1

            ? 'conectado'

            : 'erro',

        email:
          String(process.env.RESEND_API_KEY || '').trim() &&
          String(process.env.EMAIL_FROM || '').trim()
            ? 'configurado'
            : 'pendente_configuracao'

      });


    } catch (erro) {

      console.error(
        erro
      );


      res
        .status(500)
        .json({

          ok:
            false,

          erro:
            'Falha na conexão com o Turso.'

        });

    }

  }

);


// ============================================================
// CLIENTES / EMPRESAS
// ============================================================

function normalizarEmailsCliente(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || '').split(/[;,\n]/);
  const emails = [...new Set(lista.map(item => String(item || '').trim().toLowerCase()).filter(Boolean))];
  if (emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('EMAIL_INVALIDO');
  }
  return emails.slice(0, 10);
}

function clienteComEmails(cliente) {
  let emails = [];
  try { emails = JSON.parse(cliente.emails_json || '[]'); } catch {}
  const { emails_json, ...dados } = cliente;
  return { ...dados, emails: normalizarEmailsCliente(emails) };
}

app.get('/api/clientes', async (req, res) => {
  try {
    const database = await garantirDb();
    const incluirInativos = req.query.inativos === '1' &&
      podeGerenciarClientes(req.usuarioLogado);
    const clientes = await sqlAll(database, `
      SELECT id, nome, box, endereco, numero, complemento,
             bairro, cidade, uf, cep, observacao, ativo,
             emails_json, criado_em, atualizado_em
      FROM clientes
      ${incluirInativos ? '' : 'WHERE ativo = 1'}
      ORDER BY nome COLLATE NOCASE
    `);
    res.json({
      clientes: clientes.map(clienteComEmails),
      pode_gerenciar: podeGerenciarClientes(req.usuarioLogado)
    });
  } catch (erro) {
    console.error('Erro ao listar clientes:', erro);
    res.status(500).json({ erro: 'Erro ao buscar empresas.' });
  }
});

app.post('/api/clientes', exigirGerenciaDeClientes, async (req, res) => {
  try {
    const database = await garantirDb();
    const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) return res.status(400).json({ erro: 'Nome da empresa é obrigatório.' });
    const valor = campo => String(req.body[campo] || '').trim() || null;
    const ativo = req.body.ativo === false ? 0 : 1;
    const emails = normalizarEmailsCliente(req.body.emails);
    const resultado = await sqlRun(database, `
      INSERT INTO clientes (
        nome, nome_normalizado, box, endereco, numero, complemento,
        bairro, cidade, uf, cep, observacao, emails_json, ativo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nome, textoNormalizado(nome), valor('box'), valor('endereco'),
      valor('numero'), valor('complemento'), valor('bairro'), valor('cidade'),
      valor('uf')?.toUpperCase() || null, valor('cep'), valor('observacao'), JSON.stringify(emails), ativo
    ]);
    res.status(201).json({ ok: true, id: Number(resultado?.lastInsertRowid || 0) });
  } catch (erro) {
    if (/EMAIL_INVALIDO/.test(String(erro?.message || erro))) {
      return res.status(400).json({ erro: 'Informe somente endereços de e-mail válidos.' });
    }
    if (/unique/i.test(String(erro?.message || erro))) {
      return res.status(409).json({ erro: 'Esta empresa já está cadastrada.' });
    }
    console.error('Erro ao cadastrar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao cadastrar empresa.' });
  }
});

app.put('/api/clientes/:id', exigirGerenciaDeClientes, async (req, res) => {
  try {
    const database = await garantirDb();
    const id = Number(req.params.id);
    const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim();
    if (!Number.isInteger(id) || !nome) {
      return res.status(400).json({ erro: 'Cadastro inválido.' });
    }
    const valor = campo => String(req.body[campo] || '').trim() || null;
    const ativo = req.body.ativo === false ? 0 : 1;
    const emails = normalizarEmailsCliente(req.body.emails);
    const existente = await sqlGet(database, 'SELECT id FROM clientes WHERE id = ?', [id]);
    if (!existente) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    const resultado = await sqlRun(database, `
      UPDATE clientes SET
        nome = ?, nome_normalizado = ?, box = ?, endereco = ?, numero = ?,
        complemento = ?, bairro = ?, cidade = ?, uf = ?, cep = ?,
        observacao = ?, emails_json = ?, ativo = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      nome, textoNormalizado(nome), valor('box'), valor('endereco'),
      valor('numero'), valor('complemento'), valor('bairro'), valor('cidade'),
      valor('uf')?.toUpperCase() || null, valor('cep'), valor('observacao'), JSON.stringify(emails), ativo, id
    ]);
    if (Number(resultado?.changes || 0) !== 1) {
      throw new Error('A alteração da empresa não foi confirmada pelo banco.');
    }
    const cliente = await sqlGet(database, `
      SELECT id, nome, box, endereco, numero, complemento,
             bairro, cidade, uf, cep, observacao, ativo,
             emails_json, criado_em, atualizado_em
      FROM clientes
      WHERE id = ?
    `, [id]);
    if (!cliente) {
      throw new Error('A empresa não pôde ser relida após a alteração.');
    }
    res.json({ ok: true, cliente: clienteComEmails(cliente) });
  } catch (erro) {
    if (/EMAIL_INVALIDO/.test(String(erro?.message || erro))) {
      return res.status(400).json({ erro: 'Informe somente endereços de e-mail válidos.' });
    }
    if (/unique/i.test(String(erro?.message || erro))) {
      return res.status(409).json({ erro: 'Já existe outra empresa com esse nome.' });
    }
    console.error('Erro ao editar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao editar empresa.' });
  }
});

app.patch('/api/clientes/:id/ativo', exigirGerenciaDeClientes, async (req, res) => {
  try {
    const database = await garantirDb();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ erro: 'Cadastro inválido.' });
    const existente = await sqlGet(database, 'SELECT id FROM clientes WHERE id = ?', [id]);
    if (!existente) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    await sqlRun(
      database,
      'UPDATE clientes SET ativo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
      [req.body.ativo ? 1 : 0, id]
    );
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro ao alterar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao alterar empresa.' });
  }
});

app.delete('/api/clientes/:id', exigirGerenciaDeClientes, async (req, res) => {
  try {
    const database = await garantirDb();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ erro: 'Cadastro inválido.' });
    const existente = await sqlGet(database, 'SELECT id, nome FROM clientes WHERE id = ?', [id]);
    if (!existente) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    const protocolosVinculados = await sqlAll(database, 'SELECT id FROM protocolos WHERE cliente_id = ?', [id]);
    const protocolosPreservados = protocolosVinculados.length;
    try {
      await sqlRun(database, 'UPDATE protocolos SET cliente_id = NULL WHERE cliente_id = ?', [id]);
      const resultado = await sqlRun(database, 'DELETE FROM clientes WHERE id = ?', [id]);
      if (Number(resultado?.changes || 0) !== 1) throw new Error('A exclusão da empresa não foi confirmada pelo banco.');
    } catch (erroExclusao) {
      for (const protocolo of protocolosVinculados) {
        await sqlRun(database, 'UPDATE protocolos SET cliente_id = ? WHERE id = ? AND cliente_id IS NULL', [id, protocolo.id]);
      }
      throw erroExclusao;
    }
    res.json({ ok: true, protocolos_preservados: protocolosPreservados });
  } catch (erro) {
    console.error('Erro ao excluir cliente:', erro);
    res.status(500).json({ erro: 'Erro ao excluir empresa.' });
  }
});


// ============================================================
// LISTAR USUÁRIOS
// ============================================================

app.get('/api/usuarios/entregadores', async (req, res) => {
  try {
    const database = await garantirDb();
    const usuarios = await sqlAll(
      database,
      `
        SELECT id, nome, departamento, perfil, ativo
        FROM usuarios
        WHERE ativo = 1
          AND perfil IN ('admin', 'entregador')
        ORDER BY nome
      `
    );

    res.json(usuarios);
  } catch (erro) {
    console.error('Erro ao buscar entregadores:', erro);
    res.status(500).json({ erro: 'Erro ao buscar responsáveis pela entrega.' });
  }
});

app.get(

  '/api/usuarios',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const usuarios =
        await sqlAll(

          database,

          `
            SELECT

              id,
              nome,
              departamento,
              perfil,
              email,
              ativo,
              criado_em,
              usuario,
              ultimo_login,

              CASE

                WHEN

                  senha_hash
                    IS NOT NULL

                  AND

                  senha_hash <> ''

                THEN 1

                ELSE 0

              END

              AS senha_configurada

            FROM usuarios

            WHERE
              ativo = 1

            ORDER BY
              nome
          `

        );


      res.json(
        usuarios
      );


    } catch (erro) {

      console.error(
        'Erro ao buscar usuários:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao buscar usuários.'

        });

    }

  }

);


// ============================================================
// CRIAR USUÁRIO
// ============================================================

app.post(

  '/api/usuarios',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const {

        nome,
        departamento,
        perfil,
        email,
        usuario,
        senha

      } =
        req.body;


      if (
        !nome ||
        !departamento ||
        !perfil ||
        !usuario ||
        !senha
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Nome, departamento, perfil, login e senha são obrigatórios.'

          });

      }


      const perfisValidos =
        [

          'admin',
          'emissor',
          'entregador'

        ];


      if (
        !perfisValidos
          .includes(
            perfil
          )
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Perfil inválido.'

          });

      }


      const login =
        usuario
          .trim()
          .toLowerCase();

      const emailNormalizado = String(email || '').trim().toLowerCase();

      if (emailNormalizado && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
        return res.status(400).json({ erro: 'E-mail inválido.' });
      }

      if (
        !/^[a-z0-9._-]{3,30}$/
          .test(
            login
          )
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Login inválido. Use de 3 a 30 caracteres: letras minúsculas, números, ponto, traço ou underline.'

          });

      }


      if (
        senha.length <
        6
      ) {

        return res
          .status(400)
          .json({

            erro:
              'A senha precisa ter pelo menos 6 caracteres.'

          });

      }


      const loginExistente =
        await sqlGet(

          database,

          `
            SELECT
              id,
              ativo

            FROM usuarios

            WHERE

              LOWER(usuario) =
              LOWER(?)

            LIMIT 1
          `,

          [
            login
          ]

        );


      if (
        loginExistente
      ) {

        return res
          .status(409)
          .json({

            erro:

              Number(
                loginExistente.ativo
              ) === 1

                ? `O login "${login}" já está sendo utilizado.`

                : `O login "${login}" pertence a um usuário removido anteriormente.`

          });

      }


      const credencial =
        gerarHashSenha(
          senha
        );


      const resultado =
        await sqlRun(

          database,

          `
            INSERT INTO usuarios (

              nome,
              departamento,
              perfil,
              email,
              usuario,
              senha_hash,
              senha_salt,
              ativo

            )

            VALUES (
              ?, ?, ?, ?, ?, ?, ?, 1
            )
          `,

          [

            nome.trim(),

            departamento.trim(),

            perfil,

            emailNormalizado || null,

            login,

            credencial.hash,

            credencial.salt

          ]

        );


      let usuarioId =
        Number(
          resultado
            ?.lastInsertRowid ||
          0
        );


      let usuarioCriado;


      if (usuarioId) {

        usuarioCriado =
          await sqlGet(

            database,

            `
              SELECT

                id,
                nome,
                departamento,
                perfil,
                email,
                usuario,
                ativo,
                criado_em

              FROM usuarios

              WHERE id = ?
            `,

            [
              usuarioId
            ]

          );

      } else {

        usuarioCriado =
          await sqlGet(

            database,

            `
              SELECT

                id,
                nome,
                departamento,
                perfil,
                email,
                usuario,
                ativo,
                criado_em

              FROM usuarios

              WHERE
                LOWER(usuario) =
                LOWER(?)

              LIMIT 1
            `,

            [
              login
            ]

          );

      }


      res
        .status(201)
        .json(
          usuarioCriado
        );


    } catch (erro) {

      console.error(
        'Erro ao cadastrar usuário:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao cadastrar usuário.'

        });

    }

  }

);


// ============================================================
// EDITAR USUÁRIO
// ============================================================

app.put(

  '/api/usuarios/:id',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      const {

        nome,
        departamento,
        perfil,
        email,
        usuario

      } =
        req.body;


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID de usuário inválido.'

          });

      }


      if (
        !nome ||
        !departamento ||
        !perfil ||
        !usuario
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Nome, departamento, perfil e login são obrigatórios.'

          });

      }


      const perfisValidos =
        [

          'admin',
          'emissor',
          'entregador'

        ];


      if (
        !perfisValidos
          .includes(
            perfil
          )
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Perfil inválido.'

          });

      }


      const login =
        usuario
          .trim()
          .toLowerCase();

      const emailNormalizado = String(email || '').trim().toLowerCase();

      if (emailNormalizado && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
        return res.status(400).json({ erro: 'E-mail inválido.' });
      }

      if (
        !/^[a-z0-9._-]{3,30}$/
          .test(
            login
          )
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Login inválido. Use de 3 a 30 caracteres.'

          });

      }


      const usuarioExistente =
        await sqlGet(

          database,

          `
            SELECT
              id,
              usuario,
              perfil

            FROM usuarios

            WHERE

              id = ?

              AND ativo = 1
          `,

          [
            id
          ]

        );


      if (
        !usuarioExistente
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Usuário não encontrado.'

          });

      }

      if (
        String(usuarioExistente.usuario || '').trim().toLowerCase() === 'admin' &&
        (login !== 'admin' || perfil !== 'admin')
      ) {
        return res.status(400).json({
          erro: 'A conta principal deve permanecer como Administrador geral.'
        });
      }


      const duplicado =
        await sqlGet(

          database,

          `
            SELECT
              id

            FROM usuarios

            WHERE

              LOWER(usuario) =
              LOWER(?)

              AND id <> ?

            LIMIT 1
          `,

          [
            login,
            id
          ]

        );


      if (
        duplicado
      ) {

        return res
          .status(409)
          .json({

            erro:
              `O login "${login}" já está sendo utilizado.`

          });

      }


      await sqlRun(

        database,

        `
          UPDATE usuarios

          SET

            nome = ?,
            departamento = ?,
            perfil = ?,
            email = ?,
            usuario = ?

          WHERE id = ?
        `,

        [

          nome.trim(),

          departamento.trim(),

          perfil,

          emailNormalizado || null,

          login,

          id

        ]

      );


      const atualizado =
        await sqlGet(

          database,

          `
            SELECT

              id,
              nome,
              departamento,
              perfil,
              email,
              usuario,
              ativo,
              criado_em,
              ultimo_login

            FROM usuarios

            WHERE id = ?
          `,

          [
            id
          ]

        );


      res.json(
        atualizado
      );


    } catch (erro) {

      console.error(
        'Erro ao editar usuário:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao editar usuário.'

        });

    }

  }

);


// ============================================================
// REDEFINIR SENHA
// ============================================================

app.put(

  '/api/usuarios/:id/senha',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      const {
        senha
      } =
        req.body;


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID de usuário inválido.'

          });

      }


      if (
        !senha ||
        senha.length <
        6
      ) {

        return res
          .status(400)
          .json({

            erro:
              'A nova senha precisa ter pelo menos 6 caracteres.'

          });

      }


      const usuario =
        await sqlGet(

          database,

          `
            SELECT

              id,
              nome,
              ativo

            FROM usuarios

            WHERE id = ?
          `,

          [
            id
          ]

        );


      if (
        !usuario ||

        Number(
          usuario.ativo
        ) !== 1
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Usuário não encontrado.'

          });

      }


      const credencial =
        gerarHashSenha(
          senha
        );


      await sqlRun(

        database,

        `
          UPDATE usuarios

          SET

            senha_hash = ?,
            senha_salt = ?

          WHERE id = ?
        `,

        [

          credencial.hash,

          credencial.salt,

          id

        ]

      );


      await sqlRun(

        database,

        `
          DELETE FROM sessoes

          WHERE usuario_id = ?
        `,

        [
          id
        ]

      );


      res.json({

        ok:
          true,

        mensagem:
          `Senha de "${usuario.nome}" redefinida com sucesso.`

      });


    } catch (erro) {

      console.error(
        'Erro ao redefinir senha:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao redefinir senha.'

        });

    }

  }

);


// ============================================================
// REMOVER USUÁRIO
// ============================================================

app.delete(

  '/api/usuarios/:id',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID de usuário inválido.'

          });

      }


      if (
        Number(
          req.usuarioLogado.id
        ) === id
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Você não pode remover o próprio usuário enquanto está logado.'

          });

      }


      const usuarioExistente =
        await sqlGet(

          database,

          `
            SELECT

              id,
              nome

            FROM usuarios

            WHERE

              id = ?

              AND ativo = 1
          `,

          [
            id
          ]

        );


      if (
        !usuarioExistente
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Usuário não encontrado.'

          });

      }


      await sqlRun(

        database,

        `
          UPDATE usuarios

          SET
            ativo = 0

          WHERE id = ?
        `,

        [
          id
        ]

      );


      await sqlRun(

        database,

        `
          DELETE FROM sessoes

          WHERE usuario_id = ?
        `,

        [
          id
        ]

      );


      res.json({

        ok:
          true,

        mensagem:
          `Usuário "${usuarioExistente.nome}" removido do acesso.`

      });


    } catch (erro) {

      console.error(
        'Erro ao remover usuário:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao remover usuário.'

        });

    }

  }

);


// ============================================================
// FUNÇÕES DOS ITENS
// ============================================================

function normalizarItensDoProtocolo(
  body
) {

  let itens =
    [];


  if (
    Array.isArray(
      body.itens
    )
  ) {

    itens =
      body.itens

        .map(

          (
            item,
            indice
          ) => ({

            descricao:
              String(

                item?.descricao ||
                ''

              ).trim(),

            competencia:
              item?.competencia
                ? String(item.competencia).trim()
                : null,

            vencimento:

              item?.vencimento ===
              undefined ||

              item?.vencimento ===
              null ||

              item?.vencimento ===
              ''

                ? null

                : String(
                    item.vencimento
                  ).trim(),

            ordem:
              indice + 1

          })

        )

        .filter(

          item =>
            item.descricao

        );

  }


  if (
    itens.length === 0 &&
    body.descricao
  ) {

    itens.push({

      descricao:
        String(
          body.descricao
        ).trim(),

      competencia: null,

      vencimento:

        body.vencimento ===
        undefined ||

        body.vencimento ===
        null ||

        body.vencimento ===
        ''

          ? null

          : String(
              body.vencimento
            ).trim(),

      ordem:
        1

    });

  }


  return itens;

}


// ============================================================

function vencimentoValido(
  valor
) {

  if (!valor) {

    return true;

  }


  return /^\d{4}-\d{2}-\d{2}$/
    .test(
      valor
    );

}


// ============================================================

async function buscarItensDoProtocolo(
  protocoloId,
  conexao = null
) {

  const database =
    conexao ||
    await garantirDb();


  return await sqlAll(

    database,

    `
      SELECT

        id,
        protocolo_id,
        descricao,
        competencia,
        vencimento,
        ordem,
        criado_em

      FROM protocolo_itens

      WHERE
        protocolo_id = ?

      ORDER BY

        ordem,
        id
    `,

    [
      protocoloId
    ]

  );

}


// ============================================================

async function anexarItens(
  protocolo,
  conexao = null
) {

  if (!protocolo) {

    return protocolo;

  }


  const { qr_token, ...dadosPublicos } = protocolo;
  const qr_hash = qr_token
    ? crypto.createHash('sha256').update(`PROTOVIA:${protocolo.id}:${qr_token}`).digest('hex')
    : '';

  return {

    ...dadosPublicos,
    qr_hash,

    itens:
      await buscarItensDoProtocolo(

        protocolo.id,

        conexao

      )

  };

}


// ============================================================

async function anexarItensEmLista(
  protocolos
) {

  const resultado =
    [];


  for (
    const protocolo
    of protocolos
  ) {

    resultado.push(

      await anexarItens(
        protocolo
      )

    );

  }


  return resultado;

}


// ============================================================
// LISTAR PROTOCOLOS
// ============================================================

app.get(

  '/api/protocolos',

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const protocolos =
        await sqlAll(

          database,

          `
            SELECT

              id,
              numero,
              cliente,
              cliente_id,
              cliente_box,
              endereco_empresa,
              departamento,
              descricao,
              vencimento,
              emissor,
              entregador,
              observacao,
              status,
              recebido_por,
              assinatura,
              criado_em,
              entregue_em,
              motivo_cancelamento,
              cancelado_por,
              cancelado_em,
              qr_token,
              qr_obrigatorio,
              qr_confirmado_em,
              qr_confirmado_por,
              email_destinatarios,
              email_status,
              email_enviado_em,
              excluido,
              excluido_em,
              excluido_por

            FROM protocolos

            WHERE

              COALESCE(
                excluido,
                0
              ) = 0

            ORDER BY

              numero DESC
          `

        );


      res.json(

        await anexarItensEmLista(
          protocolos
        )

      );


    } catch (erro) {

      console.error(
        'Erro ao buscar protocolos:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao buscar protocolos.'

        });

    }

  }

);


// ============================================================
// PRÓXIMO NÚMERO
// ============================================================

app.get(

  '/api/protocolos/proximo-numero',

  exigirEmissor,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const resultado =
        await sqlGet(

          database,

          `
            SELECT

              MAX(numero)
              AS ultimo

            FROM protocolos
          `

        );


      const ultimo =
        Number(

          resultado?.ultimo ||
          0

        );


      res.json({

        ultimo,

        proximo:
          ultimo + 1

      });


    } catch (erro) {

      console.error(
        'Erro ao buscar próximo protocolo:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao buscar próximo número.'

        });

    }

  }

);


// ============================================================
// CRIAR PROTOCOLO
// ============================================================

app.post(

  '/api/protocolos',

  exigirEmissor,

  async (
    req,
    res
  ) => {

    const {

      numero,
      cliente,
      cliente_id,
      cliente_box,
      departamento,
      entregador,
      observacao

    } =
      req.body;


    const itens =
      normalizarItensDoProtocolo(
        req.body
      );

    let clienteCadastro = null;

    try {
      const database = await garantirDb();
      clienteCadastro = Number(cliente_id)
        ? await sqlGet(database, `
            SELECT id, nome, box, endereco, numero, complemento,
                   bairro, cidade, uf, cep
            FROM clientes
            WHERE id = ? AND ativo = 1
          `, [Number(cliente_id)])
        : null;
    } catch (erro) {
      console.error('Erro ao validar empresa do protocolo:', erro);
    }

    if (!clienteCadastro) {
      return res.status(400).json({
        erro: 'Selecione uma empresa ativa do cadastro.'
      });
    }

    const enderecoCadastro = [
      [clienteCadastro.endereco, clienteCadastro.numero, clienteCadastro.complemento]
        .filter(Boolean).join(', '),
      [clienteCadastro.bairro, clienteCadastro.cidade, clienteCadastro.uf]
        .filter(Boolean).join(' - '),
      clienteCadastro.cep ? `CEP ${clienteCadastro.cep}` : ''
    ].filter(Boolean).join(' · ') || null;


    if (
      !cliente ||
      !departamento ||
      !entregador ||
      itens.length === 0
    ) {

      return res
        .status(400)
        .json({

          erro:
            'Cliente, departamento, entregador e pelo menos um item/documento são obrigatórios.'

        });

    }


    for (
      const item
      of itens
    ) {

      if (
        !vencimentoValido(
          item.vencimento
        )
      ) {

        return res
          .status(400)
          .json({

            erro:
              `Vencimento inválido no item "${item.descricao}".`

          });

      }

    }


    let numeroManual =
      null;


    if (
      numero !== undefined &&
      numero !== null &&
      numero !== ''
    ) {

      numeroManual =
        Number(
          numero
        );


      if (
        !Number.isInteger(
          numeroManual
        ) ||

        numeroManual <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Número do protocolo inválido.'

          });

      }

    }


    try {

      const database =
        await garantirDb();


      let protocoloId =
        null;


      let numeroFinal =
        null;


      const transacao =
        database.transactionAsync(

          async (
            tx
          ) => {

            // ===============================================
            // NÚMERO MANUAL
            // ===============================================

            if (
              numeroManual !==
              null
            ) {

              numeroFinal =
                numeroManual;


              const duplicado =
                await sqlGet(

                  tx,

                  `
                    SELECT
                      id

                    FROM protocolos

                    WHERE
                      numero = ?
                  `,

                  [
                    numeroFinal
                  ]

                );


              if (
                duplicado
              ) {

                const erro =
                  new Error(
                    `O protocolo ${String(
                      numeroFinal
                    ).padStart(
                      6,
                      '0'
                    )} já existe.`
                  );


                erro.statusCode =
                  409;


                throw erro;

              }

            }


            // ===============================================
            // NÚMERO AUTOMÁTICO
            // ===============================================

            else {

              const resultadoNumero =
                await sqlGet(

                  tx,

                  `
                    SELECT

                      MAX(numero)
                      AS ultimo

                    FROM protocolos
                  `

                );


              numeroFinal =
                Number(

                  resultadoNumero
                    ?.ultimo ||
                  0

                ) + 1;

            }


            const emissor =
              req.usuarioLogado
                .nome;


            const primeiroItem =
              itens[0];

            const qrToken = crypto.randomBytes(24).toString('hex');


            const resultado =
              await sqlRun(

                tx,

                `
                  INSERT INTO protocolos (

                    numero,
                    cliente,
                    cliente_id,
                    cliente_box,
                    endereco_empresa,
                    departamento,
                    descricao,
                    vencimento,
                    emissor,
                    entregador,
                    observacao,
                    status,
                    qr_token,
                    qr_obrigatorio

                  )

                  VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                  )
                `,

                [

                  numeroFinal,

                  clienteCadastro.nome,

                  Number(clienteCadastro.id),

                  clienteCadastro.box || null,

                  enderecoCadastro,

                  String(
                    departamento
                  ).trim(),

                  primeiroItem
                    .descricao,

                  primeiroItem
                    .vencimento,

                  emissor,

                  String(
                    entregador
                  ).trim(),

                  observacao
                    ?.trim() ||
                    null,

                  'Aguardando entrega',

                  qrToken,

                  1

                ]

              );


            protocoloId =
              Number(

                resultado
                  ?.lastInsertRowid ||
                0

              );


            if (
              !protocoloId
            ) {

              const criado =
                await sqlGet(

                  tx,

                  `
                    SELECT
                      id

                    FROM protocolos

                    WHERE
                      numero = ?

                    LIMIT 1
                  `,

                  [
                    numeroFinal
                  ]

                );


              protocoloId =
                Number(
                  criado?.id ||
                  0
                );

            }


            if (
              !protocoloId
            ) {

              throw new Error(
                'Não foi possível identificar o protocolo criado.'
              );

            }


            // ===============================================
            // ITENS
            // ===============================================

            for (
              let indice = 0;
              indice <
              itens.length;
              indice++
            ) {

              const item =
                itens[indice];


              await sqlRun(

                tx,

                `
                  INSERT INTO protocolo_itens (

                    protocolo_id,
                    descricao,
                    competencia,
                    vencimento,
                    ordem

                  )

                  VALUES (
                    ?, ?, ?, ?, ?
                  )
                `,

                [

                  protocoloId,

                  item.descricao,

                  item.competencia,

                  item.vencimento,

                  indice + 1

                ]

              );

            }

          }

        );


      await transacao
        .immediate();


      const protocoloCriado =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            protocoloId
          ]

        );

      let notificacao = { status: 'nao_aplicavel' };
      const usuarioEntregador = await sqlGet(
        database,
        `
          SELECT nome, email
          FROM usuarios
          WHERE ativo = 1
            AND perfil = 'entregador'
            AND LOWER(nome) = LOWER(?)
          ORDER BY id
          LIMIT 1
        `,
        [String(entregador).trim()]
      );

      if (usuarioEntregador) {
        try {
          const pendencias = await sqlGet(database,`
            SELECT COUNT(*) AS total FROM protocolos
            WHERE LOWER(entregador) = LOWER(?)
              AND status IN ('Aguardando entrega', 'Em entrega')
              AND COALESCE(excluido, 0) = 0
          `, [String(entregador).trim()]);
          notificacao = await enviarNotificacaoNovoProtocolo({
            totalPendentes: Number(pendencias.total),
            protocolo: protocoloCriado,
            itens,
            destinatario: usuarioEntregador.email
          });
        } catch (erroNotificacao) {
          notificacao = { status: 'falhou', erro: erroNotificacao.message };
        }
      }

      const notificacaoEnviadaEm = notificacao.status === 'enviado'
        ? new Date().toISOString()
        : null;

      await sqlRun(
        database,
        `
          UPDATE protocolos
          SET notificacao_entregador_destinatario = ?,
              notificacao_entregador_status = ?,
              notificacao_entregador_enviada_em = ?,
              notificacao_entregador_erro = ?
          WHERE id = ?
        `,
        [
          usuarioEntregador?.email || null,
          notificacao.status,
          notificacaoEnviadaEm,
          notificacao.erro || null,
          protocoloId
        ]
      );

      const protocoloComNotificacao = await sqlGet(
        database,
        'SELECT * FROM protocolos WHERE id = ?',
        [protocoloId]
      );


      res
        .status(201)
        .json(

          await anexarItens(
            protocoloComNotificacao
          )

        );


    } catch (erro) {

      console.error(
        'Erro ao criar protocolo:',
        erro
      );


      if (
        erro?.statusCode ===
        409
      ) {

        return res
          .status(409)
          .json({

            erro:
              erro.message

          });

      }


      if (
        String(
          erro?.message ||
          ''
        ).includes(
          'UNIQUE constraint failed'
        )
      ) {

        return res
          .status(409)
          .json({

            erro:
              'Já existe um protocolo com esse número.'

          });

      }


      res
        .status(500)
        .json({

          erro:
            'Erro ao criar protocolo.'

        });

    }

  }

);


// ============================================================
// INICIAR ENTREGA
// ============================================================

app.put(

  '/api/protocolos/:id/em-entrega',

  exigirEntregador,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID do protocolo inválido.'

          });

      }


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE

              id = ?

              AND

              COALESCE(
                excluido,
                0
              ) = 0
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        req.usuarioLogado
          .perfil ===
        'entregador' &&

        protocolo
          .entregador !==
        req.usuarioLogado
          .nome
      ) {

        return res
          .status(403)
          .json({

            erro:
              'Esta entrega está atribuída a outro usuário.'

          });

      }


      if (
        protocolo.status ===
        'Em entrega'
      ) {

        return res.json(

          await anexarItens(
            protocolo
          )

        );

      }


      if (
        protocolo.status ===
        'Entregue'
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Este protocolo já foi entregue.'

          });

      }


      if (
        protocolo.status ===
        'Cancelado'
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Este protocolo foi cancelado.'

          });

      }


      await sqlRun(

        database,

        `
          UPDATE protocolos

          SET
            status = 'Em entrega'

          WHERE id = ?
        `,

        [
          id
        ]

      );


      const atualizado =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      res.json(

        await anexarItens(
          atualizado
        )

      );


    } catch (erro) {

      console.error(
        'Erro ao iniciar entrega:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro interno ao iniciar entrega.'

        });

    }

  }

);


// ============================================================
// CONFIRMAR ENTREGA
// ============================================================

app.get('/api/protocolos/:id/etiqueta', exigirEmissor, async (req, res) => {
  try {
    const database = await garantirDb();
    const id = Number(req.params.id);
    const protocolo = await sqlGet(database, 'SELECT * FROM protocolos WHERE id = ? AND COALESCE(excluido, 0) = 0', [id]);
    if (!protocolo) return res.status(404).json({ erro: 'Protocolo não encontrado.' });
    const completo = await anexarItens(protocolo);
    const codigo = `PROTOVIA:${protocolo.id}:${protocolo.qr_token}`;
    const qr_data_url = await QRCode.toDataURL(codigo, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'no-store').json({
      id: protocolo.id,
      numero: protocolo.numero,
      cliente: protocolo.cliente,
      itens: completo.itens,
      qr_data_url
    });
  } catch (erro) {
    console.error('Erro ao gerar etiqueta:', erro);
    res.status(500).json({ erro: 'Não foi possível gerar a etiqueta.' });
  }
});

app.put(

  '/api/protocolos/:id/entregar',

  exigirEntregador,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      const {

        recebido_por,
        assinatura,
        entregue_em_local,
        qr_codigo,
        protocolo_numero_confirmacao,
        email_destinatarios

      } =
        req.body;


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID do protocolo inválido.'

          });

      }


      if (
        !recebido_por ||
        !assinatura
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Nome e assinatura são obrigatórios.'

          });

      }


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE

              id = ?

              AND

              COALESCE(
                excluido,
                0
              ) = 0
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        req.usuarioLogado
          .perfil ===
        'entregador' &&

        protocolo
          .entregador !==
        req.usuarioLogado
          .nome
      ) {

        return res
          .status(403)
          .json({

            erro:
              'Esta entrega está atribuída a outro usuário.'

          });

      }


      if (
        protocolo.status ===
        'Cancelado'
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Protocolo cancelado não pode ser entregue.'

          });

      }

      const qrEsperado = `PROTOVIA:${protocolo.id}:${protocolo.qr_token}`;
      const qrRecebidoBuffer = Buffer.from(String(qr_codigo || ''));
      const qrEsperadoBuffer = Buffer.from(qrEsperado);
      const qrValido = Boolean(
        qr_codigo &&
        protocolo.qr_token &&
        qrRecebidoBuffer.length === qrEsperadoBuffer.length &&
        crypto.timingSafeEqual(qrRecebidoBuffer, qrEsperadoBuffer)
      );
      const numeroDigitado = String(protocolo_numero_confirmacao ?? '').trim();
      const numeroValido = /^\d+$/.test(numeroDigitado) && Number(numeroDigitado) === Number(protocolo.numero);

      if (Number(protocolo.qr_obrigatorio) === 1 && !qrValido && !numeroValido) {
        return res.status(400).json({ erro: 'Escaneie o QR Code ou digite o número correto do protocolo.' });
      }

      const metodoConfirmacao = qrValido ? 'qr_code' : (numeroValido ? 'numero_protocolo' : 'nao_exigida');

      const destinatarios = normalizarDestinatarios(email_destinatarios);


      if (
        protocolo.status ===
        'Entregue'
      ) {

        return res.json(

          await anexarItens(
            protocolo
          )

        );

      }


      let entregueEm =
        new Date()
          .toISOString();


      if (
        entregue_em_local
      ) {

        const dataLocal =
          new Date(
            entregue_em_local
          );


        if (
          !isNaN(
            dataLocal.getTime()
          )
        ) {

          entregueEm =
            dataLocal
              .toISOString();

        }

      }


      await sqlRun(

        database,

        `
          UPDATE protocolos

          SET

            status =
              'Entregue',

            recebido_por = ?,

            assinatura = ?,

            entregue_em = ?,

            qr_confirmado_em = ?,

            qr_confirmado_por = ?,

            confirmacao_entrega_metodo = ?,

            confirmacao_numero_digitado = ?,

            email_destinatarios = ?,

            email_status = ?

          WHERE id = ?
        `,

        [

          String(
            recebido_por
          ).trim(),

          assinatura,

          entregueEm,

          new Date().toISOString(),

          req.usuarioLogado.nome,

          metodoConfirmacao,

          numeroValido ? numeroDigitado : null,

          JSON.stringify(destinatarios),

          destinatarios.length ? 'pendente' : 'nao_solicitado',

          id

        ]

      );


      const atualizado =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      const completo = await anexarItens(atualizado);
      const envio = await enviarComprovanteEntrega({ protocolo: atualizado, itens: completo.itens, destinatarios });
      await sqlRun(database, `UPDATE protocolos SET email_status = ?, email_enviado_em = ?, email_erro = ? WHERE id = ?`, [
        envio.status,
        envio.status === 'enviado' ? new Date().toISOString() : null,
        envio.erro || null,
        id
      ]);
      res.json({ ...completo, email_status: envio.status, email_erro: envio.erro || null });


    } catch (erro) {

      console.error(
        'Erro ao confirmar entrega:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro interno ao confirmar entrega.'

        });

    }

  }

);


// ============================================================
// CANCELAR PROTOCOLO
// ============================================================

app.put(

  '/api/protocolos/:id/cancelar',

  exigirEmissor,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      const {
        motivo
      } =
        req.body;


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID do protocolo inválido.'

          });

      }


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE

              id = ?

              AND

              COALESCE(
                excluido,
                0
              ) = 0
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        protocolo.status ===
        'Cancelado'
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Este protocolo já está cancelado.'

          });

      }


      if (
        protocolo.status ===
        'Entregue'
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Um protocolo já entregue não pode ser cancelado.'

          });

      }


      await sqlRun(

        database,

        `
          UPDATE protocolos

          SET

            status =
              'Cancelado',

            motivo_cancelamento = ?,

            cancelado_por = ?,

            cancelado_em = ?

          WHERE id = ?
        `,

        [

          motivo
            ?.trim() ||
          'Sem motivo informado',

          req.usuarioLogado
            .nome,

          new Date()
            .toISOString(),

          id

        ]

      );


      const atualizado =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      res.json(

        await anexarItens(
          atualizado
        )

      );


    } catch (erro) {

      console.error(
        'Erro ao cancelar protocolo:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao cancelar protocolo.'

        });

    }

  }

);


// ============================================================
// EXCLUSÃO LÓGICA
// ============================================================

app.put(

  '/api/protocolos/:id/excluir',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID do protocolo inválido.'

          });

      }


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        Number(
          protocolo.excluido ||
          0
        ) === 1
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Este protocolo já está excluído.'

          });

      }


      await sqlRun(

        database,

        `
          UPDATE protocolos

          SET

            excluido = 1,

            excluido_em = ?,

            excluido_por = ?

          WHERE id = ?
        `,

        [

          new Date()
            .toISOString(),

          req.usuarioLogado
            .nome,

          id

        ]

      );


      res.json({

        ok:
          true,

        mensagem:

          `Protocolo ${String(
            protocolo.numero
          ).padStart(
            6,
            '0'
          )} excluído.`

      });


    } catch (erro) {

      console.error(
        'Erro ao excluir protocolo:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao excluir protocolo.'

        });

    }

  }

);


// ============================================================
// PROTOCOLOS EXCLUÍDOS
// ============================================================

app.get(

  '/api/protocolos-excluidos',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const protocolos =
        await sqlAll(

          database,

          `
            SELECT

              id,
              numero,
              cliente,
              cliente_id,
              cliente_box,
              endereco_empresa,
              departamento,
              descricao,
              vencimento,
              emissor,
              entregador,
              observacao,
              status,
              recebido_por,
              assinatura,
              criado_em,
              entregue_em,
              motivo_cancelamento,
              cancelado_por,
              cancelado_em,
              excluido,
              excluido_em,
              excluido_por

            FROM protocolos

            WHERE

              COALESCE(
                excluido,
                0
              ) = 1

            ORDER BY

              numero DESC
          `

        );


      res.json(

        await anexarItensEmLista(
          protocolos
        )

      );


    } catch (erro) {

      console.error(
        'Erro ao buscar protocolos excluídos:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao buscar protocolos excluídos.'

        });

    }

  }

);


// ============================================================
// RESTAURAR PROTOCOLO
// ============================================================

app.put(

  '/api/protocolos/:id/restaurar',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    try {

      const database =
        await garantirDb();


      const id =
        Number(
          req.params.id
        );


      if (
        !Number.isInteger(
          id
        ) ||

        id <= 0
      ) {

        return res
          .status(400)
          .json({

            erro:
              'ID do protocolo inválido.'

          });

      }


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        Number(
          protocolo.excluido ||
          0
        ) !== 1
      ) {

        return res
          .status(400)
          .json({

            erro:
              'Este protocolo não está excluído.'

          });

      }


      await sqlRun(

        database,

        `
          UPDATE protocolos

          SET

            excluido = 0,

            excluido_em =
              NULL,

            excluido_por =
              NULL

          WHERE id = ?
        `,

        [
          id
        ]

      );


      const restaurado =
        await sqlGet(

          database,

          `
            SELECT *

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      res.json(

        await anexarItens(
          restaurado
        )

      );


    } catch (erro) {

      console.error(
        'Erro ao restaurar protocolo:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao restaurar protocolo.'

        });

    }

  }

);


// ============================================================
// EXCLUIR DEFINITIVAMENTE
// ============================================================

app.delete(

  '/api/protocolos/:id/definitivo',

  exigirAdmin,

  async (
    req,
    res
  ) => {

    const id =
      Number(
        req.params.id
      );


    if (
      !Number.isInteger(
        id
      ) ||

      id <= 0
    ) {

      return res
        .status(400)
        .json({

          erro:
            'ID do protocolo inválido.'

        });

    }


    try {

      const database =
        await garantirDb();


      const protocolo =
        await sqlGet(

          database,

          `
            SELECT

              id,
              numero,
              cliente,
              status,
              excluido

            FROM protocolos

            WHERE id = ?
          `,

          [
            id
          ]

        );


      if (
        !protocolo
      ) {

        return res
          .status(404)
          .json({

            erro:
              'Protocolo não encontrado.'

          });

      }


      if (
        Number(
          protocolo.excluido ||
          0
        ) !== 1
      ) {

        return res
          .status(400)
          .json({

            erro:
              'O protocolo precisa estar na área de protocolos excluídos antes da exclusão definitiva.'

          });

      }


      const transacao =
        database.transactionAsync(

          async (
            tx
          ) => {

            await sqlRun(

              tx,

              `
                DELETE FROM protocolo_itens

                WHERE
                  protocolo_id = ?
              `,

              [
                id
              ]

            );


            const resultado =
              await sqlRun(

                tx,

                `
                  DELETE FROM protocolos

                  WHERE

                    id = ?

                    AND

                    COALESCE(
                      excluido,
                      0
                    ) = 1
                `,

                [
                  id
                ]

              );


            const alteracoes =
              Number(

                resultado
                  ?.changes ||

                resultado
                  ?.rowsAffected ||

                0

              );


            if (
              alteracoes !==
              1
            ) {

              throw new Error(
                'O protocolo não pôde ser excluído definitivamente.'
              );

            }

          }

        );


      await transacao
        .immediate();


      res.json({

        ok:
          true,

        numero:
          protocolo.numero,

        mensagem:

          `Protocolo ${String(
            protocolo.numero
          ).padStart(
            6,
            '0'
          )} excluído definitivamente.`

      });


    } catch (erro) {

      console.error(
        'Erro ao excluir protocolo definitivamente:',
        erro
      );


      res
        .status(500)
        .json({

          erro:
            'Erro ao excluir protocolo definitivamente.'

        });

    }

  }

);


// ============================================================
// INICIAR SERVIDOR
// ============================================================

async function iniciarServidor() {

  try {

    const database =
      await garantirDb();


    await sqlGet(

      database,

      `
        SELECT
          1 AS ok
      `

    );


    app.listen(

      PORT,

      () => {

        console.log('');
        console.log(
          '======================================'
        );

        console.log(
          ' PROTOVIA PROTOCOLOS - TURSO'
        );

        console.log(
          '======================================'
        );

        console.log('');

        console.log(
          `Servidor: http://localhost:${PORT}`
        );

        console.log(
          'Banco: Turso conectado'
        );

        console.log('');

      }

    );


  } catch (erro) {

    console.error('');
    console.error(
      'ERRO AO INICIAR PROTOVIA TURSO:'
    );
    console.error('');

    console.error(
      erro
    );

    console.error('');

    process.exit(1);

  }

}


// ============================================================
// LOCAL
// ============================================================

if (
  require.main ===
  module
) {

  iniciarServidor();

}


// ============================================================
// VERCEL
// ============================================================

module.exports =
  app;

async function installationDatabase() { return garantirDb(); }
async function installationTransaction(callback) { const database=await garantirDb(); return database.transactionAsync(callback).immediate(); }
