import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

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
import { z } from "zod";
import { apiBaseUrl } from "../../lib/api-base.js";

const createMatchSchema = z.object({
  whitePlayerId: z.string().min(1, "White player is required"),
  blackPlayerId: z.string().min(1, "Black player is required"),
  playedOn: z.string().min(1, "Date is required"),
  roundId: z.string().optional(),
});

type CreateMatchInput = z.infer<typeof createMatchSchema>;

interface Player {
  playerId: string;
  displayName: string;
}

interface Round {
  id: string;
  number: number;
}

interface CreateMatchDialogProps {
  tournamentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateMatchDialog({ tournamentId, open, onOpenChange, onCreated }: CreateMatchDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<CreateMatchInput>({
    resolver: zodResolver(createMatchSchema),
    defaultValues: {
      whitePlayerId: "",
      blackPlayerId: "",
      playedOn: new Date().toISOString().slice(0, 16),
      roundId: "",
    },
  });

  useEffect(() => {
    if (open) {
      loadPlayers();
      loadRounds();
    }
  }, [open, tournamentId]);

  const loadPlayers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}/players`);
      if (!response.ok) throw new Error("Failed to load players");
      const data = await response.json();
      setPlayers(data.players || []);
    } catch (error) {
      console.error("Failed to load players:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRounds = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}/rounds`);
      if (!response.ok) throw new Error("Failed to load rounds");
      const data = await response.json();
      setRounds(data.rounds || []);
    } catch (error) {
      console.error("Failed to load rounds:", error);
    }
  };

  const onSubmit = async (data: CreateMatchInput) => {
    setIsSubmitting(true);
    try {
      const bodyData: any = {
        whitePlayerId: data.whitePlayerId,
        blackPlayerId: data.blackPlayerId,
        playedOn: data.playedOn,
      };

      // Only include roundId if it's not empty
      if (data.roundId && data.roundId.trim() !== "") {
        bodyData.roundId = data.roundId;
      }

      const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}/matches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodyData),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(error.message || `API responded with ${response.status}`);
      }

      toast({
        title: "Match created",
        description: "Match has been created successfully.",
      });
      onOpenChange(false);
      form.reset();
      onCreated();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create match",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const whitePlayerId = form.watch("whitePlayerId");
  const blackPlayerId = form.watch("blackPlayerId");

  const availableBlackPlayers = players.filter(p => p.playerId !== whitePlayerId);
  const availableWhitePlayers = players.filter(p => p.playerId !== blackPlayerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Match</DialogTitle>
          <DialogDescription>
            Manually create a match between two players.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whitePlayerId">White Player</Label>
              <select
                id="whitePlayerId"
                {...form.register("whitePlayerId")}
                disabled={isSubmitting}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select white player</option>
                {availableWhitePlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.displayName}
                  </option>
                ))}
              </select>
              {form.formState.errors.whitePlayerId && (
                <p className="text-sm text-destructive">{form.formState.errors.whitePlayerId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="blackPlayerId">Black Player</Label>
              <select
                id="blackPlayerId"
                {...form.register("blackPlayerId")}
                disabled={isSubmitting}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select black player</option>
                {availableBlackPlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.displayName}
                  </option>
                ))}
              </select>
              {form.formState.errors.blackPlayerId && (
                <p className="text-sm text-destructive">{form.formState.errors.blackPlayerId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="playedOn">Date Played</Label>
              <Input
                id="playedOn"
                type="datetime-local"
                {...form.register("playedOn")}
                disabled={isSubmitting}
              />
              {form.formState.errors.playedOn && (
                <p className="text-sm text-destructive">{form.formState.errors.playedOn.message}</p>
              )}
            </div>
            {rounds.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="roundId">Round (optional)</Label>
                <select
                  id="roundId"
                  {...form.register("roundId")}
                  disabled={isSubmitting}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">No round (unassigned)</option>
                  {rounds.map((round) => (
                    <option key={round.id} value={round.id}>
                      Round {round.number}
                    </option>
                  ))}
                </select>
                {form.formState.errors.roundId && (
                  <p className="text-sm text-destructive">{form.formState.errors.roundId.message}</p>
                )}
              </div>
            )}
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
                  "Create Match"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
