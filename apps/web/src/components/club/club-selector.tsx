import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClub } from "@/contexts/club-context.js";

export function ClubSelector() {
  const { club, clubs, setSelectedClubId, setCreateClubDialogOpen } = useClub();
  const [open, setOpen] = useState(false);

  if (!club) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="font-medium">{club.name}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch Club</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clubs.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => {
              setSelectedClubId(c.id);
              setOpen(false);
            }}
            className={c.id === club.id ? "bg-accent" : ""}
          >
            {c.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCreateClubDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create New Club
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
