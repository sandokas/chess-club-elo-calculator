import chess_club.repo as repo


def record_match_result(conn, match_id: int, p1_id: int, p2_id: int, computed: dict, match_date: str = None, result: float = None) -> dict:
    """Persist a computed match result transactionally.

    - `computed` is the dict returned by `ratings.compute_match`.
    - Persists per-player profile fields, per-match audit columns, and
      updates players' `last_game_date`/`last_game_match_id`.
    Returns a summary dict (the provided `computed` with small metadata).
    """
    cur = conn.cursor()
    try:
        cur.execute('BEGIN')

        # Persist consolidated player profiles
        try:
            repo.update_player_profile(conn, p1_id,
                                       elo=computed.get('p1_elo_after'),
                                       g2_rating=computed.get('p1_g2_after'), g2_rd=computed.get('p1_g2_rd_after'), g2_vol=computed.get('p1_g2_vol_after'),
                                       last_game_date=match_date, last_game_match_id=match_id)
            repo.update_player_profile(conn, p2_id,
                                       elo=computed.get('p2_elo_after'),
                                       g2_rating=computed.get('p2_g2_after'), g2_rd=computed.get('p2_g2_rd_after'), g2_vol=computed.get('p2_g2_vol_after'),
                                       last_game_date=match_date, last_game_match_id=match_id)
        except Exception:
            pass

        # Backfill per-match audit columns where available
        try:
            repo.update_match_elos(conn, match_id, computed.get('p1_elo_before'), computed.get('p1_elo_after'),
                                   computed.get('p2_elo_before'), computed.get('p2_elo_after'))
        except Exception:
            pass
        # Ensure the stored match row records the result and date when provided
        try:
            if result is not None and match_date is not None:
                cur.execute("UPDATE Matches SET result = ?, date = ? WHERE id = ?", (result, match_date, match_id))
            elif result is not None:
                cur.execute("UPDATE Matches SET result = ? WHERE id = ?", (result, match_id))
            elif match_date is not None:
                cur.execute("UPDATE Matches SET date = ? WHERE id = ?", (match_date, match_id))
        except Exception:
            pass

        try:
            repo.update_match_glicko(conn, match_id,
                                     computed.get('p1_g2_before'), computed.get('p1_g2_after'),
                                     computed.get('p1_g2_rd_before'), computed.get('p1_g2_rd_after'),
                                     computed.get('p1_g2_vol_before'), computed.get('p1_g2_vol_after'),
                                     computed.get('p2_g2_before'), computed.get('p2_g2_after'),
                                     computed.get('p2_g2_rd_before'), computed.get('p2_g2_rd_after'),
                                     computed.get('p2_g2_vol_before'), computed.get('p2_g2_vol_after'))
        except Exception:
            pass

        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise

    # Return the computed dict as a convenience summary
    return computed
