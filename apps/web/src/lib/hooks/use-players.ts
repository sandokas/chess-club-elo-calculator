import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson, putJson, deleteJson } from "../http.js";
import type { PlayersListData, PlayerDetail } from "../types.js";

type CreatePlayerInput = {
  displayName: string;
};

type UpdatePlayerInput = {
  displayName?: string;
  active?: boolean;
};

type PlayersFilters = {
  name?: string;
  active?: string;
  eloMin?: string;
  eloMax?: string;
  glickoMin?: string;
  glickoMax?: string;
  gamesPlayedMin?: string;
  gamesPlayedMax?: string;
  lastGameDateAfter?: string;
  lastGameDateBefore?: string;
};

export function usePlayersList(
  clubId: string | undefined,
  page: number = 1,
  limit: number = 20,
  sortBy: string = "displayName",
  sortOrder: string = "asc",
  filters: PlayersFilters = {}
) {
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
    placeholderData: keepPreviousData,
  });
}

export function usePlayerDetail(playerId: string | undefined) {
  return useQuery({
    queryKey: ["players", playerId],
    queryFn: ({ signal }) => fetchJson<PlayerDetail>(`/players/${playerId}`, signal),
    enabled: !!playerId,
  });
}

export function useCreatePlayer(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePlayerInput) =>
      postJson<{ player: any }>(`/clubs/${clubId}/players`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "players"] });
    },
  });
}

export function useUpdatePlayer(playerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdatePlayerInput) =>
      putJson<{ player: any }>(`/players/${playerId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players", playerId] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
    },
  });
}

export function useDeletePlayer(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (playerId: string) => deleteJson(`/clubs/${clubId}/players/${playerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "players"] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
    },
  });
}
