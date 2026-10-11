import { useEffect, useState } from "react";

export type PanelTheme = "hospital" | "midnight" | "emerald" | "burgundy" | "slate";

const STORAGE_KEY = "painel:visual-theme";
const LEGACY_STORAGE_KEY = "painel:theme";

// Preserva a escolha quando se navega entre as telas sem remonte visual escuro.
let sessionTheme: PanelTheme | null = null;

function normalizeTheme(value: string | null): PanelTheme | null {
  if (value === "hospital" || value === "midnight" || value === "emerald" ||
      value === "burgundy" || value === "slate") return value;
  if (value === "light") return "hospital";
  if (value === "dark") return "midnight";
  return null;
}

export function usePanelTheme() {
  const [theme, setCurrentTheme] = useState<PanelTheme>(() => sessionTheme ?? "midnight");

  useEffect(() => {
    try {
      const stored =
        normalizeTheme(localStorage.getItem(STORAGE_KEY)) ??
        normalizeTheme(localStorage.getItem(LEGACY_STORAGE_KEY));
      if (stored) {
        sessionTheme = stored;
        setCurrentTheme(stored);
      }
    } catch {
      // Armazenamento pode estar bloqueado; o seletor continua funcionando.
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) return;
      const next = normalizeTheme(event.newValue);
      if (!next) return;
      sessionTheme = next;
      setCurrentTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (next: PanelTheme) => {
    sessionTheme = next;
    setCurrentTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A preferência continua ativa até a página ser recarregada.
    }
  };

  const isDark = theme === "midnight";
  return {
    theme,
    setTheme,
    isDark,
    themeClass: isDark
      ? "dark panel-dark panel-theme-midnight"
      : "panel-light panel-theme-" + theme,
  };
}
