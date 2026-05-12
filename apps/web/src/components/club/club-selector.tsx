import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const { club, clubs, setSelectedClubId, setCreateClubDialogOpen } = useClub();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="font-medium">{club ? club.name : "Select Club"}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch Club</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clubs.length === 0 ? (
          <DropdownMenuItem
            onClick={() => {
              setCreateClubDialogOpen(true);
              setOpen(false);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Club
          </DropdownMenuItem>
        ) : (
          clubs.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => {
                setSelectedClubId(c.id);
                setOpen(false);
                navigate("/");
              }}
            >
              {c.name}
            </DropdownMenuItem>
          ))
        )}
        {clubs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setCreateClubDialogOpen(true);
                setOpen(false);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Club
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
