const { randomUUID } = require('node:crypto');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS retirada_opcoes (id INTEGER PRIMARY KEY CHECK(id=1), ativo INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS retiradas (
    id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL, empresa_nome TEXT NOT NULL,
    solicitante_id INTEGER NOT NULL, solicitante_nome TEXT NOT NULL,
    entregador_id INTEGER NOT NULL, entregador_nome TEXT NOT NULL,
    solicitado_em TEXT NOT NULL, retirado_em TEXT, conferido_em TEXT,
    conferente_id INTEGER, conferente_nome TEXT, estado TEXT NOT NULL,
    documentos_json TEXT NOT NULL, conferencia_json TEXT, observacao TEXT NOT NULL
  )`
];
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const canReview = user => user?.perfil === 'admin' || normalized(user?.departamento) === 'LEGALIZACAO';
function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) invalid('Preencha os campos e respeite os limites de tamanho.');
  return value.trim();
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function conference(input, requested) {
  if (!Array.isArray(input) || input.length < requested.length || input.length > 100) invalid('Confira todos os documentos solicitados.');
  const seen = new Set();
  const items = input.map(item => {
    if (!item || typeof item.recebido !== 'boolean') invalid('Informe se cada documento foi recebido.');
    const original = requested.find(doc => doc.id === item.id);
    if (item.id && (!original || seen.has(item.id))) invalid('Documento repetido ou desconhecido.');
    if (original) seen.add(item.id);
    if (!original && !item.recebido) invalid('Documentos adicionais devem ter sido recebidos.');
    const result = {id: original?.id || randomUUID(), descricao: original?.descricao || text(item.descricao,300), adicional: !original, recebido:item.recebido};
    if (item.recebido) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(item.competencia || '') || !validDate(item.data_recebimento)) invalid('Informe competência (mês/ano) e data válida para cada documento recebido.');
      result.competencia = item.competencia;
      result.data_recebimento = item.data_recebimento;
    } else result.justificativa = text(item.justificativa,1000);
    return result;
  });
  if (seen.size !== requested.length) invalid('Confira todos os documentos solicitados.');
  return items;
}

function mountPickups(app, {database, optional = false}) {
  let ready;
  async function dbReady() {
    const db = await database();
    if (!ready) ready = (async()=>{for (const sql of SCHEMA) await db.run(sql);})().catch(error=>{ready=null;throw error;});
    await ready;
    return db;
  }
  const route = handler => async(req,res) => {
    res.setHeader('Cache-Control','no-store');
    try { await handler(req,res,await dbReady()); }
    catch(error) { if (!error.status) console.error('Retiradas:',error.message); res.status(error.status || 503).json({erro:error.status ? error.message : 'Não foi possível acessar as retiradas. Tente novamente.'}); }
  };
  async function enabled(db) { return !optional || Number((await db.get('SELECT ativo FROM retirada_opcoes WHERE id=1'))?.ativo) === 1; }
  async function access(req, db) {
    if (!await enabled(db)) invalid('O módulo de retiradas está desativado.',403);
    if (!canReview(req.usuarioLogado) && req.usuarioLogado?.perfil !== 'entregador') invalid('Sem acesso às retiradas.',403);
  }
  app.get('/api/retiradas/opcoes', route(async(req,res,db)=>res.json({ativo:await enabled(db), configuravel:optional})));
  app.put('/api/retiradas/opcoes', route(async(req,res,db)=>{
    if (req.usuarioLogado?.perfil !== 'admin') invalid('Somente administradores podem alterar esta opção.',403);
    if (!optional) invalid('Retiradas permanece ativo nesta instalação.');
    if (typeof req.body.ativo !== 'boolean') invalid('Opção inválida.');
    await db.run('INSERT INTO retirada_opcoes(id,ativo) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET ativo=excluded.ativo',req.body.ativo?1:0);
    res.json({ativo:req.body.ativo});
  }));
  app.get('/api/retiradas/cadastros', route(async(req,res,db)=>{
    await access(req,db);
    if (!canReview(req.usuarioLogado)) invalid('Somente Legalização e administradores criam solicitações.',403);
    res.json({empresas:await db.all('SELECT id,nome FROM clientes WHERE ativo=1 ORDER BY nome'), entregadores:await db.all("SELECT id,nome FROM usuarios WHERE ativo=1 AND perfil IN ('entregador','admin') ORDER BY nome")});
  }));
  app.get('/api/retiradas', route(async(req,res,db)=>{
    await access(req,db);
    const manager = canReview(req.usuarioLogado);
    const rows = await db.all(`SELECT * FROM retiradas ${manager?'':'WHERE entregador_id=?'} ORDER BY empresa_nome,solicitado_em DESC`,...(manager?[]:[req.usuarioLogado.id]));
    res.json(rows.map(({documentos_json,conferencia_json,...row})=>({...row,documentos:JSON.parse(documentos_json),conferencia:conferencia_json?JSON.parse(conferencia_json):null})));
  }));
  app.post('/api/retiradas', route(async(req,res,db)=>{
    await access(req,db);
    if (!canReview(req.usuarioLogado)) invalid('Somente Legalização e administradores criam solicitações.',403);
    const company = await db.get('SELECT id,nome FROM clientes WHERE id=? AND ativo=1',Number(req.body.empresa_id)||0);
    const courier = await db.get("SELECT id,nome FROM usuarios WHERE id=? AND ativo=1 AND perfil IN ('entregador','admin')",Number(req.body.entregador_id)||0);
    if (!company || !courier) invalid('Selecione empresa e responsável pela retirada ativos.');
    if (!Array.isArray(req.body.documentos) || !req.body.documentos.length || req.body.documentos.length>100) invalid('Informe de 1 a 100 documentos.');
    const docs = req.body.documentos.map(value=>({id:randomUUID(),descricao:text(value,300)}));
    const id=randomUUID(), user=req.usuarioLogado;
    await db.run(`INSERT INTO retiradas(id,empresa_id,empresa_nome,solicitante_id,solicitante_nome,entregador_id,entregador_nome,solicitado_em,estado,documentos_json,observacao) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,id,company.id,company.nome,user.id,user.nome,courier.id,courier.nome,new Date().toISOString(),'solicitada',JSON.stringify(docs),text(req.body.observacao || '',2000,false));
    res.status(201).json({id});
  }));
  app.put('/api/retiradas/:id/retirar', route(async(req,res,db)=>{
    await access(req,db);
    const row=await db.get('SELECT * FROM retiradas WHERE id=?',req.params.id);
    if (!row) invalid('Retirada não encontrada.',404);
    if (req.usuarioLogado.perfil!=='admin' && (req.usuarioLogado.perfil!=='entregador' || Number(row.entregador_id)!==Number(req.usuarioLogado.id))) invalid('Somente o responsável pela retirada pode registrar a coleta.',403);
    const result=await db.run("UPDATE retiradas SET estado='aguardando_conferencia',retirado_em=? WHERE id=? AND estado='solicitada'",new Date().toISOString(),row.id);
    if (Number(result.changes)!==1) invalid('Esta retirada já foi atualizada. Recarregue a lista.',409);
    res.json({ok:true});
  }));
  app.put('/api/retiradas/:id/conferir', route(async(req,res,db)=>{
    await access(req,db);
    if (!canReview(req.usuarioLogado)) invalid('A conferência é feita pela Legalização no escritório.',403);
    const row=await db.get('SELECT * FROM retiradas WHERE id=?',req.params.id);
    if (!row) invalid('Retirada não encontrada.',404);
    const items=conference(req.body.documentos,JSON.parse(row.documentos_json));
    const result=await db.run("UPDATE retiradas SET estado='conferida',conferido_em=?,conferente_id=?,conferente_nome=?,conferencia_json=? WHERE id=? AND estado='aguardando_conferencia'",new Date().toISOString(),req.usuarioLogado.id,req.usuarioLogado.nome,JSON.stringify(items),row.id);
    if (Number(result.changes)!==1) invalid('Registre a retirada antes de conferir. Uma conferência finalizada não pode ser sobrescrita.',409);
    res.json({ok:true});
  }));
}
module.exports = {mountPickups,conference,SCHEMA};
