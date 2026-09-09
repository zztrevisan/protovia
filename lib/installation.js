const crypto = require('node:crypto');

function validOrganization(body) {
  const nome = String(body.organizacao || '').trim();
  const logo = String(body.logo || '');
  const corPrimaria = String(body.corPrimaria || '#0f6657').trim().toLowerCase();
  const corSecundaria = String(body.corSecundaria || '#19b89f').trim().toLowerCase();
  const logoTamanho = String(body.logoTamanho || 'grande').trim().toLowerCase();
  const mostrarContextoLogin = body.mostrarContextoLogin !== false && body.mostrarContextoLogin !== 0 && body.mostrarContextoLogin !== 'false' && body.mostrarContextoLogin !== '0';
  if (!nome || nome.length > 120) throw new Error('Informe o nome da organização (até 120 caracteres).');
  if (logo && (logo.length > 700000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))) {
    throw new Error('Use uma imagem PNG, JPEG ou WebP de até 500 KB.');
  }
  if (!/^#[0-9a-f]{6}$/.test(corPrimaria) || !/^#[0-9a-f]{6}$/.test(corSecundaria)) {
    throw new Error('Escolha cores válidas para a identidade do ambiente.');
  }
  if (!['grande', 'compacto', 'contexto'].includes(logoTamanho)) throw new Error('Escolha um modo válido para a marca.');
  return { nome, logo, corPrimaria, corSecundaria, logoTamanho, mostrarContextoLogin };
}

async function ensureOrganizationSchema(db) {
  // O SQLite local já executa estas migrações ao iniciar; o adaptador reduzido
  // expõe somente get/run. No banco remoto, verificamos as colunas aqui.
  if (typeof db.all !== 'function') return;
  const columns = await db.all('PRAGMA table_info(organizacao)');
  const names = new Set(columns.map(column => column.name));
  if (!names.has('cor_primaria')) await db.run("ALTER TABLE organizacao ADD COLUMN cor_primaria TEXT NOT NULL DEFAULT '#0f6657'");
  if (!names.has('cor_secundaria')) await db.run("ALTER TABLE organizacao ADD COLUMN cor_secundaria TEXT NOT NULL DEFAULT '#19b89f'");
  if (!names.has('logo_tamanho')) await db.run("ALTER TABLE organizacao ADD COLUMN logo_tamanho TEXT NOT NULL DEFAULT 'grande'");
  if (!names.has('mostrar_contexto_login')) await db.run('ALTER TABLE organizacao ADD COLUMN mostrar_contexto_login INTEGER NOT NULL DEFAULT 1');
}

function mountInstallation(app, { database, transaction, exigirLogin, exigirAdmin }) {
  require('./email').setOrganizationProvider(async () => (await database()).get('SELECT nome, logo FROM organizacao WHERE id = 1'));
  app.get('/api/installation', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const db = await database();
      await ensureOrganizationSchema(db);
      const organization = await db.get('SELECT nome, logo, cor_primaria, cor_secundaria, logo_tamanho, mostrar_contexto_login FROM organizacao WHERE id = 1');
      const users = await db.get('SELECT COUNT(*) AS total FROM usuarios');
      res.json({
        configured: Number(users.total) > 0,
        nome: organization?.nome || 'Sua organização',
        logo: organization?.logo || '',
        corPrimaria: organization?.cor_primaria || '#0f6657',
        corSecundaria: organization?.cor_secundaria || '#19b89f',
        logoTamanho: organization?.logo_tamanho || 'grande',
        mostrarContextoLogin: organization ? Number(organization.mostrar_contexto_login) !== 0 : true
      });
    } catch { res.status(503).json({ erro: 'Não foi possível consultar a instalação. Confira o banco configurado.' }); }
  });

  app.post('/api/installation', async (req, res) => {
    const expected = String(process.env.SETUP_TOKEN || '');
    const supplied = String(req.body.token || '');
    if (expected.length < 24 || supplied.length > 256 ||
        !crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(), crypto.createHash('sha256').update(expected).digest())) {
      return res.status(403).json({ erro: 'Token de instalação inválido ou não configurado.' });
    }
    let organization;
    try { organization = validOrganization(req.body); }
    catch (error) { return res.status(400).json({ erro: error.message }); }
    const nome = String(req.body.nome || '').trim();
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    if (!nome || nome.length > 120 || !/^[a-z0-9_.-]{3,60}$/.test(usuario) || senha.length < 12 || senha.length > 128) {
      return res.status(400).json({ erro: 'Informe nome, login (3–60 caracteres) e senha de 12–128 caracteres.' });
    }
    try {
      await transaction(async db => {
        await ensureOrganizationSchema(db);
        const users = await db.get('SELECT COUNT(*) AS total FROM usuarios');
        if (Number(users.total)) throw new Error('ALREADY_CONFIGURED');
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
        await db.run('INSERT INTO organizacao (id, nome, logo, cor_primaria, cor_secundaria, logo_tamanho, mostrar_contexto_login) VALUES (1, ?, ?, ?, ?, ?, ?)', organization.nome, organization.logo, organization.corPrimaria, organization.corSecundaria, organization.logoTamanho, organization.mostrarContextoLogin ? 1 : 0);
        await db.run('INSERT INTO usuarios (nome, departamento, perfil, usuario, senha_hash, senha_salt) VALUES (?, ?, ?, ?, ?, ?)', nome, 'Administrativo', 'admin', usuario, hash, salt);
      });
      res.status(201).json({ ok: true });
    } catch (error) {
      const exists = error.message === 'ALREADY_CONFIGURED' || /UNIQUE/.test(error.message);
      res.status(exists ? 409 : 500).json({ erro: exists ? 'Esta instalação já tem um administrador.' : 'Não foi possível concluir a instalação.' });
    }
  });

  app.put('/api/organization', exigirLogin, exigirAdmin, async (req, res) => {
    try {
      const organization = validOrganization(req.body);
      const db = await database();
      await ensureOrganizationSchema(db);
      await db.run('UPDATE organizacao SET nome = ?, logo = ?, cor_primaria = ?, cor_secundaria = ?, logo_tamanho = ?, mostrar_contexto_login = ? WHERE id = 1', organization.nome, organization.logo, organization.corPrimaria, organization.corSecundaria, organization.logoTamanho, organization.mostrarContextoLogin ? 1 : 0);
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ erro: error.message }); }
  });
}

module.exports = { mountInstallation, validOrganization, ensureOrganizationSchema };
