from math import pow
from . import config


def expected_score(rating_a, rating_b, base: float = 10.0, divisor: float = 400.0) -> float:
    """Return the expected score for player A vs player B.

    Uses the standard Elo logistic formula: 1 / (1 + base^((Rb - Ra)/divisor)).
    """
    return 1 / (1 + base ** ((rating_b - rating_a) / divisor))


def k_factor(games_played: int) -> int:
    """Return the K-factor based on game-count thresholds from config.

    Config uses two arrays: `ELO_K_THRESHOLDS` and `ELO_K_VALUES`.
    Example default: thresholds [20,50], values [40,20,10].
    """
    thresholds = getattr(config, "ELO_K_THRESHOLDS", [20, 50])
    values = getattr(config, "ELO_K_VALUES", [40, 20, 10])
    for idx, t in enumerate(thresholds):
        if games_played < t:
            return values[idx]
    return values[-1]


def update_elo(rating_a: float, rating_b: float, score_a: float, k_a: int, k_b: int):
    """Compute new Elo ratings and round according to config decimals."""
    exp_a = expected_score(rating_a, rating_b)
    exp_b = 1 - exp_a

    s_a = score_a
    s_b = 1 - score_a

    new_a = rating_a + k_a * (s_a - exp_a)
    new_b = rating_b + k_b * (s_b - exp_b)

    decimals = getattr(config, "ELO_DECIMALS", 2)
    return round(new_a, decimals), round(new_b, decimals)

