# Unificar "Colaboradores" e "Time Altas" na TV

Você está certo: hoje as duas tabelas mostram praticamente a mesma coisa.

## O que está duplicado (confirmado no código)

- **Colaboradores** (`StaffPanel`): pessoas vindas do Listo (`listo:user:*`), mostradas **só quando estão ativas** — status `DESMONTANDO` ou `EM ALTA`, com leito e tempo.
- **Time Altas** (`BreaksPanel`): pessoas vindas do healthcon (`painel:staff:*`), mostradas **sempre**, e o status derivado já inclui `EM ALTA`, `A CAMINHO`, `DESMONTANDO` — exatamente os mesmos estados do painel de cima — mais `CAFÉ / ALMOÇO / JANTAR / SEM ALTA / DESLOGOU`.

Ou seja: quem está trabalhando aparece **nas duas listas ao mesmo tempo**, com o mesmo rótulo. A diferença real é só a origem do dado (Listo x healthcon) e a comparação de nomes por primeiro+último nome, que já existe para casar as duas fontes.

Isso também explica ruído: nomes escritos diferente nas duas fontes podem gerar a mesma pessoa duas vezes na tela, e o KPI "Colaboradores Ativos" conta só a lista do Listo.

## Proposta: um único painel "Equipe"

Um painel só, ocupando toda a coluna da direita, com a lista completa do time e o status real de cada um — sem repetição.

```text
EQUIPE                                    12
--------------------------------------------
EM CAMPO (5)
  Hema Oliveira      EM ALTA · 305    12m
  Ana Souza          A CAMINHO · 812   4m
  Carlos Lima        DESMONTANDO · 5A  8m
PAUSAS (2)
  Joao Pedro         ALMOÇO           47m
  Marcia Silva       CAFÉ         24m (!)
DISPONÍVEIS / SEM ALTA (3)
  ...
FORA DE TURNO (2)
  ...
```

Regras:
- Uma pessoa aparece **uma única vez**. A união é feita por `external_id` quando existir e, se não, pela comparação de nome já usada hoje (primeiro + último nome, sem "de/da/dos").
- Prioridade do status: o que o Listo mostra (em alta / a caminho / desmontando) vence o status do healthcon — mesma regra que já existe.
- Quem está em campo mostra **leito + tempo**; quem está em pausa mostra tempo com alerta quando passa do limite; fora de turno fica esmaecido no fim.
- Cabeçalhos de grupo com contagem, para leitura rápida de longe.
- KPI "Colaboradores Ativos" passa a contar em campo a partir dessa lista unificada (número deixa de divergir da tela).

## Alternativa, se preferir manter separado

Manter dois painéis, mas eliminar a sobreposição: "Em Campo" mostra só quem está trabalhando, e "Pausas & Fora de Turno" mostra **apenas** café/almoço/jantar/sem alta/deslogou — nunca quem já aparece em cima.

## Detalhes técnicos

- `src/routes/tv.tsx`: substituir `staffRows` + `timeAltasRows` por um único `teamRows` (união deduplicada + status priorizado + grupo), e trocar `StaffPanel` + `BreaksPanel` por um `TeamPanel` com seções agrupadas e `AutoScroll`.
- Grid da direita passa a ter um único bloco `lg:col-start-9 lg:col-span-4 lg:row-span-4`, removendo a lógica condicional de rows que hoje existe para os dois painéis.
- Nenhuma mudança de banco, de sync do Listo ou de segurança.

## Decisão necessária

Prefere o **painel único "Equipe"** (recomendado) ou manter **dois painéis sem sobreposição**?
