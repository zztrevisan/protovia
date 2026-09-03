// ============================================================
// PROTOVIA PROTOCOLOS - OFFLINE / SINCRONIZAÇÃO
// V15
// ============================================================

const PROTOVIA_OFFLINE_DB = 'protovia_offline';
const PROTOVIA_OFFLINE_VERSION = 3;
const STORE_FILA = 'fila_sincronizacao';
const STORE_CACHE = 'cache_app';

const OFFLINE_SESSION_MS =
  12 * 60 * 60 * 1000; // 12 horas

let offlineDbPromise = null;
let sincronizacaoEmAndamento = false;


// ============================================================
// BANCO LOCAL
// ============================================================

function abrirBancoOffline(){

  if(offlineDbPromise){
    return offlineDbPromise;
  }

  offlineDbPromise = new Promise((resolve,reject)=>{

    const req = indexedDB.open(
      PROTOVIA_OFFLINE_DB,
      PROTOVIA_OFFLINE_VERSION
    );

    req.onupgradeneeded = event=>{

      const db = event.target.result;

      if(!db.objectStoreNames.contains(STORE_FILA)){
        db.createObjectStore(
          STORE_FILA,
          {
            keyPath:'id',
            autoIncrement:true
          }
        );
      }

      if(!db.objectStoreNames.contains(STORE_CACHE)){
        db.createObjectStore(
          STORE_CACHE,
          {
            keyPath:'chave'
          }
        );
      }
    };

    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });

  return offlineDbPromise;
}


// ============================================================
// CACHE GENÉRICO
// ============================================================

async function salvarCacheOffline(chave,valor){

  const db = await abrirBancoOffline();

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_CACHE,
      'readwrite'
    );

    tx.objectStore(STORE_CACHE).put({
      chave,
      valor,
      atualizado_em:
        new Date().toISOString()
    });

    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}


async function lerCacheOffline(chave){

  const db = await abrirBancoOffline();

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_CACHE,
      'readonly'
    );

    const req =
      tx.objectStore(STORE_CACHE).get(chave);

    req.onsuccess = ()=>{
      resolve(req.result?.valor ?? null);
    };

    req.onerror = ()=>reject(req.error);
  });
}


async function removerCacheOffline(chave){

  const db = await abrirBancoOffline();

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_CACHE,
      'readwrite'
    );

    tx.objectStore(STORE_CACHE).delete(chave);

    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}


// ============================================================
// SESSÃO OFFLINE
// ============================================================

async function salvarSessaoOffline(usuario){

  if(!usuario)return;

  const agora = Date.now();

  await salvarCacheOffline(
    'sessao_offline',
    {
      usuario,
      salvo_em:
        new Date(agora).toISOString(),
      valido_ate:
        new Date(
          agora + OFFLINE_SESSION_MS
        ).toISOString()
    }
  );
}


async function obterSessaoOfflineValida(){

  const item =
    await lerCacheOffline('sessao_offline');

  if(
    !item ||
    !item.usuario ||
    !item.valido_ate
  ){
    return null;
  }

  const limite =
    new Date(item.valido_ate).getTime();

  if(
    !Number.isFinite(limite) ||
    limite <= Date.now()
  ){
    await removerCacheOffline(
      'sessao_offline'
    );

    return null;
  }

  return item.usuario;
}


async function limparSessaoOffline(){
  await removerCacheOffline('sessao_offline');
}


// ============================================================
// CACHE DE USUÁRIOS E PROTOCOLOS
// ============================================================

function chaveProtocolos(usuarioId){
  return `protocolos_${usuarioId || 'anon'}`;
}


function chaveUsuarios(usuarioId){
  return `usuarios_${usuarioId || 'anon'}`;
}


async function salvarProtocolosOffline(
  protocolos,
  proximoNumero,
  usuarioId
){
  await salvarCacheOffline(
    chaveProtocolos(usuarioId),
    {
      protocolos:
        Array.isArray(protocolos)
          ? protocolos
          : [],
      proximoNumero,
      salvo_em:
        new Date().toISOString()
    }
  );
}


async function carregarProtocolosOffline(usuarioId){
  return await lerCacheOffline(
    chaveProtocolos(usuarioId)
  );
}


async function salvarUsuariosOffline(
  usuarios,
  usuarioId
){
  await salvarCacheOffline(
    chaveUsuarios(usuarioId),
    {
      usuarios:
        Array.isArray(usuarios)
          ? usuarios
          : [],
      salvo_em:
        new Date().toISOString()
    }
  );
}


