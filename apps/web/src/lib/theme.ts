export type ColorPalette = "emerald" | "blue" | "purple" | "rose" | "amber";

export const colorPalettes: Record<ColorPalette, { primary: string; name: string }> = {
  emerald: { primary: "47 111 115", name: "Emerald" },
  blue: { primary: "37 99 235", name: "Ocean" },
  purple: { primary: "124 58 237", name: "Royal" },
  rose: { primary: "225 29 72", name: "Crimson" },
  amber: { primary: "217 119 6", name: "Sunset" },
};

export function applyColorPalette(palette: ColorPalette) {
  const root = document.documentElement;
  const colors = colorPalettes[palette];
  root.style.setProperty("--primary", colors.primary);
  root.style.setProperty("--ring", colors.primary);
}

export function getStoredTheme(): "light" | "dark" | null {
  return localStorage.getItem("chess-club-theme") as "light" | "dark" | null;
}

export function setStoredTheme(theme: "light" | "dark") {
  localStorage.setItem("chess-club-theme", theme);
}

export function getStoredColorPalette(): ColorPalette | null {
  return localStorage.getItem("chess-club-color-palette") as ColorPalette | null;
}

export function setStoredColorPalette(palette: ColorPalette) {
  localStorage.setItem("chess-club-color-palette", palette);
}

export function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
