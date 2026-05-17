import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiBaseUrl } from "@/lib/api-base.js";

type RecomputeRatingsDialogProps = {
  clubId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecomputed: () => void;
};

export function RecomputeRatingsDialog({ clubId, open, onOpenChange, onRecomputed }: RecomputeRatingsDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ playersUpdated: number; matchesAudited: number } | null>(null);

  const handleRecompute = async () => {
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await fetch(`${apiBaseUrl}/clubs/${clubId}/ratings/recompute`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to recompute ratings");
      }

      const data = await response.json();
      setResult({
        playersUpdated: data.playersUpdated,
        matchesAudited: data.matchesAudited,
      });

      toast({
        title: "Success",
        description: `Ratings recomputed successfully. ${data.playersUpdated} players updated, ${data.matchesAudited} matches audited.`,
      });
      onRecomputed();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to recompute ratings",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setResult(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Recompute All Ratings</DialogTitle>
          <DialogDescription>
            This will recalculate Elo and Glicko-2 ratings for all players by replaying all completed matches in chronological order.
          </DialogDescription>
        </DialogHeader>
        
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This operation will overwrite all current rating values. Make sure you have a database backup before proceeding.
          </AlertDescription>
        </Alert>

        {result && (
          <Alert>
            <AlertDescription>
              Successfully recomputed ratings for {result.playersUpdated} players and audited {result.matchesAudited} matches.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleRecompute} disabled={isSubmitting || result !== null}>
            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recomputing...</> : "Recompute Ratings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
