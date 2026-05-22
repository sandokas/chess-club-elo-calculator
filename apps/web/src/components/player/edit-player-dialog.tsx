import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Loader2 } from "lucide-react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { useToast } from "../../hooks/use-toast";
import { playerEditSchema, type PlayerEditInput } from "../../lib/schemas";
import { useUpdatePlayer } from "../../lib/hooks/use-players";

type Player = {
  id: string;
  displayName: string;
  active: boolean;
};

interface EditPlayerDialogProps {
  player: Player;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditPlayerDialog({ player, open, onOpenChange, onSaved }: EditPlayerDialogProps) {
  const { toast } = useToast();
  const updatePlayer = useUpdatePlayer(player.id);

  const form = useForm<PlayerEditInput>({
    resolver: zodResolver(playerEditSchema),
    defaultValues: {
      displayName: player.displayName,
      active: player.active,
    },
  });

  const onSubmit = async (data: PlayerEditInput) => {
    updatePlayer.mutate(data, {
      onSuccess: () => {
        toast({
          title: "Player updated",
          description: "Player details have been updated successfully.",
        });
        onOpenChange(false);
        onSaved();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to update player",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Player</DialogTitle>
          <DialogDescription>
            Update player details. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              {...form.register("displayName")}
              disabled={updatePlayer.isPending}
            />
            {form.formState.errors.displayName && (
              <p className="text-sm text-destructive">{form.formState.errors.displayName.message}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="active"
              checked={form.watch("active")}
              onCheckedChange={(checked) => form.setValue("active", checked)}
              disabled={updatePlayer.isPending}
            />
            <Label htmlFor="active" className="cursor-pointer">
              Active
            </Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updatePlayer.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updatePlayer.isPending}>
              {updatePlayer.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Pencil className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
