import { useState } from "react";
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
import { useToast } from "../../hooks/use-toast";
import type { Tournament } from "../../lib/types.js";
import { getCurrentDateTime } from "../../lib/date-utils.js";
import { apiBaseUrl } from "../../lib/api-base.js";

interface GenerateRoundDialogProps {
  tournament: Partial<Tournament>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}

export function GenerateRoundDialog({ tournament, open, onOpenChange, onGenerated }: GenerateRoundDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Use current date/time for the round start
      const bodyData = {
        startsOn: getCurrentDateTime(),
      };

      const response = await fetch(`${apiBaseUrl}/tournaments/${tournament.id}/rounds`, {
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

      // If tournament is in draft status, set it to active
      if (tournament.status === "draft") {
        const updateResponse = await fetch(`${apiBaseUrl}/tournaments/${tournament.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        });
        if (!updateResponse.ok) {
          const error = await updateResponse.json().catch(() => ({ message: "Unknown error" }));
          throw new Error(error.message || `Failed to update tournament status`);
        }
      }

      toast({
        title: "Round generated",
        description: "New round pairings have been generated successfully.",
      });
      onOpenChange(false);
      onGenerated();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate round",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pairingMethodText = tournament.pairingMethod === "seeded_by_rating" 
    ? "Seeded by Rating" 
    : tournament.pairingMethod === "random" ? "Random" : "Default";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Generate Round Pairings</DialogTitle>
          <DialogDescription>
            Generate the next round of pairings for {tournament.name}. This will use the {pairingMethodText} method.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Once pairings are generated, the tournament status will change to "active" and you cannot add or remove players.
          </p>
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
          <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate Round"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
