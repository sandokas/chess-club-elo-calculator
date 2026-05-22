import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { useAuth } from "../../contexts/auth-context.js";
import { useToast } from "../../hooks/use-toast";
import { useClubJoinRequests, useProcessJoinRequest } from "../../lib/hooks/use-invites.js";
import { useClubPlayers } from "../../lib/hooks/use-clubs.js";

interface JoinRequest {
  id: string;
  userId: string;
  email: string;
  name: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

interface ClubPlayer {
  id: string;
  displayName: string;
  active: boolean;
}

interface JoinRequestsManagerProps {
  clubId: string;
}

export function JoinRequestsManager({ clubId }: JoinRequestsManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedPlayerMap, setSelectedPlayerMap] = useState<Record<string, string>>({});

  const { data: joinRequestsData, isLoading } = useClubJoinRequests(clubId);
  const { data: clubPlayersData } = useClubPlayers(clubId);
  const processJoinRequest = useProcessJoinRequest(clubId);

  const joinRequests = joinRequestsData?.joinRequests || [];
  const clubPlayers = clubPlayersData?.players || [];

  const handleAccept = async (requestId: string) => {
    const playerId = selectedPlayerMap[requestId];
    if (!playerId) {
      toast({
        title: "Error",
        description: "Please select a player to link",
        variant: "destructive"
      });
      return;
    }

    processJoinRequest.mutate({
      requestId,
      data: { action: "accept", playerId }
    }, {
      onSuccess: () => {
        toast({
          title: "Request accepted",
          description: "The join request has been accepted and the player has been linked.",
        });
        setSelectedPlayerMap(prev => {
          const updated = { ...prev };
          delete updated[requestId];
          return updated;
        });
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to accept request",
          variant: "destructive"
        });
      }
    });
  };

  const handleReject = async (requestId: string) => {
    processJoinRequest.mutate({
      requestId,
      data: { action: "reject" }
    }, {
      onSuccess: () => {
        toast({
          title: "Request rejected",
          description: "The join request has been rejected.",
        });
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to reject request",
          variant: "destructive"
        });
      }
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const pendingRequests = joinRequests.filter(req => req.status === "pending");

  if (pendingRequests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join Requests</CardTitle>
        <CardDescription>
          {pendingRequests.length} pending request{pendingRequests.length !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {pendingRequests.map((request) => (
            <div key={request.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{request.name}</span>
                    <span className="text-sm text-muted-foreground">({request.email})</span>
                  </div>
                  {request.message && (
                    <p className="mt-1 text-sm text-muted-foreground">{request.message}</p>
                  )}
                  <Badge variant="outline" className="mt-2">
                    {request.status}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select
                  value={selectedPlayerMap[request.id] || ""}
                  onValueChange={(value) => setSelectedPlayerMap(prev => ({ ...prev, [request.id]: value }))}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select player to link..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clubPlayers.map((player) => (
                      <SelectItem key={player.id} value={player.id}>
                        {player.displayName} {player.active ? "" : "(inactive)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => handleAccept(request.id)}
                  disabled={!selectedPlayerMap[request.id] || processJoinRequest.isPending}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(request.id)}
                  disabled={processJoinRequest.isPending}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
