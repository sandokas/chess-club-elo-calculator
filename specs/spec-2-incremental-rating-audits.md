# Spec 2: Incremental Rating Updates And Auditable Match History

## Implementation Status

Partially implemented in June 2026.

Implemented:

- transactional, serialized per-match rating application
- complete before/after match audit persistence
- explicit `ratingConfig` use in incremental and full recomputation paths
- idempotent result submission and O(1) latest-result replacement/undo
- latest-game detection across both player colors
- regression coverage for incremental chaining and audit storage

Still proposed:

- bounded suffix replay for arbitrary historical corrections
- transactional full-club recomputation and its remaining repair invariants

## Context

The application calculates Elo and Glicko-2 ratings when a match result is entered. The current live result path updates `player_ratings` and stores the players' pre-match values on `matches`, but it does not store the calculated post-match values. Player history therefore receives `NULL` for `eloAfter` and `glickoRatingAfter` and renders `N/A` even though the current player ratings have changed.

The rating formula is sequential: every match must start from the ratings produced by the preceding rated matches. Normal result entry must preserve that chain without replaying the club's complete history after every game.

This repository requires exactly one source of truth. Live result entry, tournament processing, corrections, and full recomputation must all use the same rating transition and persistence model.

## Goals

- Calculate and persist rating changes incrementally when a result is entered.
- Make a newly completed game an O(1) rating operation, excluding fixed database work.
- Store complete before/after Elo and Glicko audit values on every rated match.
- Guarantee that the next match reads the preceding match's resulting player rating.
- Use one canonical per-match rating transition for individual games, tournament workflows, corrections, and full recomputation.
- Make result and rating updates atomic.
- Support bounded replay when historical results are corrected without normally replaying the club's entire history.
- Repair existing matches whose post-match audit values are missing.

## Non-Goals

- Do not recalculate the entire club after every new result.
- Do not introduce a second Elo or Glicko implementation for tournaments.
- Do not calculate displayed changes in the web client from current player ratings.
- Do not use schema defaults or hardcoded rating constants as fallbacks.
- Do not change the configured Elo or Glicko formulas in this work.
- Do not treat a bye as a rated match.

## Rating Invariants

For every completed, non-bye match:

```text
match.before == player rating immediately before the match
match.after  == canonical rating transition(match.before, opponent.before, result)
next relevant match.before == previous match.after
current player_ratings == the player's latest completed match.after
```

The invariant applies to all stored rating dimensions:

- Elo
- Glicko rating
- Glicko rating deviation
- Glicko volatility
- games played
- last game date

`ratingConfig` from `@chess-club/config` is the only source of rating defaults and parameters. Every rating transition and replay must receive it explicitly.

## Canonical Match Order

Rating operations need one deterministic order shared by incremental checks and replay.

The canonical order is:

1. `played_on` ascending
2. match ID ascending

All code that answers "is this the latest game?", selects a replay suffix, or performs a full recomputation must use this ordering. A helper should own this ordering rule so SQL predicates and in-memory sorting do not silently diverge.

If tournament round order is intended to override match ID order for games on the same date, that must be introduced as a separate schema/design change. Until then, existing `played_on, id` behavior remains canonical.

## Required Design

### Canonical Per-Match Transition

`applyRatedMatch()` remains the single pure rating transition. Given two pre-match profiles, the result, match date, and `ratingConfig`, it returns:

- updated white profile
- updated black profile
- complete match audit containing before and after values for both players

Callers must persist the returned audit. They must not reconstruct audit fields independently from parts of the returned profiles.

The transition must not read from or write to the database. Database orchestration belongs to one shared rating application service.

### Incremental Result Entry

When a previously unplayed match receives a result:

1. Start a database transaction.
2. Lock the club's rating mutation scope so two results cannot apply concurrently from the same starting ratings.
3. Load both players' current `player_ratings` rows.
4. Verify that the match is appendable in canonical rating order for both players.
5. Build the two pre-match profiles, including `lastGameDate`.
6. Call `applyRatedMatch(..., ratingConfig)` exactly once.
7. Update the match with the result and every before/after audit field returned by the transition.
8. Update both `player_ratings` rows with the returned profiles.
9. Commit the transaction.

The match result, audit snapshots, and current ratings must never be committed independently.

Tournament result entry uses this same operation once per game. A tournament-level workflow may process several games in canonical order inside one transaction or a controlled sequence, but it must not implement separate rating math.

### Appendability Check

A match can be applied incrementally only when neither player has a later completed rated match in canonical order.

The check must consider each player's appearances as both white and black. The current color-specific check is insufficient because it can miss a later game where the player changed colors.

Conceptually:

```sql
WHERE (white_player_id = $playerId OR black_player_id = $playerId)
  AND result IS NOT NULL
  AND black_player_id IS NOT NULL
  AND (played_on, id) > ($playedOn, $matchId)
```

This policy prevents a new result from being inserted into the middle of an already-applied rating chain without replay.

### Correcting The Latest Result

Changing or clearing the latest rated result for both players is also an O(1) operation.

