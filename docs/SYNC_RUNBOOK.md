# Sincronização Listo360 e Supabase

O Painel Higiene não precisa de outro banco depois da renovação da franquia, desde que
a organização Supabase volte a atender requisições. O build sozinho NÃO prova que
o Supabase está operacional.

## Antes da próxima sincronização (obrigatório)

No Cloudflare Workers, configure como **segredos criptografados** (não em `wrangler.jsonc`):

- `LISTO360_EMAIL`: conta autorizada para a API Listo360
- `LISTO360_PASSWORD`: **nova** senha da conta Listo360 (a anterior foi
  exposta no histórico do repositório e deve ser rotacionada)
- `SUPABASE_SERVICE_ROLE_KEY`: chave de acesso de serviço do projeto Supabase
- `SYNC_CRON_SECRET`: valor longo e aleatório, compartilhado apenas com o agendador

Os valores públicos `SUPABASE_URL`, `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY` continuam definidos na configuração pública.
Uma chave publicável NÃO substitui `SUPABASE_SERVICE_ROLE_KEY`.

A senha antiga continua presente em commits anteriores: removê-la do código
atual não a revoga. É obrigatório alterar a senha no Listo360.

## No cronjob.org

- URL: `https://painelhigienehsl.williamx2k20x.workers.dev/api/public/hooks/sync-listo360`
- Método: GET ou POST
- Cabeçalho HTTP: `X-Cron-Secret: <mesmo valor de SYNC_CRON_SECRET>`

A proteção do endpoint é ativada assim que `SYNC_CRON_SECRET` existir no
ambiente do Worker. Sem esse segredo, a rota mantém temporariamente a
compatibilidade com o cron atual e continua pública. Não deixe sem segredo.

## Validação após a liberação do Supabase

1. Confirme que as quatro variáveis secretas estão configuradas no ambiente
   do Worker. O app depende delas para executar o cron.
2. Execute uma única vez o agendamento e confira `ok: true` na resposta.
3. Verifique `leitos_alterados`, `leitos_inalterados`,
   `colaboradores_novos` e `removidos_orfaos`. Em execução sem novidades,
   `leitos_alterados` deve chegar a zero.
4. Acompanhe Realtime Messages e Egress no painel Supabase durante o turno.
5. Se o serviço retornar 402, a organização ainda está restrita: aguarde a
   liberação ou consulte o suporte/upgrade. O código não contorna a quota.

## Salvaguardas implementadas

- Leitos são gravados somente quando o conjunto de campos mudou.
- Colaboradores novos são inseridos uma vez; status só muda quando necessário.
- Datas de origem ausentes reutilizam o horário conhecido quando possível.
- Se a fonte voltar sem leitos relevantes, não excluímos todos os registros.
- Paginação completa e erros de leitura/escrita falham sem continuar limpando
  registros de forma destrutiva.
- O histórico de última Alta e as cores/visuais da TV não foram modificados.

**Observação:** não há garantia de que Realtime ou transferência de dados caiam
a zero. Mensagens referentes a mudanças reais continuam sendo necessárias.
