import { useClub } from "../../contexts/club-context.js";
import { CreateClubDialog } from "./create-club-dialog.js";

export function GlobalCreateClubDialog() {
  const { createClubDialogOpen, setCreateClubDialogOpen } = useClub();
  return (
    <CreateClubDialog
      open={createClubDialogOpen}
      onOpenChange={setCreateClubDialogOpen}
    />
  );
}
