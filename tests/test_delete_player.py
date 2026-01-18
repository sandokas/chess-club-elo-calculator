import chess_club.db as dbm
import chess_club.repo as repo
import chess_club.tournament as tournament
import chess_club.ranking as ranking


def test_delete_player_removes_player_matches_and_registrations():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    # create two players and a tournament
    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-14")

    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # record a match between them
    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-14")

    # sanity checks before deletion
    assert repo.get_player(conn, p1) is not None
    matches = repo.list_matches_for_tournament(conn, tid)
    assert len(matches) == 1
    tp = repo.get_tournament_players(conn, tid)
    assert any(pid == p1 for (pid, _name) in tp)

    # delete player 1
    repo.delete_player(conn, p1)

    # player row removed
    assert repo.get_player(conn, p1) is None

    # matches involving player removed
    # Ensure no remaining matches reference the deleted player's id
    matches_after = repo.get_all_matches_ordered(conn)
    assert all(p1 not in (row[1], row[2]) for row in matches_after)

    # tournament registrations no longer include the player
    tp_after = repo.get_tournament_players(conn, tid)
    assert all(pid != p1 for (pid, _name) in tp_after)

    # recompute should still run without errors
    ranking.recompute(conn)

    # remaining player still exists
    assert repo.get_player(conn, p2) is not None
