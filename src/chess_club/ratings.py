import chess_club.elo as elo
import chess_club.glicko2 as glicko2
import chess_club.repo as repo
import chess_club.config as config
from datetime import date
import math


def compute_elo_change(elo1, elo2, games1, games2, result):
    """Compute new Elo values for a single match (pure compute).

    Returns (new_elo1, new_elo2).
    """
    k1 = elo.k_factor(games1)
    k2 = elo.k_factor(games2)
    return elo.update_elo(elo1, elo2, result, k1, k2)


def compute_glicko_update(r1, rd1, vol1, r2, rd2, vol2, result, days1: int = 0, days2: int = 0):
    """Compute Glicko-2 updates for both players given before-values and inactivity days.

    Returns ((new_r1,new_rd1,new_vol1), (new_r2,new_rd2,new_vol2)).
    """
    rd2_star = glicko2.inflate_rd(rd2, days2)
    rd1_star = glicko2.inflate_rd(rd1, days1)

    new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2_star, vol2, result, days=days1)
    new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1_star, vol1, 1 - result, days=days2)

    return (new_r1, new_rd1, new_vol1), (new_r2, new_rd2, new_vol2)


def compute_match(conn, p1_id, p2_id, result, match_date: str = None,
                  games_played_override_p1: int = None, games_played_override_p2: int = None,
                  last_played_override_p1: str = None, last_played_override_p2: str = None):
    """Compute rating changes for a match without persisting any DB state.

    Returns a dict with before/after values for both systems.
    """
    out = {
        'p1_elo_before': None, 'p1_elo_after': None,
        'p2_elo_before': None, 'p2_elo_after': None,
        'p1_g2_before': None, 'p1_g2_after': None,
        'p2_g2_before': None, 'p2_g2_after': None,
        'p1_g2_rd_before': None, 'p1_g2_rd_after': None,
        'p2_g2_rd_before': None, 'p2_g2_rd_after': None,
        'p1_g2_vol_before': None, 'p1_g2_vol_after': None,
        'p2_g2_vol_before': None, 'p2_g2_vol_after': None,
    }

    # Elo computation
    p1 = repo.get_player(conn, p1_id)
    p2 = repo.get_player(conn, p2_id)
    r1 = p1[2]
    r2 = p2[2]
    # Allow caller to provide games-played counts (useful for replaying matches)
    g1 = games_played_override_p1 if games_played_override_p1 is not None else repo.games_played_for_player(conn, p1_id)
    g2 = games_played_override_p2 if games_played_override_p2 is not None else repo.games_played_for_player(conn, p2_id)
    k1 = elo.k_factor(g1)
    k2 = elo.k_factor(g2)
    new1, new2 = elo.update_elo(r1, r2, result, k1, k2)
    out.update({
        'p1_elo_before': r1, 'p1_elo_after': new1,
        'p2_elo_before': r2, 'p2_elo_after': new2,
    })

    # Glicko-2 computation
    g1 = repo.get_player_glicko(conn, p1_id)
    g2 = repo.get_player_glicko(conn, p2_id)
    # Elo computation
    p1 = repo.get_player(conn, p1_id)
    p2 = repo.get_player(conn, p2_id)
    r1 = p1[2] if p1 else config.DEFAULT_ELO
    r2 = p2[2] if p2 else config.DEFAULT_ELO
    # Allow caller to provide games-played counts (useful for replaying matches)
    g1 = games_played_override_p1 if games_played_override_p1 is not None else repo.games_played_for_player(conn, p1_id)
    g2 = games_played_override_p2 if games_played_override_p2 is not None else repo.games_played_for_player(conn, p2_id)
    k1 = elo.k_factor(g1)
    k2 = elo.k_factor(g2)
    new1, new2 = elo.update_elo(r1, r2, result, k1, k2)
    out.update({
        'p1_elo_before': r1, 'p1_elo_after': new1,
        'p2_elo_before': r2, 'p2_elo_after': new2,
    })

    # Glicko-2 computation
    g1_row = repo.get_player_glicko(conn, p1_id)
    g2_row = repo.get_player_glicko(conn, p2_id)
    if not g1_row or g1_row[0] is None:
        r1, rd1, vol1 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
    else:
        r1, rd1, vol1 = g1_row
    if not g2_row or g2_row[0] is None:
        r2, rd2, vol2 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
    else:
        r2, rd2, vol2 = g2_row

    days1 = 0
    days2 = 0
    if match_date:
        try:
            md = date.fromisoformat(match_date)
            # Allow caller to provide last-played override for replay scenarios
            p1_last_played = last_played_override_p1 if last_played_override_p1 is not None else (p1[3] if p1 else None)
            p2_last_played = last_played_override_p2 if last_played_override_p2 is not None else (p2[3] if p2 else None)
            if p1_last_played:
                days1 = (md - date.fromisoformat(p1_last_played)).days
                if days1 < 0:
                    days1 = 0
            if p2_last_played:
                days2 = (md - date.fromisoformat(p2_last_played)).days
                if days2 < 0:
                    days2 = 0
        except Exception:
            days1 = 0
            days2 = 0

    rd2_star = glicko2.inflate_rd(rd2, days2)
    rd1_star = glicko2.inflate_rd(rd1, days1)

    new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2_star, vol2, result, days=days1)
    new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1_star, vol1, 1 - result, days=days2)

    out.update({
        'p1_g2_before': r1, 'p1_g2_after': new_r1,
        'p1_g2_rd_before': rd1, 'p1_g2_rd_after': new_rd1,
        'p1_g2_vol_before': vol1, 'p1_g2_vol_after': new_vol1,
        'p2_g2_before': r2, 'p2_g2_after': new_r2,
        'p2_g2_rd_before': rd2, 'p2_g2_rd_after': new_rd2,
        'p2_g2_vol_before': vol2, 'p2_g2_vol_after': new_vol2,
    })

    return out
