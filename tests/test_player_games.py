import io
import contextlib
import builtins

import chess_club.db as dbm
import chess_club.repo as repo
import chess_club.tournament as tournament
import chess_club.cli as cli


def test_list_matches_for_player_column_layout():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    # use business layer to create a fully-audited match
    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")

    rows = repo.list_matches_for_player(conn, p1)
    assert len(rows) == 1
    row = rows[0]
    # list_matches_for_player should return 24 explicit columns
    assert len(row) == 24


def test_cli_show_player_games_flow_runs_without_error_and_prints_matches():
    conn = dbm.get_connection(":memory:")
    dbm.init_db(conn)

    p1 = repo.add_player(conn, "Alice")
    p2 = repo.add_player(conn, "Bob")

    tid = repo.add_tournament(conn, "T1", "2025-12-30")
    repo.add_tournament_player(conn, tid, p1)
    repo.add_tournament_player(conn, tid, p2)

    tournament.create_match(conn, tid, p1, p2, 1.0, "2025-12-30")

    # capture stdout and simulate selecting player 1
    buf = io.StringIO()
    fake_inputs = [str(p1)]

    def fake_input(prompt=""):
        return fake_inputs.pop(0)

    orig_input = builtins.input
    try:
        builtins.input = fake_input
        with contextlib.redirect_stdout(buf):
            cli.show_player_games_flow(conn)
    finally:
        builtins.input = orig_input

    out = buf.getvalue()
    assert f"Matches for player ID {p1}" in out or "Matches for player ID" in out
