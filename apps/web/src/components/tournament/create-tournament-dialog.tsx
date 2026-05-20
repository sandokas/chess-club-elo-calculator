import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Loader2 } from "lucide-react";

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
import { tournamentCreateSchema, type TournamentCreateInput } from "../../lib/schemas";
import { getCurrentDateTime } from "../../lib/date-utils";

const apiBaseUrl = "/api";

interface CreateTournamentDialogProps {
  clubId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (tournamentId: string) => void;
}

export function CreateTournamentDialog({ clubId, open, onOpenChange, onCreated }: CreateTournamentDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TournamentCreateInput>({
    resolver: zodResolver(tournamentCreateSchema),
    defaultValues: {
      name: "",
      format: "swiss",
      startsOn: "",
      totalRounds: undefined,
      pairingMethod: "seeded_by_rating",
    },
  });

  const onSubmit = async (data: TournamentCreateInput) => {
    setIsSubmitting(true);
    try {
      // If no start date is provided, use current date/time
      const submissionData = {
        ...data,
        startsOn: data.startsOn || getCurrentDateTime(),
      };

      const response = await fetch(`${apiBaseUrl}/clubs/${clubId}/tournaments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submissionData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(error.message || `API responded with ${response.status}`);
      }

      const result = await response.json();
      toast({
        title: "Tournament created",
        description: "Tournament has been created successfully.",
      });
      onOpenChange(false);
      onCreated(result.tournament.id);
      form.reset();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create tournament",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Tournament</DialogTitle>
          <DialogDescription>
            Create a new tournament. Configure the settings and add players after creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              disabled={isSubmitting}
              placeholder="Tournament name"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <select
              id="format"
              {...form.register("format")}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="swiss">Swiss</option>
              <option value="manual">Manual</option>
            </select>
            {form.formState.errors.format && (
              <p className="text-sm text-destructive">{form.formState.errors.format.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="startsOn">Start Date</Label>
            <Input
              id="startsOn"
              type="datetime-local"
              {...form.register("startsOn")}
              disabled={isSubmitting}
            />
            {form.formState.errors.startsOn && (
              <p className="text-sm text-destructive">{form.formState.errors.startsOn.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalRounds">Total Rounds (optional)</Label>
            <Input
              id="totalRounds"
              type="number"
              min="1"
              max="50"
              {...form.register("totalRounds", { 
                setValueAs: (v) => v === "" ? undefined : Number(v)
              })}
              disabled={isSubmitting}
              placeholder="Auto-suggested based on players"
            />
            {form.formState.errors.totalRounds && (
              <p className="text-sm text-destructive">{form.formState.errors.totalRounds.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pairingMethod">Pairing Method</Label>
            <select
              id="pairingMethod"
              {...form.register("pairingMethod")}
              disabled={isSubmitting}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="seeded_by_rating">Seeded by Rating</option>
              <option value="random">Random</option>
            </select>
            {form.formState.errors.pairingMethod && (
              <p className="text-sm text-destructive">{form.formState.errors.pairingMethod.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
