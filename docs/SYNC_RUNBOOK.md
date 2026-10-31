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

## Agendador atual: Supabase Cron

O agendador oficial do Terminal é o job `listo-terminal-sync` no Supabase Cron.

- Frequência atual: **1 minuto** (`* * * * *`)
- Destino: `POST https://painelhigienehsl.williamx2k20x.workers.dev/api/public/hooks/sync-listo360`
- Extensões: `pg_cron` + `pg_net`
- Timeout HTTP: 35 segundos
- Segredo do scheduler: `terminal_sync_cron_secret`, armazenado no Supabase Vault
- Cabeçalho enviado: `X-Cron-Secret`

O Worker exige `SYNC_CRON_SECRET`. Chamadas sem o segredo correto recebem
`401 Não autorizado`. Isso neutraliza o antigo cronjob.org sem precisar
alterar a lógica do Terminal.

O cronjob.org não é mais o agendador oficial. Se for necessário rollback,
desative o job `listo-terminal-sync` e remova/ajuste temporariamente
`SYNC_CRON_SECRET` no Worker antes de reativar um scheduler externo.

## Validação após a liberação do Supabase

1. Confirme que as quatro variáveis secretas estão configuradas no ambiente
   do Worker e que o Vault contém `terminal_sync_cron_secret`.
2. Confirme que o job `listo-terminal-sync` está ativo e confira `HTTP 200`
   / `ok: true` em `net._http_response`.
3. Verifique `leitos_alterados`, `leitos_inalterados`,
   `colaboradores_novos` e `removidos_orfaos`. Em execução sem novidades,
   `leitos_alterados` deve chegar a zero.
4. Acompanhe Realtime Messages e Egress no painel Supabase durante o turno.
5. Se o serviço retornar 402, a organização ainda está restrita: aguarde a
   liberação ou consulte o suporte/upgrade. O código não contorna a quota.

## Frequência atual

O sincronizador do Terminal continua sendo chamado **uma vez por minuto**, agora
pelo Supabase Cron. A troca de scheduler não aumenta a frequência de consultas ao
Listo360. A etapa de 30 segundos continua separada e só deve ser feita depois de
observar duração, erros e estabilidade em produção.

O histórico do agendamento fica em `cron.job_run_details`. As respostas HTTP
assíncronas do `pg_net` ficam temporariamente em `net._http_response`.

## Salvaguardas implementadas

- Um lock persistido em `sync_runtime_state` impede duas execuções do sync de
  processarem o mesmo estado ao mesmo tempo.
- O token do Listo360 é reaproveitado por até 5 minutos enquanto o isolate do
  Worker permanece aquecido; 401/403 força renovação segura.
- A janela total de chamadas ao Listo tem orçamento de 25 segundos. Uma origem
  lenta não fica pendurada até encostar no próximo ciclo do cron.
- Falhas consecutivas entram em backoff. O cron pode continuar chamando a rota,
  mas o backend pula ciclos enquanto o backoff estiver ativo.
- Leitos são gravados somente quando o conjunto de campos de origem mudou.
- `service_order` é campo exclusivamente manual e nunca entra no payload de
  atualização do Listo, eliminando corrida com edição de OS.
- Colaboradores novos são inseridos uma vez; status só muda quando necessário.
- Datas de origem ausentes reutilizam o horário conhecido quando possível.
- Respostas vazias ou com queda abrupta de volume são tratadas como suspeitas e
  não contam como ausência de leito.
- Um registro precisa faltar em 3 sincronizações e por pelo menos 90 segundos
  antes de ser removido como órfão.
- Paginação completa e erros de leitura/escrita falham sem continuar limpando
  registros de forma destrutiva.
- A resposta do endpoint informa duração total, tempo gasto no Listo, páginas,
  ausências em observação e se a limpeza de órfãos foi pulada.
- `sync_runtime_state` guarda último sucesso, duração, falhas consecutivas,
  backoff e métricas da origem. A tabela tem RLS e não é acessível a
  `anon`/`authenticated`.
- O histórico de última Alta e as cores/visuais da TV não foram modificados.

**Observação:** não há garantia de que Realtime ou transferência de dados caiam
a zero. Mensagens referentes a mudanças reais continuam sendo necessárias.
