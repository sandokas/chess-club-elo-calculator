import chess_club.elo as elo
import chess_club.glicko2 as glicko2
import chess_club.repo as repo
import chess_club.config as config
from datetime import date
import math


def process_match(conn, p1_id, p2_id, result, match_date: str = None):
    """Process a match and update player ratings according to configured system.

    Returns a dict with before/after values for both systems (may be None).
    """
    out = {
        'p1_elo_before': None, 'p1_elo_after': None,
        'p2_elo_before': None, 'p2_elo_after': None,
        'p1_g2_before': None, 'p1_g2_after': None,
        'p2_g2_before': None, 'p2_g2_after': None,
    }

    # Always compute Elo (update DB column)
    p1 = repo.get_player(conn, p1_id)
    p2 = repo.get_player(conn, p2_id)
    r1 = p1[2]
    r2 = p2[2]
    g1 = repo.games_played_for_player(conn, p1_id)
    g2 = repo.games_played_for_player(conn, p2_id)
    k1 = elo.k_factor(g1)
    k2 = elo.k_factor(g2)
    new1, new2 = elo.update_elo(r1, r2, result, k1, k2)
    repo.update_player_elo(conn, p1_id, new1)
    repo.update_player_elo(conn, p2_id, new2)
    out.update({
        'p1_elo_before': r1, 'p1_elo_after': new1,
        'p2_elo_before': r2, 'p2_elo_after': new2,
    })

    # Glicko-2 branch
    # Always compute Glicko-2 (update separate columns)
    g1 = repo.get_player_glicko(conn, p1_id)
    g2 = repo.get_player_glicko(conn, p2_id)
    if not g1 or g1[0] is None:
        r1, rd1, vol1 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
    else:
        r1, rd1, vol1 = g1
    if not g2 or g2[0] is None:
        r2, rd2, vol2 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
    else:
        r2, rd2, vol2 = g2

    # compute days since last game for each player (if match_date provided)
    days1 = 0
    days2 = 0
    if match_date:
        try:
            md = date.fromisoformat(match_date)
            g1_summary = repo.get_player_summary(conn, p1_id)
            g2_summary = repo.get_player_summary(conn, p2_id)
            last1 = g1_summary[4]
            last2 = g2_summary[4]
            if last1:
                days1 = (md - date.fromisoformat(last1)).days
                if days1 < 0:
                    days1 = 0
            if last2:
                days2 = (md - date.fromisoformat(last2)).days
                if days2 < 0:
                    days2 = 0
        except Exception:
            days1 = 0
            days2 = 0

    # Pre-inflate opponent RD for expected score calculation so both players'
    # inactivity is considered symmetrically.
    rd2_star = glicko2.inflate_rd(rd2, days2)
    rd1_star = glicko2.inflate_rd(rd1, days1)

    new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2_star, vol2, result, days=days1)
    new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1_star, vol1, 1 - result, days=days2)

    repo.update_player_glicko(conn, p1_id, new_r1, new_rd1, new_vol1)
    repo.update_player_glicko(conn, p2_id, new_r2, new_rd2, new_vol2)

    out.update({
        'p1_g2_before': r1, 'p1_g2_after': new_r1,
        'p1_g2_rd_before': rd1, 'p1_g2_rd_after': new_rd1,
        'p1_g2_vol_before': vol1, 'p1_g2_vol_after': new_vol1,
        'p2_g2_before': r2, 'p2_g2_after': new_r2,
        'p2_g2_rd_before': rd2, 'p2_g2_rd_after': new_rd2,
        'p2_g2_vol_before': vol2, 'p2_g2_vol_after': new_vol2,
    })

        # Do not mirror Glicko ratings into the Elo column. Keep systems separate.

    return out
