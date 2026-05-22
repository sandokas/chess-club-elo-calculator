import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson, putJson, deleteJson } from "../http.js";

export function useClubTournaments(
  clubId: string | undefined,
  page: number = 1,
  limit: number = 20,
  sortBy: string = "startsOn",
  sortOrder: string = "desc",
  filters: { name?: string; status?: string } = {}
) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  if (filters.name) params.append("name", filters.name);
  if (filters.status) params.append("status", filters.status);

  return useQuery({
    queryKey: ["clubs", clubId, "tournaments", page, limit, sortBy, sortOrder, filters],
    queryFn: ({ signal }) => fetchJson<{ tournaments: any[]; pagination: any }>(`/clubs/${clubId}/tournaments?${params.toString()}`, signal),
    enabled: !!clubId,
  });
}

export function useTournament(tournamentId: string | undefined) {
  return useQuery({
    queryKey: ["tournaments", tournamentId],
    queryFn: ({ signal }) => fetchJson<{ tournament: any; matches: any[]; standings: any[]; tournamentPlayers: any[] }>(`/tournaments/${tournamentId}`, signal),
    enabled: !!tournamentId,
  });
}

export function useCreateTournament(clubId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name: string; startsOn?: string; format?: string; totalRounds?: number; pairingMethod?: string }) =>
      postJson<{ tournament: any }>(`/clubs/${clubId}/tournaments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "tournaments"] });
    },
  });
}

export function useUpdateTournament(tournamentId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name?: string; startsOn?: string; status?: string; totalRounds?: number | null; pairingMethod?: string }) =>
      putJson<{ tournament: any }>(`/tournaments/${tournamentId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useDeleteTournament() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (tournamentId: string) => deleteJson(`/tournaments/${tournamentId}`),
    onSuccess: (_, tournamentId) => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useTournamentPlayers(tournamentId: string | undefined) {
  return useQuery({
    queryKey: ["tournaments", tournamentId, "players"],
    queryFn: ({ signal }) => fetchJson<{ players: any[] }>(`/tournaments/${tournamentId}/players`, signal),
    enabled: !!tournamentId,
  });
}

export function useAddTournamentPlayer(tournamentId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { playerId: string }) =>
      postJson<{ tournamentPlayer: any }>(`/tournaments/${tournamentId}/players`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "players"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
    },
  });
}

export function useCreateTournamentPlayer(tournamentId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { displayName: string }) =>
      postJson<{ tournamentPlayer: any }>(`/tournaments/${tournamentId}/players/new`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "players"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useRemoveTournamentPlayer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ tournamentId, playerId }: { tournamentId: string; playerId: string }) =>
      deleteJson(`/tournaments/${tournamentId}/players/${playerId}`),
    onSuccess: (_, { tournamentId }) => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "players"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
    },
  });
}

export function useMarkPlayerDropout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ tournamentId, playerId, droppedOutRound }: { tournamentId: string; playerId: string; droppedOutRound: number }) =>
      putJson<{ tournamentPlayer: any }>(`/tournaments/${tournamentId}/players/${playerId}/dropout`, { droppedOutRound }),
    onSuccess: (_, { tournamentId }) => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "players"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "standings"] });
    },
  });
}

export function useTournamentRounds(tournamentId: string | undefined) {
  return useQuery({
    queryKey: ["tournaments", tournamentId, "rounds"],
    queryFn: ({ signal }) => fetchJson<{ rounds: any[] }>(`/tournaments/${tournamentId}/rounds`, signal),
    enabled: !!tournamentId,
  });
}

export function useCreateTournamentRound(tournamentId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { startsOn?: string }) =>
      postJson<{ round: any }>(`/tournaments/${tournamentId}/rounds`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId, "rounds"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments", tournamentId] });
    },
  });
}

export function useUpdateRoundStartsOn(roundId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { startsOn: string }) =>
      putJson<{ round: any }>(`/rounds/${roundId}/starts-on`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["rounds"] });
    },
  });
}

export function useDeleteRound() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (roundId: string) => deleteJson(`/rounds/${roundId}`),
    onSuccess: (_, roundId) => {
      queryClient.invalidateQueries({ queryKey: ["rounds"] });
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
    },
  });
}

export function useRoundMatches(roundId: string | undefined) {
  return useQuery({
    queryKey: ["rounds", roundId, "matches"],
    queryFn: ({ signal }) => fetchJson<{ matches: any[] }>(`/rounds/${roundId}/matches`, signal),
    enabled: !!roundId,
  });
}

export function useUpdateMatchResult(matchId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { result: number | null }) =>
      putJson<{ match: any }>(`/matches/${matchId}/result`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["rounds"] });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
    },
  });
}

export function useTournamentStandings(tournamentId: string | undefined) {
  return useQuery({
    queryKey: ["tournaments", tournamentId, "standings"],
    queryFn: ({ signal }) => fetchJson<{ standings: any[] }>(`/tournaments/${tournamentId}/standings`, signal),
    enabled: !!tournamentId,
  });
}
