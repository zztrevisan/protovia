(() => {
  let settings;
  const overlay = document.createElement('dialog');
  overlay.id = 'installationDialog';
  overlay.innerHTML = `<form id="installationForm"><h2 id="installationTitle">Configurar Protovia</h2>
    <p>Defina a identidade desta instalação e seu primeiro acesso.</p>
    <label>Nome da organização<input name="organizacao" required maxlength="120"></label>
    <label>Logo (opcional, PNG/JPEG/WebP, até 500 KB)<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
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
  style.textContent = '#installationDialog{width:min(540px,94vw);max-height:90vh;overflow:auto;border:1px solid #d7ece9;border-radius:16px;padding:26px;color:#15544a}#installationDialog::backdrop{background:#071936b8}#installationDialog label{display:block;margin:14px 0;font-size:13px}#installationDialog input{display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #b7dcd6;border-radius:6px}#installationError{color:#a61b1b}.installationActions{display:flex;gap:12px;justify-content:flex-end}';
  document.head.append(style);
  style.textContent += '#installationDialog button{padding:10px 16px;border:1px solid #cbe5e1;border-radius:8px;background:#f1f9f8;color:#15544a;cursor:pointer;font-weight:600}#installationDialog button[type=submit]{background:#15544a;color:white}#installationDialog button:disabled{opacity:.6;cursor:wait}.organization-settings-button{margin:14px;padding:10px;border:1px solid #548c83;border-radius:8px;background:transparent;color:#fff;font-size:12px}';
  const form = document.getElementById('installationForm');
  function apply(data) {
    settings = data;
    document.querySelectorAll('img[src="/brand.svg"],img[data-organization-logo]').forEach(img => {
      img.dataset.organizationLogo = 'true'; img.src = data.logo || '/brand.svg'; img.alt = data.nome;
    });
    document.querySelectorAll('[data-organization-name]').forEach(el => { el.textContent = data.nome; });
    window.protoviaOrganization = data;
  }
  function open() {
    form.elements.organizacao.value = settings.nome;
    document.getElementById('installationCredentials').hidden = settings.configured;
    document.getElementById('installationClose').hidden = !settings.configured;
    for (const name of ['nome','usuario','senha','token']) form.elements[name].required = !settings.configured;
    overlay.showModal();
  }
  overlay.addEventListener('cancel', event => { if (!settings?.configured) event.preventDefault(); });
  document.getElementById('installationClose').onclick = () => overlay.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      let logo = settings.logo;
      const file = form.elements.image.files[0];
      if (file) {
        if (file.size > 500000) throw Error('A imagem deve ter até 500 KB.');
        logo = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
      }
      const body = Object.fromEntries(new FormData(form)); delete body.image; body.logo=logo;
      const response = await fetch(settings.configured ? '/api/organization' : '/api/installation', {
        method: settings.configured ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
      const result = await response.json(); if (!response.ok) throw Error(result.erro);
      location.reload();
    } catch (error) { document.getElementById('installationError').textContent=error.message; }
    finally { button.disabled=false; }
  };
  const button = document.createElement('button'); button.className='organization-settings-button'; button.type='button'; button.textContent='Identidade da organização'; button.hidden=true; button.onclick=open;
  document.querySelector('.side')?.append(button);
  setInterval(() => { button.hidden = typeof isAdmin !== 'function' || !isAdmin(); }, 1000);
  fetch('/api/installation', {cache:'no-store'}).then(async response => {
    if (!response.ok) throw Error('Configuração indisponível. Verifique o servidor e tente recarregar.');
    const data = await response.json(); apply(data); if (!data.configured) open();
  }).catch(error => {
    const warning=document.createElement('p'); warning.setAttribute('role','alert'); warning.textContent=error.message;
    document.querySelector('.login-card')?.prepend(warning);
  });
})();
