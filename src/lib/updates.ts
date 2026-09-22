/**
 * Lista de atualizações recentes, mostrada num popup resumido quando alguém
 * entra no painel. Pra anunciar uma atualização nova: muda VERSION (qualquer
 * texto novo já serve, tipo a data de hoje) e atualiza os itens de ITEMS.
 * Enquanto VERSION não mudar, o popup já visto não aparece de novo (fica
 * guardado no navegador de cada dispositivo).
 */
export const UPDATES_VERSION = "2026-09-22";

export const UPDATES_ITEMS: string[] = [
  "Altas Paradas: resumo por bloco (D/E, B, C) direto no painel",
  "Média p/ Iniciar corrigida (não mostra mais tempos absurdos)",
  "Altas concluídas: contador mais preciso, sem contar 9C/5B",
  "Diária: horário em cima do leito, andar reto, barra de progresso e toque pra ver quem fez",
  "Terminal Geral: reorganizado por bloco/andar, com só 3 status (andamento, pendente, concluída)",
  "Carrossel automático de volta na Diária e no Terminal Geral",
];
