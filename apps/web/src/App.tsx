import { useEffect, useState } from "react";
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Header } from "./components/layout/header.js";
import { SkipLink } from "./components/ui/skip-link.js";
import { RequireAuth } from "./components/auth/require-auth.js";
import { StatusCard } from "./components/shared/status-card.js";
import { StatCard } from "./components/shared/stat-card.js";
import { BackButton } from "./components/shared/back-button.js";
import { AdminOverviewSkeleton } from "./components/dashboard/admin-overview-skeleton.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.js";
import { Badge } from "./components/ui/badge.js";
import { Switch } from "./components/ui/switch.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible.js";
import { Button } from "./components/ui/button.js";
import { Toaster } from "./components/ui/toaster.js";
import { useToast } from "./hooks/use-toast";
import { EditTournamentDialog } from "./components/tournament/edit-tournament-dialog.js";
import { CreateTournamentDialog } from "./components/tournament/create-tournament-dialog.js";
import { TournamentRosterManager } from "./components/tournament/tournament-roster-manager.js";
import { useClubPlayers, useClubTournaments, useClubTournamentsCount, useClubLeaderboard } from "./lib/hooks/use-clubs.js";
import { GenerateRoundDialog } from "./components/tournament/generate-round-dialog.js";
import { EditRoundStartDialog } from "./components/tournament/edit-round-start-dialog.js";
import { EditPlayerDialog } from "./components/player/edit-player-dialog.js";
import { EditClubDialog } from "./components/club/edit-club-dialog.js";
import { CreateClubDialog } from "./components/club/create-club-dialog.js";
import { RecomputeRatingsDialog } from "./components/club/recompute-ratings-dialog.js";
import { Pencil, Plus, Settings, RefreshCw, Play, Trash, Trophy, List } from "lucide-react";
import { PlayersListPage } from "./pages/players-list.js";
import { PlayerDetailPage } from "./pages/player-detail.js";
import { TournamentsListPage } from "./pages/tournaments-list.js";
import { TournamentDetailPage } from "./pages/tournament-detail.js";
import { AdminOverviewPage } from "./pages/admin-overview.js";
import { GlobalCreateClubDialog } from "./components/club/global-create-club-dialog.js";
import { formatRating, formatDate, formatCompactResult } from "./lib/formatters.js";
import { useClub } from "./contexts/club-context.js";
import type { Club, Player, Tournament, LeaderboardEntry, AdminData, TournamentsListState, TournamentsListData, TournamentDetail, TournamentDetailState, Match, Standing, PlayerDetail, PlayerMatch } from "./lib/types.js";
import { fetchJson, apiBaseUrl } from "./lib/http.js";

export function App() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />
      <main id="main-content" className="container mx-auto p-4 sm:p-6" tabIndex={-1}>
        <RequireAuth>
          <Routes>
            <Route path="/" element={<AdminOverviewPage />} />
            <Route path="/players" element={<PlayersListPage />} />
            <Route path="/tournaments" element={<TournamentsListPage />} />
            <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
            <Route path="/players/:id" element={<PlayerDetailPage />} />
          </Routes>
          <GlobalCreateClubDialog />
        </RequireAuth>
      </main>
      <Toaster />
    </div>
  );
}


