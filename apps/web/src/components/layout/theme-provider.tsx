import { createContext, useContext, useEffect, useState } from "react";
import type { ColorPalette } from "@/lib/theme.js";
import {
  applyColorPalette,
  getStoredColorPalette,
  getStoredTheme,
  getSystemTheme,
  setStoredColorPalette,
  setStoredTheme,
} from "@/lib/theme.js";

type Theme = "light" | "dark";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  defaultColorPalette?: ColorPalette;
  colorPaletteStorageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorPalette: ColorPalette;
  setColorPalette: (palette: ColorPalette) => void;
};

const initialState: ThemeProviderState = {
  theme: "light",
  setTheme: () => null,
  colorPalette: "emerald",
  setColorPalette: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "chess-club-theme",
  defaultColorPalette = "emerald",
  colorPaletteStorageKey = "chess-club-color-palette",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => getStoredTheme() || defaultTheme
  );
  const [colorPalette, setColorPaletteState] = useState<ColorPalette>(
    () => getStoredColorPalette() || defaultColorPalette
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme) {
      root.classList.add(theme);
      setStoredTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyColorPalette(colorPalette);
    setStoredColorPalette(colorPalette);
  }, [colorPalette]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      setThemeState(theme);
    },
    colorPalette,
    setColorPalette: (palette: ColorPalette) => {
      setColorPaletteState(palette);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
