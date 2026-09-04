const { test }=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');const {once}=require('node:events');
const {deliveryEvidence,validatePolicy}=require('../lib/delivery-policy');
test('GPS valida coordenadas e justificativa; desligado não retém localização',()=>{
  const now=Date.now();const gps={latitude:-23.55,longitude:-46.63,precisao_metros:12,capturado_em:new Date(now).toISOString()};
  const required={gpsMode:'required',qrRequired:true,manualNumberAllowed:false};
  assert.equal(deliveryEvidence(required,{localizacao_entrega:gps},1,now).gps_status,'capturado');
  assert.throws(()=>deliveryEvidence(required,{},1,now));
  for(const invalid of [{...gps,latitude:91},{...gps,longitude:'46'},{...gps,precisao_metros:-1},{...gps,capturado_em:'invalid'}])assert.throws(()=>deliveryEvidence(required,{localizacao_entrega:invalid},1,now));
  assert.throws(()=>deliveryEvidence({...required,gpsMode:'justification'},{justificativa_sem_gps:'curta'},1,now));
  assert.equal(deliveryEvidence({...required,gpsMode:'justification'},{justificativa_sem_gps:'Permissão negada pelo aparelho.'},1,now).gps_status,'justificado');
  assert.equal(deliveryEvidence({...required,gpsMode:'off'},{localizacao_entrega:gps},1,now).localizacao,null);
  assert.throws(()=>validatePolicy({...required,qrRequired:'false'}));
});

test('API protege configurações e GPS, aplica QR e mantém evidência imutável', {timeout:30000}, async t=>{
  const root=path.resolve(__dirname,'..');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-rules-test-'));
  const port=35000+Math.floor(Math.random()*10000);const origin=`http://127.0.0.1:${port}`;
  const env={...process.env,SQLITE_DATABASE_PATH:path.join(temp,'test.db'),PORT:String(port),HOST:'127.0.0.1',RESEND_API_KEY:'',EMAIL_FROM:'',CRON_SECRET:'',SETUP_TOKEN:'',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:''};
  // Apenas o banco temporário recebe contas sintéticas; o banco operacional não é aberto.
  const seed=spawnSync(process.execPath,['-e',`const db=require('./banco/db');const c=require('crypto');const salt='test-only';const hash=c.scryptSync('Test-password-123!',salt,64).toString('hex');for(const [nome,perfil] of [['Gestor Teste','admin'],['Emissor Teste','emissor']])db.prepare('INSERT INTO usuarios (nome,departamento,perfil,usuario,senha_hash,senha_salt) VALUES (?,?,?,?,?,?)').run(nome,'Fiscal',perfil,perfil,hash,salt);db.close();`],{cwd:root,env,encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);
  const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(temp,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/configuracao-entrega');if(r.status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,80));}assert.ok(ready,logs);
  let cookie='';async function api(url,method='GET',body){const r=await fetch(origin+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
  assert.equal((await api('/api/configuracao-entrega')).status,401);
  const login=await api('/api/login','POST',{usuario:'admin',senha:'Test-password-123!'});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];
  const adminCookie=cookie;
  assert.deepEqual((await api('/api/configuracao-entrega')).body,{gpsMode:'off',qrRequired:true,manualNumberAllowed:true});
  const client=await api('/api/clientes','POST',{nome:'Cliente Teste GPS'});assert.equal(client.status,201);
  const newProtocol=async()=>{const result=await api('/api/protocolos','POST',{cliente:'Cliente Teste GPS',cliente_id:client.body.id,departamento:'Fiscal',entregador:'Gestor Teste',itens:[{descricao:'Documento de teste'}]});assert.equal(result.status,201,JSON.stringify(result.body));return result.body;};
  const p=await newProtocol();
  const body={recebido_por:'Recebedor Teste',assinatura:'data:image/png;base64,dGVzdA==',protocolo_numero_confirmacao:String(p.numero)};
  const rule={gpsMode:'required',qrRequired:true,manualNumberAllowed:true};
  assert.equal((await api('/api/configuracao-entrega','PUT',rule)).status,200);
  assert.equal((await api(`/api/protocolos/${p.id}/entregar`,'PUT',body)).status,400);
  const gps={latitude:-23.55,longitude:-46.63,precisao_metros:15,capturado_em:new Date().toISOString()};
  await api('/api/configuracao-entrega','PUT',{...rule,manualNumberAllowed:false});
  assert.equal((await api(`/api/protocolos/${p.id}/entregar`,'PUT',{...body,localizacao_entrega:gps})).status,400);
  await api('/api/configuracao-entrega','PUT',rule);
  const done=await api(`/api/protocolos/${p.id}/entregar`,'PUT',{...body,localizacao_entrega:gps});assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.entrega_evidencia_json,undefined);
  const evidence=(await api(`/api/protocolos/${p.id}/localizacao`)).body.evidencia;assert.equal(evidence.localizacao.latitude,gps.latitude);
  await api(`/api/protocolos/${p.id}/entregar`,'PUT',{...body,localizacao_entrega:{...gps,latitude:10}});
  assert.deepEqual((await api(`/api/protocolos/${p.id}/localizacao`)).body.evidencia,evidence);
  const p2=await newProtocol();await api('/api/configuracao-entrega','PUT',{gpsMode:'justification',qrRequired:false,manualNumberAllowed:false});
  assert.equal((await api(`/api/protocolos/${p2.id}/entregar`,'PUT',{recebido_por:body.recebido_por,assinatura:body.assinatura,justificativa_sem_gps:'Sem sinal no local da entrega.'})).status,200);
  const p3=await newProtocol();await api('/api/configuracao-entrega','PUT',{gpsMode:'off',qrRequired:false,manualNumberAllowed:false});
  assert.equal((await api(`/api/protocolos/${p3.id}/entregar`,'PUT',{...body,localizacao_entrega:gps})).status,200);
  assert.equal((await api(`/api/protocolos/${p3.id}/localizacao`)).body.evidencia.localizacao,null);
  cookie=(await api('/api/login','POST',{usuario:'emissor',senha:'Test-password-123!'})).cookie.split(';')[0];
  assert.equal((await api('/api/configuracao-entrega')).status,200);
  assert.equal((await api('/api/configuracao-entrega','PUT',rule)).status,403);
  assert.equal((await api(`/api/protocolos/${p.id}/localizacao`)).status,403);
  cookie=adminCookie;
});