- The stored before snapshots are the rollback state.
- Replacing a result recalculates from those before snapshots and overwrites the match audit and current ratings.
- Clearing a result restores both players to the stored before profiles, clears the result, and clears all audit fields.
- Submitting the same result again is idempotent and must not increment games played or apply ratings twice.
- If required before snapshots are absent, the operation must not partially proceed; it must use replay/repair or return a validation error.

### Historical Corrections And Bounded Replay

If either player has a later rated game, the changed match cannot be corrected with an isolated transition because its effects may propagate through later opponents.

The correction path must:

1. Identify the changed match's position in canonical club order.
2. Replay the club's chronological suffix beginning at that match, not the history preceding it.
3. Seed each player from their last valid state before their first match in the suffix.
4. Apply every rated suffix match through `applyRatedMatch(..., ratingConfig)`.
5. Persist all affected match audits and final player ratings atomically.

Replaying the club suffix is intentionally broader than replaying only one player's games. A changed rating affects an opponent, whose changed rating can then affect another opponent.

If the boundary snapshots needed to seed a trustworthy suffix are missing or inconsistent, fall back to the explicit full-club repair operation. Silent fallback values are forbidden.

### Full-Club Recompute

The existing admin recompute operation remains a repair and verification tool, not the normal result-entry path.

It must:

- use the same `applyRatedMatch()` transition and `ratingConfig`
- replay all completed non-bye matches in canonical order
- update both current player ratings and complete match audits
- reset players to configured defaults when the club has no completed matches
- run atomically

The service should accept either the root database object or a transaction so result correction and administrative repair can share it without duplicating logic.

## Persistence Requirements

For each rated match, persist:

- `white_elo_before`
- `white_elo_after`
- `black_elo_before`
- `black_elo_after`
- `white_glicko_rating_before`
- `white_glicko_rating_after`
- `white_glicko_rd_before`
- `white_glicko_rd_after`
- `white_glicko_vol_before`
- `white_glicko_vol_after`
- corresponding black Glicko fields
- `white_last_played_before`
- `black_last_played_before`

The existing match audit columns remain the source of truth for displayed historical change and O(1) rollback of the latest result.

`player_ratings` remains the source of truth for each player's current rating state.

## Concurrency And Atomicity

Rating mutations for one club must be serialized. Locking only individual player rows can deadlock when simultaneous matches acquire players in different orders and does not protect suffix replay cleanly.

Preferred approach:

- acquire a transaction-scoped lock keyed by club ID, or lock the club row
- perform validation, transition, match audit write, and player rating writes in the same transaction

Mutations in different clubs may proceed concurrently.

## API And UI Behavior

No response shape change is required for player history.

The player detail API continues to return the appropriate side's before/after match fields. The web client calculates display deltas from those audit values.

The web client should check for `null`/`undefined` explicitly rather than using truthiness:

```ts
const hasEloAudit = match.eloBefore != null && match.eloAfter != null;
```

This is defensive display logic only. It must not conceal missing database audits by deriving them from unrelated values.

## Existing Data Repair

The affected June 2026 matches have populated before values and `NULL` after values. After the implementation is deployed:

1. Run the full-club recompute once for each affected club.
2. Verify that completed non-bye matches have all required before/after fields.
3. Compare final recomputed player ratings with `player_ratings` and investigate any difference before accepting the repair.

Do not populate missing after values by copying the next match's before value. That fails for a player's final match and can be wrong when ordering or intervening games differ.

## Testing Requirements

All database-touching tests must use real Postgres according to `TESTING.md`.

### Incremental Application

- A completed match stores all before and after audit fields.
- Both `player_ratings` rows equal the stored after profiles.
- A player's second match starts from the first match's after profile.
- A sequence of incremental results equals a clean full recomputation exactly within the established numeric tolerance.
- Configured values from `business_config.json` are used rather than duplicated defaults.
- A bye does not change ratings or games played.

### Result Changes

- Repeating the same result is idempotent.
- Replacing the latest result recalculates once from its stored before profile.
- Clearing the latest result restores its stored before profile and clears its audits.
- A missing required audit causes a safe error or explicit repair path, not a partial update.

### Ordering And Replay

- Later matches are detected regardless of whether a player appears as white or black.
- A historical correction replays the required suffix and updates downstream opponents.
- Matches before the replay boundary are unchanged.
- Incremental processing, suffix replay, and full replay produce the same ratings for the same ordered results.

### Transactions And Concurrency

- A forced failure after the match update rolls back the result, audits, and player ratings.
- Concurrent results within one club cannot read the same stale player rating state.
- Results in different clubs are not unnecessarily serialized.

### History Display

- The player detail route returns the correct side's audit values.
- The web page displays signed Elo and Glicko changes when both values exist.
- The web page displays `N/A` only when an audit is genuinely unavailable.

## Acceptance Criteria

- Entering a normal new result does not replay prior club matches.
- Every newly rated match has complete before/after audits.
- The next match for a player starts from the preceding match's after state.
- Individual and tournament workflows call the same canonical transition.
- Historical correction performs at most a bounded suffix replay unless repair data is missing.
- Full recompute remains available and produces the same final state as incremental processing.
- All rating parameters come from `ratingConfig`.
- No result, audit, or current rating can be partially committed.
- Existing missing audits can be repaired by the documented full recompute.
