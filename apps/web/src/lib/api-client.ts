import type { Player, PlayersListData, PlayerDetail } from "./types.js";
import { fetchJson, postJson } from "./http.js";

export async function createClub(
  name: string,
  description?: string,
  city?: string,
  country?: string
): Promise<{ id: string; name: string; slug: string; description: string | null; city: string | null; country: string | null }> {
  return postJson("/clubs", { name, description, city, country });
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
  lastGameDateBefore: string,
  club?: { id: string }
): Promise<PlayersListData> {
  if (!club) {
    throw new Error("No club selected. Please select a club from the dropdown.");
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
