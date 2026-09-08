# Segurança e isolamento

## Isolamento por cliente

Cada cliente deve possuir projeto, banco, domínio e credenciais próprios. Não reutilize tokens de outra instalação e não conecte duas instalações comerciais ao mesmo banco.

## Instalação inicial

`SETUP_TOKEN` é temporário. Use um valor aleatório longo, conclua o primeiro administrador e remova a variável. O servidor impede uma segunda instalação depois que a organização já existe.

## Controles

- cookies de sessão protegidos;
- senha derivada com salt;
- autorização no servidor;
- validação de origem e limitação de requisições;
- GPS completo restrito ao administrador;
- segredos fora do repositório;
- cron protegido por `CRON_SECRET`.

## Dados

Bancos, backups, assinaturas, coordenadas, `.env` e logs operacionais não devem ser publicados. Defina retenção, responsáveis por restauração e política de privacidade antes de colocar uma instalação em produção.

## E-mail

Use domínio verificado e remetente exclusivo da instalação. Uma falha de envio não deve apagar a operação concluída; registre o resultado para nova tentativa ou diagnóstico.

## Antes da produção

- HTTPS válido;
- backup e restauração testados;
- contas administrativas individuais;
- permissões homologadas;
- câmera, GPS e impressão testados nos dispositivos reais;
- logs sem exposição de credenciais;
- tokens temporários revogados.