async function carregarUsuariosOffline(usuarioId){
  return await lerCacheOffline(
    chaveUsuarios(usuarioId)
  );
}


async function atualizarStatusProtocoloCache(
  protocoloId,
  alteracoes
){
  const sessao =
    await obterSessaoOfflineValida();

  const usuarioId =
    sessao?.id || null;

  const cache =
    await carregarProtocolosOffline(usuarioId);

  if(
    !cache ||
    !Array.isArray(cache.protocolos)
  ){
    return;
  }

  const index =
    cache.protocolos.findIndex(
      p =>
        Number(p.id) ===
        Number(protocoloId)
    );

  if(index < 0)return;

  cache.protocolos[index] = {
    ...cache.protocolos[index],
    ...alteracoes
  };

  cache.salvo_em =
    new Date().toISOString();

  await salvarCacheOffline(
    chaveProtocolos(usuarioId),
    cache
  );
}


// ============================================================
// FILA DE SINCRONIZAÇÃO
// ============================================================

async function listarFila(){

  const db = await abrirBancoOffline();

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_FILA,
      'readonly'
    );

    const store =
      tx.objectStore(STORE_FILA);

    const itens = [];

    const req =
      store.openCursor();

    req.onsuccess = event=>{

      const cursor =
        event.target.result;

      if(!cursor){
        resolve(itens);
        return;
      }

      itens.push({
        ...cursor.value,
        _offlineKey:
          cursor.primaryKey
      });

      cursor.continue();
    };

    req.onerror = ()=>reject(req.error);
  });
}


async function removerDaFila(chave){

  const db = await abrirBancoOffline();

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_FILA,
      'readwrite'
    );

    tx.objectStore(STORE_FILA).delete(chave);

    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}


