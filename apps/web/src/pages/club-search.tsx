import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Badge } from "../components/ui/badge.js";
import { JoinClubDialog } from "../components/club/join-club-dialog.js";
import { useAuth } from "../contexts/auth-context.js";

interface Club {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  city: string | null;
  country: string | null;
}

export function ClubSearchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClub, setSelectedClub] = useState<{ id: string; name: string } | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchClubs = async () => {
      try {
        const response = await fetch("/api/clubs", { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          setClubs(data.clubs || []);
        }
      } catch (error) {
        console.error("Failed to fetch clubs:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchClubs();
  }, [user]);

  const filteredClubs = clubs.filter(club => {
    const query = searchQuery.toLowerCase();
    return (
      club.name.toLowerCase().includes(query) ||
      (club.description && club.description.toLowerCase().includes(query)) ||
      (club.city && club.city.toLowerCase().includes(query)) ||
      (club.country && club.country.toLowerCase().includes(query))
    );
  });

  const handleJoinClick = (clubId: string, clubName: string) => {
    setSelectedClub({ id: clubId, name: clubName });
    setJoinDialogOpen(true);
  };

  const handleClubClick = (clubId: string) => {
    navigate(`/clubs/${clubId}`);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Find a Club</h1>
        <p className="text-muted-foreground">Search for chess clubs to join</p>
      </div>

      <Input
        placeholder="Search clubs by name, description, city, or country..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-md"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredClubs.map((club) => {
          const isMember = user?.memberships.some(m => m.clubId === club.id);
          return (
            <Card key={club.id} className="flex flex-col">
              <CardHeader>
                <CardTitle>{club.name}</CardTitle>
                <CardDescription>
                  {club.city && club.country ? `${club.city}, ${club.country}` : club.city || club.country || "Location not specified"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {club.description || "No description available."}
                </p>
                <div className="flex items-center gap-2 mt-auto">
                  {isMember ? (
                    <Badge variant="outline">Member</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleJoinClick(club.id, club.name)}
                    >
                      Join Request
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleClubClick(club.id)}
                  >
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredClubs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No clubs found matching your search.</p>
        </div>
      )}

      {selectedClub && (
        <JoinClubDialog
          open={joinDialogOpen}
          onOpenChange={setJoinDialogOpen}
          clubId={selectedClub.id}
          clubName={selectedClub.name}
        />
      )}
    </div>
  );
}
