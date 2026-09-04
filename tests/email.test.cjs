const { test } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../lib/email');

test('aviso usa identidade da instalação, contagem e data brasileira sem enviar e-mail real', async t => {
  const previous={RESEND_API_KEY:process.env.RESEND_API_KEY,EMAIL_FROM:process.env.EMAIL_FROM,APP_URL:process.env.APP_URL};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.RESEND_API_KEY='test-only';process.env.EMAIL_FROM='Teste <teste@example.com>';process.env.APP_URL='https://example.com';
  email.setOrganizationProvider(async()=>({nome:'Organização <Teste>',logo:''}));
  let payload;
  t.mock.method(global,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');payload=JSON.parse(options.body);return {ok:true,json:async()=>({id:'test-id'})};});
  const result=await email.enviarNotificacaoNovoProtocolo({protocolo:{numero:1,cliente:'Cliente Teste',emissor:'Emissor Teste',departamento:'Fiscal'},itens:[{descricao:'Documento',vencimento:'2026-09-10'}],destinatario:'entregador@example.com',totalPendentes:2});
  assert.equal(result.status,'enviado');assert.match(payload.html,/Organização &lt;Teste&gt;/);assert.match(payload.html,/10\/09\/2026/);assert.match(payload.subject,/2/);assert.doesNotMatch(payload.html,/hiperion|imperium/i);
  assert.match(payload.html,/ProtoVia/i);
});
