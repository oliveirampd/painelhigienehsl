import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** App metadata is assigned by an administrator, unlike user metadata. */
export async function assertOperator(): Promise<void> {
  const header = getRequest().headers.get("authorization");
  const token = /^Bearer\s+([^\s]+)$/i.exec(header ?? "")?.[1];
  if (!token) throw new Error("Operador não autenticado.");

  // getUser checks the Auth server, including the current app_metadata.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) {
    throw new Error("Sessão do operador inválida.");
  }
  const role = data.user.app_metadata?.painel_role;
  if (role !== "operator" && role !== "admin") {
    throw new Error("Usuário sem permissão de operador.");
  }
}
