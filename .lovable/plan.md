## O que está errado

1. **Tempo sempre "3h"** — o Listo devolve `startTime`/`endTime` em horário local de Brasília (UTC−3) sem timezone (`"2026-07-15T09:00:00"`). Nosso código passa isso direto para `new Date(...)`, que interpreta como UTC. Resultado: todo horário fica 3h "no passado". Precisa normalizar como BRT (append `-03:00` quando não tiver timezone).

2. **Swap Altas Paradas ↔ Concluídas c/ Pendência** — a regra correta é a mesma origem (`statusAnswer` "Pendente" no Listo), separado por `endTime`:
   - `endTime IS NULL` → **Altas Paradas** (aparece na aba Rotinas Pendentes, ainda aberta)
   - `endTime NOT NULL` → **Concluídas c/ Pendência** (foi encerrada com pendência)

   Hoje o `mapStatus` faz `id=7 && hasEnd → "completed"` (genérico), então itens que deveriam ser "concluída com pendência" caem em "completed" e somem do painel. E `id=4` está sendo tratado como o único caminho para `completed_with_issues`, o que provavelmente não bate com o id real do Listo para "Pendente".

3. **Auto-scroll parado** — o `AutoScroll` mede a altura do conteúdo no mount, mas quando a tabela cresce depois (dados chegam via realtime), o `ResizeObserver` observa apenas os filhos diretos existentes no momento; o `<table>` interno cresce sem disparar. Além disso, `scrollTop += 0.4` é arredondado para 0 pelo browser quando o container tem `overflow-hidden` estrito em alguns casos.

4. **`status_updated_at` reescrito pelo trigger** — a trigger `touch_status_updated_at` sobrescreve o valor que mandamos no upsert quando o status muda, então o "tempo" no painel vira "quando o sync rodou", não "quando a rotina começou/terminou no Listo". Para o painel refletir tempo real do Listo, precisamos usar o `startTime`/`endTime` do Listo direto — guardar num campo próprio ou ignorar a trigger para linhas do Listo.

## Plano

### 1. `sync-listo360.ts` — parsing de data e mapeamento de status

- Adicionar helper `parseBRT(s)`: se a string não tem `Z` nem `±HH:MM`, concatenar `-03:00` antes do `new Date`.
- Reescrever `mapStatus(a)` para tratar "Pendente" como a chave e separar por `endTime`:
  ```
  id 7 (Pendente):        endTime? "completed_with_issues" : "paused"
  id 4 (também pendente): mesmo tratamento (fallback)
  id 2 (Em Andamento):    endTime? "completed" : "in_progress"
  id 1:                   "waiting_cleaning"
  id 5:                   "maintenance"
  id 3, 6, default:       endTime? "completed" : "waiting_cleaning"
  ```
- `status_updated_at` = `parseBRT(endTime ?? startTime ?? date).toISOString()`.

### 2. Migration — desativar o trigger para linhas do Listo

Duas opções, vou pela mais simples: alterar `touch_status_updated_at` para **não** mexer quando `NEW.external_id LIKE 'listo:%'` (o sync já manda o timestamp certo). Assim linhas manuais (do `/control`) continuam com o comportamento atual.

Também vou fazer um `UPDATE` pontual para recomputar `status_updated_at` das linhas Listo existentes com base no que estiver no banco (não temos os timestamps originais, mas o próximo sync corrige — o UPDATE só zera o "3h fixo" atual pondo `now()` como placeholder, opcional).

### 3. `/tv` — auto-scroll robusto

- Trocar a heurística por `MutationObserver` na subtree (observa qualquer mudança de conteúdo, inclusive linhas novas dentro do `<table>`).
- Trocar `scrollTop += 0.4` por acumulador em `ref` (float) e aplicar `Math.floor` — evita perda de sub-pixel.
- Recalcular `needsScroll` sempre que o conteúdo mudar; se voltar a caber, parar a animação.

### 4. Verificação

- Após deploy, rodar 1 ciclo do sync (ou chamar o endpoint manualmente) e checar no banco:
  ```sql
  select external_id, bed_number, status, status_updated_at, pause_reason
  from discharges
  where external_id like 'listo:answer:%'
    and status in ('paused','completed_with_issues')
  order by status_updated_at desc;
  ```
- No `/tv`: **Altas Paradas** só com rotinas terminais sem `endTime`; **Concluídas c/ Pendência** com as que têm `endTime` nas últimas 24h; tempos batendo com o horário de Brasília; scroll rolando quando a lista passa da altura visível.

## Arquivos alterados

- `src/routes/api/public/hooks/sync-listo360.ts` — `parseBRT`, novo `mapStatus`, `status_updated_at` a partir do horário do Listo.
- `supabase/migrations/<novo>.sql` — atualiza `touch_status_updated_at` para ignorar `external_id LIKE 'listo:%'`.
- `src/routes/tv.tsx` — `AutoScroll` com `MutationObserver` + acumulador float.
