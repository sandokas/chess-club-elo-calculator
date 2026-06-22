import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trophy, List, Play, Trash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiBaseUrl } from "@/lib/http";
import { EditTournamentDialog } from "@/components/tournament/edit-tournament-dialog";
import { GenerateRoundDialog } from "@/components/tournament/generate-round-dialog";
import { EditRoundStartDialog } from "@/components/tournament/edit-round-start-dialog";
import { TournamentRosterManager } from "@/components/tournament/tournament-roster-manager";
import { BackButton } from "@/components/shared/back-button";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate, formatCompactResult } from "@/lib/formatters";
import { formatMatchLocation, getMatchLocationHeader } from "@/lib/match-location";

interface TournamentDetailState {
  status: "loading" | "ok" | "error";
  data?: TournamentDetail;
  message?: string;
}

interface TournamentDetail {
  tournament: {
    id: string;
    name: string;
    startsOn: string;
    status: "draft" | "active" | "completed";
    format: string;
    playerCount: number;
    matchCount: number;
    totalRounds: number | null | undefined;
    pairingMethod: string;
    clubId: string;
  };
  matches: Match[];
  standings: Standing[];
}

interface Match {
  id: string;
  whitePlayerId: string;
  whitePlayerName: string;
  blackPlayerId: string | null;
  blackPlayerName: string | null;
  result: number | null;
  playedOn: string;
  boardNumber: number | null;
  roundNumber: number | null;
  roundStart: string | null;
}

interface Standing {
  playerId: string;
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  buchholz: number;
  sonnebornBerger: number;
}

