const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

test('HTML e esquema são independentes e sintaticamente válidos', () => {
  const html = fs.readFileSync('public/index.html','utf8');
  assert.doesNotMatch(html, /hiperion|imperium|riscazera|3385-6500/i);
  for (const [,code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(code);
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('banco/schema.sql','utf8'));
  for (const table of ['usuarios','clientes','protocolos']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  db.close();
});

test('instalação protegida, login, identidade e emissão com banco vazio', {timeout:25000}, async t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'protovia-test-'));
  const port=24000+Math.floor(Math.random()*12000);
  const origin=`http://127.0.0.1:${port}`;
  const token='test-only-installation-token-12345';
  const child=spawn(process.execPath,['server.js'], {env:{...process.env,PORT:String(port),HOST:'127.0.0.1',SQLITE_DATABASE_PATH:path.join(temp,'test.db'),SETUP_TOKEN:token,RESEND_API_KEY:'',EMAIL_FROM:'',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',CRON_SECRET:''},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout.on('data',v=>logs+=v); child.stderr.on('data',v=>logs+=v);
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(temp,{recursive:true,force:true});});
  let ready=false;
  for(let n=0;n<80;n++){try{const r=await fetch(origin+'/api/installation');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,logs);
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
    try {
      const page = await browser.newPage();
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.locator('#installationDialog[open]').waitFor();
      assert.equal(await page.locator('#installationForm input[name="organizacao"]').inputValue(),'Sua organização');
      assert.equal(await page.locator('#installationTitle').innerText(),'Criar primeiro administrador');
      assert.equal(await page.locator('#organizationIdentity').isVisible(),false);
      assert.deepEqual(errors,[]);
      if (process.env.PROTOVIA_SCREENSHOT) await page.screenshot({path:process.env.PROTOVIA_SCREENSHOT});
    } finally { await browser.close(); }
  }
  let cookie='';
  async function request(route,method='GET',body){const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};}
  assert.equal((await request('/api/installation')).data.configured,false);
  assert.equal((await request('/api/clientes')).status,401);
  assert.equal((await request('/cron/alertas-vencimentos')).status,401);
  const setup={organizacao:'Organização Teste',nome:'Administrador Teste',usuario:'gestor',senha:'Senha-de-teste-123!',token,corPrimaria:'#113355',corSecundaria:'#ddaa22',logoTamanho:'compacto'};
  assert.equal((await request('/api/installation','POST',{...setup,token:'errado'})).status,403);
  assert.equal((await request('/api/installation','POST',setup)).status,201);
  assert.equal((await request('/api/installation','POST',setup)).status,409);
  const login=await request('/api/login','POST',{usuario:setup.usuario,senha:setup.senha});
  assert.equal(login.status,200,JSON.stringify(login.data)); cookie=login.cookie.split(';')[0];
  assert.equal((await request('/api/clientes')).data.clientes.length,0);
  assert.equal((await request('/api/organization','PUT',{organizacao:'Nova Marca',logo:'',corPrimaria:'#123456',corSecundaria:'#abcdef',logoTamanho:'compacto'})).status,200);
  const identity=(await request('/api/installation')).data;
  assert.equal(identity.nome,'Nova Marca');
  assert.equal(identity.corPrimaria,'#123456');
  assert.equal(identity.corSecundaria,'#abcdef');
  assert.equal(identity.logoTamanho,'compacto');
  assert.equal((await request('/api/organization','PUT',{organizacao:'Nova Marca',logo:'',corPrimaria:'#123456',corSecundaria:'#abcdef',logoTamanho:'contexto'})).status,200);
  assert.equal((await request('/api/installation')).data.logoTamanho,'contexto');
  const client=await request('/api/clientes','POST',{nome:'Cliente de teste'}); assert.equal(client.status,201);
  const protocol=await request('/api/protocolos','POST',{cliente:'Cliente de teste',cliente_id:client.data.id,departamento:'Administrativo',entregador:setup.nome,itens:[{descricao:'Documento teste',vencimento:null}]});
  assert.equal(protocol.status,201,JSON.stringify(protocol.data));
  const user=await request('/api/usuarios','POST',{nome:'Emissor Teste',departamento:'Fiscal',perfil:'emissor',usuario:'emissor',senha:'Outra-senha-123!'});
  assert.equal(user.status,201,JSON.stringify(user.data));
  const other=await request('/api/login','POST',{usuario:'emissor',senha:'Outra-senha-123!'});
  cookie=other.cookie.split(';')[0];
  assert.equal((await request('/api/organization','PUT',{organizacao:'Não permitido',logo:'',corPrimaria:'#123456',corSecundaria:'#abcdef',logoTamanho:'grande'})).status,403);
});
