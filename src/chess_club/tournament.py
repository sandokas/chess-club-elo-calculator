from . import repo, elo
import chess_club.ranking as ranking
import chess_club.ratings as ratings
import chess_club.service as service


def add_player_to_tournament(conn, tournament_id: int, player_id: int):
    return repo.add_tournament_player(conn, tournament_id, player_id)


def create_match(conn, tournament_id: int, pid1: int, pid2: int, result: float, match_date: str):
    """Create a match row (no result) and apply a result atomically.

    Uses `repo.create_match` to insert the scheduled match, then calls
    `repo.update_match_result` to apply the provided `result`.
    """
    # Prevent recording matches for completed tournaments
    if repo.is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")

    p1 = repo.get_player(conn, pid1)
    p2 = repo.get_player(conn, pid2)
    if not p1 or not p2:
        raise ValueError("Player not found")

    try:
        conn.execute('BEGIN')
        match_id = repo.create_match(conn, tournament_id, pid1, pid2, match_date)
        # compute ratings (pure) and persist via service layer
        out = ratings.compute_match(conn, pid1, pid2, result, match_date)
        service.record_match_result(conn, match_id, pid1, pid2, out, match_date, result)
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise

    return (p1[1], out.get('p1_elo_after') or out.get('p1_g2_after'), p2[1], out.get('p2_elo_after') or out.get('p2_g2_after'))


def create_match_with_result(conn, tournament_id: int, pid1: int, pid2: int, result: float, match_date: str):
    """Create a match and immediately apply its result.

    This is a convenience wrapper around `create_match` + `update_match_result`.
    """
    if repo.is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")

    match_id = repo.create_match(conn, tournament_id, pid1, pid2, match_date)
    out = ratings.compute_match(conn, pid1, pid2, result, match_date)
    service.record_match_result(conn, match_id, pid1, pid2, out, match_date, result)
    p1 = repo.get_player(conn, pid1)
    p2 = repo.get_player(conn, pid2)
    return (p1[1], out.get('p1_elo_after') or out.get('p1_g2_after'), p2[1], out.get('p2_elo_after') or out.get('p2_g2_after'))


def complete_tournament(conn, tournament_id: int):
    t = repo.get_tournament(conn, tournament_id)
    if not t:
        raise ValueError("Tournament not found")
    repo.complete_tournament(conn, tournament_id)


def reopen_tournament(conn, tournament_id: int):
    t = repo.get_tournament(conn, tournament_id)
    if not t:
        raise ValueError("Tournament not found")
    repo.reopen_tournament(conn, tournament_id)


def update_match(conn, match_id: int, result: float, date: str = None):
    """Update a match result and recompute affected ratings.

    This delegates to `repo.update_match_result` (which applies the result
    and persists audit fields) and then attempts a targeted recompute via
    `ranking.recompute_from_match`, falling back to a full recompute if
    per-match audit data is missing.
    """
    m = repo.get_match(conn, match_id)
    if not m:
        raise ValueError("Match not found")
    _, tid, p1, p2, _, _ = m

    if repo.is_tournament_completed(conn, tid):
        raise ValueError("Tournament is completed")

    # Update the stored match row
    repo.update_match_result(conn, match_id, result, date)

    # Compute and persist rating/profile changes at business layer
    m = repo.get_match(conn, match_id)
    _, _, p1_id, p2_id, _, match_date = m
    out = ratings.compute_match(conn, p1_id, p2_id, result, match_date)
    try:
        repo.update_player_profile(conn, p1_id, elo=out.get('p1_elo_after'),
                                   g2_rating=out.get('p1_g2_after'), g2_rd=out.get('p1_g2_rd_after'), g2_vol=out.get('p1_g2_vol_after'),
                                   last_game_date=match_date, last_game_match_id=match_id)
        repo.update_player_profile(conn, p2_id, elo=out.get('p2_elo_after'),
                                   g2_rating=out.get('p2_g2_after'), g2_rd=out.get('p2_g2_rd_after'), g2_vol=out.get('p2_g2_vol_after'),
                                   last_game_date=match_date, last_game_match_id=match_id)
    except Exception:
        pass
    try:
        repo.update_match_elos(conn, match_id, out.get('p1_elo_before'), out.get('p1_elo_after'),
                               out.get('p2_elo_before'), out.get('p2_elo_after'))
    except Exception:
        pass
    try:
        repo.update_match_glicko(conn, match_id,
                                 out.get('p1_g2_before'), out.get('p1_g2_after'),
                                 out.get('p1_g2_rd_before'), out.get('p1_g2_rd_after'),
                                 out.get('p1_g2_vol_before'), out.get('p1_g2_vol_after'),
                                 out.get('p2_g2_before'), out.get('p2_g2_after'),
                                 out.get('p2_g2_rd_before'), out.get('p2_g2_rd_after'),
                                 out.get('p2_g2_vol_before'), out.get('p2_g2_vol_after'))
    except Exception:
        pass

    try:
        ranking.recompute_from_match(conn, match_id)
        return False
    except ValueError:
        # fallback
        ranking.recompute(conn)
        return True
