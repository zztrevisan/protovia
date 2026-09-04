const DEFAULTS = Object.freeze({ gpsMode: 'off', qrRequired: true, manualNumberAllowed: true });

function validatePolicy(value) {
  if (!value || !['off', 'required', 'justification'].includes(value.gpsMode) ||
      typeof value.qrRequired !== 'boolean' || typeof value.manualNumberAllowed !== 'boolean') {
    throw new Error('Configuração inválida. Revise GPS e conferência do protocolo.');
  }
  return { gpsMode:value.gpsMode, qrRequired:value.qrRequired, manualNumberAllowed:value.manualNumberAllowed };
}

async function readPolicy(db) {
  const row = await db.get('SELECT regras_json FROM configuracao_entrega WHERE id = 1');
  return row ? validatePolicy(JSON.parse(row.regras_json)) : { ...DEFAULTS };
}

function deliveryEvidence(policy, body, actor, now = Date.now()) {
  const base = { policy, registrado_em:new Date(now).toISOString(), registrado_por:actor, localizacao:null, justificativa:null };
  if (policy.gpsMode === 'off') return { ...base, gps_status:'desativado' };
  const gps = body.localizacao_entrega;
  if (gps !== undefined && gps !== null) {
    const captured = Date.parse(gps.capturado_em);
    const delivered = body.entregue_em_local ? Date.parse(body.entregue_em_local) : now;
    if (!gps || typeof gps !== 'object' ||
        !Number.isFinite(gps.latitude) || Math.abs(gps.latitude)>90 ||
        !Number.isFinite(gps.longitude) || Math.abs(gps.longitude)>180 ||
        !Number.isFinite(gps.precisao_metros) || gps.precisao_metros<0 || gps.precisao_metros>100000 ||
        !Number.isFinite(captured) || !Number.isFinite(delivered) || captured>now+60000 ||
        delivered>now+60000 || Math.abs(delivered-captured)>600000) {
      throw new Error('Localização inválida ou antiga. Capture novamente antes de concluir.');
    }
    return { ...base, gps_status:'capturado', localizacao:{latitude:gps.latitude,longitude:gps.longitude,precisao_metros:gps.precisao_metros,capturado_em:new Date(captured).toISOString()} };
  }
  if (policy.gpsMode === 'required') throw new Error('O administrador exige localização para confirmar a entrega. Ative a permissão de localização.');
  const reason=String(body.justificativa_sem_gps || '').trim();
  if (reason.length<10 || reason.length>1000) throw new Error('Informe uma justificativa de 10 a 1.000 caracteres para concluir sem localização.');
  return { ...base, gps_status:'justificado', justificativa:reason };
}

function mountDeliveryPolicy(app, { database, exigirAdmin }) {
  // Montado depois da autenticação e do limitador de mutações.
  app.get('/api/configuracao-entrega', async (_req,res) => {
    res.setHeader('Cache-Control','no-store');
    try { res.json(await readPolicy(await database())); }
    catch { res.status(503).json({erro:'Não foi possível consultar as regras de entrega.'}); }
  });
  app.put('/api/configuracao-entrega', exigirAdmin, async (req,res) => {
    let policy;
    try { policy=validatePolicy(req.body); }
    catch(error) { return res.status(400).json({erro:error.message}); }
    try {
      const db=await database();
      await db.run(`INSERT INTO configuracao_entrega (id,regras_json,alterado_por,alterado_em) VALUES (1,?,?,?)
        ON CONFLICT(id) DO UPDATE SET regras_json=excluded.regras_json,alterado_por=excluded.alterado_por,alterado_em=excluded.alterado_em`,
        JSON.stringify(policy), String(req.usuarioLogado.id), new Date().toISOString());
      res.json(policy);
    } catch { res.status(500).json({erro:'Não foi possível salvar as regras.'}); }
  });
  app.get('/api/protocolos/:id/localizacao', exigirAdmin, async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const id=Number(req.params.id);
    if (!Number.isSafeInteger(id)||id<1) return res.status(400).json({erro:'Protocolo inválido.'});
    try {
      const row=await (await database()).get('SELECT entrega_evidencia_json FROM protocolos WHERE id = ? AND COALESCE(excluido,0) = 0',id);
      if(!row) return res.status(404).json({erro:'Protocolo não encontrado.'});
      res.json({evidencia:row.entrega_evidencia_json ? JSON.parse(row.entrega_evidencia_json) : null});
    } catch { res.status(500).json({erro:'Não foi possível consultar a localização.'}); }
  });
}
module.exports = { DEFAULTS, validatePolicy, readPolicy, deliveryEvidence, mountDeliveryPolicy };