async function adicionarNaFila(item){

  const db = await abrirBancoOffline();

  // Evita duas entregas pendentes do mesmo protocolo.
  const existentes = await listarFila();

  for(const antigo of existentes){
    if(
      antigo.tipo === item.tipo &&
      Number(antigo.protocolo_id) ===
      Number(item.protocolo_id)
    ){
      await removerDaFila(
        antigo._offlineKey
      );
    }
  }

  return new Promise((resolve,reject)=>{

    const tx = db.transaction(
      STORE_FILA,
      'readwrite'
    );

    const store =
      tx.objectStore(STORE_FILA);

    const payload = {
      ...item,
      criado_em_offline:
        new Date().toISOString(),
      tentativas:0
    };

    const req = store.add(payload);

    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}


// ============================================================
// TESTAR O SERVIDOR REAL
// ============================================================

async function servidorProtoviaDisponivel(
  timeoutMs = 2500
){

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      ()=>controller.abort(),
      timeoutMs
    );

  try{
    const resposta =
      await fetch(
        `/teste?ping=${Date.now()}`,
        {
          method:'GET',
          cache:'no-store',
          signal:
            controller.signal
        }
      );

    return resposta.ok;

  }catch(erro){
    return false;

  }finally{
    clearTimeout(timer);
  }
}


// ============================================================
// INDICADOR
// ============================================================

async function atualizarIndicadorSincronizacao(){

  const painel =
    document.getElementById('syncPanel');

  const texto =
    document.getElementById('syncStatus');

  const countEl =
    document.getElementById('syncCount');

  if(!painel || !texto)return;

  let fila=[];

  try{
    fila=await listarFila();
  }catch(e){}

  const pendentes=fila.length;

  if(countEl){
    countEl.textContent=String(pendentes);

    countEl.classList.toggle(
      'show',
      pendentes > 0
    );
  }

  if(sincronizacaoEmAndamento){
    painel.className='sync-panel syncing';

    texto.textContent=
      'Sincronizando com o servidor...';

    return;
  }

  const online=
    await servidorProtoviaDisponivel();

  window.dispatchEvent(
    new CustomEvent(
      'protovia-server-state',
      {
        detail:{
          online,
          pendentes
        }
      }
    )
  );

  if(online){

    painel.className='sync-panel online';

    texto.textContent=
      pendentes
        ? `Conectado · ${pendentes} pendente(s)`
        : 'Conectado · sincronizado';

  }else{

    painel.className='sync-panel offline';

    texto.textContent=
      pendentes
        ? `Modo offline · ${pendentes} aguardando envio`
        : 'Modo offline · dados locais disponíveis';
  }
}


// ============================================================
// SINCRONIZAR FILA
// ============================================================

async function sincronizarFila(){

  if(sincronizacaoEmAndamento){
    return {
      sincronizados:0,
      ocupado:true
    };
  }

  const online=
    await servidorProtoviaDisponivel();

  if(!online){

    await atualizarIndicadorSincronizacao();

    return {
      sincronizados:0,
      offline:true
    };
  }

  sincronizacaoEmAndamento=true;

  await atualizarIndicadorSincronizacao();

  let sincronizados=0;
  let precisaLogin=false;

  try{

    const fila=
      await listarFila();

    for(const item of fila){

      try{

        if(
          item.tipo ===
          'entrega_protocolo'
        ){

          const resposta =
            await fetch(
              `/api/protocolos/${item.protocolo_id}/entregar`,
              {
                method:'PUT',

                headers:{
                  'Content-Type':
                    'application/json'
                },

                body:JSON.stringify({

                  recebido_por:
                    item.recebido_por,

                  assinatura:
                    item.assinatura,

                  entregue_em_local:
                    item.entregue_em_local,

                  qr_codigo:
                    item.qr_codigo,

                  protocolo_numero_confirmacao:
                    item.protocolo_numero_confirmacao,

                  email_destinatarios:
                    item.email_destinatarios

                })
              }
            );


          const dados =
            await resposta
              .json()
              .catch(()=>({}));


          if(resposta.status===401){

            precisaLogin=true;
            break;

          }


          // Caso a primeira tentativa tenha chegado ao servidor
          // e apenas a resposta tenha se perdido,
          // uma segunda tentativa pode informar "já entregue".
          const jaEntregue =
            resposta.status===400 &&
            /já.*entreg/i.test(
              dados.erro || ''
            );


          if(
            !resposta.ok &&
            !jaEntregue
          ){

            throw new Error(
              dados.erro ||
              'Erro ao sincronizar entrega.'
            );

          }


          await removerDaFila(
            item._offlineKey
          );


          sincronizados++;

        }

      }catch(erroItem){

        console.warn(
          'Falha ao sincronizar item:',
          erroItem
        );

        // Mantém na fila e tenta novamente depois.
        break;
      }
    }

  }finally{

    sincronizacaoEmAndamento=false;

    await atualizarIndicadorSincronizacao();

  }


  if(sincronizados>0){

    window.dispatchEvent(
      new CustomEvent(
        'protovia-sync-complete',
        {
          detail:{
            sincronizados
          }
        }
      )
    );

  }


  return {
    sincronizados,
    precisaLogin
  };
}


// ============================================================
// SINCRONIZAÇÃO AUTOMÁTICA
// ============================================================

async function tentativaAutomatica(){

  try{

    await atualizarIndicadorSincronizacao();


    const online=
      await servidorProtoviaDisponivel();


    if(online){

      await sincronizarFila();

    }

  }catch(e){

    console.warn(
      'Sincronização automática:',
      e
    );

  }
}


// Quando o navegador detectar retorno de rede.
window.addEventListener(
  'online',
  ()=>{

    setTimeout(
      tentativaAutomatica,
      800
    );

  }
);


// Quando o usuário voltar para a aba/tela.
document.addEventListener(
  'visibilitychange',
  ()=>{

    if(
      document.visibilityState ===
      'visible'
    ){

      tentativaAutomatica();

    }

  }
);


// Verifica a cada 30 segundos
// enquanto o sistema estiver aberto.
setInterval(
  tentativaAutomatica,
  30000
);


// ============================================================
// SERVICE WORKER
// ============================================================

async function registrarServiceWorker(){

  if(
    !('serviceWorker' in navigator)
  ){
    return;
  }


  // Service Worker exige contexto seguro.
  //
  // Funciona:
  // http://localhost:3000
  //
  // Para IP da rede, por exemplo:
  // http://192.168.0.13:3000
  //
  // normalmente será necessário HTTPS.
  const podeUsar =
    window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';


  if(!podeUsar){

    console.info(
      'Protovia: Service Worker não registrado porque o acesso por IP HTTP não é um contexto seguro.'
    );

    return;
  }


  try{

    await navigator
      .serviceWorker
      .register(
        '/service-worker.js'
      );

  }catch(erro){

    console.warn(
      'Service Worker não registrado:',
      erro
    );

  }

}


// Ao abrir o sistema:
window.addEventListener(
  'load',
  ()=>{

    registrarServiceWorker();

    tentativaAutomatica();

  }
);
