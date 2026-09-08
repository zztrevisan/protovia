// ============================================================
// PROTOVIA PROTOCOLOS - SERVICE WORKER
// V22
// ============================================================

const CACHE_NAME =
  'protovia-protocolos-v92-product-logo-border';


const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.js',
  '/theme.css',
  '/delivery-settings.js',
  '/pickups.js',
  '/installation.js',
  '/brand.png',
  '/vendor/qr-scanner.umd.min.js',
  '/vendor/qr-scanner-worker.min.js'
];


// ============================================================
// INSTALAÇÃO
// ============================================================

self.addEventListener(
  'install',
  event=>{

    event.waitUntil(

      caches
        .open(CACHE_NAME)

        .then(
          cache =>
            cache.addAll(
              APP_SHELL
            )
        )

        .then(
          ()=>self.skipWaiting()
        )

    );

  }
);


// ============================================================
// ATIVAÇÃO
// ============================================================

self.addEventListener(
  'activate',
  event=>{

    event.waitUntil(

      caches
        .keys()

        .then(
          keys=>

            Promise.all(

              keys

                .filter(
                  key =>
                    key !== CACHE_NAME &&
                    key.startsWith(
                      'protovia-protocolos-'
                    )
                )

                .map(
                  key =>
                    caches.delete(key)
                )

            )
        )

        .then(
          ()=>self.clients.claim()
        )

    );

  }
);


// ============================================================
// INTERCEPTAR REQUISIÇÕES
// ============================================================

self.addEventListener(
  'fetch',
  event=>{

    const request =
      event.request;


    const url =
      new URL(
        request.url
      );


    // ======================================================
    // API E TESTE DO SERVIDOR
    // ======================================================
    //
    // Não usamos cache aqui.
    //
    // Precisamos saber se o servidor
    // está realmente disponível.
    // ======================================================

    if(
      url.origin ===
        self.location.origin &&

      (
        url.pathname.startsWith(
          '/api/'
        ) ||

        url.pathname ===
          '/teste'
      )
    ){

      return;

    }


    // Só trabalhamos com GET.
    if(
      request.method !==
      'GET'
    ){

      return;

    }


    // ======================================================
    // NAVEGAÇÃO
    // ======================================================
    //
    // Primeiro tenta a rede.
    //
    // Se não houver servidor,
    // carrega index.html do cache.
    // ======================================================

    if(
      request.mode ===
      'navigate'
    ){

      event.respondWith(

        fetch(request)

          .then(
            response=>{

              const copia =
                response.clone();


              caches
                .open(
                  CACHE_NAME
                )

                .then(
                  cache =>

                    cache.put(
                      '/index.html',
                      copia
                    )
                );


              return response;

            }
          )


          .catch(
            ()=>

              caches.match(
                '/index.html'
              )
          )

      );


      return;

    }


    // ======================================================
    // ARQUIVOS ESTÁTICOS
    // ======================================================
    //
    // Usa cache primeiro.
    //
    // Ao mesmo tempo tenta atualizar
    // o arquivo pela rede.
    // ======================================================

    event.respondWith(

      caches
        .match(request)

        .then(
          cached=>{

            const rede =
              fetch(request)

                .then(
                  response=>{

                    if(
                      response &&
                      response.ok
                    ){

                      const copia =
                        response.clone();


                      caches
                        .open(
                          CACHE_NAME
                        )

                        .then(
                          cache =>

                            cache.put(
                              request,
                              copia
                            )
                        );

                    }


                    return response;

                  }
                );


            return (
              cached ||
              rede
            );

          }
        )

    );

  }
);
