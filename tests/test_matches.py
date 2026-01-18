import chess_club.db as dbm
import chess_club.repo as repo
import chess_club.tournament as tournament
import chess_club.ratings as ratings
import chess_club.ranking as ranking


def test_record_match_result_sets_result_in_db():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # create and record match via business layer
    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")

    matches = repo.get_all_matches_ordered(conn)
    assert len(matches) == 1
    mid = matches[0][0]

    m = repo.get_match(conn, mid)
    # m layout: id, tournament_id, player1_id, player2_id, result, date
    assert m[4] == 1.0


def test_delete_match_removes_row_and_recompute_runs():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")
    matches = repo.get_all_matches_ordered(conn)
    assert len(matches) == 1
    mid = matches[0][0]

    repo.delete_match(conn, mid)

    assert repo.get_match(conn, mid) is None
    assert repo.get_all_matches_ordered(conn) == []

    # recompute should still run without error
    ranking.recompute(conn)


def test_update_match_persists_new_result_and_date():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")
    matches = repo.get_all_matches_ordered(conn)
    mid = matches[0][0]

    # change to draw and update date
    fallback = tournament.update_match(conn, mid, 0.5, "2025-12-31")
    m = repo.get_match(conn, mid)
    assert m[4] == 0.5
    assert m[5] == "2025-12-31"


def test_list_matches_for_tournament_column_ordering():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")
    rows = repo.list_matches_for_tournament(conn, tid)
    assert len(rows) == 1
    row = rows[0]
    # Expecting 13 columns: id, p1_name, p2_name, result, date, p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after, p1_g2_before, p1_g2_after, p2_g2_before, p2_g2_after
    assert len(row) == 13
    assert isinstance(row[0], int)
    assert isinstance(row[1], str) and isinstance(row[2], str)
    assert row[3] in (None, 0, 0.5, 1)
