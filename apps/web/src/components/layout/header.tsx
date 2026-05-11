import { Crown } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher.js";
import { ColorPaletteSwitcher } from "./color-palette-switcher.js";

export function Header() {
  return (
    <header className="border-b bg-card">
      <div className="flex h-14 sm:h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary/10">
            <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          </div>
          <h1 className="text-base sm:text-xl font-bold">Chess Club Manager</h1>
        </div>
        <div className="flex items-center gap-1">
          <ColorPaletteSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
