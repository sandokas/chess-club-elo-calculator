from . import repo, elo, ratings


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
    res = ratings.process_match(conn, pid1, pid2, result)

    # insert match row (try to include Elo audit if available)
    try:
        repo.insert_match_with_elos(
            conn,
            tournament_id, pid1, pid2, result, match_date,
            p1_elo_before=res.get('p1_elo_before'), p1_elo_after=res.get('p1_elo_after'),
            p2_elo_before=res.get('p2_elo_before'), p2_elo_after=res.get('p2_elo_after')
        )
        match_id = None
    except Exception:
        match_id = repo.insert_match(conn, tournament_id, pid1, pid2, result, match_date)

    # update glicko per-match columns if present
    try:
        # if insert used insert_match_with_elos above, get last inserted id
        if match_id is None:
            # find last rowid
            cur = conn.cursor()
            cur.execute('SELECT last_insert_rowid()')
            match_id = cur.fetchone()[0]
        repo.update_match_glicko(conn, match_id,
                                 res.get('p1_g2_before'), res.get('p1_g2_after'),
                                 res.get('p2_g2_before'), res.get('p2_g2_after'))
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
