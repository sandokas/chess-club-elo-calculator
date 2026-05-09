import type { Player, PlayersListData, PlayerDetail } from "./types.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`API responded with ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

export async function loadPlayersList(
  signal: AbortSignal,
  page: number,
  limit: number,
  sortBy: string,
  sortOrder: string,
  name: string,
  active: string,
  eloMin: string,
  eloMax: string,
  glickoMin: string,
  glickoMax: string,
  gamesPlayedMin: string,
  gamesPlayedMax: string,
  lastGameDateAfter: string,
  lastGameDateBefore: string
): Promise<PlayersListData> {
  const clubsPayload = await fetchJson<{ clubs: { id: string }[] }>("/clubs", signal);
  const club = clubsPayload.clubs[0];
  if (!club) {
    throw new Error("No clubs found in the database.");
  }

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sortBy,
    sortOrder
  });

  if (name) params.append("name", name);
  if (active) params.append("active", active);
  if (eloMin) params.append("eloMin", eloMin);
  if (eloMax) params.append("eloMax", eloMax);
  if (glickoMin) params.append("glickoMin", glickoMin);
  if (glickoMax) params.append("glickoMax", glickoMax);
  if (gamesPlayedMin) params.append("gamesPlayedMin", gamesPlayedMin);
  if (gamesPlayedMax) params.append("gamesPlayedMax", gamesPlayedMax);
  if (lastGameDateAfter) params.append("lastGameDateAfter", lastGameDateAfter);
  if (lastGameDateBefore) params.append("lastGameDateBefore", lastGameDateBefore);

  const result = await fetchJson<PlayersListData>(
    `/clubs/${club.id}/players?${params.toString()}`,
    signal
  );

  return result;
}

export async function loadPlayerDetail(playerId: string, signal: AbortSignal): Promise<PlayerDetail> {
  const result = await fetchJson<PlayerDetail>(`/players/${playerId}`, signal);
  return result;
}
