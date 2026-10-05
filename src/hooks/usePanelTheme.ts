import { useEffect, useState } from "react";

export type PanelTheme = "dark" | "light";

const STORAGE_KEY = "painel:theme";

export function usePanelTheme() {
  const [theme, setTheme] = useState<PanelTheme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    isDark: theme === "dark",
    themeClass: theme === "dark" ? "dark panel-dark" : "panel-light",
    toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
