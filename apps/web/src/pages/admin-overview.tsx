import { useState } from "react";
import { useClub } from "../contexts/club-context.js";
import { useClubPlayers, useClubTournaments, useClubTournamentsCount, useClubLeaderboard } from "../lib/hooks/use-clubs.js";
import { AdminOverviewSkeleton } from "../components/dashboard/admin-overview-skeleton.js";
import { StatusCard } from "../components/shared/status-card.js";
import { Button } from "../components/ui/button.js";
import { Plus } from "lucide-react";
import type { AdminData } from "../lib/types.js";
import { AdminOverview } from "../components/dashboard/admin-overview.js";

export function AdminOverviewPage() {
  const [activeOnly, setActiveOnly] = useState(true);
  const { club, clubs, isLoading: clubLoading, error: clubError, setCreateClubDialogOpen } = useClub();
  
  const { data: playersData, isLoading: playersLoading, error: playersError } = useClubPlayers(club?.id);
  const { data: tournamentsData, isLoading: tournamentsLoading, error: tournamentsError } = useClubTournaments(club?.id, 6);
  const { data: tournamentsCountData, isLoading: tournamentsCountLoading, error: tournamentsCountError } = useClubTournamentsCount(club?.id);
  const { data: leaderboardData, isLoading: leaderboardLoading, error: leaderboardError } = useClubLeaderboard(club?.id, activeOnly, 10);

  const isLoading = clubLoading || playersLoading || tournamentsLoading || tournamentsCountLoading || leaderboardLoading;
  const error = clubError || playersError || tournamentsError || tournamentsCountError || leaderboardError;

  // No clubs at all: prompt the user to create one
  if (!clubLoading && clubs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <h2 className="text-2xl font-semibold">Welcome to Chess Club Manager</h2>
        <p className="text-muted-foreground max-w-md">
          You don't belong to any club yet. Create your first club to get started.
        </p>
        <Button onClick={() => setCreateClubDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create your first club
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <AdminOverviewSkeleton />;
  }

  if (error) {
    return <StatusCard title="Unable to load club data" message={typeof error === 'string' ? error : "Unknown error"} tone="error" />;
  }

  const data: AdminData = {
    club: club!,
    players: playersData?.players || [],
    tournaments: tournamentsData?.tournaments || [],
    totalTournaments: tournamentsCountData?.pagination.total || 0,
    leaderboard: leaderboardData?.leaderboard || []
  };

  return <AdminOverview data={data} activeOnly={activeOnly} onActiveOnlyChange={setActiveOnly} />;
}
