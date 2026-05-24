import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Textarea } from "../components/ui/textarea.js";
import { useAuth } from "../contexts/auth-context.js";
import { useToast } from "../hooks/use-toast";
import { useCreateJoinRequestByClubName } from "../lib/hooks/use-invites.js";

export function ClubSearchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clubName, setClubName] = useState("");
  const [message, setMessage] = useState("");
  const createJoinRequest = useCreateJoinRequestByClubName();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      navigate("/login");
      return;
    }

    createJoinRequest.mutate(
      {
        clubName,
        message: message.trim() || undefined
      },
      {
        onSuccess: () => {
          toast({
            title: "Join request submitted",
            description: "If that club exists, an admin will be able to review your request."
          });
          setClubName("");
          setMessage("");
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error instanceof Error ? error.message : "Failed to submit join request",
            variant: "destructive"
          });
        }
      }
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Join a Club</h1>
        <p className="text-muted-foreground">Request access using the club name provided by an organizer.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Club request</CardTitle>
          <CardDescription>Club names are not listed publicly.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="club-name">Club name</Label>
              <Input
                id="club-name"
                value={clubName}
                onChange={(event) => setClubName(event.target.value)}
                placeholder="Exact club name"
                autoComplete="off"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-message">Message (optional)</Label>
              <Textarea
                id="join-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Tell the admins who you are"
                rows={4}
              />
            </div>

            <Button type="submit" disabled={createJoinRequest.isPending || !clubName.trim()}>
              {createJoinRequest.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
