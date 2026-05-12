import { Pool } from "pg";

/**
 * FIDE Dutch System Swiss pairing implementation.
 *
 * Key rules implemented:
 * - Bye to lowest-rated player (round 1) or lowest-scoring player without a prior bye.
 * - Score groups split into S1 (top half) vs S2 (bottom half); S1[i] paired with S2[i].
 * - Transposition + exchange backtracking to avoid repeat pairings and color clashes.
 * - Downfloater between score groups when a group has an odd number.
 * - Color allocation respects: absolute rule (never 3-in-a-row, max diff ±2),
 *   strong preference (|balance| = 1), mild (alternate from last color),
 *   board alternation (no preference).
 * - Bye matches (black_player_id IS NULL) do NOT contribute to color balance or
 *   the opponents played set.
 */

export type Color = "W" | "B";

export interface Player {
  id: string;
  displayName: string;
  elo: number;
  points: number;
  buchholz: number;
  sonnebornBerger: number;
  whiteCount: number;
  blackCount: number;
  colorHistory: Color[]; // ordered by round, only real games
  hadBye: boolean;
  droppedOutRound: number | null;
  opponents: Set<string>;
}

export interface Match {
  whitePlayerId: string;
  blackPlayerId: string | null; // null for a virtual bye match
  boardNumber: number;
}

export interface SwissPairingOptions {
  pairingMethod: "seeded_by_rating" | "random";
  roundNumber: number;
}

type ColorPref = "absolute" | "strong" | "mild" | "none";

interface PairCandidate {
  whiteId: string;
  blackId: string;
}

const MAX_COLOR_DIFF = 2;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generateSwissPairings(
  pool: Pool,
  tournamentId: string,
  roundNumber: number,
  options: SwissPairingOptions
): Promise<Match[]> {
  const players = await loadPlayers(pool, tournamentId, roundNumber);

  if (roundNumber === 1) {
    return generateFirstRoundPairings(players, options);
  }
  return generateSubsequentRoundPairings(players, roundNumber);
}

// ---------------------------------------------------------------------------
// Player loading
// ---------------------------------------------------------------------------

