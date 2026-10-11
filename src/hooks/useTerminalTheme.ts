import { useEffect, useState } from "react";

/** Temas exclusivos do Terminal. "original" não aplica cor adicional alguma. */
export type TerminalTheme = "original" | "abyss" | "forest" | "imperial" | "amethyst";

const STORAGE_KEY = "painel:terminal-theme-v2";
let sessionTheme: TerminalTheme | null = null;

function isTerminalTheme(value: unknown): value is TerminalTheme {
  return (
    value === "original" ||
    value === "abyss" ||
    value === "forest" ||
    value === "imperial" ||
    value === "amethyst"
  );
}

export function useTerminalTheme() {
  // Uma chave nova evita reutilizar preferências dos temas antigos que foram rejeitados.
  const [theme, setCurrentTheme] = useState<TerminalTheme>(() => sessionTheme ?? "original");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isTerminalTheme(saved)) {
        sessionTheme = saved;
        setCurrentTheme(saved);
      }
    } catch {
      // O painel continua operando normalmente sem armazenamento local.
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = isTerminalTheme(event.newValue) ? event.newValue : "original";
      sessionTheme = next;
      setCurrentTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (next: TerminalTheme) => {
    sessionTheme = next;
    setCurrentTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A seleção funciona até a próxima atualização mesmo sem storage.
    }
  };

  return {
    theme,
    setTheme,
    // TODOS os temas do Terminal usam a leitura escura original. Somente a
    // decoração de fundo muda, sem ativar as regras claras que alteravam cards.
    isDark: true,
    themeClass: "dark panel-dark terminal-theme-" + theme,
  };
}
