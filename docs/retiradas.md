# Retiradas de documentação

Fluxo separado da emissão de protocolos. Uma retirada não consome número de protocolo, não gera etiqueta e não confirma entrega de protocolos existentes.

1. Qualquer usuário autenticado escolhe **Nova solicitação → Nova retirada**, solicita documentos de uma empresa e atribui um responsável pela coleta. O mesmo seletor oferece **Novo protocolo** para todos os perfis.
2. O entregador atribuído registra a coleta realizada. A retirada passa a aguardar conferência no escritório.
3. Legalização ou administrador confere os documentos que chegaram: recebidos com data e competência (mês/ano), faltantes com justificativa e documentos adicionais que vieram junto.

O acesso ao histórico fica em **Acompanhar retiradas** na barra lateral. **Nova solicitação** oferece apenas **Novo protocolo** e **Nova retirada**. As listas internas **Em andamento** e **Conferidas** usam cartões compactos, agrupados por empresa, com busca por nome ou box. Clique para abrir documentos e detalhes. O resumo diferencia documentos conforme solicitado de faltantes/adicionais. Preserva a lista solicitada, a lista conferida, os responsáveis e os horários registrados pelo servidor. A data informada do recebimento e a competência ficam por documento; o horário da conferência é registrado automaticamente. Conferências concluídas não podem ser sobrescritas.

## Permissões e configuração

- Hiperion: ativo por padrão, sem chave para desativação.
- Protovia: inicialmente desligado. Administrador ativa em **Configurações de entrega → Ativar módulo de retiradas**. A alteração é salva ao marcar a opção. Desativar não apaga o histórico; reativar restaura o acesso.
- Legalização e administradores: consulta de todas as retiradas e conferência no escritório.
- Todos os perfis: criação e consulta das próprias solicitações.
- Entregador: consulta também retiradas atribuídas à própria conta e registra sua coleta. Não pode fazer a conferência final.
- Administrador pode registrar coleta excepcionalmente em nome da operação; o responsável atribuído permanece no registro, junto de quem efetivamente registrou a coleta.

As permissões são verificadas no servidor, não apenas no menu. As transições usam atualização condicional de estado para impedir dupla coleta ou sobrescrita simultânea de conferência.

## Operação

O módulo precisa de conexão com o servidor. Não usa a fila offline dos protocolos, nem dispara e-mails de entrega. Cadastros inativos não podem ser selecionados para novas retiradas. Os nomes são preservados na solicitação mesmo se o cadastro for alterado posteriormente.

O pop-up de empresa pesquisa nome/box e mostra endereço. Novas retiradas preservam esses dados do cadastro. Registros antigos não recebem localização ou dados retroativos inventados.

A coleta segue a configuração administrativa de GPS: desligado, obrigatório ou ausência justificada. Não exige QR de protocolo. O GPS é pontual, mediante permissão do navegador; coordenadas e precisão são visíveis apenas ao administrador. Os demais participantes veem somente a situação do GPS e eventual justificativa. Coordenadas não comprovam presença de forma absoluta.

Protocolos já entregues ficam fora de **Solicitações**, inclusive na pesquisa numérica. Permanecem em **Protocolos entregues**, com exclusão recuperável para administradores e impressão de etiquetas por seleção.

Tabelas aditivas: `retiradas` e `retirada_opcoes`; sem alterações destrutivas nas tabelas existentes. SQLite cria as tabelas na inicialização e Turso na primeira chamada do módulo. Incluir essas tabelas nos backups completos do banco.

Validação: `node --test tests/pickups.test.cjs tests/delivery-settings.test.cjs`.
