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

O cronjob.org não é mais o agendador oficial. Não remova
`SYNC_CRON_SECRET`: sem ele a rota falha fechada com HTTP 503.

## Validação após a liberação do Supabase

1. Confirme que as quatro variáveis secretas estão configuradas no ambiente
   do Worker e que o Vault contém `terminal_sync_cron_secret`.
2. Confirme que o job `listo-terminal-sync` está ativo e confira `HTTP 200`
   / `ok: true` em `net._http_response`.
3. Verifique `leitos_alterados`, `leitos_inalterados`,
   `colaboradores_novos` e `ausencias_preservadas`. Em execução sem novidades,
   `leitos_alterados` deve chegar a zero e `removidos_orfaos` deve ser zero.
4. Acompanhe Realtime Messages e Egress no painel Supabase durante o turno.
5. Se o serviço retornar 402, a organização ainda está restrita: aguarde a
   liberação ou consulte o suporte/upgrade. O código não contorna a quota.

## Frequência atual

O sincronizador do Terminal continua sendo chamado **uma vez por minuto** pelo
Supabase Cron. Não altere essa cadência sem uma decisão operacional específica.

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
- Ausência na janela consultada não exclui nem conclui registros operacionais.
- Paginação completa e erros de leitura/escrita falham sem continuar limpando
  registros de forma destrutiva.
- A resposta do endpoint informa duração total, tempo gasto no Listo, páginas
  e quantas ausências foram preservadas.
- `sync_runtime_state` guarda último sucesso, duração, falhas consecutivas,
  backoff e métricas da origem. A tabela tem RLS e não é acessível a
  `anon`/`authenticated`.
- O histórico de última Alta e as cores/visuais da TV não foram modificados.

**Observação:** não há garantia de que Realtime ou transferência de dados caiam
a zero. Mensagens referentes a mudanças reais continuam sendo necessárias.

## Acesso de operador

As funções de escrita do Controle exigem uma sessão Supabase Auth válida e
`app_metadata.painel_role` igual a `operator` ou `admin`. Atribua esse campo
somente pela administração do Supabase, nunca por `user_metadata` editável
pelo próprio usuário. A tela `/control` oferece o login. TV e Diária continuam
acessíveis sem login. Na TV, a resolução pública só passa `paused` ou
`maintenance` para `completed_with_issues`; a edição pública de OS só alcança
essas pendências abertas. O upload de previsões continua protegido pelo código
de importação. A proteção CSRF cobre as server functions. Essas ações públicas
não identificam o operador; acompanhe as alterações no banco.

Em 01/11/2026, o Supabase de produção não possuía contas Auth. O Controle não
está em uso e ficará sem acesso de escrita até o cadastro posterior de uma
conta de operador, conforme decisão operacional. Ao retomá-lo, atribua o papel
via administração e teste login, escrita autorizada e recusa de conta sem o
papel.

## Lock do sync

A liberação e a finalização condicionam a atualização a `lock_until` adquirido
pela execução. Uma execução atrasada não deve limpar o lock de outra. O lease
é de 50 segundos; monitore `last_duration_ms` e erros de lock. Se a duração
se aproximar desse limite, revise o lease e a renovação antes de elevar a
carga de trabalho do sync.
