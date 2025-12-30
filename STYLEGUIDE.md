# Chess Club STYLEGUIDE

Purpose
- Document small, practical conventions used in this repo so contributors and automated agents produce consistent, readable code.

Core rules
- None checks: use explicit presence checks. Prefer positive form when acting on a present value:
  - Good: `if val is not None:`
  - Avoid: `if val == None` or `if not val` for distinguishing None from falsy values (0, "", []).
- Simple fallbacks: use ternary one-liners for short assignments:
  - `elo_display = f"Elo:{elo:.1f}" if elo is not None else "Elo:(none)"`
  - Use this where the branch is a single expression.
- Multi-statement logic: use full `if/else` blocks when either branch contains multiple statements or side-effects.

Display placeholders and formatting
- Use explicit placeholders for missing numeric ratings (recommended): `Elo:(none)` / `G2:(none)`.
- Always guard numeric formatting (e.g., `:.1f`) with a presence check to avoid TypeError.
- Prefer f-strings for clarity and consistency.

Imports and project structure
- Use absolute imports within package: `import chess_club.repo as repo`.
- Keep imports at module top (PEP8).

Database access and performance
- Use the `repo` layer for all DB access; do not run ad-hoc SQL across the codebase.
- Avoid N+1 queries in CLI/display code: prefetch needed columns (e.g., `elo`, `g2_rating`, `g2_rd`, `g2_vol`) in `repo.list_players()` and related functions.
- Application defaults belong in configuration (e.g., `configs/business_config.json` and `src/chess_club/config.py`), not as SQL column defaults. Use `config.DEFAULT_ELO` when initializing or recomputing ratings.

Ratings policy (project-specific rules)
- Always compute and persist both rating systems (Elo and Glicko-2) behind the scenes.
- `RATING_SYSTEM` is a display/ordering flag only — do not change computation logic based on this setting.
- Recompute functions should explicitly reset and recompute both systems (`recompute_elos` and `recompute_glicko`).

Error handling
- Prefer catching specific exceptions. Use broad `except Exception:` only when re-raising or logging and when truly necessary.

Style and tooling
- Formatting: use `black` (or whatever project formatter) with the project's line length (default 88 unless configured).
- Type hints: use them for public functions where it improves clarity.
- Naming: `snake_case` for functions and variables, `UPPER_SNAKE` for constants.

Tests and CI
- Tests should rely on `config.DEFAULT_ELO` (or set a test-specific config) instead of hardcoding numeric defaults.
- When changing displayed row shapes (e.g., adding prefetched columns), update tests to match the returned tuples.

Small examples
- Preferred (ternary fallback):
```
elo_display = f"Elo:{elo:.1f}" if elo is not None else "Elo:(none)"
g2_display = f"G2:{g2:.1f}" if g2 is not None else "G2:(none)"
```
- Preferred (multi-line for complexity):
```
if elo is not None:
    elo_part = f"Elo:{elo:.1f}"
    # additional formatting or logging
else:
    elo_part = "Elo:(none)"
```

PR checklist for reviewers
- Run tests: `python -m pytest -q`.
- Run formatter and style checks (if present).
- Verify no N+1 queries introduced in CLI/display code.
- Confirm display fallbacks are explicit and guarded.

Notes
- This guide is intentionally small and pragmatic. Add rules here when they represent an established project preference.
