import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useOperatorAccess() {
  const [state, setState] = useState<"loading" | "operator" | "signed_out" | "forbidden">("loading");
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error || !data.user) setState("signed_out");
      else setState(["operator", "admin"].includes(String(data.user.app_metadata?.painel_role))
        ? "operator" : "forbidden");
    };
    void check();
    const { data: listener } = supabase.auth.onAuthStateChange(() => { setTimeout(() => void check(), 0); });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);
  return state;
}

export function OperatorGate({ children }: { children: ReactNode }) {
  const state = useOperatorAccess();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (state === "operator") return <>{children}</>;
  if (state === "loading") return <p className="p-6 text-sm">Verificando acesso do operador…</p>;

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError("Não foi possível entrar. Confira suas credenciais.");
    setSubmitting(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <form onSubmit={(event) => void signIn(event)} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5">
        <h1 className="text-xl font-semibold">Acesso do operador</h1>
        <p className="text-sm text-muted-foreground">Entre com a conta autorizada para alterar o painel.</p>
        {state === "forbidden" && <p role="alert" className="text-sm text-destructive">Esta conta não tem permissão de operador.</p>}
        <label className="block text-sm">E-mail
          <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" />
        </label>
        <label className="block text-sm">Senha
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button disabled={submitting} className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground disabled:opacity-50">Entrar</button>
          {state === "forbidden" && <button type="button" onClick={() => void supabase.auth.signOut()}
            className="min-h-11 rounded-md border border-border px-4">Sair da conta atual</button>}
          <a href="/tv" className="inline-flex min-h-11 items-center rounded-md border border-border px-4">Ver painel</a>
        </div>
      </form>
    </main>
  );
}
