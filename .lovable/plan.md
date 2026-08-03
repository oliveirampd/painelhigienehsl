# Separar claramente "Colaboradores" (Listo) e "Time Altas" (healthcon)

Entendido: são **dois times diferentes** com fontes diferentes. A sobreposição não é a mesma pessoa duplicada — é o mesmo *rótulo de status* aparecendo nos dois painéis, o que dá a impressão de tabelas iguais.

## O que muda

Mantemos os dois painéis, mas com papéis bem definidos:

**Colaboradores (Listo)** — quem executa a limpeza terminal e a desmontagem
- Mostra apenas quem está **ativo agora**: `EM ALTA`, `A CAMINHO`, `DESMONTANDO`, com leito e tempo.
- **Nunca** mostra `DESLOGOU`, `CAFÉ`, `ALMOÇO`, `JANTAR` — esses estados não vêm do Listo.
- Subtítulo: "Higienização terminal e desmontagem — Listo".

**Time Altas (healthcon)** — o time de campo das altas
- Mostra o time inteiro logado, incluindo `DESLOGOU`, `CAFÉ`, `ALMOÇO`, `JANTAR`, `SEM ALTA`.
- Continua priorizando o que o Listo mostra (`EM ALTA` / `A CAMINHO` / `DESMONTANDO`) quando a pessoa está de fato trabalhando, para não virar "deslogou" por engano.
- `DESLOGOU` é **exclusivo deste painel**.
- Subtítulo: "Login e pausas do time de altas — healthcon".

## Diferenciação visual (para não parecerem a mesma tabela)

- Cada painel ganha uma **cor de borda/etiqueta de origem** distinta e um badge pequeno no cabeçalho: `LISTO` e `HEALTHCON`.
- Colaboradores usa layout com **leito em destaque** (número grande à esquerda); Time Altas usa layout de **nome + estado**, sem coluna de leito.
- Os rótulos compartilhados (`EM ALTA`, `A CAMINHO`, `DESMONTANDO`) usam a mesma cor nos dois painéis, mantendo a leitura consistente.

## Se depois você quiser juntar em um painel só

Fica registrado o critério: painel único "Equipe" com duas seções internas rotuladas por origem — bloco **Listo (execução)** em cima e bloco **Time Altas (healthcon)** embaixo, e `DESLOGOU` só pode aparecer no bloco do Time Altas. Não fazemos isso agora.

## Detalhes técnicos

- `src/routes/tv.tsx`:
  - `staffRows` (Listo) permanece filtrando apenas `desmontando` / `em_alta`; adicionar `a_caminho` para ficar completo.
  - `timeAltasRows` (healthcon) permanece como está, incluindo `deslogou`.
  - Garantir por tipo que `StaffPanel` não aceite os estados de pausa/deslogou (tipo `StaffActivity` restrito), e que `deslogou` só exista em `TimeAltasKind`.
  - Adicionar badge de origem e ajustar o layout de linha de cada painel.
- KPI "Colaboradores Ativos" continua contando a lista do Listo (execução real).
- Nenhuma mudança de banco, de sync ou de segurança.
