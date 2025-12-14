from . import elo, glicko2, repo, config


def process_match(conn, p1_id, p2_id, result):
    """Process a match and update player ratings according to configured system.

    Returns a dict with before/after values for both systems (may be None).
    """
    out = {
        'p1_elo_before': None, 'p1_elo_after': None,
        'p2_elo_before': None, 'p2_elo_after': None,
        'p1_g2_before': None, 'p1_g2_after': None,
        'p2_g2_before': None, 'p2_g2_after': None,
    }

    # Elo branch
    if config.RATING_SYSTEM in ('elo', 'both'):
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
    if config.RATING_SYSTEM in ('glicko2', 'both'):
        # get current glicko or defaults; handle NULL/None DB values
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

        # update both players
        new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2, vol2, result)
        # opponent perspective: score for player2 is 1 - result
        new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1, vol1, 1 - result)

        repo.update_player_glicko(conn, p1_id, new_r1, new_rd1, new_vol1)
        repo.update_player_glicko(conn, p2_id, new_r2, new_rd2, new_vol2)

        out.update({
            'p1_g2_before': r1, 'p1_g2_after': new_r1,
            'p2_g2_before': r2, 'p2_g2_after': new_r2,
        })

        # Do not mirror Glicko ratings into the Elo column. Keep systems separate.

    return out