export function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<TournamentDetailState>({ status: "loading" });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [editRoundStartOpen, setEditRoundStartOpen] = useState(false);
  const [rounds, setRounds] = useState<any[]>([]);
  const [victoryView, setVictoryView] = useState<"victory" | "details">("victory");

  useEffect(() => {
    if (!id) {
      setState({ status: "error", message: "No tournament ID provided" });
      return;
    }

    const controller = new AbortController();

    loadTournamentDetail(id, controller.signal)
      .then((data) => {
        setState({ status: "ok", data });
        // Load rounds for status display
        fetch(`${apiBaseUrl}/tournaments/${id}/rounds`)
          .then(res => res.json())
          .then(roundsData => setRounds(roundsData.rounds || []))
          .catch(err => console.error("Failed to load rounds:", err));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load tournament"
        });
      });

    return () => controller.abort();
  }, [id]);

  const handleSaved = () => {
    if (id) {
      const controller = new AbortController();
      loadTournamentDetail(id, controller.signal)
        .then((data) => {
          setState({ status: "ok", data });
          // Reload rounds
          fetch(`${apiBaseUrl}/tournaments/${id}/rounds`)
            .then(res => res.json())
            .then(roundsData => setRounds(roundsData.rounds || []))
            .catch(err => console.error("Failed to load rounds:", err));
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load tournament"
          });
        });
    }
  };

  const handleMatchResultChange = async (matchId: string, value: string) => {
    try {
      const result = value === "" ? null : parseFloat(value);
      const response = await fetch(`${apiBaseUrl}/matches/${matchId}/result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!response.ok) throw new Error("Failed to update match result");
      handleSaved();
    } catch (error) {
      console.error("Failed to update match result:", error);
    }
  };

  const handleDeleteRound = async (roundNumber: number) => {
    if (!confirm(`Are you sure you want to delete Round ${roundNumber}? This will delete all matches in the round.`)) return;
    try {
      if (state.status !== "ok" || !id) return;
      
      // Get round ID
      const response = await fetch(`${apiBaseUrl}/tournaments/${id}/rounds`);
      if (!response.ok) throw new Error("Failed to fetch rounds");
      const roundsData = await response.json();
      const round = roundsData.rounds.find((r: any) => r.number === roundNumber);
      if (!round) throw new Error("Round not found");

      const deleteResponse = await fetch(`${apiBaseUrl}/rounds/${round.id}`, {
        method: "DELETE",
      });
      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => ({ message: "Failed to delete round" }));
        throw new Error(errorData.message || "Failed to delete round");
      }
      
      // If no rounds remain, set tournament to draft
      if (roundsData.rounds.length === 1) {
        const updateResponse = await fetch(`${apiBaseUrl}/tournaments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "draft" }),
        });
        if (!updateResponse.ok) throw new Error("Failed to update tournament status");
      }
      
      setSelectedRound(null);
      handleSaved();
    } catch (error) {
      console.error("Failed to delete round:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete round";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleEditRoundStart = () => {
    setEditRoundStartOpen(true);
  };

  const handleFinalizeTournament = async () => {
    if (!confirm("Are you sure you want to finalize the tournament? This will set the tournament status to completed.")) return;
    try {
      if (state.status !== "ok" || !id) return;
      
      const response = await fetch(`${apiBaseUrl}/tournaments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!response.ok) throw new Error("Failed to update tournament status");
      handleSaved();
    } catch (error) {
      console.error("Failed to finalize tournament:", error);
      toast({
        title: "Error",
        description: "Failed to finalize tournament",
        variant: "destructive",
      });
    }
  };

  return (
    <section className="space-y-6 sm:space-y-8" aria-labelledby="tournament-title">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-xs sm:text-sm font-semibold text-primary uppercase tracking-wider">Chess Club Manager</p>
          <BackButton />
        </div>
        <div className="flex items-center gap-2">
          {state.status === "loading" && <h1 id="tournament-title">Loading tournament...</h1>}
          {state.status === "error" && <h1 id="tournament-title">Error: {state.message}</h1>}
          {state.status === "ok" && <h1 id="tournament-title" className="text-2xl sm:text-3xl font-bold">{state.data?.tournament.name}</h1>}
          {state.status === "ok" && (
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </header>

      {state.status === "ok" && state.data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" aria-label="Tournament summary">
            <StatCard label="Status" value={state.data.tournament.status} />
            <StatCard label="Players" value={state.data.tournament.playerCount} />
            <StatCard label="Matches" value={state.data.tournament.matchCount} />
            <StatCard label="Start date" value={formatDate(state.data.tournament.startsOn)} />
          </section>

          {state.data.tournament.status === "draft" ? (
            <TournamentRosterManager
              tournament={{...state.data.tournament, totalRounds: state.data.tournament.totalRounds ?? undefined}}
              onUpdated={handleSaved}
            />
          ) : state.data.tournament.status === "completed" ? (
            <div className="space-y-6 sm:space-y-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl sm:text-3xl font-bold">Tournament Complete!</h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant={victoryView === "victory" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVictoryView("victory")}
                  >
                    <Trophy className="h-4 w-4 mr-2" />
                    Victory
                  </Button>
                  <Button
                    variant={victoryView === "details" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVictoryView("details")}
                  >
                    <List className="h-4 w-4 mr-2" />
                    Details
                  </Button>
                </div>
              </div>

              {victoryView === "victory" ? (
                <>
                  <Card className="border-2 border-primary">
                    <CardHeader className="text-center">
                      <Trophy className="h-16 w-16 mx-auto mb-4 text-primary" />
                      <CardDescription className="text-lg">{state.data.tournament.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 mt-6 items-end">
                        {/* Podium order: 2nd (left, mid), 1st (center, top), 3rd (right, bottom) */}
                        {[2, 1, 3].map((rank) => {
                          const standing = state.data!.standings[rank - 1];
                          if (!standing) return null;
                          const medals = ["🥇", "🥈", "🥉"];
                          const heightClass = rank === 1 ? "pt-8 pb-6" : rank === 2 ? "pt-6 pb-5" : "pt-4 pb-4";
                          const sizeClass = rank === 1 ? "text-6xl" : rank === 2 ? "text-5xl" : "text-4xl";
                          const ringClass = rank === 1 ? "ring-2 ring-primary" : "";
                          return (
                            <div key={standing.playerId} className={`text-center px-4 rounded-lg bg-muted ${heightClass} ${ringClass}`}>
                              <div className={`mb-2 ${sizeClass}`}>{medals[rank - 1]}</div>
                              <Link to={`/players/${standing.playerId}`} className="font-bold text-lg hover:underline">{standing.playerName}</Link>
                              <div className="text-2xl font-semibold mt-2">{standing.points.toFixed(1)}</div>
                              <div className="text-sm text-muted-foreground">points</div>
                              {standing.buchholz !== undefined && (
                                <div className="text-xs text-muted-foreground mt-1">Buchholz {standing.buchholz.toFixed(1)}</div>
                              )}
                              {standing.sonnebornBerger !== undefined && (
                                <div className="text-xs text-muted-foreground">S-B {standing.sonnebornBerger.toFixed(1)}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg sm:text-xl">Final Standings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Rank</TableHead>
                              <TableHead>Player</TableHead>
                              <TableHead className="hidden sm:table-cell">W</TableHead>
                              <TableHead className="hidden sm:table-cell">D</TableHead>
                              <TableHead className="hidden sm:table-cell">L</TableHead>
                              <TableHead>Points</TableHead>
                              <TableHead title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                              <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {state.data.standings.map((standing, index) => (
                              <TableRow key={standing.playerId}>
                                <TableCell>{index + 1}</TableCell>
                                <TableCell><Link to={`/players/${standing.playerId}`} className="font-medium hover:underline">{standing.playerName}</Link></TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.wins}</TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.draws}</TableCell>
                                <TableCell className="hidden sm:table-cell">{standing.losses}</TableCell>
                                <TableCell>{standing.points.toFixed(1)}</TableCell>
                                <TableCell className="text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                                <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg sm:text-xl">Standings</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="hidden sm:table-cell">W</TableHead>
                                <TableHead className="hidden sm:table-cell">D</TableHead>
                                <TableHead className="hidden sm:table-cell">L</TableHead>
                                <TableHead>Points</TableHead>
                                <TableHead className="hidden sm:table-cell" title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                                <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {state.data.standings.map((standing) => (
                                <TableRow key={standing.playerId}>
                                  <TableCell><Link to={`/players/${standing.playerId}`} className="font-medium hover:underline text-sm sm:text-base">{standing.playerName}</Link></TableCell>
                                  <TableCell className="hidden sm:table-cell">{standing.wins}</TableCell>
                                  <TableCell className="hidden sm:table-cell">{standing.draws}</TableCell>
                                  <TableCell className="hidden sm:table-cell">{standing.losses}</TableCell>
                                  <TableCell>{standing.points.toFixed(1)}</TableCell>
                                  <TableCell className="hidden sm:table-cell text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                                  <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <CardTitle className="text-lg sm:text-xl">Matches</CardTitle>
                          <div className="flex items-center gap-2">
                            {selectedRound !== null && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedRound(null)}
                              >
                                Show All Rounds
                              </Button>
                            )}
                          </div>
                        </div>
                        {state.data.matches.length > 0 && (
                          <div className="space-y-2 mt-2">
                            <div className="flex flex-wrap gap-2">
                              {[...new Set(state.data.matches.map(m => m.roundNumber))].sort((a, b) => (a || 0) - (b || 0)).map(roundNum => (
                                <Button
                                  key={roundNum}
                                  variant={selectedRound === roundNum ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setSelectedRound(roundNum === selectedRound ? null : roundNum)}
                                >
                                  Round {roundNum}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{getMatchLocationHeader(selectedRound)}</TableHead>
                                <TableHead className="hidden sm:table-cell">White</TableHead>
                                <TableHead className="hidden sm:table-cell">Black</TableHead>
                                <TableHead>Result</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                const matchesInRound = state.data.matches
                                  .filter(match => selectedRound === null || match.roundNumber === selectedRound);
                                
                                // Separate regular matches from bye matches
                                const regularMatches = matchesInRound.filter(m => m.blackPlayerId !== null);
                                const byeMatches = matchesInRound.filter(m => m.blackPlayerId === null);
                                
                                return [...regularMatches, ...byeMatches].map((match) => (
                                  <TableRow key={match.id}>
                                    <TableCell className="text-muted-foreground">
                                      {formatMatchLocation(selectedRound, match)}
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                      <Link to={`/players/${match.whitePlayerId}`} className="font-medium hover:underline text-sm sm:text-base">{match.whitePlayerName}</Link>
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                      {match.blackPlayerId ? (
                                        <Link to={`/players/${match.blackPlayerId}`} className="font-medium hover:underline text-sm sm:text-base">{match.blackPlayerName}</Link>
                                      ) : (
                                        <span className="text-muted-foreground italic">Bye</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {match.result !== null ? (
                                        <Badge variant="outline" className="text-xs">
                                          {match.blackPlayerId === null ? "1-0 (bye)" : formatCompactResult(match.result)}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-xs">Pending</Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ));
                              })()}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg sm:text-xl">Standings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Player</TableHead>
                          <TableHead className="hidden sm:table-cell">W</TableHead>
                          <TableHead className="hidden sm:table-cell">D</TableHead>
                          <TableHead className="hidden sm:table-cell">L</TableHead>
                          <TableHead>Points</TableHead>
                          <TableHead className="hidden sm:table-cell" title="Buchholz: sum of opponents' points">Buchholz</TableHead>
                          <TableHead className="hidden md:table-cell" title="Sonneborn-Berger: sum of opponents' points weighted by your result">S-B</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.data.standings.map((standing) => (
                          <TableRow key={standing.playerId}>
                            <TableCell><Link to={`/players/${standing.playerId}`} className="font-medium hover:underline text-sm sm:text-base">{standing.playerName}</Link></TableCell>
                            <TableCell className="hidden sm:table-cell">{standing.wins}</TableCell>
                            <TableCell className="hidden sm:table-cell">{standing.draws}</TableCell>
                            <TableCell className="hidden sm:table-cell">{standing.losses}</TableCell>
                            <TableCell>{standing.points.toFixed(1)}</TableCell>
                            <TableCell className="hidden sm:table-cell text-muted-foreground">{standing.buchholz !== undefined ? standing.buchholz.toFixed(1) : "-"}</TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground">{standing.sonnebornBerger !== undefined ? standing.sonnebornBerger.toFixed(1) : "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <CardTitle className="text-lg sm:text-xl">Matches</CardTitle>
                    <div className="flex items-center gap-2">
                      {selectedRound !== null && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRound(null)}
                        >
                          Show All Rounds
                        </Button>
                      )}
                      {selectedRound !== null && state.data.tournament.status === "active" && (() => {
                        const roundMatches = state.data.matches.filter((m: Match) => m.roundNumber === selectedRound);
                        const hasResults = roundMatches.some((m: Match) => m.result !== null && m.blackPlayerId !== null);
                        return !hasResults;
                      })() && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteRound(selectedRound)}
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Delete Round {selectedRound}
                        </Button>
                      )}
                      {(() => {
                        // Check if all matches have results
                        const allResultsIn = state.data.matches.every(m => m.result !== null);
                        // Check if there are more rounds to generate
                        const currentRoundCount = [...new Set(state.data.matches.map(m => m.roundNumber))].length;
                        // If totalRounds not set, use Swiss suggestion: ceil(log2(playerCount)).
                        const effectiveTotalRounds = state.data.tournament.totalRounds
                          || (state.data.tournament.playerCount > 0
                            ? Math.ceil(Math.log2(state.data.tournament.playerCount))
                            : 0);
                        const canGenerateMore = effectiveTotalRounds === 0 || currentRoundCount < effectiveTotalRounds;
                        
                        if (state.data.tournament.status === "active" && allResultsIn) {
                          if (canGenerateMore) {
                            return (
                              <Button size="sm" onClick={() => setGenerateDialogOpen(true)}>
                                <Play className="h-4 w-4 mr-2" />
                                Generate Round
                              </Button>
                            );
                          } else {
                            return (
                              <Button size="sm" onClick={() => handleFinalizeTournament()}>
                                <Trophy className="h-4 w-4 mr-2" />
                                Finalize Tournament
                              </Button>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  {state.data.matches.length > 0 && (
                    <div className="space-y-2 mt-2">
                      <div className="flex flex-wrap gap-2">
                        {[...new Set(state.data.matches.map(m => m.roundNumber))].sort((a, b) => (a || 0) - (b || 0)).map(roundNum => (
                          <Button
                            key={roundNum}
                            variant={selectedRound === roundNum ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedRound(roundNum === selectedRound ? null : roundNum)}
                          >
                            Round {roundNum}
                          </Button>
                        ))}
                      </div>
                      {selectedRound !== null && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const roundMatches = state.data.matches.filter((m: Match) => m.roundNumber === selectedRound);
                              const roundStart = roundMatches[0]?.roundStart;
                              if (!roundStart) return 'Start time not set';
                              const date = new Date(roundStart);
                              return `Starts: ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                            })()}
                            {state.data.tournament.status === "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleEditRoundStart()}
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{getMatchLocationHeader(selectedRound)}</TableHead>
                          <TableHead className="hidden sm:table-cell">White</TableHead>
                          <TableHead className="hidden sm:table-cell">Black</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const matchesInRound = state.data.matches
                            .filter(match => selectedRound === null || match.roundNumber === selectedRound);
                          
                          // Separate regular matches from bye matches
                          const regularMatches = matchesInRound.filter(m => m.blackPlayerId !== null);
                          const byeMatches = matchesInRound.filter(m => m.blackPlayerId === null);
                          
                          return (
                            <>
                              {regularMatches.map((match) => (
                                <TableRow key={match.id}>
                                  <TableCell>{formatMatchLocation(selectedRound, match)}</TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${match.whitePlayerId}`} className="font-medium hover:underline">{match.whitePlayerName}</Link></TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${match.blackPlayerId}`} className="font-medium hover:underline">{match.blackPlayerName}</Link></TableCell>
                                  <TableCell>
                                    {state.data!.tournament.status === "active" ? (
                                      <select
                                        value={match.result ?? ""}
                                        onChange={(e) => handleMatchResultChange(match.id, e.target.value)}
                                        className="h-8 w-24 rounded border border-input bg-background px-2 text-sm"
                                      >
                                        <option value="">—</option>
                                        <option value="1">1-0</option>
                                        <option value="0.5">½-½</option>
                                        <option value="0">0-1</option>
                                      </select>
                                    ) : (
                                      match.result === null ? (
                                        <span className="text-muted-foreground italic">Not played</span>
                                      ) : (
                                        formatCompactResult(match.result)
                                      )
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                              {byeMatches.map((match) => (
                                <TableRow key={match.id}>
                                  <TableCell>{formatMatchLocation(selectedRound, match)}</TableCell>
                                  <TableCell className="hidden sm:table-cell"><Link to={`/players/${match.whitePlayerId}`} className="font-medium hover:underline">{match.whitePlayerName}</Link></TableCell>
                                  <TableCell className="hidden sm:table-cell">—</TableCell>
                                  <TableCell>
                                    <Badge variant="outline">Bye (1 point)</Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </>
                          );
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {state.status === "ok" && state.data && (
        <EditTournamentDialog
          tournament={{...state.data.tournament, totalRounds: state.data.tournament.totalRounds ?? undefined}}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={handleSaved}
        />
      )}
      {state.status === "ok" && state.data && (
        <GenerateRoundDialog
          tournament={{...state.data.tournament, totalRounds: state.data.tournament.totalRounds ?? undefined}}
          open={generateDialogOpen}
          onOpenChange={setGenerateDialogOpen}
          onGenerated={handleSaved}
        />
      )}
      {selectedRound !== null && state.status === "ok" && state.data && id && (
        <EditRoundStartDialog
          roundNumber={selectedRound}
          tournamentId={id}
          currentStart={state.data.matches.find((m: Match) => m.roundNumber === selectedRound)?.roundStart ?? null}
          open={editRoundStartOpen}
          onOpenChange={setEditRoundStartOpen}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}

async function loadTournamentDetail(tournamentId: string, signal: AbortSignal): Promise<TournamentDetail> {
  const response = await fetch(`${apiBaseUrl}/tournaments/${tournamentId}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for tournament ${tournamentId}`);
  }
  return response.json() as Promise<TournamentDetail>;
}
