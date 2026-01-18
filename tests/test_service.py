import chess_club.db as dbm
import chess_club.repo as repo
import chess_club.ratings as ratings
import chess_club.service as service


def test_record_match_result_persists_profiles_and_match_audits():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # create scheduled match (no result yet)
    match_id = repo.create_match(conn, tid, p1, p2, "2025-12-30")

    # compute result and persist via service
    computed = ratings.compute_match(conn, p1, p2, 1.0, "2025-12-30")
    summary = service.record_match_result(conn, match_id, p1, p2, computed, "2025-12-30")

    # players' profiles should be updated
    p1_row = repo.get_player(conn, p1)
    p2_row = repo.get_player(conn, p2)
    assert p1_row[2] == summary.get('p1_elo_after')
    assert p2_row[2] == summary.get('p2_elo_after')

    # last_game_date should be set
    assert p1_row[3] == "2025-12-30"
    assert p2_row[3] == "2025-12-30"

    # per-match audit columns should have been backfilled
    matches = repo.list_matches_for_tournament(conn, tid)
    assert len(matches) == 1
    row = matches[0]
    # with the explicit SELECT ordering in repo.list_matches_for_tournament,
    # indices are: 0=id,1=p1_name,2=p2_name,3=result,4=date,5=player1_elo_before,6=player1_elo_after
    assert row[5] == summary.get('p1_elo_before')
    assert row[6] == summary.get('p1_elo_after')
