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

const apiBaseUrl = "/api";

interface Match {
  id: string;
  whitePlayerName: string;
  blackPlayerName: string;
  result?: number | null;
  roundNumber?: number;
}

interface EditMatchResultDialogProps {
  match: Match;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditMatchResultDialog({ match, open, onOpenChange, onSaved }: EditMatchResultDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedResult, setSelectedResult] = useState<number | null>(match.result ?? null);

  const onSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/matches/${match.id}/result`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ result: selectedResult }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(error.message || `API responded with ${response.status}`);
      }

      toast({
        title: "Match result updated",
        description: "The match result has been saved successfully.",
      });
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update match result",
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
          <DialogTitle>Edit Match Result</DialogTitle>
          <DialogDescription>
            Round {match.roundNumber}: {match.whitePlayerName} vs {match.blackPlayerName}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">Select the match result:</p>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
              <input
                type="radio"
                name="result"
                value="1"
                checked={selectedResult === 1}
                onChange={(e) => setSelectedResult(Number(e.target.value))}
                className="w-4 h-4"
              />
              <div>
                <p className="font-medium">{match.whitePlayerName} wins</p>
                <p className="text-xs text-muted-foreground">White wins (1-0)</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
              <input
                type="radio"
                name="result"
                value="0.5"
                checked={selectedResult === 0.5}
                onChange={(e) => setSelectedResult(Number(e.target.value))}
                className="w-4 h-4"
              />
              <div>
                <p className="font-medium">Draw</p>
                <p className="text-xs text-muted-foreground">½-½</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
              <input
                type="radio"
                name="result"
                value="0"
                checked={selectedResult === 0}
                onChange={(e) => setSelectedResult(Number(e.target.value))}
                className="w-4 h-4"
              />
              <div>
                <p className="font-medium">{match.blackPlayerName} wins</p>
                <p className="text-xs text-muted-foreground">Black wins (0-1)</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-accent">
              <input
                type="radio"
                name="result"
                value="null"
                checked={selectedResult === null}
                onChange={() => setSelectedResult(null)}
                className="w-4 h-4"
              />
              <div>
                <p className="font-medium">Clear result</p>
                <p className="text-xs text-muted-foreground">Remove result (undo rating change)</p>
              </div>
            </label>
          </div>
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
                Saving...
              </>
            ) : (
              "Save Result"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
