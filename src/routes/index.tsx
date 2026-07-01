import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel de Higienização Terminal" },
      { name: "description", content: "Sistema de operações para higienização terminal de leitos hospitalares." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-xl w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Higienização Terminal</h1>
          <p className="mt-2 text-muted-foreground">
            Sistema de controle de altas e limpeza de leitos hospitalares.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link
            to="/control"
            className="rounded-xl border border-border bg-card p-6 text-left hover:border-primary transition-colors"
          >
            <div className="text-lg font-semibold">Painel de Controle</div>
            <p className="text-sm text-muted-foreground mt-1">
              Para o operador. Atribuir equipe, atualizar status, gerenciar pausas.
            </p>
          </Link>
          <Link
            to="/tv"
            className="rounded-xl border border-border bg-card p-6 text-left hover:border-primary transition-colors"
          >
            <div className="text-lg font-semibold">Painel TV</div>
            <p className="text-sm text-muted-foreground mt-1">
              Exibição em tela cheia para monitor. Somente leitura.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
