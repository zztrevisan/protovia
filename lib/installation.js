const crypto = require('node:crypto');

function validOrganization(body) {
  const nome = String(body.organizacao || '').trim();
  const logo = String(body.logo || '');
  if (!nome || nome.length > 120) throw new Error('Informe o nome da organização (até 120 caracteres).');
  if (logo && (logo.length > 700000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))) {
    throw new Error('Use uma imagem PNG, JPEG ou WebP de até 500 KB.');
  }
  return { nome, logo };
}

function mountInstallation(app, { database, transaction, exigirLogin, exigirAdmin }) {
  require('./email').setOrganizationProvider(async () => (await database()).get('SELECT nome, logo FROM organizacao WHERE id = 1'));
  app.get('/api/installation', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const db = await database();
      const organization = await db.get('SELECT nome, logo FROM organizacao WHERE id = 1');
      const users = await db.get('SELECT COUNT(*) AS total FROM usuarios');
      res.json({ configured: Number(users.total) > 0, nome: organization?.nome || 'Sua organização', logo: organization?.logo || '' });
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
        const users = await db.get('SELECT COUNT(*) AS total FROM usuarios');
        if (Number(users.total)) throw new Error('ALREADY_CONFIGURED');
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
        await db.run('INSERT INTO organizacao (id, nome, logo) VALUES (1, ?, ?)', organization.nome, organization.logo);
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
      await db.run('UPDATE organizacao SET nome = ?, logo = ? WHERE id = 1', organization.nome, organization.logo);
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ erro: error.message }); }
  });
}

module.exports = { mountInstallation, validOrganization };
