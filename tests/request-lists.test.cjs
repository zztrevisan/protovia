const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8').replace(/\r/g,'');
function source(name){const start=html.indexOf(`function ${name}(`);return html.slice(start,html.indexOf('\nfunction ',start+1));}
test('Entregues não aparecem em solicitações, nem por número; excluir fica restrito ao admin em entregues',()=>{
  const fields=Object.fromEntries(['requestList','reqSearch','reqStatus','completedList','completedSearch','completedDept'].map(key=>[key,{value:'',innerHTML:''}]));
  const protocol={id:7,num:1,status:'Entregue',cliente:'Cliente entregue',dept:'Fiscal'};let admin=true;
  const scope={$:key=>fields[key],requests:[protocol],protocols:[protocol],visibleRequestsForUser:()=>[protocol],protocolMatchesSearch:()=>true,atualizarBarraEtiquetas(){},isAdmin:()=>admin,esc:value=>String(value||''),fmtNum:value=>String(value).padStart(6,'0'),statusBadge:value=>value,etiquetasSelecionadas:new Set()};vm.createContext(scope);
  vm.runInContext(source('renderRequests')+'\n'+source('renderCompleted'),scope);
  for(const query of ['','000001']){fields.reqSearch.value=query;scope.renderRequests();assert.ok(!fields.requestList.innerHTML.includes('Cliente entregue'));}
  scope.renderCompleted();assert.ok(fields.completedList.innerHTML.includes('Cliente entregue'));assert.ok(fields.completedList.innerHTML.includes('deleteProtocol(7)'));assert.ok(fields.completedList.innerHTML.includes('Selecionar etiqueta'));
  admin=false;scope.renderCompleted();assert.ok(!fields.completedList.innerHTML.includes('deleteProtocol('));
});
