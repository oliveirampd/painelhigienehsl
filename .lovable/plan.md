# Deixar as 6 melhorias da TV bem mais visíveis

As funcionalidades já existem, mas estão em fonte 9-11px e cinza translúcido — de longe simplesmente não aparecem. O objetivo é dar peso visual a cada uma sem ocupar mais espaço na tela.

## 1. Tendência nos KPIs
Hoje: seta de 9px cinza colada no rótulo.
- Seta + número em **pílula própria** com fundo colorido (vermelho quando piorou, verde quando melhorou), fonte 14-18px, colada no número grande do KPI.
- Seta em formato cheio (▲ / ▼) em vez de ↑ / ↓, mais legível a distância.
- Quando um KPI "ruim" sobe, o card inteiro ganha um anel de alerta pulsando suavemente.
- Legenda "vs 1h" microscópica só como apoio.

## 2. Destaque do pior caso
Hoje: um ⚠ pequeno na célula do leito.
- A linha inteira ganha **borda esquerda grossa vermelha** + fundo vermelho mais forte + pulso já existente.
- Badge "ATENÇÃO MÁXIMA" em pílula vermelha sólida com texto branco, visível também em telas pequenas (não mais `hidden lg:inline`).
- O número do leito nessa linha fica maior e em negrito.

## 3. Feed de atividade recente
Hoje: faixa cinza de 10px, quase invisível.
- Faixa com **fundo próprio levemente esverdeado** e altura maior.
- Cada item vira um **chip** com ícone de check verde: "LEITO 820 · 2min".
- Rótulo "ATIVIDADE RECENTE" em verde, não em branco 25%.
- Item mais novo entra com animação de fade/slide para dar sensação de vivo.

## 4. Modo noturno automático
Hoje: só escurece, sem sinalizar.
- Continua escurecendo, mas com **indicador no cabeçalho**: pílula "MODO NOTURNO" com ícone de lua.
- Brilho ajustado de 0.72 para ~0.80 (escuro demais dificultava a leitura) e leve redução de saturação.

## 5. Meta / benchmark
Hoje: "meta: até 15min" em 10px cinza.
- Vira **pílula ao lado do título do painel**: "META 15MIN" — verde quando tudo dentro, vermelha pulsando quando algo estourou.
- Adicionar contagem: "2 fora da meta" quando houver estouro.
- Aplicar também em "Leitos em Limpeza Terminal" (meta 60min) para consistência.

## 6. Resumo do dia no rodapé
Hoje: linha de 11px cinza centralizada.
- Rodapé com **altura maior e fundo próprio**, números em fonte grande (Bebas Neue, mesma dos KPIs) com rótulos pequenos embaixo — formato "placar": `38 ALTAS CONCLUÍDAS` · `42min TEMPO MÉDIO`.
- Números em cor de destaque, não branco 70%.

## Também nesta passada
- Contadores de itens nos cabeçalhos dos painéis (hoje 11px branco 50%) viram pílulas legíveis.
- Corrigir o erro de hidratação no rodapé do resumo do dia (o valor é calculado no cliente e difere do servidor).

## Detalhes técnicos
Tudo em `src/routes/tv.tsx` (`KpiCard`, `BedsPanel`, `ActivityFeed`, `DaySummaryFooter`, cabeçalho) mais 2-3 keyframes novos em `src/styles.css` (anel de alerta, entrada do chip de atividade). Sem mudança de dados, sync ou banco.