async function loadPlayers(
  pool: Pool,
  tournamentId: string,
  roundNumber: number
): Promise<Player[]> {
  const playersResult = await pool.query(
    `
      SELECT
        tp.player_id AS "playerId",
        p.display_name AS "displayName",
        pr.elo,
        tp.white_count AS "whiteCount",
        tp.black_count AS "blackCount",
        tp.dropped_out_round AS "droppedOutRound"
      FROM tournament_players tp
      JOIN players p ON p.id = tp.player_id
      JOIN player_ratings pr ON pr.player_id = tp.player_id
      WHERE tp.tournament_id = $1
        AND (tp.dropped_out_round IS NULL OR tp.dropped_out_round >= $2)
    `,
    [tournamentId, roundNumber]
  );

  const players: Player[] = [];

  for (const row of playersResult.rows) {
    const matchHistoryResult = await pool.query(
      `
        SELECT
          m.white_player_id AS "whitePlayerId",
          m.black_player_id AS "blackPlayerId",
          m.result,
          r.number AS "roundNumber"
        FROM matches m
        JOIN rounds r ON r.id = m.round_id
        WHERE m.tournament_id = $1
          AND (m.white_player_id = $2 OR m.black_player_id = $2)
          AND m.result IS NOT NULL
          AND r.number < $3
        ORDER BY r.number ASC
      `,
      [tournamentId, row.playerId, roundNumber]
    );

    let points = 0;
    let hadBye = false;
    const opponents = new Set<string>();
    const colorHistory: Color[] = [];

    for (const m of matchHistoryResult.rows) {
      const isBye = m.blackPlayerId === null;
      const isWhite = m.whitePlayerId === row.playerId;
      const result = parseFloat(m.result);

      // Points: from white's perspective, result is the score (1/0.5/0).
      if (isWhite) {
        points += result;
      } else {
        points += 1 - result;
      }

      if (isBye) {
        hadBye = true;
        // Bye matches do NOT contribute to colorHistory or opponents.
      } else {
        opponents.add(isWhite ? m.blackPlayerId : m.whitePlayerId);
        colorHistory.push(isWhite ? "W" : "B");
      }
    }

    players.push({
      id: row.playerId,
      displayName: row.displayName,
      elo: Number(row.elo) || 0,
      points,
      buchholz: 0,
      sonnebornBerger: 0,
      whiteCount: row.whiteCount || 0,
      blackCount: row.blackCount || 0,
      colorHistory,
      hadBye,
      droppedOutRound: row.droppedOutRound,
      opponents,
    });
  }

  // Tiebreakers: Buchholz (sum of opponents' points) and Sonneborn-Berger.
  const pointsById = new Map(players.map((p) => [p.id, p.points]));
  for (const player of players) {
    let buchholz = 0;
    let sb = 0;
    // We need per-opponent result; re-query lightweight match history sufficient.
    for (const oppId of player.opponents) {
      buchholz += pointsById.get(oppId) ?? 0;
    }
    // SB: sum of opponents' points for wins + half for draws.
    // We don't have per-opponent results easily here; recompute by scanning matches.
    const sbRows = await pool.query(
      `
        SELECT
          CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
          CASE WHEN m.white_player_id = $1 THEN m.result ELSE 1 - m.result END AS "scoreFromOurSide"
        FROM matches m
        WHERE m.tournament_id = $2
          AND (m.white_player_id = $1 OR m.black_player_id = $1)
          AND m.result IS NOT NULL
          AND m.black_player_id IS NOT NULL
      `,
      [player.id, tournamentId]
    );
    for (const row of sbRows.rows) {
      const oppPts = pointsById.get(row.opponentId) ?? 0;
      const s = parseFloat(row.scoreFromOurSide);
      if (s === 1) sb += oppPts;
      else if (s === 0.5) sb += oppPts / 2;
    }
    player.buchholz = buchholz;
    player.sonnebornBerger = sb;
  }

  return players;
}

// ---------------------------------------------------------------------------
// Bye selection
// ---------------------------------------------------------------------------

function selectByePlayer(players: Player[], roundNumber: number): Player | null {
  if (players.length % 2 === 0) return null;

  if (roundNumber === 1) {
    // Lowest-rated player by ELO ascending.
    const sorted = [...players].sort(
      (a, b) => a.elo - b.elo || a.displayName.localeCompare(b.displayName)
    );
    return sorted[0] ?? null;
  }

  // Subsequent rounds: lowest score group, lowest tiebreaks, no prior bye.
  const sorted = [...players].sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    if (a.buchholz !== b.buchholz) return a.buchholz - b.buchholz;
    if (a.sonnebornBerger !== b.sonnebornBerger)
      return a.sonnebornBerger - b.sonnebornBerger;
    return a.elo - b.elo;
  });

  const eligible = sorted.find((p) => !p.hadBye);
  return eligible ?? sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// First round
// ---------------------------------------------------------------------------

