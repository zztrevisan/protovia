(() => {
  let settings;
  const overlay = document.createElement('dialog');
  overlay.id = 'installationDialog';
  overlay.innerHTML = `<form id="installationForm"><h2 id="installationTitle">Identidade do cliente</h2>
    <p id="installationDescription">Cadastre a identidade do cliente. A marca ProtoVia continuará visível como responsável pelo produto.</p>
    <div id="organizationIdentity">
      <label>Nome do cliente ou organização<input name="organizacao" required maxlength="120" placeholder="Ex.: Empresa Cliente"></label>
      <label>Logo do cliente (opcional, PNG/JPEG/WebP, até 500 KB)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div class="identity-colors">
        <label>Cor principal<input name="corPrimaria" type="color" value="#0f6657"></label>
        <label>Cor secundária<input name="corSecundaria" type="color" value="#19b89f"></label>
      </div>
      <label>Exibição da marca<select name="logoTamanho"><option value="grande">Grande — marca do cliente em destaque</option><option value="compacto">Compacta — marca menor e nome ao lado</option></select></label>
      <div class="identity-preview" aria-label="Prévia das cores"><span></span><div><strong>Prévia do ambiente</strong><small>Marca principal e cor complementar</small></div></div>
    </div>
    <div id="installationCredentials">
      <label>Seu nome<input name="nome" maxlength="120" autocomplete="name"></label>
      <label>Login do administrador<input name="usuario" autocomplete="username" pattern="[a-z0-9_.-]{3,60}"></label>
      <label>Senha (mínimo 12 caracteres)<input name="senha" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label>
      <label>Token de instalação<input name="token" type="password" autocomplete="off"></label>
    </div>
    <p id="installationError" role="alert"></p>
    <div class="installationActions"><button type="button" id="installationClose">Cancelar</button><button type="submit">Salvar configuração</button></div>
  </form>`;
  document.body.append(overlay);
  const style = document.createElement('style');
  style.textContent = '#installationDialog{width:min(560px,94vw);max-height:90vh;overflow:auto;border:1px solid #d7ece9;border-radius:16px;padding:26px;color:#15544a}#installationDialog::backdrop{background:#071936b8}#installationDialog label{display:block;margin:14px 0;font-size:13px}#installationDialog input,#installationDialog select{display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #b7dcd6;border-radius:6px;background:#fff;color:#173d37}#installationDialog input[type=color]{height:46px;padding:4px;cursor:pointer}.identity-colors{display:grid;grid-template-columns:1fr 1fr;gap:12px}.identity-preview{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px;border:1px solid #d7ece9;border-radius:12px;background:#f6fbfa}.identity-preview span{width:44px;height:44px;border-radius:11px;background:linear-gradient(135deg,var(--preview-primary),var(--preview-secondary));box-shadow:0 7px 18px color-mix(in srgb,var(--preview-primary),transparent 75%)}.identity-preview strong,.identity-preview small{display:block}.identity-preview small{margin-top:3px;color:#64847e}#installationError{color:#a61b1b}.installationActions{display:flex;gap:12px;justify-content:flex-end}@media(max-width:480px){.identity-colors{grid-template-columns:1fr}}';
  document.head.append(style);
  style.textContent += '#installationDialog button{padding:10px 16px;border:1px solid #cbe5e1;border-radius:8px;background:#f1f9f8;color:#15544a;cursor:pointer;font-weight:600}#installationDialog button[type=submit]{background:#15544a;color:white}#installationDialog button:disabled{opacity:.6;cursor:wait}.organization-settings-button{margin:14px;padding:10px;border:1px solid #548c83;border-radius:8px;background:transparent;color:#fff;font-size:12px}';
  const form = document.getElementById('installationForm');
  const DEFAULT_PRIMARY='#0f6657';
  const DEFAULT_SECONDARY='#19b89f';
  function mix(hex, target, amount) {
    const value=parseInt(hex.slice(1),16); const to=parseInt(target.slice(1),16);
    const channel=shift=>Math.round(((value>>shift)&255)*(1-amount)+((to>>shift)&255)*amount);
    return `#${[16,8,0].map(shift=>channel(shift).toString(16).padStart(2,'0')).join('')}`;
  }
  function applyColors(primary,secondary) {
    primary=/^#[0-9a-f]{6}$/i.test(primary||'')?primary:DEFAULT_PRIMARY;
    secondary=/^#[0-9a-f]{6}$/i.test(secondary||'')?secondary:DEFAULT_SECONDARY;
    const root=document.documentElement.style;
    root.setProperty('--navy',mix(primary,'#000000',.28));
    root.setProperty('--navy-2',mix(primary,'#000000',.08));
    root.setProperty('--blue',secondary);
    root.setProperty('--blue-2',mix(secondary,'#000000',.12));
    root.setProperty('--blue-bright',mix(secondary,'#ffffff',.16));
    root.setProperty('--cyan-soft',mix(secondary,'#ffffff',.9));
    root.setProperty('--bg',mix(primary,'#ffffff',.955));
    root.setProperty('--surface-soft',mix(primary,'#ffffff',.965));
    root.setProperty('--surface-muted',mix(primary,'#ffffff',.91));
    root.setProperty('--text',mix(primary,'#000000',.34));
    root.setProperty('--text-soft',mix(primary,'#ffffff',.38));
    root.setProperty('--border',mix(primary,'#ffffff',.86));
    root.setProperty('--border-strong',mix(primary,'#ffffff',.76));
  }
  function updatePreview(){
    overlay.style.setProperty('--preview-primary',form.elements.corPrimaria.value);
    overlay.style.setProperty('--preview-secondary',form.elements.corSecundaria.value);
  }
  function apply(data) {
    settings = data;
    const customerName=(data.nome && data.nome!=='Sua organização')?data.nome:'ProtoVia';
    const customerConfigured=customerName!=='ProtoVia';
    applyColors(data.corPrimaria,data.corSecundaria);
    document.body.classList.toggle('customer-branded',customerConfigured);
    document.body.classList.toggle('brand-compact',data.logoTamanho==='compacto');
    document.querySelectorAll('[data-customer-logo]').forEach(img => {
      img.hidden = !data.logo || !customerConfigured;
      if (data.logo) { img.src = data.logo; img.alt = `Logo de ${data.nome}`; }
    });
    document.querySelectorAll('[data-customer-name]').forEach(el => { el.textContent = customerName; });
    document.querySelectorAll('[data-customer-name-fallback]').forEach(el => { el.hidden=Boolean(data.logo)&&customerConfigured; el.textContent=customerName; });
    document.querySelectorAll('[data-product-fallback]').forEach(el => { el.hidden=customerConfigured; });
    document.querySelectorAll('[data-customer-context]').forEach(el => { el.hidden = !data.configured || !customerConfigured; });
    document.querySelectorAll('[data-customer-monogram]').forEach(el => { el.textContent=customerName.trim().charAt(0).toUpperCase()||'P'; });
    document.title=`${customerName} Protocolos`;
    window.protoviaOrganization = data;
    window.protoviaCustomer = data;
  }
  function open() {
    form.elements.organizacao.value = settings.nome;
    form.elements.corPrimaria.value=settings.corPrimaria||DEFAULT_PRIMARY;
    form.elements.corSecundaria.value=settings.corSecundaria||DEFAULT_SECONDARY;
    form.elements.logoTamanho.value=settings.logoTamanho||'grande';
    updatePreview();
    document.getElementById('organizationIdentity').hidden = !settings.configured;
    document.getElementById('installationCredentials').hidden = settings.configured;
    document.getElementById('installationTitle').textContent = settings.configured ? 'Identidade do cliente' : 'Criar primeiro administrador';
    document.getElementById('installationDescription').textContent = settings.configured
      ? 'Configure a marca do cliente exibida junto da identidade permanente da ProtoVia.'
      : 'Crie o acesso administrativo inicial. A identidade do cliente será configurada depois do login, no menu Configurações.';
    document.getElementById('installationClose').hidden = !settings.configured;
    for (const name of ['nome','usuario','senha','token']) form.elements[name].required = !settings.configured;
    form.elements.organizacao.required = settings.configured;
    overlay.showModal();
  }
  overlay.addEventListener('cancel', event => { if (!settings?.configured) event.preventDefault(); });
  document.getElementById('installationClose').onclick = () => overlay.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      let logo = settings.configured ? settings.logo : '';
      const file = form.elements.image.files[0];
      if (file) {
        if (file.size > 500000) throw Error('A imagem deve ter até 500 KB.');
        logo = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
      }
      const body = Object.fromEntries(new FormData(form)); delete body.image;
      if (!settings.configured) body.organizacao='Sua organização';
      body.logo=logo;
      body.corPrimaria=form.elements.corPrimaria.value||settings.corPrimaria||DEFAULT_PRIMARY;
      body.corSecundaria=form.elements.corSecundaria.value||settings.corSecundaria||DEFAULT_SECONDARY;
      body.logoTamanho=form.elements.logoTamanho.value||settings.logoTamanho||'grande';
      const response = await fetch(settings.configured ? '/api/organization' : '/api/installation', {
        method: settings.configured ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
      const result = await response.json(); if (!response.ok) throw Error(result.erro);
      location.reload();
    } catch (error) { document.getElementById('installationError').textContent=error.message; }
    finally { button.disabled=false; }
  };
  form.elements.corPrimaria.addEventListener('input',updatePreview);
  form.elements.corSecundaria.addEventListener('input',updatePreview);
  window.protoviaIdentitySettings={open:()=>{if(settings?.configured && typeof isAdmin==='function' && isAdmin())open();}};
  fetch('/api/installation', {cache:'no-store'}).then(async response => {
    if (!response.ok) throw Error('Configuração indisponível. Verifique o servidor e tente recarregar.');
    const data = await response.json(); apply(data); if (!data.configured) open();
  }).catch(error => {
    const warning=document.createElement('p'); warning.setAttribute('role','alert'); warning.textContent=error.message;
    document.querySelector('.login-card')?.prepend(warning);
  });
})();
