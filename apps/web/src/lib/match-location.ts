export interface MatchLocation {
  roundNumber: number | null;
  boardNumber: number | null;
  blackPlayerId: string | null;
}

export function getMatchLocationHeader(selectedRound: number | null): "Round" | "Table" {
  return selectedRound === null ? "Round" : "Table";
}

export function formatMatchLocation(
  selectedRound: number | null,
  match: MatchLocation
): number | "—" {
  if (selectedRound === null) {
    return match.roundNumber ?? "—";
  }

  if (match.blackPlayerId === null) {
    return "—";
  }

  return match.boardNumber ?? "—";
}
