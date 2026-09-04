const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { normalizarDestinatarios, enviarComprovanteEntrega, enviarNotificacaoNovoProtocolo, enviarAlertaVencimentos } = require('./lib/email');

try {
  process.loadEnvFile('.env');
} catch {
  // Em produção, as variáveis podem ser fornecidas pelo serviço do sistema.
}

const db = require('./banco/db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// Assinaturas em base64 podem ultrapassar
// o limite padrão do Express.
app.use(
  express.json({
    limit: '5mb'
  })
);

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const limitesLocais = new Map();

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

function identificadorCliente(req) {
  return String(req.ip || req.socket?.remoteAddress || 'desconhecido');
}

function consumirLimiteLocal(namespace, identificador, maximo, janelaMs) {
  const agora = Date.now();
  const janela = Math.floor(agora / janelaMs);
  const expiraEm = (janela + 1) * janelaMs;
  const hash = crypto.createHash('sha256').update(String(identificador || '')).digest('hex');
  const chave = `${namespace}:${janela}:${hash}`;
  const quantidade = (limitesLocais.get(chave)?.quantidade || 0) + 1;
  limitesLocais.set(chave, { quantidade, expiraEm });

  if (limitesLocais.size > 500) {
    for (const [item, limite] of limitesLocais) {
      if (limite.expiraEm < agora) limitesLocais.delete(item);
    }
  }

  return {
    permitido: quantidade <= maximo,
    restante: Math.max(0, maximo - quantidade),
    retryAfter: Math.max(1, Math.ceil((expiraEm - agora) / 1000))
  };
}

function responderLimiteExcedido(res, limite) {
  res.setHeader('Retry-After', String(limite.retryAfter));
  return res.status(429).json({
    erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  });
}

function limitarLogin(req, res, next) {
  const ip = identificadorCliente(req);
  const login = String(req.body?.usuario || '').trim().toLowerCase() || 'sem-login';
  const porCredencial = consumirLimiteLocal('login-credencial', `${ip}:${login}`, 8, 15 * 60 * 1000);
  if (!porCredencial.permitido) return responderLimiteExcedido(res, porCredencial);
  const porIp = consumirLimiteLocal('login-ip', ip, 50, 15 * 60 * 1000);
  if (!porIp.permitido) return responderLimiteExcedido(res, porIp);
  next();
}

function limitarMutacoesApi(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  const identificador = req.usuarioLogado?.id || identificadorCliente(req);
  const limite = consumirLimiteLocal('api-mutacao', identificador, 120, 5 * 60 * 1000);
  res.setHeader('X-RateLimit-Remaining', String(limite.restante));
  if (!limite.permitido) return responderLimiteExcedido(res, limite);
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
  8 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';


// ============================================================
// FUNÇÕES DE LOGIN
// ============================================================

function lerCookies(req) {

  const cabecalho =
    req.headers.cookie || '';

  const cookies = {};

  cabecalho
    .split(';')
    .forEach(item => {

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
            valor || ''
          );

      }

    });

  return cookies;
}


function hashToken(token) {

  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

}


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


function gerarHashSenha(senha) {

  const salt =
    crypto
      .randomBytes(32)
      .toString('hex');

  const hash =
    crypto
      .scryptSync(
        senha,
        salt,
        64
      )
      .toString('hex');

  return {
    salt,
    hash
  };

}


function criarSessao(usuarioId) {

  const tokenReal =
    crypto
      .randomBytes(32)
      .toString('hex');

  const tokenBanco =
    hashToken(tokenReal);

  const expira =
    new Date(
      Date.now() +
      DURACAO_SESSAO
    );

  db.prepare(`
    INSERT INTO sessoes (
      token,
      usuario_id,
      expira_em
    )
    VALUES (?, ?, ?)
  `).run(
    tokenBanco,
    usuarioId,
    expira.toISOString()
  );

  return {
    token:
      tokenReal,

    expira
  };

}


