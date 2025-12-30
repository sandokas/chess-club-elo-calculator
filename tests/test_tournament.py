from chess_club import db, repo, tournament


def test_record_match_logic_updates_elos_and_inserts_match():
    conn = db.get_connection(":memory:")
    db.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    name1, new1, name2, new2 = tournament.record_match_logic(conn, tid, p1, p2, 1.0, "2025-12-14")

    # players' elos updated
    p1_row = repo.get_player(conn, p1)
    p2_row = repo.get_player(conn, p2)
    assert p1_row[2] == new1
    assert p2_row[2] == new2

    # match recorded
    matches = repo.list_matches_for_tournament(conn, tid)
    assert len(matches) == 1
    assert matches[0][0] == name1


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
        tournament.record_match_logic(conn, tid, p1, p2, 1.0, "2025-12-14")
        assert False, "Should not be able to record match in completed tournament"
    except ValueError:
        pass

    # Reopen should allow changes again
    tournament.reopen_tournament(conn, tid)
    # Now adding a player should succeed
    repo.add_tournament_player(conn, tid, p3)
    # And recording a match should succeed
    tournament.record_match_logic(conn, tid, p1, p3, 1.0, "2025-12-14")
