from . import repo, elo, ratings
import chess_club.ranking as ranking


def add_player_to_tournament(conn, tournament_id: int, player_id: int):
    return repo.add_tournament_player(conn, tournament_id, player_id)


def record_match_logic(conn, tournament_id: int, pid1: int, pid2: int, result: float, match_date: str):
    # Prevent recording matches for completed tournaments
    if repo.is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")
    p1 = repo.get_player(conn, pid1)
    p2 = repo.get_player(conn, pid2)
    if not p1 or not p2:
        raise ValueError("Player not found")

    r1 = p1[2]
    r2 = p2[2]

    g1 = repo.games_played_for_player(conn, pid1)
    g2 = repo.games_played_for_player(conn, pid2)

    k1 = elo.k_factor(g1)
    k2 = elo.k_factor(g2)

    # Use ratings wrapper which may update Elo and/or Glicko depending on config
    res = ratings.process_match(conn, pid1, pid2, result, match_date)

    # insert match row (try to include Elo/Glicko audit and per-match last-played)
    try:
        p1_last = repo.get_player_summary(conn, pid1)[4]
        p2_last = repo.get_player_summary(conn, pid2)[4]
        match_id = repo.insert_match_with_elos(
            conn,
            tournament_id, pid1, pid2, result, match_date,
            p1_elo_before=res.get('p1_elo_before'), p1_elo_after=res.get('p1_elo_after'),
            p2_elo_before=res.get('p2_elo_before'), p2_elo_after=res.get('p2_elo_after'),
            p1_g2_before=res.get('p1_g2_before'), p1_g2_after=res.get('p1_g2_after'),
            p1_g2_rd_before=res.get('p1_g2_rd_before'), p1_g2_rd_after=res.get('p1_g2_rd_after'),
            p1_g2_vol_before=res.get('p1_g2_vol_before'), p1_g2_vol_after=res.get('p1_g2_vol_after'),
            p2_g2_before=res.get('p2_g2_before'), p2_g2_after=res.get('p2_g2_after'),
            p2_g2_rd_before=res.get('p2_g2_rd_before'), p2_g2_rd_after=res.get('p2_g2_rd_after'),
            p2_g2_vol_before=res.get('p2_g2_vol_before'), p2_g2_vol_after=res.get('p2_g2_vol_after'),
            p1_last_played_before=p1_last, p2_last_played_before=p2_last
        )
    except Exception:
        match_id = repo.insert_match(conn, tournament_id, pid1, pid2, result, match_date)

    # update glicko per-match columns if present
    try:
        # match_id should be set; if not, get last rowid
        if not match_id:
            cur = conn.cursor()
            cur.execute('SELECT last_insert_rowid()')
            match_id = cur.fetchone()[0]
        repo.update_match_glicko(conn, match_id,
                     res.get('p1_g2_before'), res.get('p1_g2_after'),
                     res.get('p1_g2_rd_before'), res.get('p1_g2_rd_after'),
                     res.get('p1_g2_vol_before'), res.get('p1_g2_vol_after'),
                     res.get('p2_g2_before'), res.get('p2_g2_after'),
                     res.get('p2_g2_rd_before'), res.get('p2_g2_rd_after'),
                     res.get('p2_g2_vol_before'), res.get('p2_g2_vol_after'))
    except Exception:
        pass

    # update players' last-game fields on profile
    try:
        repo.update_player_last_game(conn, pid1, match_date, match_id)
        repo.update_player_last_game(conn, pid2, match_date, match_id)
    except Exception:
        pass

    # return names and elo/glicko quick summary (prefer elo for legacy)
    return (p1[1], res.get('p1_elo_after') or res.get('p1_g2_after'), p2[1], res.get('p2_elo_after') or res.get('p2_g2_after'))


def complete_tournament(conn, tournament_id: int):
    """Mark a tournament as completed. Further players or matches cannot be added.

    Raises ValueError if tournament not found.
    """
    t = repo.get_tournament(conn, tournament_id)
    if not t:
        raise ValueError("Tournament not found")
    repo.complete_tournament(conn, tournament_id)


def reopen_tournament(conn, tournament_id: int):
    """Reopen a previously completed tournament so it can be modified again."""
    t = repo.get_tournament(conn, tournament_id)
    if not t:
        raise ValueError("Tournament not found")
    repo.reopen_tournament(conn, tournament_id)


def update_match(conn, match_id: int, result: float, date: str = None):
    """Update a match result (allowed only when tournament is open) and
    recompute ratings affected by the change.

    This updates the match row and triggers a full ratings recompute to
    ensure consistency after the change.
    """
    m = repo.get_match(conn, match_id)
    if not m:
        raise ValueError("Match not found")
    _, tid, p1, p2, _, _ = m

    # Ensure tournament is not completed
    if repo.is_tournament_completed(conn, tid):
        raise ValueError("Tournament is completed")

    # Update the match row
    repo.update_match_result(conn, match_id, result, date)

    # Try targeted recompute; if not possible (missing per-match audit data),
    # fall back to a full recompute.
    try:
        ranking.recompute_from_match(conn, match_id)
        return False
    except ValueError:
        # Fall back to full recompute when per-match before-values are missing
        print("⚠️ Per-match audit data missing — performing full ratings recompute.")
        ranking.recompute(conn)
        return True
