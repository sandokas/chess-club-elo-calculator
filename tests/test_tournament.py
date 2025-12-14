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
