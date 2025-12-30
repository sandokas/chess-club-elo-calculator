import chess_club.db as dbm
import chess_club.repo as repo
import chess_club.tournament as tournament
import chess_club.ranking as ranking
import os


def setup_inmem():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)
    return conn


def test_fallback_on_missing_before():
    import chess_club.db as dbm
    import chess_club.repo as repo
    import chess_club.tournament as tournament
    import chess_club.ranking as ranking


    def setup_inmem():
        conn = dbm.get_connection(":memory:")
        dbm.init_db(conn)
        return conn


    def test_fallback_on_missing_before():
        conn = setup_inmem()
        # create players
        p1 = repo.add_player(conn, 'A')
        p2 = repo.add_player(conn, 'B')
        # add tournament
        t = repo.add_tournament(conn, 'T', '2025-12-30')
        repo.add_tournament_player(conn, t, p1)
        repo.add_tournament_player(conn, t, p2)
        # insert a match without per-match audit (simulate minimal insert)
        mid = repo.insert_match(conn, t, p1, p2, 1.0, '2025-12-30')
        # now update the match result - recompute_from_match should detect missing per-match before and fallback
        fallback = tournament.update_match(conn, mid, 0.0, '2025-12-30')
        assert fallback is True


    def test_same_day_ordering_and_zero_days():
        conn = setup_inmem()
        p1 = repo.add_player(conn, 'A')
        p2 = repo.add_player(conn, 'B')
        p3 = repo.add_player(conn, 'C')
        t = repo.add_tournament(conn, 'T', '2025-12-30')
        repo.add_tournament_player(conn, t, p1)
        repo.add_tournament_player(conn, t, p2)
        repo.add_tournament_player(conn, t, p3)
        # record two matches same day
        tournament.record_match_logic(conn, t, p1, p2, 1.0, '2025-12-30')
        tournament.record_match_logic(conn, t, p2, p3, 1.0, '2025-12-30')
        # Recompute from second match should use zero days because same-day ordering
        # find second match id
        matches = repo.get_all_matches_ordered(conn)
        assert len(matches) == 2
        second_id = matches[1][0]
        # attempt targeted recompute: since matches were created via record_match_logic, per-match before values exist and targeted replay should succeed
        fallback = False
        try:
            ranking.recompute_from_match(conn, second_id)
        except ValueError:
            fallback = True
        assert fallback is False