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
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DeleteClubDialogProps = {
  clubId: string;
  clubName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

export function DeleteClubDialog({ clubId, clubName, open, onOpenChange, onDeleted }: DeleteClubDialogProps) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const expectedText = clubName.toLowerCase();

  const handleDelete = async () => {
    if (confirmText.toLowerCase() !== expectedText) {
      toast({
        variant: "destructive",
        title: "Confirmation failed",
        description: "Please type the club name exactly to confirm deletion.",
      });
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/clubs/${clubId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete club");
      }

      toast({
        title: "Club deleted",
        description: `"${clubName}" has been permanently deleted.`,
      });
      onDeleted();
      onOpenChange(false);
      setConfirmText("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete club",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmText("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Club
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the club and all its data including:
            players, ratings, tournaments, matches, and memberships.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm mb-4">
            To confirm deletion, type <strong>"{clubName}"</strong> below:
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type "${clubName}" to confirm`}
            disabled={isDeleting}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={confirmText.toLowerCase() !== expectedText || isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Club"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
