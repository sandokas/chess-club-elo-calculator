import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson, putJson, deleteJson } from "../http.js";
import type { Club, Player, Tournament, LeaderboardEntry, PlayersListData, PlayerDetail } from "../types.js";

export function useClubs() {
  return useQuery({
    queryKey: ["clubs"],
    queryFn: ({ signal }) => fetchJson<{ clubs: Club[] }>("/clubs", signal),
  });
}

export function useClubPlayers(clubId: string | undefined) {
  return useQuery({
    queryKey: ["clubs", clubId, "players"],
    queryFn: ({ signal }) => fetchJson<{ players: Player[] }>(`/clubs/${clubId}/players`, signal),
    enabled: !!clubId,
  });
}

export function useClubTournaments(clubId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: ["clubs", clubId, "tournaments", limit],
    queryFn: ({ signal }) => fetchJson<{ tournaments: Tournament[]; pagination: { total: number } }>(`/clubs/${clubId}/tournaments?limit=${limit || 10}`, signal),
    enabled: !!clubId,
  });
}

export function useClubLeaderboard(clubId: string | undefined, activeOnly: boolean = true, limit: number = 10) {
  return useQuery({
    queryKey: ["clubs", clubId, "leaderboard", activeOnly, limit],
    queryFn: ({ signal }) => fetchJson<{ leaderboard: LeaderboardEntry[] }>(`/clubs/${clubId}/leaderboard?activeOnly=${activeOnly}&limit=${limit}`, signal),
    enabled: !!clubId,
  });
}

export function useCreateClub() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name: string; description?: string; city?: string; country?: string }) =>
      postJson<{ club: Club }>("/clubs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useUpdateClub(clubId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { name?: string; description?: string; city?: string; country?: string }) =>
      putJson<{ club: Club }>(`/clubs/${clubId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useDeleteClub() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (clubId: string) => deleteJson(`/clubs/${clubId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
    },
  });
}

export function useRecomputeRatings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (clubId: string) => postJson<{ message: string; playersUpdated: number }>(`/clubs/${clubId}/ratings/recompute`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
    },
  });
}

export function usePlayersList(clubId: string | undefined, page: number, limit: number, sortBy: string, sortOrder: string, filters: Record<string, string>) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.append(key, value);
  });

  return useQuery({
    queryKey: ["clubs", clubId, "players", "list", page, limit, sortBy, sortOrder, filters],
    queryFn: ({ signal }) => fetchJson<PlayersListData>(`/clubs/${clubId}/players?${params.toString()}`, signal),
    enabled: !!clubId,
  });
}

export function usePlayerDetail(playerId: string | undefined) {
  return useQuery({
    queryKey: ["players", playerId],
    queryFn: ({ signal }) => fetchJson<PlayerDetail>(`/players/${playerId}`, signal),
    enabled: !!playerId,
  });
}
