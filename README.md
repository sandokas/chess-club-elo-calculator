Chess Club Manager

````markdown
Chess Club Manager

Overview
- Small CLI app to manage players, tournaments and ratings (Elo and Glicko‑2).

Quick start

- Install editable (recommended) and use the console script:

```bash
pip install -e .
chess-club
```

- Or run without installing (from the repository root):

```bash
PYTHONPATH=src python -m chess_club
```

- Quick import check:

```bash
python -c "import chess_club; print('module loads OK')"
```

Files
- `elo.py` — Elo calculation helpers
- `glicko2.py` — Glicko‑2 helpers
- `ratings.py` — rating orchestration (Elo/Glicko)
- `db.py` — sqlite connection and schema initialization
- `repo.py` — database query wrappers
- `tournament.py` — tournament logic and helpers
- `ranking.py` — leaderboard and recompute logic
- `cli.py` / `__main__.py` — CLI entry (console script `chess-club` / `python -m chess_club`)
- `config.py` — runtime loader that reads JSON configs in `configs/`

Usage notes
- Configuration is now split between JSON files under the repository-level `configs/` directory:
	- `configs/business_config.json` — business-facing settings (rating system, thresholds, rating defaults).
	- `configs/operational_config.json` — operational/runtime settings (DB path, etc.).

- The module `src/chess_club/config.py` looks for configuration in this order:
	1. Directory set by `CHESS_CLUB_CONFIG_DIR` environment variable
	2. Repository-level `configs/` directory
	3. Package fallback `src/chess_club/configs/`

	It exposes the same top-level names used elsewhere (e.g. `RATING_SYSTEM`, `DB_PATH`, `G2_DEFAULT_RATING`).
	You can call `chess_club.config.reload()` at runtime to pick up changes to the JSON files.

- ELO-related settings in the business config:
	- `ELO_K_THRESHOLDS` and `ELO_K_VALUES` — control `k_factor()` behavior (defaults: thresholds [20,50], values [40,20,10]).
	- `ELO_DECIMALS` — number of decimals used when rounding Elo updates (default 2).

- Standard Elo constants (base=10 and divisor=400) remain in the code as the canonical chess formula.

-- Default DB path is `chessclub.db`. Change `DB_PATH` in `configs/operational_config.json` to use a different file or location.

Testing
- Run the test suite with:

```bash
pytest
```

Contributing / Development
- Work from the project root. When running directly, ensure Python can import `src` (via `PYTHONPATH=src` or by installing editable with `pip install -e .`).

````
