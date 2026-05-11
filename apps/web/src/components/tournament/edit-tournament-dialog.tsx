import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Loader2, AlertCircle, Trash2 } from "lucide-react";

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
import { useToast } from "../../hooks/use-toast";
import { putJson, deleteJson } from "../../lib/api";
import { tournamentEditSchema, type TournamentEditInput } from "../../lib/schemas";

type Tournament = {
  id: string;
  name: string;
  startsOn: string | null;
  status: string;
  pairingMethod?: string;
};

interface EditTournamentDialogProps {
  tournament: Tournament;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditTournamentDialog({ tournament, open, onOpenChange, onSaved }: EditTournamentDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isCompleted = tournament.status === "completed";
  const isDraft = tournament.status === "draft";

  const form = useForm<TournamentEditInput>({
    resolver: zodResolver(tournamentEditSchema),
    defaultValues: {
      name: tournament.name,
      startsOn: tournament.startsOn ? tournament.startsOn.split('T')[0] : "",
      status: tournament.status as "draft" | "active" | "completed",
      pairingMethod: tournament.pairingMethod as "seeded_by_rating" | "random" | undefined,
    },
  });

  const currentStatus = form.watch("status");

  const onSubmit = async (data: TournamentEditInput) => {
    setIsSubmitting(true);
    try {
      await putJson<{ tournament: Tournament }>(`/tournaments/${tournament.id}`, data);
      toast({
        title: "Tournament updated",
        description: "Tournament details have been updated successfully.",
      });
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update tournament",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${tournament.name}"? This action cannot be undone.`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteJson(`/tournaments/${tournament.id}`);
      toast({
        title: "Tournament deleted",
        description: "Tournament has been deleted successfully.",
      });
      onOpenChange(false);
      window.location.href = "/tournaments";
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete tournament",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Tournament</DialogTitle>
          <DialogDescription>
            Update tournament details. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              disabled={isSubmitting || isCompleted}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="startsOn">Start Date</Label>
            <Input
              id="startsOn"
              type="date"
              {...form.register("startsOn")}
              disabled={isSubmitting || isCompleted}
            />
            {form.formState.errors.startsOn && (
              <p className="text-sm text-destructive">{form.formState.errors.startsOn.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              {...form.register("status")}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
            {form.formState.errors.status && (
              <p className="text-sm text-destructive">{form.formState.errors.status.message}</p>
            )}
          </div>
          {!isCompleted && (
            <div className="space-y-2">
              <Label htmlFor="pairingMethod">Pairing Method</Label>
              <select
                id="pairingMethod"
                {...form.register("pairingMethod")}
                disabled={isSubmitting || !isDraft}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="seeded_by_rating">Seeded by Rating</option>
                <option value="random">Random</option>
              </select>
              {form.formState.errors.pairingMethod && (
                <p className="text-sm text-destructive">{form.formState.errors.pairingMethod.message}</p>
              )}
              {!isDraft && (
                <p className="text-xs text-muted-foreground">
                  Pairing method can only be changed while the tournament is in Draft status (before first round is generated).
                </p>
              )}
            </div>
          )}
          {isCompleted && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <p>
                Tournament is completed. Name and start date are locked. Change status to Active to edit details.
              </p>
            </div>
          )}
          <DialogFooter>
            {isDraft && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting || isSubmitting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting || isDeleting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isDeleting}>
              {isSubmitting ? (
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