function generateFirstRoundPairings(
  players: Player[],
  options: SwissPairingOptions
): Match[] {
  const matches: Match[] = [];
  let working = [...players];

  const byePlayer = selectByePlayer(working, 1);
  if (byePlayer) {
    working = working.filter((p) => p.id !== byePlayer.id);
    matches.push({
      whitePlayerId: byePlayer.id,
      blackPlayerId: null,
      boardNumber: 0,
    });
  }

  let ordered: Player[];
  if (options.pairingMethod === "seeded_by_rating") {
    ordered = [...working].sort(
      (a, b) => b.elo - a.elo || a.displayName.localeCompare(b.displayName)
    );
  } else {
    ordered = [...working].sort(() => Math.random() - 0.5);
  }

  const half = ordered.length / 2;
  const s1 = ordered.slice(0, half);
  const s2 = ordered.slice(half);

  for (let i = 0; i < half; i++) {
    const a = s1[i];
    const b = s2[i];
    if (!a || !b) continue;
    // Alternate colors by board: top seed of each S1/S2 pair gets white on odd boards,
    // black on even boards. This balances first-round color starts.
    const aIsWhite = i % 2 === 0;
    matches.push({
      whitePlayerId: aIsWhite ? a.id : b.id,
      blackPlayerId: aIsWhite ? b.id : a.id,
      boardNumber: i + 1,
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Subsequent rounds: FIDE Dutch System
// ---------------------------------------------------------------------------

function generateSubsequentRoundPairings(
  players: Player[],
  roundNumber: number
): Match[] {
  const matches: Match[] = [];
  let working = [...players];

  const byePlayer = selectByePlayer(working, roundNumber);
  if (byePlayer) {
    working = working.filter((p) => p.id !== byePlayer.id);
    matches.push({
      whitePlayerId: byePlayer.id,
      blackPlayerId: null,
      boardNumber: 0,
    });
  }

  // Sort by master ranking: points desc, Buchholz, SB, ELO.
  const master = [...working].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    if (b.sonnebornBerger !== a.sonnebornBerger)
      return b.sonnebornBerger - a.sonnebornBerger;
    if (b.elo !== a.elo) return b.elo - a.elo;
    return a.displayName.localeCompare(b.displayName);
  });

  // Build score groups, top to bottom, preserving master order within each.
  const groups: Player[][] = [];
  for (const p of master) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.points === p.points) {
      last.push(p);
    } else {
      groups.push([p]);
    }
  }

  // Pair groups top to bottom with downfloater propagation.
  let downfloaters: Player[] = [];
  const paired = new Set<string>();
  let groupMatches: PairCandidate[] = [];
  let scoreGroupFailed = false;

  for (let g = 0; g < groups.length; g++) {
    let current = [...downfloaters, ...(groups[g] ?? [])];
    downfloaters = [];

    if (current.length === 0) continue;

    // If odd, pick a downfloater: the lowest-ranked player in this combined group.
    if (current.length % 2 !== 0) {
      const floater = current[current.length - 1]!;
      current = current.filter((p) => p.id !== floater.id);
      downfloaters = [floater];
    }

    const pairs = pairGroup(current, paired);
    if (!pairs) {
      scoreGroupFailed = true;
      break;
    }
    for (const pair of pairs) {
      groupMatches.push(pair);
      paired.add(pair.whiteId);
      paired.add(pair.blackId);
    }
  }

  // If score-group pairing failed OR there are leftover downfloaters, fall back to a
  // global backtracking pairer over ALL unpaired players. This avoids repeat pairings
  // by exploring cross-group exchanges that the score-group method can't see.
  if (scoreGroupFailed || downfloaters.length > 0) {
    const globalPairs = pairAllBacktrack(master);
    if (globalPairs) {
      groupMatches = globalPairs;
      paired.clear();
      for (const pair of globalPairs) {
        paired.add(pair.whiteId);
        paired.add(pair.blackId);
      }
    } else if (downfloaters.length > 0) {
      // Last resort: pair the leftover with any remaining player (may repeat).
      const leftover = master.find(
        (p) => !paired.has(p.id) && !downfloaters.some((d) => d.id === p.id)
      );
      if (leftover && downfloaters[0]) {
        const pair = decideColors(downfloaters[0]!, leftover);
        groupMatches.push(pair);
        paired.add(pair.whiteId);
        paired.add(pair.blackId);
      }
    }
  }

  // Convert pair candidates to matches with board numbers, ordered by master ranking
  // of the white player (descending).
  const rankIndex = new Map(master.map((p, i) => [p.id, i]));
  groupMatches.sort((a, b) => {
    const ra = Math.min(
      rankIndex.get(a.whiteId) ?? Infinity,
      rankIndex.get(a.blackId) ?? Infinity
    );
    const rb = Math.min(
      rankIndex.get(b.whiteId) ?? Infinity,
      rankIndex.get(b.blackId) ?? Infinity
    );
    return ra - rb;
  });

  let board = 1;
  for (const pair of groupMatches) {
    matches.push({
      whitePlayerId: pair.whiteId,
      blackPlayerId: pair.blackId,
      boardNumber: board++,
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Score-group pairing with transposition/exchange search
// ---------------------------------------------------------------------------

function pairGroup(
  group: Player[],
  alreadyPaired: Set<string>
): PairCandidate[] | null {
  // group is even-sized; split S1 vs S2.
  const available = group.filter((p) => !alreadyPaired.has(p.id));
  if (available.length === 0) return [];
  if (available.length % 2 !== 0) return null;

  const half = available.length / 2;
  const s1 = available.slice(0, half);
  const s2 = available.slice(half);

  // Try permutations of S2 to find a valid arrangement (transposition).
  // Limit: only allow up to a reasonable factorial for safety.
  const perms = permutations(s2);
  for (const perm of perms) {
    const candidate = tryPair(s1, perm);
    if (candidate) return candidate;
  }

  // Exchange: swap one player between S1 and S2 boundaries, then retry.
  for (let i = s1.length - 1; i >= 0; i--) {
    for (let j = 0; j < s2.length; j++) {
      const newS1 = [...s1];
      const newS2 = [...s2];
      const tmp = newS1[i]!;
      newS1[i] = newS2[j]!;
      newS2[j] = tmp;
      const subPerms = permutations(newS2);
      for (const perm of subPerms) {
        const candidate = tryPair(newS1, perm);
        if (candidate) return candidate;
      }
    }
  }

  return null;
}

/**
 * Global backtracking pairer: tries to pair all players in master order, picking the
 * closest valid partner (by master rank) and backtracking on dead-ends. Guarantees no
 * repeats and respects absolute color rules whenever a valid pairing exists.
 */
function pairAllBacktrack(master: Player[]): PairCandidate[] | null {
  const used = new Set<string>();
  const pairs: PairCandidate[] = [];

  function backtrack(startIdx: number): boolean {
    // Find next unpaired player in master order.
    let i = startIdx;
    while (i < master.length && used.has(master[i]!.id)) i++;
    if (i >= master.length) return true;

    const a = master[i]!;
    // Try partners in master order (closest score first).
    for (let j = i + 1; j < master.length; j++) {
      const b = master[j]!;
      if (used.has(b.id)) continue;
      if (a.opponents.has(b.id)) continue;
      if (!colorPairingAllowed(a, b)) continue;

      used.add(a.id);
      used.add(b.id);
      pairs.push(decideColors(a, b));

      if (backtrack(i + 1)) return true;

      pairs.pop();
      used.delete(a.id);
      used.delete(b.id);
    }
    return false;
  }

  return backtrack(0) ? pairs : null;
}

function pairGroupAllowRepeats(
  group: Player[],
  alreadyPaired: Set<string>
): PairCandidate[] {
  const available = group.filter((p) => !alreadyPaired.has(p.id));
  const out: PairCandidate[] = [];
  const half = Math.floor(available.length / 2);
  const s1 = available.slice(0, half);
  const s2 = available.slice(half, half * 2);
  for (let i = 0; i < half; i++) {
    const a = s1[i]!;
    const b = s2[i]!;
    out.push(decideColors(a, b));
  }
  return out;
}

function tryPair(s1: Player[], s2: Player[]): PairCandidate[] | null {
  if (s1.length !== s2.length) return null;
  const result: PairCandidate[] = [];
  for (let i = 0; i < s1.length; i++) {
    const a = s1[i]!;
    const b = s2[i]!;
    if (a.opponents.has(b.id) || b.opponents.has(a.id)) return null;
    if (!colorPairingAllowed(a, b)) return null;
    result.push(decideColors(a, b));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Color allocation
// ---------------------------------------------------------------------------

function colorBalance(p: Player): number {
  let w = 0;
  let b = 0;
  for (const c of p.colorHistory) {
    if (c === "W") w++;
    else b++;
  }
  return w - b;
}

function lastColor(p: Player): Color | null {
  return p.colorHistory[p.colorHistory.length - 1] ?? null;
}

function twoLastColors(p: Player): [Color | null, Color | null] {
  const n = p.colorHistory.length;
  return [p.colorHistory[n - 1] ?? null, p.colorHistory[n - 2] ?? null];
}

function colorPreference(p: Player): { color: Color | null; strength: ColorPref } {
  const balance = colorBalance(p);
  const [last, prev] = twoLastColors(p);

  // Absolute: must avoid 3-in-a-row, must keep |balance| ≤ 2.
  if (last && prev && last === prev) {
    return { color: last === "W" ? "B" : "W", strength: "absolute" };
  }
  if (balance >= MAX_COLOR_DIFF) return { color: "B", strength: "absolute" };
  if (balance <= -MAX_COLOR_DIFF) return { color: "W", strength: "absolute" };

  // Strong: |balance| = 1 → due opposite color.
  if (balance === 1) return { color: "B", strength: "strong" };
  if (balance === -1) return { color: "W", strength: "strong" };

  // Mild: balance = 0 → alternate from last color.
  if (last) return { color: last === "W" ? "B" : "W", strength: "mild" };

  return { color: null, strength: "none" };
}

function colorPairingAllowed(a: Player, b: Player): boolean {
  const prefA = colorPreference(a);
  const prefB = colorPreference(b);

  // If both have absolute preference for the same color → conflict.
  if (
    prefA.strength === "absolute" &&
    prefB.strength === "absolute" &&
    prefA.color === prefB.color
  ) {
    return false;
  }
  return true;
}

function strengthRank(s: ColorPref): number {
  switch (s) {
    case "absolute":
      return 3;
    case "strong":
      return 2;
    case "mild":
      return 1;
    case "none":
      return 0;
  }
}

function decideColors(a: Player, b: Player): PairCandidate {
  const prefA = colorPreference(a);
  const prefB = colorPreference(b);

  // If preferences point to opposite colors, honor them.
  if (
    prefA.color &&
    prefB.color &&
    prefA.color !== prefB.color &&
    prefA.strength !== "none" &&
    prefB.strength !== "none"
  ) {
    return prefA.color === "W"
      ? { whiteId: a.id, blackId: b.id }
      : { whiteId: b.id, blackId: a.id };
  }

  // Both want the same color (or only one has a preference): the stronger preference wins.
  const sa = strengthRank(prefA.strength);
  const sb = strengthRank(prefB.strength);

  if (sa > sb && prefA.color) {
    return prefA.color === "W"
      ? { whiteId: a.id, blackId: b.id }
      : { whiteId: b.id, blackId: a.id };
  }
  if (sb > sa && prefB.color) {
    return prefB.color === "W"
      ? { whiteId: b.id, blackId: a.id }
      : { whiteId: a.id, blackId: b.id };
  }

  // Equal preference strength: higher-ranked player (a, by master order) gets due color
  // if any preference exists; otherwise white goes to a.
  if (prefA.color) {
    return prefA.color === "W"
      ? { whiteId: a.id, blackId: b.id }
      : { whiteId: b.id, blackId: a.id };
  }

  return { whiteId: a.id, blackId: b.id };
}

// ---------------------------------------------------------------------------
// Utility: permutations (bounded)
// ---------------------------------------------------------------------------

function* permutations<T>(arr: T[]): Generator<T[]> {
  // Cap permutation search at 8 elements (40320) to avoid pathological cases.
  if (arr.length > 8) {
    yield arr;
    return;
  }
  if (arr.length <= 1) {
    yield arr.slice();
    return;
  }
  const indices = arr.map((_, i) => i);
  const c = new Array(arr.length).fill(0);
  yield arr.slice();
  let i = 0;
  while (i < arr.length) {
    if (c[i] < i) {
      const swapIdx = i % 2 === 0 ? 0 : c[i];
      const tmp = indices[i]!;
      indices[i] = indices[swapIdx]!;
      indices[swapIdx] = tmp;
      yield indices.map((idx) => arr[idx]!);
      c[i] += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
}