function obterUsuarioLogado(req) {

  try {

    const cookies =
      lerCookies(req);

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
      db.prepare(`
        SELECT
          s.id AS sessao_id,
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

        WHERE s.token = ?

        LIMIT 1
      `).get(
        tokenBanco
      );

    if (!sessao) {

      return null;

    }

    if (
      Number(
        sessao.ativo
      ) !== 1
    ) {

      db.prepare(`
        DELETE FROM sessoes
        WHERE id = ?
      `).run(
        sessao.sessao_id
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

      db.prepare(`
        DELETE FROM sessoes
        WHERE id = ?
      `).run(
        sessao.sessao_id
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
// LOGIN
// ============================================================

app.post(
  '/api/login',
  limitarLogin,
  (req, res) => {

    try {

      const {
        usuario,
        senha
      } = req.body;

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
        db.prepare(`
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
        `).get(
          login
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

      const sessoes =
        db.prepare(`
          SELECT
            id,
            expira_em

          FROM sessoes
        `).all();

      for (
        const sessao
        of sessoes
      ) {

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

          db.prepare(`
            DELETE FROM sessoes
            WHERE id = ?
          `).run(
            sessao.id
          );

        }

      }

      const novaSessao =
        criarSessao(
          cadastro.id
        );

      db.prepare(`
        UPDATE usuarios

        SET
          ultimo_login = ?

        WHERE id = ?
      `).run(

        new Date()
          .toISOString(),

        cadastro.id

      );

      const maxAgeSegundos =
        Math.floor(
          DURACAO_SESSAO /
          1000
        );

      res.setHeader(

        'Set-Cookie',

        `${COOKIE_SESSAO}=${encodeURIComponent(
          novaSessao.token
        )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSegundos}${COOKIE_SECURE}`

      );

      res.json({

        ok: true,

        usuario: {

          id:
            cadastro.id,

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

      res.status(500).json({

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
  (req, res) => {

    const usuario =
      obterUsuarioLogado(
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
  (req, res) => {

    try {

      const cookies =
        lerCookies(req);

      const tokenReal =
        cookies[
          COOKIE_SESSAO
        ];

      if (tokenReal) {

        db.prepare(`
          DELETE FROM sessoes

          WHERE token = ?
        `).run(

          hashToken(
            tokenReal
          )

        );

      }

      res.setHeader(

        'Set-Cookie',

        `${COOKIE_SESSAO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SECURE}`

      );

      res.json({
        ok: true
      });

    } catch (erro) {

      console.error(
        'Erro ao sair:',
        erro
      );

      res.status(500).json({

        erro:
          'Erro ao encerrar sessão.'

      });

    }

  }
);


// ============================================================
// PERMISSÕES
// ============================================================

function exigirLogin(
  req,
  res,
  next
) {

  const usuario =
    obterUsuarioLogado(
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

}


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
      'emissor'
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
      'entregador'
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
// TODA API ABAIXO EXIGE LOGIN
// ============================================================

require('./lib/installation').mountInstallation(app, {database: installationDatabase, transaction: installationTransaction, exigirLogin, exigirAdmin});

app.use(
  '/api',
  exigirLogin
);

app.use('/api', limitarMutacoesApi);
const deliveryPolicy = require('./lib/delivery-policy');
const deliveryDatabase = () => ({get:(sql,...args)=>db.prepare(sql).get(...args),run:(sql,...args)=>db.prepare(sql).run(...args)});
deliveryPolicy.mountDeliveryPolicy(app, { database:deliveryDatabase, exigirAdmin });
require('./lib/pickups').mountPickups(app, {optional:true,database:()=>({
  ...deliveryDatabase(), all:(sql,...args)=>db.prepare(sql).all(...args)
})});


// ============================================================
// TESTE DO SERVIDOR
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
    const hoje = dataHojeSaoPaulo();
    const itens = db.prepare(`
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
    `).all(hoje, hoje, hoje);

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
        const registrar = db.prepare(`
          INSERT OR IGNORE INTO alertas_vencimento_enviados
          (protocolo_item_id, data_referencia, destinatario) VALUES (?, ?, ?)
        `);
        for (const item of grupo) registrar.run(item.item_id, hoje, grupo[0].email);
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
  (req, res) => {

    res.send(
      'Servidor Protovia funcionando!'
    );

  }
);

app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      servico: 'protovia-protocolos-interno',
      banco: 'sqlite',
      email: String(process.env.RESEND_API_KEY || '').trim() && String(process.env.EMAIL_FROM || '').trim()
        ? 'configurado'
        : 'pendente_configuracao',
      uptime_segundos: Math.floor(process.uptime())
    });
  } catch (erro) {
    res.status(503).json({ ok: false, erro: 'Banco indisponível.' });
  }
});

// ============================================================
// CLIENTES / EMPRESAS
// Consulta global; manutenção exclusiva da Legalização e Admin.
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

app.get('/api/clientes', (req, res) => {
  try {
    const incluirInativos = req.query.inativos === '1' &&
      podeGerenciarClientes(req.usuarioLogado);

    const clientes = db.prepare(`
      SELECT id, nome, box, endereco, numero, complemento,
             bairro, cidade, uf, cep, observacao, ativo,
             emails_json, criado_em, atualizado_em
      FROM clientes
      ${incluirInativos ? '' : 'WHERE ativo = 1'}
      ORDER BY nome COLLATE NOCASE
    `).all();

    res.json({
      clientes: clientes.map(clienteComEmails),
      pode_gerenciar: podeGerenciarClientes(req.usuarioLogado)
    });
  } catch (erro) {
    console.error('Erro ao listar clientes:', erro);
    res.status(500).json({ erro: 'Erro ao buscar empresas.' });
  }
});

app.post('/api/clientes', exigirGerenciaDeClientes, (req, res) => {
  try {
    const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) return res.status(400).json({ erro: 'Nome da empresa é obrigatório.' });

    const valor = campo => {
      const texto = String(req.body[campo] || '').trim();
      return texto || null;
    };
    const ativo = req.body.ativo === false ? 0 : 1;
    const emails = normalizarEmailsCliente(req.body.emails);

    const resultado = db.prepare(`
      INSERT INTO clientes (
        nome, nome_normalizado, box, endereco, numero, complemento,
        bairro, cidade, uf, cep, observacao, emails_json, ativo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nome, textoNormalizado(nome), valor('box'), valor('endereco'),
      valor('numero'), valor('complemento'), valor('bairro'),
      valor('cidade'), valor('uf')?.toUpperCase() || null,
      valor('cep'), valor('observacao'), JSON.stringify(emails), ativo
    );

    res.status(201).json({ ok: true, id: Number(resultado.lastInsertRowid) });
  } catch (erro) {
    if (String(erro.message).includes('EMAIL_INVALIDO')) {
      return res.status(400).json({ erro: 'Informe somente endereços de e-mail válidos.' });
    }
    if (String(erro.message).includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Esta empresa já está cadastrada.' });
    }
    console.error('Erro ao cadastrar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao cadastrar empresa.' });
  }
});

app.put('/api/clientes/:id', exigirGerenciaDeClientes, (req, res) => {
  try {
    const id = Number(req.params.id);
    const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim();
    if (!Number.isInteger(id) || !nome) {
      return res.status(400).json({ erro: 'Cadastro inválido.' });
    }
    const valor = campo => String(req.body[campo] || '').trim() || null;
    const ativo = req.body.ativo === false ? 0 : 1;
    const emails = normalizarEmailsCliente(req.body.emails);
    const resultado = db.prepare(`
      UPDATE clientes SET
        nome = ?, nome_normalizado = ?, box = ?, endereco = ?, numero = ?,
        complemento = ?, bairro = ?, cidade = ?, uf = ?, cep = ?,
        observacao = ?, emails_json = ?, ativo = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nome, textoNormalizado(nome), valor('box'), valor('endereco'),
      valor('numero'), valor('complemento'), valor('bairro'),
      valor('cidade'), valor('uf')?.toUpperCase() || null,
      valor('cep'), valor('observacao'), JSON.stringify(emails), ativo, id
    );
    if (!resultado.changes) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    const cliente = db.prepare(`
      SELECT id, nome, box, endereco, numero, complemento,
             bairro, cidade, uf, cep, observacao, emails_json, ativo,
             criado_em, atualizado_em
      FROM clientes WHERE id = ?
    `).get(id);
    res.json({ ok: true, cliente: clienteComEmails(cliente) });
  } catch (erro) {
    if (String(erro.message).includes('EMAIL_INVALIDO')) {
      return res.status(400).json({ erro: 'Informe somente endereços de e-mail válidos.' });
    }
    if (String(erro.message).includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Já existe outra empresa com esse nome.' });
    }
    console.error('Erro ao editar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao editar empresa.' });
  }
});

app.patch('/api/clientes/:id/ativo', exigirGerenciaDeClientes, (req, res) => {
  try {
    const id = Number(req.params.id);
    const ativo = req.body.ativo ? 1 : 0;
    const resultado = db.prepare(`
      UPDATE clientes SET ativo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
    `).run(ativo, id);
    if (!resultado.changes) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    res.json({ ok: true });
  } catch (erro) {
    console.error('Erro ao alterar cliente:', erro);
    res.status(500).json({ erro: 'Erro ao alterar empresa.' });
  }
});

app.delete('/api/clientes/:id', exigirGerenciaDeClientes, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ erro: 'Cadastro inválido.' });
    const excluir = db.transaction(() => {
      const existente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(id);
      if (!existente) return null;
      const protocolosPreservados = Number(db.prepare('SELECT COUNT(*) AS total FROM protocolos WHERE cliente_id = ?').get(id)?.total || 0);
      db.prepare('UPDATE protocolos SET cliente_id = NULL WHERE cliente_id = ?').run(id);
      const resultado = db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
      if (Number(resultado.changes) !== 1) throw new Error('A exclusão da empresa não foi confirmada pelo banco.');
      return protocolosPreservados;
    });
    const protocolosPreservados = excluir();
    if (protocolosPreservados === null) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    res.json({ ok: true, protocolos_preservados: protocolosPreservados });
  } catch (erro) {
    console.error('Erro ao excluir cliente:', erro);
    res.status(500).json({ erro: 'Erro ao excluir empresa.' });
  }
});


// ============================================================
// USUÁRIOS
// ============================================================

app.get('/api/usuarios/entregadores', (req, res) => {
  try {
    const usuarios = db.prepare(`
      SELECT id, nome, departamento, perfil, ativo
      FROM usuarios
      WHERE ativo = 1
        AND perfil IN ('admin', 'entregador')
      ORDER BY nome
    `).all();

    res.json(usuarios);
  } catch (erro) {
    console.error('Erro ao buscar entregadores:', erro);
    res.status(500).json({ erro: 'Erro ao buscar responsáveis pela entrega.' });
  }
});

app.get(
  '/api/usuarios',
  exigirAdmin,
  (req, res) => {

    try {

      const usuarios =
        db.prepare(`
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

          WHERE ativo = 1

          ORDER BY nome
        `).all();

      res.json(
        usuarios
      );

    } catch (erro) {

      console.error(
        'Erro ao buscar usuários:',
        erro
      );

      res.status(500).json({

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
  (req, res) => {

    try {

      const {
        nome,
        departamento,
        perfil,
        email,
        usuario,
        senha
      } = req.body;

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

      const perfisValidos = [

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
        db.prepare(`
          SELECT id

          FROM usuarios

          WHERE
            LOWER(usuario) =
            LOWER(?)

          LIMIT 1
        `).get(
          login
        );

      if (
        loginExistente
      ) {

        return res
          .status(409)
          .json({

            erro:
              `O login "${login}" já está sendo utilizado.`

          });

      }

      const credencial =
        gerarHashSenha(
          senha
        );

      const resultado =
        db.prepare(`
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
        `).run(

          nome.trim(),

          departamento.trim(),

          perfil,

          emailNormalizado || null,

          login,

          credencial.hash,

          credencial.salt

        );

      const usuarioCriado =
        db.prepare(`
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
        `).get(
          resultado
            .lastInsertRowid
        );

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

      res.status(500).json({

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
  (req, res) => {

    try {

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
      } = req.body;

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

      const perfisValidos = [

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
        db.prepare(`
          SELECT id

          FROM usuarios

          WHERE id = ?

            AND ativo = 1
        `).get(
          id
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

      const duplicado =
        db.prepare(`
          SELECT id

          FROM usuarios

          WHERE
            LOWER(usuario) =
            LOWER(?)

            AND id <> ?

          LIMIT 1
        `).get(
          login,
          id
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

      db.prepare(`
        UPDATE usuarios

        SET
          nome = ?,
          departamento = ?,
          perfil = ?,
          email = ?,
          usuario = ?

        WHERE id = ?
      `).run(

        nome.trim(),

        departamento.trim(),

        perfil,

        emailNormalizado || null,

        login,

        id

      );

      const atualizado =
        db.prepare(`
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
        `).get(
          id
        );

      res.json(
        atualizado
      );

    } catch (erro) {

      console.error(
        'Erro ao editar usuário:',
        erro
      );

      res.status(500).json({

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
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const {
        senha
      } = req.body;

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
        db.prepare(`
          SELECT
            id,
            nome,
            ativo

          FROM usuarios

          WHERE id = ?
        `).get(
          id
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

      db.prepare(`
        UPDATE usuarios

        SET
          senha_hash = ?,
          senha_salt = ?

        WHERE id = ?
      `).run(

        credencial.hash,

        credencial.salt,

        id

      );

      db.prepare(`
        DELETE FROM sessoes

        WHERE
          usuario_id = ?
      `).run(
        id
      );

      res.json({

        ok: true,

        mensagem:
          `Senha de "${usuario.nome}" redefinida com sucesso.`

      });

    } catch (erro) {

      console.error(
        'Erro ao redefinir senha:',
        erro
      );

      res.status(500).json({

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
  (req, res) => {

    try {

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
        db.prepare(`
          SELECT
            id,
            nome

          FROM usuarios

          WHERE id = ?

            AND ativo = 1
        `).get(
          id
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

      db.prepare(`
        UPDATE usuarios

        SET
          ativo = 0

        WHERE id = ?
      `).run(
        id
      );

      db.prepare(`
        DELETE FROM sessoes

        WHERE
          usuario_id = ?
      `).run(
        id
      );

      res.json({

        ok: true,

        mensagem:
          `Usuário "${usuarioExistente.nome}" removido do acesso.`

      });

    } catch (erro) {

      console.error(
        'Erro ao remover usuário:',
        erro
      );

      res.status(500).json({

        erro:
          'Erro ao remover usuário.'

      });

    }

  }
);


// ============================================================
// FUNÇÕES DE ITENS / DOCUMENTOS
// ============================================================

function normalizarItensDoProtocolo(
  body
) {

  let itens = [];

  // Formato novo da V17
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

  // Compatibilidade temporária
  // com o HTML antigo.
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


function buscarItensDoProtocolo(
  protocoloId
) {

  return db.prepare(`
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
  `).all(
    protocoloId
  );

}


function anexarItens(
  protocolo
) {

  if (!protocolo) {

    return protocolo;

  }

  const { qr_token, entrega_evidencia_json, ...dadosPublicos } = protocolo;
  const qr_hash = qr_token
    ? crypto.createHash('sha256').update(`PROTOVIA:${protocolo.id}:${qr_token}`).digest('hex')
    : '';

  return {

    ...dadosPublicos,
    qr_hash,

    itens:
      buscarItensDoProtocolo(
        protocolo.id
      )

  };

}


function anexarItensEmLista(
  protocolos
) {

  return protocolos
    .map(
      anexarItens
    );

}


// ============================================================
// LISTAR PROTOCOLOS
// ============================================================

app.get(
  '/api/protocolos',
  (req, res) => {

    try {

      const protocolos =
        db.prepare(`
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
        `).all();

      res.json(
        anexarItensEmLista(
          protocolos
        )
      );

    } catch (erro) {

      console.error(
        'Erro ao buscar protocolos:',
        erro
      );

      res.status(500).json({

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
  exigirLogin,
  (req, res) => {

    try {

      const resultado =
        db.prepare(`
          SELECT
            MAX(numero)
            AS ultimo

          FROM protocolos
        `).get();

      const ultimo =
        resultado?.ultimo ||
        0;

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

      res.status(500).json({

        erro:
          'Erro ao buscar próximo número.'

      });

    }

  }
);


// ============================================================
// CRIAR PROTOCOLO COM VÁRIOS ITENS
// ============================================================

app.post(
  '/api/protocolos',
  exigirLogin,
  async (req, res) => {

    const {
      numero,
      cliente,
      cliente_id,
      cliente_box,
      endereco_empresa,
      departamento,
      entregador,
      observacao
    } = req.body;

    const itens =
      normalizarItensDoProtocolo(
        req.body
      );

    const clienteCadastro = Number(cliente_id)
      ? db.prepare(`
          SELECT id, nome, box, endereco, numero, complemento,
                 bairro, cidade, uf, cep
          FROM clientes
          WHERE id = ? AND ativo = 1
        `).get(Number(cliente_id))
      : null;

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

    let transacaoAberta =
      false;

    try {

      // Protocolo e itens serão
      // gravados juntos.
      db.exec(
        'BEGIN IMMEDIATE'
      );

      transacaoAberta =
        true;

      let numeroFinal;

      // ==================================
      // NÚMERO MANUAL
      // ==================================

      if (
        numero !==
          undefined &&

        numero !==
          null &&

        numero !==
          ''
      ) {

        numeroFinal =
          Number(
            numero
          );

        if (
          !Number.isInteger(
            numeroFinal
          ) ||

          numeroFinal <=
            0
        ) {

          db.exec(
            'ROLLBACK'
          );

          transacaoAberta =
            false;

          return res
            .status(400)
            .json({

              erro:
                'Número do protocolo inválido.'

            });

        }

        const duplicado =
          db.prepare(`
            SELECT id

            FROM protocolos

            WHERE
              numero = ?
          `).get(
            numeroFinal
          );

        if (
          duplicado
        ) {

          db.exec(
            'ROLLBACK'
          );

          transacaoAberta =
            false;

          return res
            .status(409)
            .json({

              erro:
                `O protocolo ${String(
                  numeroFinal
                ).padStart(
                  6,
                  '0'
                )} já existe.`

            });

        }

      }

      // ==================================
      // NÚMERO AUTOMÁTICO
      // ==================================

      else {

        const resultadoNumero =
          db.prepare(`
            SELECT
              MAX(numero)
              AS ultimo

            FROM protocolos
          `).get();

        numeroFinal =
          (
            resultadoNumero
              ?.ultimo ||
            0
          ) + 1;

      }

      const emissor =
        req.usuarioLogado.nome;

      // O primeiro item também fica
      // gravado nos campos antigos.
      // Isso mantém compatibilidade
      // com o HTML/cache atual.
      const primeiroItem =
        itens[0];

      const qrToken = crypto.randomBytes(24).toString('hex');

      const resultado =
        db.prepare(`
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
        `).run(

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

        );

      const protocoloId =
        Number(
          resultado
            .lastInsertRowid
        );

      const inserirItem =
        db.prepare(`
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
        `);

      itens.forEach(
        (
          item,
          indice
        ) => {

          inserirItem.run(

            protocoloId,

            item.descricao,

            item.competencia,

            item.vencimento,

            indice + 1

          );

        }
      );

      db.exec(
        'COMMIT'
      );

      transacaoAberta =
        false;

      const protocoloCriado =
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          protocoloId
        );

      let notificacao = { status: 'nao_aplicavel' };
      const usuarioEntregador = db.prepare(`
        SELECT nome, email
        FROM usuarios
        WHERE ativo = 1
          AND perfil = 'entregador'
          AND LOWER(nome) = LOWER(?)
        ORDER BY id
        LIMIT 1
      `).get(String(entregador).trim());

      if (usuarioEntregador) {
        try {
          const pendencias = db.prepare(`
            SELECT COUNT(*) AS total FROM protocolos
            WHERE LOWER(entregador) = LOWER(?)
              AND status IN ('Aguardando entrega', 'Em entrega')
              AND COALESCE(excluido, 0) = 0
          `).get(String(entregador).trim());
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

      db.prepare(`
        UPDATE protocolos
        SET notificacao_entregador_destinatario = ?,
            notificacao_entregador_status = ?,
            notificacao_entregador_enviada_em = ?,
            notificacao_entregador_erro = ?
        WHERE id = ?
      `).run(
        usuarioEntregador?.email || null,
        notificacao.status,
        notificacaoEnviadaEm,
        notificacao.erro || null,
        protocoloId
      );

      const protocoloComNotificacao = db.prepare(`
        SELECT * FROM protocolos WHERE id = ?
      `).get(protocoloId);

      res
        .status(201)
        .json(

          anexarItens(
            protocoloComNotificacao
          )

        );

    } catch (erro) {

      if (
        transacaoAberta
      ) {

        try {

          db.exec(
            'ROLLBACK'
          );

        } catch (_) {}

      }

      console.error(
        'Erro ao criar protocolo:',
        erro
      );

      if (
        String(
          erro?.message ||
          ''
        ).includes(
          'UNIQUE constraint failed: protocolos.numero'
        )
      ) {

        return res
          .status(409)
          .json({

            erro:
              'Já existe um protocolo com esse número.'

          });

      }

      res.status(500).json({

        erro:
          'Erro ao criar protocolo.'

      });

    }

  }
);


// ============================================================
// INICIAR / ABRIR ENTREGA
// ============================================================

app.put(
  '/api/protocolos/:id/em-entrega',
  exigirEntregador,
  (req, res) => {

    try {

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
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE
            id = ?

            AND
            COALESCE(
              excluido,
              0
            ) = 0
        `).get(
          id
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

          anexarItens(
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

      db.prepare(`
        UPDATE protocolos

        SET
          status =
            'Em entrega'

        WHERE id = ?
      `).run(
        id
      );

      const atualizado =
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
        );

      res.json(

        anexarItens(
          atualizado
        )

      );

    } catch (erro) {

      console.error(
        'Erro ao iniciar entrega:',
        erro
      );

      res.status(500).json({

        erro:
          'Erro interno ao iniciar entrega.'

      });

    }

  }
);


// ============================================================
// CONFIRMAR ENTREGA + ASSINATURA
// ============================================================

app.get('/api/protocolos/:id/etiqueta', exigirLogin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const protocolo = db.prepare('SELECT * FROM protocolos WHERE id = ? AND COALESCE(excluido, 0) = 0').get(id);
    if (!protocolo) return res.status(404).json({ erro: 'Protocolo não encontrado.' });
    const completo = anexarItens(protocolo);
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
  async (req, res) => {

    try {

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
      } = req.body;

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
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE
            id = ?

            AND
            COALESCE(
              excluido,
              0
            ) = 0
        `).get(
          id
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

      if (protocolo.status === 'Entregue') return res.json(anexarItens(protocolo));
      const regrasEntrega = await deliveryPolicy.readPolicy(await deliveryDatabase());
      let evidenciaEntrega;
      try { evidenciaEntrega = deliveryPolicy.deliveryEvidence(regrasEntrega, req.body, req.usuarioLogado.id); }
      catch (error) { return res.status(400).json({erro:error.message}); }

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

      if (regrasEntrega.qrRequired && !qrValido && !(regrasEntrega.manualNumberAllowed && numeroValido)) {
        return res.status(400).json({ erro: regrasEntrega.manualNumberAllowed ? 'Escaneie o QR Code ou digite o número correto do protocolo.' : 'A confirmação exige leitura do QR Code. A alternativa manual está desativada.' });
      }

      const metodoConfirmacao = !regrasEntrega.qrRequired ? 'desativada_configuracao' : (qrValido ? 'qr_code' : 'numero_protocolo');

      const destinatarios = normalizarDestinatarios(email_destinatarios);

      // Importante para sincronização:
      // se já chegou uma vez,
      // devolvemos o protocolo.
      if (
        protocolo.status ===
        'Entregue'
      ) {

        return res.json(

          anexarItens(
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
            dataLocal
              .getTime()
          )
        ) {

          entregueEm =
            dataLocal
              .toISOString();

        }

      }

      db.prepare(`
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

          entrega_evidencia_json = ?,

          email_status = ?

        WHERE id = ? AND status <> 'Entregue'
      `).run(

        String(
          recebido_por
        ).trim(),

        assinatura,

        entregueEm,

        regrasEntrega.qrRequired ? new Date().toISOString() : null,

        regrasEntrega.qrRequired ? req.usuarioLogado.nome : null,

        metodoConfirmacao,

        metodoConfirmacao === 'numero_protocolo' ? numeroDigitado : null,

        JSON.stringify(destinatarios),

        JSON.stringify(evidenciaEntrega),

        destinatarios.length ? 'pendente' : 'nao_solicitado',

        id

      );

      const atualizado =
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
        );

      const completo = anexarItens(atualizado);
      const envio = await enviarComprovanteEntrega({ protocolo: atualizado, itens: completo.itens, destinatarios });
      db.prepare(`UPDATE protocolos SET email_status = ?, email_enviado_em = ?, email_erro = ? WHERE id = ?`).run(
        envio.status,
        envio.status === 'enviado' ? new Date().toISOString() : null,
        envio.erro || null,
        id
      );
      res.json({ ...completo, email_status: envio.status, email_erro: envio.erro || null });

    } catch (erro) {

      console.error(
        'Erro ao confirmar entrega:',
        erro
      );

      res.status(500).json({

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
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      const {
        motivo
      } = req.body;

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
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE
            id = ?

            AND
            COALESCE(
              excluido,
              0
            ) = 0
        `).get(
          id
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

      db.prepare(`
        UPDATE protocolos

        SET
          status =
            'Cancelado',

          motivo_cancelamento = ?,

          cancelado_por = ?,

          cancelado_em = ?

        WHERE id = ?
      `).run(

        motivo?.trim() ||
          'Sem motivo informado',

        req.usuarioLogado
          .nome,

        new Date()
          .toISOString(),

        id

      );

      const atualizado =
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
        );

      res.json(

        anexarItens(
          atualizado
        )

      );

    } catch (erro) {

      console.error(
        'Erro ao cancelar protocolo:',
        erro
      );

      res.status(500).json({

        erro:
          'Erro ao cancelar protocolo.'

      });

    }

  }
);


// ============================================================
// EXCLUIR PROTOCOLO
// ============================================================

app.put(
  '/api/protocolos/:id/excluir',
  exigirAdmin,
  (req, res) => {

    try {

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
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
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

      db.prepare(`
        UPDATE protocolos

        SET
          excluido = 1,

          excluido_em = ?,

          excluido_por = ?

        WHERE id = ?
      `).run(

        new Date()
          .toISOString(),

        req.usuarioLogado
          .nome,

        id

      );

      res.json({

        ok: true,

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

      res.status(500).json({

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
  (req, res) => {

    try {

      const protocolos =
        db.prepare(`
          SELECT
            id,
            numero,
            cliente,
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
        `).all();

      res.json(

        anexarItensEmLista(
          protocolos
        )

      );

    } catch (erro) {

      console.error(
        'Erro ao buscar protocolos excluídos:',
        erro
      );

      res.status(500).json({

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
  (req, res) => {

    try {

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
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
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

      db.prepare(`
        UPDATE protocolos

        SET
          excluido = 0,

          excluido_em =
            NULL,

          excluido_por =
            NULL

        WHERE id = ?
      `).run(
        id
      );

      const restaurado =
        db.prepare(`
          SELECT *

          FROM protocolos

          WHERE id = ?
        `).get(
          id
        );

      res.json(

        anexarItens(
          restaurado
        )

      );

    } catch (erro) {

      console.error(
        'Erro ao restaurar protocolo:',
        erro
      );

      res.status(500).json({

        erro:
          'Erro ao restaurar protocolo.'

      });

    }

  }
);
// ============================================================
// EXCLUIR PROTOCOLO DEFINITIVAMENTE
// SOMENTE ADMINISTRADOR
// ============================================================

app.delete(
  '/api/protocolos/:id/definitivo',
  exigirAdmin,
  (req, res) => {

    const id = Number(
      req.params.id
    );

    // ----------------------------------------
    // VALIDAR ID
    // ----------------------------------------

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return res
        .status(400)
        .json({
          erro:
            'ID do protocolo inválido.'
        });

    }

    let transacaoAberta = false;

    try {

      // ----------------------------------------
      // LOCALIZAR PROTOCOLO
      // ----------------------------------------

      const protocolo =
        db.prepare(`
          SELECT
            id,
            numero,
            cliente,
            status,
            excluido

          FROM protocolos

          WHERE id = ?
        `).get(id);

      if (!protocolo) {

        return res
          .status(404)
          .json({
            erro:
              'Protocolo não encontrado.'
          });

      }

      // ----------------------------------------
      // SEGURANÇA
      //
      // Só permitimos apagar definitivamente
      // algo que já tenha sido excluído antes.
      // ----------------------------------------

      if (
        Number(
          protocolo.excluido || 0
        ) !== 1
      ) {

        return res
          .status(400)
          .json({
            erro:
              'O protocolo precisa estar na área de protocolos excluídos antes da exclusão definitiva.'
          });

      }

      // ----------------------------------------
      // TRANSAÇÃO
      // ----------------------------------------

      db.exec(
        'BEGIN IMMEDIATE'
      );

      transacaoAberta = true;

      // ----------------------------------------
      // APAGAR ITENS DO PROTOCOLO
      // ----------------------------------------

      db.prepare(`
        DELETE FROM protocolo_itens
        WHERE protocolo_id = ?
      `).run(id);

      // ----------------------------------------
      // APAGAR PROTOCOLO
      // ----------------------------------------

      const resultado =
        db.prepare(`
          DELETE FROM protocolos
          WHERE
            id = ?
            AND COALESCE(excluido, 0) = 1
        `).run(id);

      if (
        Number(
          resultado.changes || 0
        ) !== 1
      ) {

        throw new Error(
          'O protocolo não pôde ser excluído definitivamente.'
        );

      }

      db.exec(
        'COMMIT'
      );

      transacaoAberta = false;

      // ----------------------------------------
      // RESPOSTA
      // ----------------------------------------

      res.json({

        ok: true,

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

      if (transacaoAberta) {

        try {

          db.exec(
            'ROLLBACK'
          );

        } catch (_) {}

      }

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
// INICIA O SERVIDOR
// ============================================================

app.listen(
  PORT,
  HOST,
  () => {

    console.log(
      `Protovia Protocolos rodando em http://${HOST}:${PORT}`
    );

  }
);

function installationDatabase() {
  return { get: (sql,...args)=>db.prepare(sql).get(...args), run: (sql,...args)=>db.prepare(sql).run(...args) };
}
let installationQueue=Promise.resolve();
function installationTransaction(callback) {
  const result=installationQueue.then(async()=>{
    db.exec('BEGIN IMMEDIATE');
    try { const value=await callback(installationDatabase()); db.exec('COMMIT'); return value; }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  });
  installationQueue=result.catch(()=>{}); return result;
}
