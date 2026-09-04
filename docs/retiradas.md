# Retiradas de documentação

Fluxo separado da emissão de protocolos. Uma retirada não consome número de protocolo, não gera etiqueta e não confirma entrega de protocolos existentes.

1. Legalização ou administrador solicita documentos de uma empresa e atribui um responsável pela coleta.
2. O entregador atribuído registra a coleta realizada. A retirada passa a aguardar conferência no escritório.
3. Legalização ou administrador confere os documentos que chegaram: recebidos com data e competência (mês/ano), faltantes com justificativa e documentos adicionais que vieram junto.

O histórico fica na aba **Retiradas**, agrupado por empresa, com busca pelo nome. Preserva a lista solicitada, a lista conferida, os responsáveis e os horários registrados pelo servidor. A data informada do recebimento e a competência ficam por documento; o horário da conferência é registrado automaticamente. Conferências concluídas não podem ser sobrescritas.

## Permissões e configuração

- Hiperion: ativo por padrão, sem chave para desativação.
- Protovia: inicialmente desligado. Administrador ativa em **Configurações de entrega → Ativar módulo de retiradas**. A alteração é salva ao marcar a opção. Desativar não apaga o histórico; reativar restaura o acesso.
- Legalização e administradores: solicitação, consulta de todas as retiradas e conferência no escritório.
- Entregador: consulta apenas retiradas atribuídas à própria conta e registra sua coleta. Não pode fazer a conferência final.
- Outros emissores: sem acesso ao módulo.
- Administrador pode registrar coleta excepcionalmente em nome da operação; o responsável atribuído permanece no registro.

As permissões são verificadas no servidor, não apenas no menu. As transições usam atualização condicional de estado para impedir dupla coleta ou sobrescrita simultânea de conferência.

## Operação

O módulo precisa de conexão com o servidor. Não usa a fila offline dos protocolos, nem dispara e-mails de entrega. Cadastros inativos não podem ser selecionados para novas retiradas. Os nomes são preservados na solicitação mesmo se o cadastro for alterado posteriormente.

Tabelas aditivas: `retiradas` e `retirada_opcoes`; sem alterações destrutivas nas tabelas existentes. SQLite cria as tabelas na inicialização e Turso na primeira chamada do módulo. Incluir essas tabelas nos backups completos do banco.

Validação: `node --test tests/pickups.test.cjs tests/delivery-settings.test.cjs`.
