(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const manager = () => isAdmin() || isLegalizacao();
  const allowed = () => Boolean(currentUser().id);
  const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
  const day = value => value ? value.split('-').reverse().join('/') : '—';
  let options = {ativo:false}, rows = [], sessionKey = '', loading = false, history=false;
  const button = document.createElement('button');
  button.type='button'; button.className='menu-btn pickup-nav'; button.dataset.view='pickups'; button.textContent='Acompanhar retiradas'; button.hidden=true;
  const side=document.querySelector('.side');
  side?.insertBefore(button,side.querySelector('[data-view="companies"]'));
  const section=document.createElement('section'); section.id='pickups'; section.className='view';
  section.innerHTML=`<div class="pickup-head"><div><span class="kicker">SOLICITAÇÕES</span><h2>Retiradas</h2><p>Coleta de documentação · conferência pela Legalização no escritório.</p></div><div><button type="button" class="pickup-new">Nova retirada</button><button type="button" class="pickup-refresh">Atualizar</button></div></div><div class="pickup-tabs"><button type="button" data-history="false" aria-pressed="true">Em andamento</button><button type="button" data-history="true" aria-pressed="false">Conferidas</button></div>
    <p class="pickup-message" role="status"></p><div class="pickup-create"></div>
    <label class="pickup-search">Pesquisar empresa<input type="search" placeholder="Nome da empresa"></label><div class="pickup-list"></div>`;
  document.querySelector('main')?.append(section);
  const style=document.createElement('style');
  style.textContent=`.side{overflow-y:auto!important}.pickup-nav[hidden]{display:none!important}#pickups .pickup-head{display:flex;align-items:center;justify-content:space-between;gap:16px}#pickups p{line-height:1.6}#pickups .pickup-message{color:#a72d36}#pickups .pickup-create form,#pickups article,#pickups .pickup-review{background:white;border:1px solid #d7e1e8;border-radius:14px;padding:20px;margin:16px 0}#pickups label{display:block;font-weight:600;margin:12px 0}#pickups input,#pickups select,#pickups textarea{display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:6px;border:1px solid #c9d5df;border-radius:8px;background:white;color:var(--text,#172b45)}#pickups textarea{min-height:90px}#pickups button{padding:10px 14px;border-radius:8px;background:var(--navy,#123e60);color:white;margin:6px 6px 6px 0}#pickups .pickup-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}#pickups .pickup-doc{padding:12px 0;border-bottom:1px solid #e1e7ec}#pickups .pickup-doc label{font-weight:400}#pickups .pickup-doc input[type=checkbox]{display:inline;width:auto;margin-right:8px}#pickups li{margin:8px 0;overflow-wrap:anywhere}#pickups small{display:block;color:var(--muted,#52677e);line-height:1.6}#pickups h3{overflow-wrap:anywhere}#pickups .pickup-status{font-size:13px;font-weight:700}#pickups .pickup-search{max-width:500px}@media(max-width:650px){#pickups .pickup-grid{grid-template-columns:1fr}#pickups .pickup-head{display:block}}`;
  document.head.append(style);
  style.textContent+='#pickups [hidden]{display:none!important}';
  style.textContent+='#pickups .pickup-message{color:var(--text,#172b45)}#pickups summary strong{display:inline}#pickups button{border:1px solid transparent;box-shadow:none}';
  style.textContent+=`.pickup-dialog{width:min(680px,94vw);max-height:90vh;overflow:auto;border:1px solid #d7e1e8;border-radius:18px;padding:24px;color:var(--text,#172b45)}.pickup-dialog::backdrop{background:#071936aa}.pickup-dialog button{padding:12px 16px;border-radius:9px;margin:6px;background:var(--navy,#123e60);color:white}.pickup-dialog label{display:block;margin:14px 0;font-weight:600}.pickup-dialog input,.pickup-dialog select,.pickup-dialog textarea{box-sizing:border-box;width:100%;padding:12px;margin-top:6px;border:1px solid #c9d5df;border-radius:9px}.pickup-dialog textarea{min-height:100px}.pickup-dialog .company-result{display:block;text-align:left;width:100%;margin:4px 0;background:#f0f5f8;color:var(--text,#172b45)}.pickup-dialog small{display:block;margin-top:5px}.pickup-dialog [hidden]{display:none!important}#pickups details.pickup-card{background:white;border:1px solid #d7e1e8;border-radius:12px;margin:10px 0;padding:14px}#pickups summary{cursor:pointer;line-height:1.6}#pickups summary strong{display:block}#pickups .pickup-tabs [aria-pressed=true]{outline:2px solid var(--navy);outline-offset:2px}#pickups .pickup-detail{border-top:1px solid #e1e7ec;margin-top:12px;padding-top:12px}`;
  function modal(title) {const dialog=document.createElement('dialog');dialog.className='pickup-dialog';dialog.setAttribute('aria-label',title);dialog.innerHTML=`<h2>${escape(title)}</h2><div class="modal-content"></div><button type="button" class="close-modal">Fechar</button>`;dialog.querySelector('.close-modal').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return dialog;}
  window.pickupRequests={async choose(){
    const dialog=modal('Nova solicitação');const target=dialog.querySelector('.modal-content');target.innerHTML='<p>O que você deseja solicitar?</p><button type="button" class="choose-protocol">Novo protocolo</button><button type="button" class="choose-pickup" hidden>Nova retirada</button><p role="status"></p>';
    target.querySelector('.choose-protocol').onclick=()=>{dialog.close();show('new',null,true);};
    try{options=await api('/opcoes');target.querySelector('.choose-pickup').hidden=!options.ativo;
      target.querySelector('.choose-pickup').onclick=()=>{dialog.close();show('pickups');refresh();createForm().catch(error=>message(error.message));};
    }catch(error){target.querySelector('[role=status]').textContent=error.message;}
  }};
  section.querySelector('.pickup-new').onclick=()=>createForm().catch(error=>message(error.message));
  section.querySelector('.pickup-tabs').onclick=event=>{const tab=event.target.closest('[data-history]');if(!tab)return;if(section.querySelector('.pickup-review')){message('Finalize ou cancele a conferência aberta.');return;}history=tab.dataset.history==='true';section.querySelectorAll('[data-history]').forEach(item=>item.setAttribute('aria-pressed',String(item===tab)));render();};
  style.textContent+='.pickup-dialog .pickup-company-snapshot{display:block;background:#f0f6f8;border:1px solid #d7e1e8;border-radius:12px;padding:14px;margin:12px 0}.pickup-dialog .pickup-company-snapshot strong{display:block;overflow-wrap:anywhere}.pickup-dialog .pickup-company-snapshot small{display:block;margin-top:6px;line-height:1.5}.pickup-dialog .close-modal,.pickup-dialog .view-pickups{background:#eef3f6;color:var(--text,#172b45);border:1px solid #c9d5df}.pickup-dialog button{border:1px solid transparent;box-shadow:none}.pickup-dialog .choose-protocol,.pickup-dialog .choose-pickup{padding:20px;min-width:180px}';
  const message = text => section.querySelector('.pickup-message').textContent=text;
  async function api(path,method='GET',body) {
    const response=await fetch('/api/retiradas'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json(); if(!response.ok)throw Error(value.erro || 'Não foi possível salvar.'); return value;
  }
  const status = {solicitada:'Solicitada',aguardando_conferencia:'Aguardando conferência no escritório',conferida:'Conferida'};
  function render() {
    section.querySelectorAll('[data-history]').forEach(tab=>tab.setAttribute('aria-pressed',String((tab.dataset.history==='true')===history)));
    const search=normalizeText(section.querySelector('[type=search]').value);
    const visible=rows.filter(row=>(row.estado==='conferida')===history && normalizeText(row.empresa_nome+' '+(row.contexto?.empresa?.box || '')).includes(search));
    let company=null;
    section.querySelector('.pickup-list').innerHTML=visible.map(row=>{
      const heading=company!==row.empresa_id?`<h3>${escape(row.empresa_nome)}</h3>`:''; company=row.empresa_id;
      const docs=row.conferencia || row.documentos;
      const comparison=!row.conferencia?'Conferência pendente':row.conferencia.some(doc=>doc.adicional || !doc.recebido)?'Com diferenças em relação ao solicitado':'Documentos conforme solicitado';
      const gps=row.contexto?.gps;const gpsLabel=!row.retirado_em?'Coleta pendente':!gps?'GPS não registrado':gps.gps_status==='capturado'?'Coleta com GPS':gps.gps_status==='justificado'?'Sem GPS · justificado':'GPS desativado';
      return `${heading}<details class="pickup-card"><summary><strong>${escape(row.empresa_nome)} ${row.contexto?.empresa?.box?`· Box ${escape(row.contexto.empresa.box)}`:''} · ${status[row.estado]}</strong><small>Solicitado por ${escape(row.solicitante_nome)} · Responsável: ${escape(row.entregador_nome)}</small><small>${gpsLabel} · ${comparison} · Ver detalhes</small></summary><div class="pickup-detail"><small>Solicitado em ${date(row.solicitado_em)}${row.retirado_em?` · Coletado em ${date(row.retirado_em)} por ${escape(row.contexto?.coletado_por || row.entregador_nome)}`:''}</small>${gps?.justificativa?`<p>Justificativa GPS: ${escape(gps.justificativa)}</p>`:''}${gps?.localizacao?`<small>GPS: ${Number(gps.localizacao.latitude)}, ${Number(gps.localizacao.longitude)} · precisão ${Number(gps.localizacao.precisao_metros)} m</small>`:''}
        <ul>${docs.map(doc=>`<li>${escape(doc.descricao)}${doc.adicional?' — adicional à solicitação':''}${row.conferencia?(doc.recebido?`<small>Recebido em ${day(doc.data_recebimento)} · Competência ${escape(doc.competencia.split('-').reverse().join('/'))}</small>`:`<small>Não recebido: ${escape(doc.justificativa)}</small>`):''}</li>`).join('')}</ul>
        ${row.observacao?`<p>${escape(row.observacao)}</p>`:''}
        ${row.estado==='solicitada' && (isAdmin() || Number(row.entregador_id)===Number(currentUser().id))?`<button type="button" data-collect="${escape(row.id)}">Registrar coleta realizada</button>`:''}
        ${row.estado==='aguardando_conferencia' && manager()?`<button type="button" data-review="${escape(row.id)}">Conferir no escritório</button>`:''}
        ${row.conferido_em?`<small>Conferido por ${escape(row.conferente_nome)} em ${date(row.conferido_em)}</small><details><summary>Documentos originalmente solicitados</summary><ul>${row.documentos.map(doc=>`<li>${escape(doc.descricao)}</li>`).join('')}</ul></details>`:''}
      </div></details>`;
    }).join('') || '<p>Nenhuma retirada encontrada.</p>';
  }
  async function refresh() {
    message('Carregando retiradas…');
    try { rows=await api(''); render(); message(''); }
    catch(error){rows=[];render();message(error.message);}
  }
  async function createForm() {
    if(!allowed())return;
    const data=await api('/cadastros');
    const dialog=modal('Nova retirada'),target=dialog.querySelector('.modal-content');
    target.innerHTML=`<form><label>Empresa<input type="search" class="find-company" placeholder="Pesquisar nome ou box" autocomplete="off"></label><div class="company-results"></div><input type="hidden" name="company"><div class="pickup-company-snapshot" role="status">Selecione uma empresa.</div><label>Responsável pela retirada<select name="courier" required><option value="">Selecione</option>${data.entregadores.map(item=>`<option value="${Number(item.id)}">${escape(item.nome)}</option>`).join('')}</select></label><label>Documentos solicitados — um por linha<textarea name="documents" required maxlength="30000" placeholder="Contrato social\nAlvará de funcionamento"></textarea></label><label>Observações<textarea name="notes" maxlength="2000"></textarea></label><button type="submit">Solicitar retirada</button><small>A data e a competência de cada documento serão registradas na conferência no escritório.</small><p class="form-error" role="alert"></p></form>`;
    const search=target.querySelector('.find-company'),results=target.querySelector('.company-results');
    const searchCompanies=()=>{const term=normalizeText(search.value);const matches=data.empresas.filter(item=>normalizeText(item.nome+' '+(item.box||'')).includes(term));results.innerHTML=matches.slice(0,term?6:3).map(item=>`<button type="button" class="company-result" data-company="${Number(item.id)}">${escape(item.nome)}<small>Box ${escape(item.box || '—')} · ${escape([item.endereco,item.numero,item.bairro,item.cidade,item.uf].filter(Boolean).join(', ') || 'Endereço não cadastrado')}</small></button>`).join('') || '<p>Nenhuma empresa encontrada.</p>';};
    search.oninput=()=>{target.querySelector('[name=company]').value='';target.querySelector('.pickup-company-snapshot').textContent='Selecione uma empresa.';searchCompanies();};searchCompanies();
    results.onclick=event=>{const selected=event.target.closest('[data-company]');if(!selected)return;const company=data.empresas.find(item=>Number(item.id)===Number(selected.dataset.company));target.querySelector('[name=company]').value=company.id;search.value=company.nome;results.innerHTML='';target.querySelector('.pickup-company-snapshot').innerHTML=`<strong>${escape(company.nome)}</strong><small>Box ${escape(company.box || '—')} · ${escape([company.endereco,company.numero,company.bairro,company.cidade,company.uf].filter(Boolean).join(', ') || 'Endereço não cadastrado')}</small>`;};
    target.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget, submit=form.querySelector('[type=submit]');submit.disabled=true;
      try{await api('','POST',{empresa_id:Number(form.elements.company.value),entregador_id:Number(form.elements.courier.value),documentos:form.elements.documents.value.split('\n').map(x=>x.trim()).filter(Boolean),observacao:form.elements.notes.value});dialog.close();history=false;show('pickups');await refresh();message('Retirada solicitada. Nenhum protocolo foi emitido.');}
      catch(error){form.querySelector('.form-error').textContent=error.message;}finally{submit.disabled=false;}
    };
  }
  function review(row, article) {
    if(section.querySelector('.pickup-review')){message('Finalize ou cancele a conferência já aberta.');return;}
    const form=document.createElement('form');form.className='pickup-review';
    form.innerHTML='<h3>Conferência no escritório</h3><p>Marque apenas os documentos efetivamente recebidos. Ao finalizar, o registro fica preservado.</p><div class="pickup-docs"></div><button type="button" class="pickup-add">Adicionar documento recebido a mais</button><br><button type="submit">Finalizar conferência</button><button type="button" class="pickup-cancel">Cancelar</button><p class="pickup-error" role="alert"></p>';
    const add=doc=>{
      const field=document.createElement('div');field.className='pickup-doc';field.dataset.id=doc?.id || '';
      field.innerHTML=`${doc?`<strong>${escape(doc.descricao)}</strong>`:'<label>Documento adicional<input name="description" maxlength="300" required></label>'}<label><input type="checkbox" name="received" ${doc?'':'checked disabled'}>Recebido no escritório</label><div class="pickup-grid"><label>Data do recebimento<input type="date" name="receivedDate"></label><label>Competência<input type="month" name="competence"></label></div><label class="pickup-missing">Motivo de não recebimento<textarea name="reason" maxlength="1000"></textarea></label>${doc?'':'<button type="button" class="pickup-remove">Remover adicional</button>'}`;
      const update=()=>{const received=field.querySelector('[name=received]').checked;field.querySelector('.pickup-grid').hidden=!received;field.querySelector('.pickup-missing').hidden=received;for(const name of ['receivedDate','competence']){field.querySelector(`[name=${name}]`).required=received;field.querySelector(`[name=${name}]`).disabled=!received;}field.querySelector('[name=reason]').required=!received;field.querySelector('[name=reason]').disabled=received;};
      field.querySelector('[name=received]').onchange=update;update();field.querySelector('.pickup-remove')?.addEventListener('click',()=>field.remove());form.querySelector('.pickup-docs').append(field);
    };
    row.documentos.forEach(add);form.querySelector('.pickup-add').onclick=()=>add(null);form.querySelector('.pickup-cancel').onclick=()=>form.remove();
    form.onsubmit=async event=>{
      event.preventDefault();
      const submit=form.querySelector('[type=submit]');submit.disabled=true;
      try { const documentos=[...form.querySelectorAll('.pickup-doc')].map(field=>({id:field.dataset.id || undefined,descricao:field.querySelector('[name=description]')?.value,recebido:field.querySelector('[name=received]').checked,data_recebimento:field.querySelector('[name=receivedDate]').value,competencia:field.querySelector('[name=competence]').value,justificativa:field.querySelector('[name=reason]').value}));await api('/'+row.id+'/conferir','PUT',{documentos});await refresh(); }
      catch(error){form.querySelector('.pickup-error').textContent=error.message;submit.disabled=false;}
    };
    article.append(form);form.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  section.querySelector('.pickup-list').onclick=async event=>{
    const collect=event.target.closest('[data-collect]'), check=event.target.closest('[data-review]');
    if(check){review(rows.find(row=>row.id===check.dataset.review),check.closest('.pickup-detail'));return;}
    if(!collect)return;
    collect.disabled=true;
    try{const policy=await window.deliveryRules.fetchPolicy();const evidence=await window.deliveryRules.capture(policy);await api('/'+collect.dataset.collect+'/retirar','PUT',evidence);await refresh();}catch(error){message(error.message);collect.disabled=false;}
  };
  button.onclick=async()=>{show('pickups',button);await refresh();};
  section.querySelector('.pickup-refresh').onclick=()=>{if(section.querySelector('.pickup-review'))message('Finalize ou cancele a conferência aberta antes de atualizar.');else refresh();};
  section.querySelector('[type=search]').oninput=()=>{if(!section.querySelector('.pickup-review'))render();};
  async function syncOptions() {
    const user=currentUser(), key=JSON.stringify([user.id,user.roles,user.dept]);
    if(loading || key===sessionKey)return;
    loading=true;sessionKey=key;button.hidden=true;rows=[];render();section.querySelector('.pickup-create').innerHTML='';
    document.querySelector('.pickup-option')?.remove();
    try {
      if(!user.id)return;
      options=await api('/opcoes');button.hidden=!options.ativo || !allowed();
      if(options.configuravel && isAdmin()) {
        const label=document.createElement('label');label.className='check pickup-option';
        label.innerHTML='<input type="checkbox"> Ativar módulo de retiradas (salvo ao marcar)';
        const toggle=label.querySelector('input');toggle.checked=options.ativo;
        toggle.onchange=async()=>{toggle.disabled=true;try{options=await api('/opcoes','PUT',{ativo:toggle.checked});button.hidden=!options.ativo || !allowed();if(!options.ativo && section.classList.contains('active'))show('dashboard');}catch(error){toggle.checked=!toggle.checked;alert(error.message);}finally{toggle.disabled=false;}};
        document.querySelector('#deliverySettingsDialog footer')?.before(label);
      }
    } catch {sessionKey='';} finally{loading=false;}
  }
  setInterval(syncOptions,2000);syncOptions();
})();
