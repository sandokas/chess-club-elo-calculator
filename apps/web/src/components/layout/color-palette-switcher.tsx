import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useTheme } from "./theme-provider.js";
import { colorPalettes, type ColorPalette } from "@/lib/theme.js";

export function ColorPaletteSwitcher() {
  const { colorPalette, setColorPalette } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Palette className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Change color palette</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(colorPalettes).map(([key, palette]) => (
          <DropdownMenuItem
            key={key}
            onClick={() => setColorPalette(key as ColorPalette)}
            className="flex items-center gap-2"
          >
            <div
              className="h-4 w-4 rounded-full border"
              style={{
                backgroundColor: `rgb(${palette.primary})`,
              }}
            />
            {palette.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
