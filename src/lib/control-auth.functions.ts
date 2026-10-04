import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { z } from "zod";

type ControlSession = { authenticated?: boolean };

function sessionConfig() {
  const password = process.env.CONTROL_SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("CONTROL_SESSION_SECRET deve ter pelo menos 32 caracteres.");
  }
  return {
    name: "painel-control",
    password,
    maxAge: 12 * 60 * 60,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function controlPassword(): string {
  const value = process.env.CONTROL_PASSWORD;
  if (!value) throw new Error("CONTROL_PASSWORD não configurada.");
  return value;
}

export const getControlAuth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const session = await useSession<ControlSession>(sessionConfig());
    return {
      configured: true,
      authenticated: session.data.authenticated === true,
    };
  } catch {
    return { configured: false, authenticated: false };
  }
});

export const loginControl = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ password: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data }) => {
    if (data.password !== controlPassword()) {
      return { ok: false as const, error: "Senha inválida." };
    }
    const session = await useSession<ControlSession>(sessionConfig());
    await session.update({ authenticated: true });
    return { ok: true as const };
  });

export const logoutControl = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<ControlSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});

export const requireControlAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await useSession<ControlSession>(sessionConfig());
  if (session.data.authenticated !== true) {
    throw new Error("Unauthorized: acesso de operador necessário.");
  }
  return next();
});
