# Melhorias propostas — Painel de Higienização Terminal

## O que está bom hoje
- Sincronização em tempo real via Supabase Realtime funciona.
- TV já tem KPIs, auto-scroll, modo noturno, flash de status e resumo do dia.
- Integração Listo360 está ativa e mapeia leitos/unidades corretamente.
- Segurança básica foi aplicada (secret no sync, RLS restrito, server functions no control).

## Onde podemos ir além

### 1. Layout da TV (visibilidade a distância)
Problema: a TV usa muitas seções pequenas, fontes finas e tabelas densas. De longe (corredor de hospital) fica difícil de ler.

Ideias:
- **Layout "Quadro de Operações"**: cabeçalho gigante com apenas 4 blocos (Em Limpeza, A Caminho, Altas Paradas, Leitos Pausados). Cada bloco vira um card de grade com número do leito em fonte grande, colaborador e tempo abaixo. Nada de tabelas — só cards quadrados.
- **Layout "Trilha de Leitos"**: uma única coluna horizontal (estilo linha do tempo) mostrando cada leito como um card de status. Ótimo para TVs acima do corredor.
- **Layout "Números Grandes"**: oculta listas e mostra só KPIs em tamanho enorme (tipo painel de fábrica), com um alerta piscando para o leito mais crítico.
- Adicionar **pictogramas de status** (ícones grandes de "limpo", "alerta", "pausa") ao lado de cada leito.
- Usar **cores mais saturadas** para status críticos e garantir contraste WCAG AAA para leitura à distância.
- Separar visualmente "Colaboradores" e "Time Altas" em abas ou mini-painéis menos dominantes.

### 2. Controle operador (usabilidade)
Problema: o formulário mistura criação e atualização, o que confunde. A lista de altas ativas cresce sem filtros.

Ideias:
- Dividir a tela em **"Nova Alta"** e **"Altas Ativas"** com ações contextuais por leito.
- Adicionar busca/filtro por leito, unidade ou colaborador.
- Botão de **"Atribuir a mim"** com login rápido do colaborador (QR code ou seleção).
- Campos de leito e unidade com **autocomplete** baseado nos últimos valores usados.
- Confirmação antes de concluir uma alta (evita clique acidental).
- Painel de **últimas ações** (log de quem alterou o quê e quando).

### 3. Alertas e notificações
- Som de alerta quando um leito passa de 30 min ou 60 min.
- Notificação visual/flutuante no Control quando um novo leito entra em alta.
- Badge no browser/tab com número de leitos críticos.
- Email/alerta para supervisor quando muitas altas ficam paradas (configurável).

### 4. Dados e histórico
- Gráfico de tempo médio por turno (manhã/tarde/noite) na TV.
- Ranking de colaboradores por tempo médio de conclusão.
- Histórico de conclusões do dia (não só contagem e média).
- Exportar CSV do dia para gestão.
- Filtro de "minhas altas" para cada colaborador logado.

### 5. Robustez e integração
- Tratar fusos horários de forma explícita (BRT/UTC) na integração Listo360.
- Página de status da integração (último sync, erros, quantidade de registros).
- Fallback quando o sync falhar: mostrar aviso "dados desatualizados" na TV.
- Validação de duplicatas (evitar duas altas ativas para o mesmo leito).

### 6. Login e acesso
- Tela de login simples para operadores (não expor o Control anonimamente).
- Perfis: operador, supervisor, TV (somente leitura).
- Log de auditoria de alterações no banco.

### 7. Acessibilidade e performance
- Aumentar contraste geral na TV.
- Reduzir re-renderizações desnecessárias (memoização do grid).
- Testar em viewport de TV 1920x1080 e 4K.
- Suporte a modo retrato para monitores verticais.

## Próximo passo sugerido
Recomendo começar pelo **redesign do layout da TV**, pois é o que todo mundo olha o dia todo. Podemos propor 3 direções visuais diferentes para você escolher.

## Decisões pendentes
1. Qual layout de TV você prefere testar primeiro? (Quadro de Operações, Trilha de Leitos, Números Grandes ou manter/refinar o atual?)
2. Quer adicionar sons de alerta na TV e/ou no Control?
3. Quer login de operadores agora ou depois?
4. Quer incluir ranking de colaboradores e gráficos de desempenho na TV?
