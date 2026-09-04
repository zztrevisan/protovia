let organizationProvider = async () => ({ nome: 'Sua organização', logo: '' });
function setOrganizationProvider(provider) { organizationProvider = provider; }

async function identidadeEmail(titulo, conteudo) {
  const organization = await organizationProvider();
  const appUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(organization?.logo || '');
  const customerLogo = match?.[2] || '';
  const productLogo = appUrl ? `${appUrl}/brand.png` : '';
  return {
    attachments: customerLogo ? [{ filename: `logo-cliente.${match[1]}`, content: customerLogo, content_id: 'customer-logo' }] : [],
    html: `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#eef8f6;font-family:Arial,sans-serif;color:#17453d">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="padding:22px 24px;background:#07362e;color:#fff">${productLogo ? `<img src="${escaparHtml(productLogo)}" width="180" alt="ProtoVia" style="display:block;background:white;border-radius:8px;padding:6px;margin-bottom:14px">` : '<strong style="font-size:24px">ProtoVia</strong>'}<div style="display:flex;align-items:center;gap:10px;border-top:1px solid #47766e;padding-top:12px">${customerLogo ? '<img src="cid:customer-logo" width="44" height="44" alt="Logo do cliente" style="object-fit:contain;background:white;border-radius:6px;padding:3px">' : ''}<div><span style="display:block;color:#9bc7c0;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Comunicação para</span><strong style="font-size:16px">${escaparHtml(organization?.nome || 'Sua organização')}</strong></div></div></td></tr>
        <tr><td style="padding:28px;overflow-wrap:anywhere"><h1 style="font-size:24px;line-height:1.3;margin:0 0 20px">${escaparHtml(titulo)}</h1>${conteudo}
        ${appUrl ? `<p style="margin-top:28px"><a href="${escaparHtml(appUrl)}" style="display:inline-block;background:#0d5c4f;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Abrir Protovia</a></p>` : ''}
        <p style="font-size:12px;color:#668580;line-height:1.6">Consulte o sistema para ver a situação atual das entregas. Esta mensagem mostra os dados no momento do envio.</p><p style="border-top:1px solid #dcebe8;padding-top:14px;font-size:11px;color:#78928e">Tecnologia e rastreabilidade por <strong>ProtoVia</strong>.</p></td></tr>
      </table></td></tr></table></body></html>`
  };
}

function dataEmail(valor) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(valor || '');
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#009980;');
}

function normalizarDestinatarios(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return [...new Set(lista
    .map(item => String(item || '').trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )].slice(0, 10);
}

async function enviarComprovanteEntrega({ protocolo, itens, destinatarios }) {
  const emails = normalizarDestinatarios(destinatarios);
  if (!emails.length) return { status: 'nao_solicitado' };

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const remetente = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !remetente) {
    return {
      status: 'pendente_configuracao',
      erro: 'RESEND_API_KEY ou EMAIL_FROM não configurado.'
    };
  }

  const documentos = (itens || [])
    .map(item => `<li>${escaparHtml(item.descricao)}</li>`)
    .join('');
  const numero = String(protocolo.numero).padStart(6, '0');
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: remetente,
      to: emails,
      subject: `Comprovante de entrega · Protocolo ${numero}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#17453d;line-height:1.55">
          <h2 style="margin-bottom:4px">Comprovante de entrega</h2>
          <p><strong>Protocolo:</strong> ${numero}</p>
          <p><strong>Empresa:</strong> ${escaparHtml(protocolo.cliente)}</p>
          <p><strong>Recebido por:</strong> ${escaparHtml(protocolo.recebido_por)}</p>
          <p><strong>Data da entrega:</strong> ${escaparHtml(protocolo.entregue_em)}</p>
          <p><strong>Documentos:</strong></p>
          <ul>${documentos}</ul>
          <p style="color:#668580;font-size:12px">Mensagem enviada automaticamente pelo Protovia Protocolos após confirmação da entrega.</p>
        </div>
      `
    })
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    return { status: 'falhou', erro: dados.message || `Falha HTTP ${resposta.status}` };
  }
  return { status: 'enviado', id: dados.id || null };
}

async function enviarNotificacaoNovoProtocolo({ protocolo, itens, destinatario, totalPendentes = 1 }) {
  const emails = normalizarDestinatarios([destinatario]);
  if (!emails.length) return { status: 'sem_email' };

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const remetente = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !remetente) {
    return {
      status: 'pendente_configuracao',
      erro: 'RESEND_API_KEY ou EMAIL_FROM não configurado.'
    };
  }

  const documentos = (itens || [])
    .map(item => {
      const vencimento = item.vencimento
        ? `<br><span style="color:#668580;font-size:13px">Vencimento: ${escaparHtml(dataEmail(item.vencimento))}</span>`
        : '';
      return `<li style="margin-bottom:6px">${escaparHtml(item.descricao)}${vencimento}</li>`;
    })
    .join('');
  const numero = String(protocolo.numero).padStart(6, '0');
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: remetente,
      to: emails,
      subject: `Nova entrega adicionada · ${totalPendentes} ${totalPendentes === 1 ? 'entrega pendente' : 'entregas pendentes'}`,
      ...await identidadeEmail('Uma nova entrega foi adicionada', `
        <div style="font-family:Arial,sans-serif;color:#17453d;line-height:1.55;max-width:620px">
          <p style="padding:16px;background:#edfcfa;border-radius:10px;color:#0d5c4f;font-size:20px"><strong>Você tem ${Number(totalPendentes)} ${totalPendentes === 1 ? 'entrega pendente' : 'entregas pendentes'}</strong><br><span style="font-size:13px">Incluindo esta nova solicitação.</span></p>
          <p><strong>${escaparHtml(protocolo.emissor)}</strong> atribuiu uma nova entrega a você.</p>
          <p style="color:#668580;font-size:12px;text-transform:uppercase">Entrega recém-adicionada</p>
          <p><strong>Protocolo:</strong> ${numero}<br>
          <strong>Empresa:</strong> ${escaparHtml(protocolo.cliente)}<br>
          <strong>Departamento:</strong> ${escaparHtml(protocolo.departamento)}</p>
          <p><strong>Documentos:</strong></p>
          <ul>${documentos}</ul>
          <p style="color:#668580;font-size:12px">Abra o Protovia Protocolos para acompanhar e confirmar a entrega.</p>
        </div>
      `)
    })
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    return { status: 'falhou', erro: dados.message || `Falha HTTP ${resposta.status}` };
  }
  return { status: 'enviado', id: dados.id || null };
}

async function enviarAlertaVencimentos({ destinatario, nomeEntregador, itens }) {
  const emails = normalizarDestinatarios([destinatario]);
  if (!emails.length) return { status: 'sem_email' };

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const remetente = String(process.env.EMAIL_FROM || '').trim();
  if (!apiKey || !remetente) {
    return { status: 'pendente_configuracao', erro: 'RESEND_API_KEY ou EMAIL_FROM não configurado.' };
  }

  const linhas = (itens || []).map(item => {
    const numero = String(item.numero).padStart(6, '0');
    const data = escaparHtml(dataEmail(item.vencimento));
    const prazo = Number(item.dias_restantes) === 1
      ? 'vence amanhã'
      : `vence em ${item.dias_restantes} dias`;
    return `<li style="margin-bottom:16px"><strong>Protocolo ${numero} · ${escaparHtml(item.cliente)}</strong><br>${escaparHtml(item.descricao)}<br><span style="background:#fff3d6;color:#945600;padding:4px 8px;display:inline-block">${data} · ${prazo}</span></li>`;
  }).join('');

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remetente,
      to: emails,
      subject: `${itens.length} vencimento${itens.length === 1 ? '' : 's'} próximo${itens.length === 1 ? '' : 's'} · Protovia`,
      ...await identidadeEmail('Documentos próximos do vencimento', `
        <div style="font-family:Arial,sans-serif;color:#17453d;line-height:1.55;max-width:650px">
          <p>Olá, ${escaparHtml(nomeEntregador)}. Estes documentos atribuídos a você vencem nos próximos 3 dias:</p>
          <ul>${linhas}</ul>
          <p style="color:#668580;font-size:12px">Este lembrete é enviado diariamente até o vencimento ou até a conclusão do protocolo.</p>
        </div>`)
    })
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) return { status: 'falhou', erro: dados.message || `Falha HTTP ${resposta.status}` };
  return { status: 'enviado', id: dados.id || null };
}

module.exports = {
  setOrganizationProvider,
  normalizarDestinatarios,
  enviarComprovanteEntrega,
  enviarNotificacaoNovoProtocolo,
  enviarAlertaVencimentos
};
