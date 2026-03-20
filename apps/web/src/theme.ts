import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { createElement } from "react";

export type ThemeName = "standard" | "wh40k";

const STORAGE_KEY = "openclaw-theme";

type ThemeContextValue = {
  theme: ThemeName;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "standard",
  toggle: () => {},
});

function readStoredTheme(): ThemeName {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "wh40k") return "wh40k";
  } catch {
    // localStorage unavailable
  }
  return "standard";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(readStoredTheme);

  useEffect(() => {
    if (theme === "wh40k") {
      document.body.classList.add("theme-40k");
    } else {
      document.body.classList.remove("theme-40k");
    }

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "standard" ? "wh40k" : "standard"));
  }, []);

  return createElement(ThemeContext.Provider, { value: { theme, toggle } }, children);
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
