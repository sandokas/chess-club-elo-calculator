"""Configuration loader.

This module loads configuration from JSON files under the ``configs``
package. Business-facing configuration lives in
``configs/business_config.json`` while operational/runtime configuration
lives in ``configs/operational_config.json``.

If the JSON files are missing, sensible defaults are used so the project
continues to work.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

# Paths: prefer environment override, then project-level `configs/`, then
# package-level `configs/` (for backwards compatibility).
PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGE_CONFIG_DIR = PACKAGE_DIR / "configs"

# Project root is two levels up from the package (src/chess_club -> src -> project)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROJECT_CONFIG_DIR = PROJECT_ROOT / "configs"

# Allow overriding config location with env var `CHESS_CLUB_CONFIG_DIR`
env_dir = os.getenv("CHESS_CLUB_CONFIG_DIR")
if env_dir:
	CONFIG_DIR = Path(env_dir)
elif PROJECT_CONFIG_DIR.exists():
	CONFIG_DIR = PROJECT_CONFIG_DIR
else:
	CONFIG_DIR = PACKAGE_CONFIG_DIR

BUSINESS_CONFIG_PATH = CONFIG_DIR / "business_config.json"
OPERATIONAL_CONFIG_PATH = CONFIG_DIR / "operational_config.json"

_DEFAULTS_BUSINESS: Dict[str, Any] = {
	"MIN_GAMES_FOR_OFFICIAL": 10,
	"SHOW_PROVISIONAL_IN_LEADERBOARD": True,
	"RATING_SYSTEM": "both",
	"G2_DEFAULT_RATING": 1200.0,
	"G2_DEFAULT_RD": 350.0,
	"G2_DEFAULT_VOL": 0.06,
	# Per-day RD increase constant used to grow RD with inactivity (units: rating points/day)
	"G2_RD_INCREASE_PER_DAY": 1.0,
	"ELO_K_THRESHOLDS": [20, 50],
	"ELO_K_VALUES": [40, 20, 10],
	"ELO_DECIMALS": 2,
	"DEFAULT_ELO": 1200,
}

_DEFAULTS_OPERATIONAL: Dict[str, Any] = {
	"DB_PATH": "chessclub.db",
}


def _load_json(path: Path, defaults: Dict[str, Any]) -> Dict[str, Any]:
	if not path.exists():
		return dict(defaults)
	try:
		with path.open("r", encoding="utf-8") as fh:
			data = json.load(fh)
			if not isinstance(data, dict):
				return dict(defaults)
			merged = dict(defaults)
			merged.update(data)
			return merged
	except Exception:
		return dict(defaults)


_BUSINESS = _load_json(BUSINESS_CONFIG_PATH, _DEFAULTS_BUSINESS)
_OPERATIONAL = _load_json(OPERATIONAL_CONFIG_PATH, _DEFAULTS_OPERATIONAL)


# Business config
MIN_GAMES_FOR_OFFICIAL: int = _BUSINESS["MIN_GAMES_FOR_OFFICIAL"]
SHOW_PROVISIONAL_IN_LEADERBOARD: bool = _BUSINESS["SHOW_PROVISIONAL_IN_LEADERBOARD"]
RATING_SYSTEM: str = _BUSINESS["RATING_SYSTEM"]
G2_DEFAULT_RATING: float = _BUSINESS["G2_DEFAULT_RATING"]
G2_DEFAULT_RD: float = _BUSINESS["G2_DEFAULT_RD"]
G2_DEFAULT_VOL: float = _BUSINESS["G2_DEFAULT_VOL"]
G2_RD_INCREASE_PER_DAY: float = _BUSINESS["G2_RD_INCREASE_PER_DAY"]
DEFAULT_ELO: int = _BUSINESS["DEFAULT_ELO"]

# Operational config
DB_PATH: str = _OPERATIONAL["DB_PATH"]



def reload() -> None:
	"""Reload configuration from JSON files at runtime.

	Call this if you change the JSON files and want the module-level
	variables to reflect the new values.
	"""
	global _BUSINESS, _OPERATIONAL
	global MIN_GAMES_FOR_OFFICIAL, SHOW_PROVISIONAL_IN_LEADERBOARD, RATING_SYSTEM
	global DB_PATH, G2_DEFAULT_RATING, G2_DEFAULT_RD, G2_DEFAULT_VOL, DEFAULT_ELO

	_BUSINESS = _load_json(BUSINESS_CONFIG_PATH, _DEFAULTS_BUSINESS)
	_OPERATIONAL = _load_json(OPERATIONAL_CONFIG_PATH, _DEFAULTS_OPERATIONAL)

	MIN_GAMES_FOR_OFFICIAL = _BUSINESS["MIN_GAMES_FOR_OFFICIAL"]
	SHOW_PROVISIONAL_IN_LEADERBOARD = _BUSINESS["SHOW_PROVISIONAL_IN_LEADERBOARD"]
	RATING_SYSTEM = _BUSINESS["RATING_SYSTEM"]
	G2_DEFAULT_RATING = _BUSINESS["G2_DEFAULT_RATING"]
	G2_DEFAULT_RD = _BUSINESS["G2_DEFAULT_RD"]
	G2_DEFAULT_VOL = _BUSINESS["G2_DEFAULT_VOL"]
	G2_RD_INCREASE_PER_DAY = _BUSINESS["G2_RD_INCREASE_PER_DAY"]
	DEFAULT_ELO = _BUSINESS["DEFAULT_ELO"]
	DB_PATH = _OPERATIONAL["DB_PATH"]


