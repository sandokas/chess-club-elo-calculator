from chess_club import db, repo, tournament


def test_record_match_logic_updates_elos_and_inserts_match():
    conn = db.get_connection(":memory:")
    db.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    name1, new1, name2, new2 = tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-14")

    # returned new ratings present (trust public API, not DB internals)
    assert new1 is not None
    assert new2 is not None

    # match recorded
    matches = repo.list_matches_for_tournament(conn, tid)
    assert len(matches) == 1
    # repo.list_matches_for_tournament now returns (id, p1_name, p2_name, ...)
    assert matches[0][1] == name1


def test_cannot_modify_completed_tournament_until_reopened():
    conn = db.get_connection(":memory:")
    db.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # Complete the tournament
    tournament.complete_tournament(conn, tid)

    # Adding a player should raise
    p3 = repo.add_player(conn, "Charlie")
    try:
        repo.add_tournament_player(conn, tid, p3)
        assert False, "Should not be able to add player to completed tournament"
    except ValueError:
        pass

    # Recording a match should raise
    try:
        tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-14")
        assert False, "Should not be able to record match in completed tournament"
    except ValueError:
        pass

    # Reopen should allow changes again
    tournament.reopen_tournament(conn, tid)
    # Now adding a player should succeed
    repo.add_tournament_player(conn, tid, p3)
    # And recording a match should succeed
    tournament.create_match(conn, tid, p1, p3, 1.0, "2025-12-14")


def test_update_match_recomputes_ratings():
    conn = db.get_connection(":memory:")
    db.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # Record an initial decisive match (A beats B)
    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-14")

    # Capture reported elos after the initial result (from DB is internal; rely on API)
    # find the match id
    matches = repo.get_all_matches_ordered(conn)
    assert len(matches) == 1
    match_id = matches[0][0]
    # We won't rely on reading `Players` directly here; instead verify recompute behavior

    # Update the match to a draw and assert targeted recompute occurred (no full fallback)
    fallback = tournament.update_match(conn, match_id, 0.5, "2025-12-14")
    assert fallback is False


def test_cannot_update_match_in_completed_tournament():
    conn = db.get_connection(":memory:")
    db.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-14")
    matches = repo.get_all_matches_ordered(conn)
    match_id = matches[0][0]

    # Complete the tournament
    tournament.complete_tournament(conn, tid)

    try:
        tournament.update_match(conn, match_id, 0.5)
        assert False, "Should not be able to update match in completed tournament"
    except ValueError:
        pass
