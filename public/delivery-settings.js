(() => {
  const dialog=document.createElement('dialog');
  dialog.id='deliverySettingsDialog';
  dialog.innerHTML=`<form><h2>Configurações</h2><p>Identidade e regras desta instalação. Somente administradores podem alterá-las.</p>
    <section class="identity-settings"><div><strong>Identidade do cliente</strong><p class="help">Nome e logo exibidos junto da marca permanente da ProtoVia.</p></div><button type="button" class="open-identity">Configurar identidade</button></section>
    <h3>Regras de entrega</h3>
    <label>Localização ao concluir<select name="gpsMode"><option value="off">Desativada — não coletar localização</option><option value="required">Obrigatória — bloquear sem localização</option><option value="justification">Solicitar — permitir ausência com justificativa</option></select></label>
    <p class="help">Coleta pontual após a conferência, nunca rastreamento contínuo. A precisão depende do aparelho; localização não comprova presença de forma absoluta.</p>
    <label class="check"><input type="checkbox" name="qrRequired"> Exigir conferência por QR Code</label>
    <label class="check"><input type="checkbox" name="manualNumberAllowed"> Permitir número do protocolo em emergência</label>
    <p class="help">O número substitui a leitura somente se essa opção estiver ativa. Nome do recebedor e assinatura continuam obrigatórios.</p>
    <p class="help">Mudanças valem para próximas confirmações e sincronizações, não alteram entregas já registradas.</p>
    <p class="error" role="alert"></p><footer><button type="button" class="close">Cancelar</button><button type="submit">Salvar regras</button></footer></form>`;
  document.body.append(dialog);
  const style=document.createElement('style');
  style.textContent='#deliverySettingsDialog{width:min(620px,94vw);max-height:90vh;overflow:auto;border:1px solid #cbe1dd;border-radius:16px;padding:24px;color:#17453d}#deliverySettingsDialog::backdrop{background:#071936bb}#deliverySettingsDialog label{display:block;margin:18px 0 10px;font-weight:600}#deliverySettingsDialog select{display:block;width:100%;padding:12px;margin-top:8px;border:1px solid #badcd6;border-radius:8px;background:white;color:#17453d}#deliverySettingsDialog .check{display:flex;gap:10px;align-items:center}#deliverySettingsDialog .check input{width:18px;height:18px}#deliverySettingsDialog .help{font-size:13px;line-height:1.6;color:#527e77;margin:4px 0}#deliverySettingsDialog .identity-settings{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:20px 0;padding:16px;border:1px solid #cbe1dd;border-radius:12px;background:#f2faf8}#deliverySettingsDialog .identity-settings strong{font-size:15px}#deliverySettingsDialog .open-identity{flex:0 0 auto;background:#fff;color:#126053}#deliverySettingsDialog h3{margin:24px 0 4px;padding-top:18px;border-top:1px solid #dcebe8}#deliverySettingsDialog .error{color:#ad2437}#deliverySettingsDialog footer{display:flex;justify-content:flex-end;gap:10px}#deliverySettingsDialog button,.delivery-settings-button{padding:10px 14px;border:1px solid #b6dcd6;border-radius:8px;cursor:pointer}#deliverySettingsDialog button[type=submit]{background:#126053;color:white}.delivery-settings-button{margin:10px;background:#126053;color:#fff}.delivery-location-button{margin:10px 0;padding:9px 14px;border-radius:8px;border:1px solid #b6dcd6;background:#f0faf8;color:#126053}@media(max-width:520px){#deliverySettingsDialog .identity-settings{display:block}#deliverySettingsDialog .open-identity{width:100%;margin-top:12px}}';
  document.head.append(style);
  const form=dialog.querySelector('form');
  const error=dialog.querySelector('.error');
  const button=document.createElement('button');button.type='button';button.className='delivery-settings-button';button.textContent='Configurações';button.hidden=true;
  button.classList.add('menu-btn');
  button.dataset.access='admin';
  const sidebar=document.querySelector('.side');
  sidebar?.insertBefore(button,sidebar.querySelector('.sidebar-account'));
  style.textContent+=' .side{overflow-y:auto!important}.delivery-settings-button{flex:0 0 auto;margin:4px 0}.delivery-settings-button[hidden]{display:none!important}';
  async function fetchPolicy(){
    const response=await fetch('/api/configuracao-entrega',{cache:'no-store'});
    const value=await response.json();if(!response.ok)throw Error(value.erro||'Não foi possível consultar as regras.');
    return value;
  }
  button.onclick=async()=>{
    error.textContent='';
    try{const policy=await fetchPolicy();form.elements.gpsMode.value=policy.gpsMode;form.elements.qrRequired.checked=policy.qrRequired;form.elements.manualNumberAllowed.checked=policy.manualNumberAllowed;dialog.showModal();}
    catch(e){alert(e.message);}
  };
  dialog.querySelector('.open-identity').onclick=()=>{dialog.close();window.protoviaIdentitySettings?.open();};
  dialog.querySelector('.close').onclick=()=>dialog.close();
  form.onsubmit=async event=>{
    event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try{const response=await fetch('/api/configuracao-entrega',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({gpsMode:form.elements.gpsMode.value,qrRequired:form.elements.qrRequired.checked,manualNumberAllowed:form.elements.manualNumberAllowed.checked})});const value=await response.json();if(!response.ok)throw Error(value.erro);dialog.close();alert('Regras de entrega salvas.');}
    catch(e){error.textContent=e.message;}finally{submit.disabled=false;}
  };
  setInterval(()=>{button.hidden=typeof isAdmin!=='function'||!isAdmin();if(button.hidden&&dialog.open)dialog.close();},1000);
  window.deliveryRules = {fetchPolicy, async capture(policy){
    if(policy.gpsMode==='off')return {};
    let failure='Localização não disponível neste aparelho.';
    try{
      if(!navigator.geolocation||!window.isSecureContext)throw Error('A localização requer HTTPS e permissão do navegador.');
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
      return {localizacao_entrega:{latitude:position.coords.latitude,longitude:position.coords.longitude,precisao_metros:position.coords.accuracy,capturado_em:new Date(position.timestamp).toISOString()}};
    }catch(e){failure=e.code===1?'Permissão de localização negada.':e.code===3?'Tempo esgotado ao obter a localização.':e.message||failure;}
    if(policy.gpsMode==='required')throw Error(failure+' A entrega exige localização. Ative a permissão e tente novamente.');
    const ask=typeof protoviaPrompt==='function'?protoviaPrompt:hiperionPrompt;
    const reason=await ask({title:'Entrega sem localização',message:failure+' Explique por que está concluindo sem localização.',inputLabel:'Justificativa (10 a 1.000 caracteres)',confirmText:'Registrar justificativa',cancelText:'Voltar',type:'warning'});
    if(reason===null)throw Error('Confirmação cancelada.');
    if(String(reason).trim().length<10||String(reason).trim().length>1000)throw Error('A justificativa precisa ter de 10 a 1.000 caracteres.');
    return {justificativa_sem_gps:String(reason).trim()};
  }};
  window.showDeliveryLocation=async id=>{
    if(typeof isAdmin!=='function'||!isAdmin())return;
    try{
      const response=await fetch(`/api/protocolos/${id}/localizacao`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.erro);
      const e=data.evidencia;const panel=document.createElement('dialog');panel.style.cssText='max-width:520px;width:90%;padding:24px;border:1px solid #badcd6;border-radius:14px';
      const title=document.createElement('h2');title.textContent='Local de confirmação';panel.append(title);
      const details=document.createElement('p');details.style.whiteSpace='pre-wrap';
      details.textContent=!e?'Este protocolo não possui registro de localização.':e.localizacao?`Latitude: ${e.localizacao.latitude}\nLongitude: ${e.localizacao.longitude}\nPrecisão informada: ${Math.round(e.localizacao.precisao_metros)} m\nCapturada em: ${new Date(e.localizacao.capturado_em).toLocaleString('pt-BR')}\nRecebida no servidor: ${new Date(e.registrado_em).toLocaleString('pt-BR')}`:e.gps_status==='justificado'?`Entrega sem GPS.\nJustificativa: ${e.justificativa}`:'A coleta estava desativada nesta entrega.';panel.append(details);
      if(e?.localizacao){const link=document.createElement('a');link.textContent='Ver localização no Google Maps ↗';link.href=`https://www.google.com/maps/search/?api=1&query=${e.localizacao.latitude},${e.localizacao.longitude}`;link.target='_blank';link.rel='noopener noreferrer';panel.append(link);}
      const close=document.createElement('button');close.textContent='Fechar';close.style.display='block';close.style.marginTop='18px';close.onclick=()=>panel.close();panel.append(close);panel.addEventListener('close',()=>panel.remove());document.body.append(panel);panel.showModal();
    }catch(e){alert(e.message);}
  };
})();
