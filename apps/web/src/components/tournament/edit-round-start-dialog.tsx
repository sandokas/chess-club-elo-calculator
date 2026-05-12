import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useToast } from "../../hooks/use-toast";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const roundStartSchema = z.object({
  startsOn: z.string().min(1, "Start date and time is required"),
});

type RoundStartInput = z.infer<typeof roundStartSchema>;

interface EditRoundStartDialogProps {
  roundNumber: number;
  tournamentId: string;
  currentStart: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditRoundStartDialog({
  roundNumber,
  tournamentId,
  currentStart,
  open,
  onOpenChange,
  onSaved,
}: EditRoundStartDialogProps) {
  const { toast } = useToast();
  const form = useForm<RoundStartInput>({
    resolver: zodResolver(roundStartSchema),
    defaultValues: {
      startsOn: currentStart ? currentStart.substring(0, 16) : "",
    },
  });

  const onSubmit = async (data: RoundStartInput) => {
    try {
      // Get round ID
      const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}/rounds`);
      if (!response.ok) throw new Error("Failed to fetch rounds");
      const roundsData = await response.json();
      const round = roundsData.rounds.find((r: any) => r.number === roundNumber);
      if (!round) throw new Error("Round not found");

      const updateResponse = await fetch(`${apiBaseUrl}/rounds/${round.id}/starts-on`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsOn: `${data.startsOn}:00Z` }),
      });
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || "Failed to update round start time");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("Failed to update round start:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update round start time",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Round Start Time</DialogTitle>
          <DialogDescription>
            Update the start date and time for Round {roundNumber}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="startsOn">Start Date & Time</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="startsOn"
                  type="datetime-local"
                  {...form.register("startsOn")}
                  className="pl-9"
                />
              </div>
              {form.formState.errors.startsOn && (
                <p className="text-sm text-destructive">{form.formState.errors.startsOn.message}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
