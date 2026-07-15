## Objetivo

Corrigir a seção **Altas Paradas** do painel `/tv` para contabilizar **apenas** leitos que estão simultaneamente:

1. Com `locationName` iniciando por "Leito" (é leito, não área comum)
2. Com `routeName` = "Limpeza Terminal Leitos" (é rotina terminal)
3. Com status **pendente** no Listo (aba Rotinas Pendentes)

Hoje o filtro está pegando qualquer `statusAnswer.id = 7` (paused) do último dia, incluindo respostas antigas já finalizadas ou reabertas, o que infla o contador.

## O que muda

### `src/routes/api/public/hooks/sync-listo360.ts`

- Ajustar `mapStatus`: uma resposta só é considerada `paused` quando o Listo indica pendência real — status pausado **e** `endTime` nulo (rotina em aberto). Se tiver `endTime`, é uma execução já encerrada e vai para `completed`/`completed_with_issues` conforme o id.
- Garantir que só leitos terminais (`isTerminalBed`) entram como discharges do tipo `answer` — já é o caso, mas revalidar que nenhuma linha antiga com prefixo `listo:answer:` de área comum sobreviva (limpeza no banco das entradas cujo `bed_number` não começa com "Leito").
- Adicionar log do total de "pendentes reais" no retorno JSON para diagnóstico.

### `src/routes/tv.tsx`

- Manter o filtro atual (`isTerminal && status === "paused"`), agora confiável porque a origem foi apertada.
- Nenhuma mudança visual.

### Banco (migration curta)

- `DELETE FROM public.discharges WHERE external_id LIKE 'listo:answer:%' AND (bed_number NOT ILIKE 'Leito%');` — remove qualquer resíduo de resposta não-leito de sincronizações antigas.
- `DELETE FROM public.discharges WHERE external_id LIKE 'listo:answer:%' AND status = 'paused' AND status_updated_at < now() - interval '2 days';` — zera pausas antigas que não são mais pendentes reais; o próximo sync (30s) repovoa as legítimas.

## Validação

1. Aguardar 1 ciclo do cron (30s) após deploy.
2. Consultar `discharges` com `status = 'paused' AND external_id LIKE 'listo:answer:%'` — contagem deve bater com o número visível na aba **Rotinas Pendentes** do Listo (filtrando por "Limpeza Terminal Leitos", excluindo unidades 3D/3C/11C/12C/5B).
3. Conferir o painel `/tv` — card "Altas Paradas" e tabela devem refletir o mesmo conjunto.

## Nota

Se o número ainda divergir após o ajuste, o próximo passo é inspecionar 1 resposta específica que aparece indevidamente (comparar payload do Listo com o esperado) para descobrir qual campo distingue "pendente" de "encerrada" no modelo deles — o filtro `endTime IS NULL` cobre o caso mais comum, mas o Listo pode ter uma flag adicional.