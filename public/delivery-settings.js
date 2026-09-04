(() => {
  const dialog=document.createElement('dialog');
  dialog.id='deliverySettingsDialog';
  dialog.innerHTML=`<form><h2>Configurações de entrega</h2><p>Regras desta instalação. Somente administradores podem alterá-las.</p>
    <label>Localização ao concluir<select name="gpsMode"><option value="off">Desativada — não coletar localização</option><option value="required">Obrigatória — bloquear sem localização</option><option value="justification">Solicitar — permitir ausência com justificativa</option></select></label>
    <p class="help">Coleta pontual após a conferência, nunca rastreamento contínuo. A precisão depende do aparelho; localização não comprova presença de forma absoluta.</p>
    <label class="check"><input type="checkbox" name="qrRequired"> Exigir conferência por QR Code</label>
    <label class="check"><input type="checkbox" name="manualNumberAllowed"> Permitir número do protocolo em emergência</label>
    <p class="help">O número substitui a leitura somente se essa opção estiver ativa. Nome do recebedor e assinatura continuam obrigatórios.</p>
    <p class="help">Mudanças valem para próximas confirmações e sincronizações, não alteram entregas já registradas.</p>
    <p class="error" role="alert"></p><footer><button type="button" class="close">Cancelar</button><button type="submit">Salvar regras</button></footer></form>`;
  document.body.append(dialog);
  const style=document.createElement('style');
  style.textContent='#deliverySettingsDialog{width:min(560px,94vw);max-height:90vh;overflow:auto;border:1px solid #cbd5e1;border-radius:16px;padding:24px;color:#172b45}#deliverySettingsDialog::backdrop{background:#071936bb}#deliverySettingsDialog label{display:block;margin:18px 0 10px;font-weight:600}#deliverySettingsDialog select{display:block;width:100%;padding:12px;margin-top:8px;border:1px solid #bacbdc;border-radius:8px;background:white;color:#172b45}#deliverySettingsDialog .check{display:flex;gap:10px;align-items:center}#deliverySettingsDialog .check input{width:18px;height:18px}#deliverySettingsDialog .help{font-size:13px;line-height:1.6;color:#52677e}#deliverySettingsDialog .error{color:#ad2437}#deliverySettingsDialog footer{display:flex;justify-content:flex-end;gap:10px}#deliverySettingsDialog button,.delivery-settings-button{padding:10px 14px;border:1px solid #b6cbdc;border-radius:8px;cursor:pointer}#deliverySettingsDialog button[type=submit]{background:#123e60;color:white}.delivery-settings-button{margin:10px;background:#123e60;color:#fff}.delivery-location-button{margin:10px 0;padding:9px 14px;border-radius:8px;border:1px solid #b6cbdc;background:#f0f6fa;color:#123e60}';
  document.head.append(style);
  const form=dialog.querySelector('form');
  const error=dialog.querySelector('.error');
  const button=document.createElement('button');button.type='button';button.className='delivery-settings-button';button.textContent='Configurações de entrega';button.hidden=true;
  document.querySelector('.side')?.append(button);
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
      const e=data.evidencia;const panel=document.createElement('dialog');panel.style.cssText='max-width:520px;width:90%;padding:24px;border:1px solid #bacbdc;border-radius:14px';
      const title=document.createElement('h2');title.textContent='Local de confirmação';panel.append(title);
      const details=document.createElement('p');details.style.whiteSpace='pre-wrap';
      details.textContent=!e?'Este protocolo não possui registro de localização.':e.localizacao?`Latitude: ${e.localizacao.latitude}\nLongitude: ${e.localizacao.longitude}\nPrecisão informada: ${Math.round(e.localizacao.precisao_metros)} m\nCapturada em: ${new Date(e.localizacao.capturado_em).toLocaleString('pt-BR')}\nRecebida no servidor: ${new Date(e.registrado_em).toLocaleString('pt-BR')}`:e.gps_status==='justificado'?`Entrega sem GPS.\nJustificativa: ${e.justificativa}`:'A coleta estava desativada nesta entrega.';panel.append(details);
      if(e?.localizacao){const link=document.createElement('a');link.textContent='Ver localização no Google Maps ↗';link.href=`https://www.google.com/maps/search/?api=1&query=${e.localizacao.latitude},${e.localizacao.longitude}`;link.target='_blank';link.rel='noopener noreferrer';panel.append(link);}
      const close=document.createElement('button');close.textContent='Fechar';close.style.display='block';close.style.marginTop='18px';close.onclick=()=>panel.close();panel.append(close);panel.addEventListener('close',()=>panel.remove());document.body.append(panel);panel.showModal();
    }catch(e){alert(e.message);}
  };
})();
