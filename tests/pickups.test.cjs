const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const express=require('express');
const {mountPickups,conference}=require('../lib/pickups');

test('Conferência preserva solicitados e valida data, competência, faltantes e adicionais',()=>{
  const requested=[{id:'doc1',descricao:'Contrato'}];
  const received={id:'doc1',recebido:true,competencia:'2026-09',data_recebimento:'2026-09-04'};
  assert.equal(conference([received],requested)[0].descricao,'Contrato');
  assert.throws(()=>conference([],requested));
  assert.throws(()=>conference([received,received],requested));
  assert.throws(()=>conference([{...received,data_recebimento:'2026-02-30'}],requested));
  assert.throws(()=>conference([{...received,competencia:'2026-13'}],requested));
  assert.throws(()=>conference([{id:'doc1',recebido:false}],requested));
  assert.equal(conference([{id:'doc1',recebido:false,justificativa:'Empresa não disponibilizou.'}],requested)[0].recebido,false);
  assert.equal(conference([received,{descricao:'Alvará',recebido:true,competencia:'2026-08',data_recebimento:'2026-09-04'}],requested)[1].adicional,true);
});

for(const optional of [false,true])test(`Retiradas: permissões, etapas, isolamento e módulo ${optional?'opcional':'ativo'}`,async t=>{
  const raw=new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE clientes(id INTEGER PRIMARY KEY,nome TEXT,ativo INTEGER);INSERT INTO clientes VALUES(1,'Empresa Teste',1);
    CREATE TABLE usuarios(id INTEGER PRIMARY KEY,nome TEXT,perfil TEXT,departamento TEXT,ativo INTEGER);
    INSERT INTO usuarios VALUES(1,'Admin','admin','Administrativo',1),(2,'Legalização','emissor','Legalização',1),(3,'Entregador','entregador','Entregas',1),(4,'Outro entregador','entregador','Entregas',1),(5,'Fiscal','emissor','Fiscal',1);
    CREATE TABLE protocolos(id INTEGER PRIMARY KEY);`);
  const database=()=>({get:(sql,...args)=>raw.prepare(sql).get(...args),all:(sql,...args)=>raw.prepare(sql).all(...args),run:(sql,...args)=>raw.prepare(sql).run(...args)});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{req.usuarioLogado=raw.prepare('SELECT * FROM usuarios WHERE id=?').get(Number(req.headers['x-test-user'])||0);if(!req.usuarioLogado)return res.status(401).json({erro:'Login obrigatório'});next();});
  mountPickups(app,{database,optional});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));raw.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/retiradas`;
  async function api(user,path='',method='GET',body){const response=await fetch(base+path,{method,headers:{'x-test-user':String(user),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  assert.equal((await api(0)).status,401);
  assert.equal((await api(1,'/opcoes')).body.ativo,!optional);
  assert.equal((await api(2,'/opcoes','PUT',{ativo:true})).status,403);
  if(optional){assert.equal((await api(2)).status,403);assert.equal((await api(1,'/opcoes','PUT',{ativo:true})).status,200);}
  assert.equal((await api(5)).status,403);
  assert.equal((await api(2,'/cadastros')).body.empresas.length,1);
  const request={empresa_id:1,entregador_id:3,documentos:['Contrato','Alvará'],observacao:'Retirar originais'};
  assert.equal((await api(3,'','POST',request)).status,403);
  assert.equal((await api(2,'','POST',{...request,empresa_id:9})).status,400);
  const created=await api(2,'','POST',request);assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.id;
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM protocolos').get().n,0);
  assert.equal((await api(4)).body.length,0);
  assert.equal((await api(3)).body.length,1);
  assert.equal((await api(4,`/${id}/retirar`,'PUT',{})).status,403);
  assert.equal((await api(2,`/${id}/retirar`,'PUT',{})).status,403);
  const row=(await api(2)).body[0];
  const docs=row.documentos.map((doc,i)=>i?{id:doc.id,recebido:false,justificativa:'Não disponibilizado'}:{id:doc.id,recebido:true,competencia:'2026-09',data_recebimento:'2026-09-04'});
  assert.equal((await api(2,`/${id}/conferir`,'PUT',{documentos:docs})).status,409);
  assert.equal((await api(3,`/${id}/retirar`,'PUT',{})).status,200);
  assert.equal((await api(3,`/${id}/retirar`,'PUT',{})).status,409);
  assert.equal((await api(3,`/${id}/conferir`,'PUT',{documentos:docs})).status,403);
  assert.equal((await api(2,`/${id}/conferir`,'PUT',{documentos:docs.slice(0,1)})).status,400);
  const results=await Promise.all([api(2,`/${id}/conferir`,'PUT',{documentos:docs}),api(2,`/${id}/conferir`,'PUT',{documentos:docs})]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const done=(await api(2)).body[0];assert.equal(done.estado,'conferida');assert.equal(done.conferente_id,2);assert.equal(done.documentos.length,2);assert.equal(done.conferencia[1].recebido,false);assert.ok(done.conferido_em);assert.ok(done.retirado_em);
  if(optional){await api(1,'/opcoes','PUT',{ativo:false});assert.equal((await api(2)).status,403);await api(1,'/opcoes','PUT',{ativo:true});assert.equal((await api(2)).body[0].estado,'conferida');}
});
