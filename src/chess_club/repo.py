
from typing import List, Dict, Optional
import chess_club.config as config


def add_player(conn, name: str, elo: float = None) -> int:
    if elo is None:
        elo = config.DEFAULT_ELO
    cur = conn.cursor()
    cur.execute("INSERT INTO Players (name, elo) VALUES (?, ?)", (name, elo))
    conn.commit()
    return cur.lastrowid


def list_players(conn) -> List[Dict]:
    cur = conn.cursor()
    # Order players according to display/ordering preference in config.
    # If the system is set to 'glicko2' order by g2_rating, otherwise order by elo.
    try:
        order_by = "g2_rating" if config.RATING_SYSTEM == 'glicko2' else "elo"
        cur.execute(f"SELECT id, name, elo, g2_rating, g2_rd, g2_vol FROM Players ORDER BY {order_by} DESC")
    except Exception:
        # Fallback to elo ordering if anything goes wrong
        cur.execute("SELECT id, name, elo, g2_rating, g2_rd, g2_vol FROM Players ORDER BY elo DESC")
    return cur.fetchall()


def get_player(conn, player_id: int) -> Optional[Dict]:
    cur = conn.cursor()
    # Include last_game_date to avoid expensive aggregate queries when callers
    # need the last-played timestamp. Keep `elo` at index 2 for backward
    # compatibility with existing call sites.
    cur.execute("SELECT id, name, elo, last_game_date FROM Players WHERE id = ?", (player_id,))
    return cur.fetchone()


def update_player_profile(conn, player_id: int, elo: float = None,
                          g2_rating: float = None, g2_rd: float = None, g2_vol: float = None,
                          last_game_date: str = None, last_game_match_id: int = None):
    """Update multiple player profile fields in a single statement.

    Only non-None parameters will overwrite existing values.
    """
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE Players SET
                elo = COALESCE(?, elo),
                g2_rating = COALESCE(?, g2_rating),
                g2_rd = COALESCE(?, g2_rd),
                g2_vol = COALESCE(?, g2_vol),
                last_game_date = COALESCE(?, last_game_date),
                last_game_match_id = COALESCE(?, last_game_match_id)
            WHERE id = ?
            """,
            (elo, g2_rating, g2_rd, g2_vol, last_game_date, last_game_match_id, player_id)
        )
        conn.commit()
    except Exception:
        # Best-effort: ignore if columns don't exist or other DB issues
        pass


def add_tournament(conn, name: str, date: str) -> int:
    cur = conn.cursor()
    cur.execute("INSERT INTO Tournaments (name, date) VALUES (?, ?)", (name, date))
    conn.commit()
    return cur.lastrowid


def get_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute("SELECT id, name, date FROM Tournaments WHERE id = ?", (tournament_id,))
    return cur.fetchone()


def is_tournament_completed(conn, tournament_id: int) -> bool:
    cur = conn.cursor()
    cur.execute("SELECT completed FROM Tournaments WHERE id = ?", (tournament_id,))
    row = cur.fetchone()
    return bool(row and row[0])


def update_tournament(conn, tournament_id: int, name: str, date: str):
    cur = conn.cursor()
    cur.execute("UPDATE Tournaments SET name = ?, date = ? WHERE id = ?", (name, date, tournament_id))
    conn.commit()


def count_matches_for_tournament(conn, tournament_id: int) -> int:
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM Matches WHERE tournament_id = ?", (tournament_id,))
    return cur.fetchone()[0]


def delete_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    # remove tournament players registrations
    cur.execute("DELETE FROM TournamentPlayers WHERE tournament_id = ?", (tournament_id,))
    # remove matches belonging to tournament
    cur.execute("DELETE FROM Matches WHERE tournament_id = ?", (tournament_id,))
    # remove the tournament row
    cur.execute("DELETE FROM Tournaments WHERE id = ?", (tournament_id,))
    conn.commit()


def complete_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute("UPDATE Tournaments SET completed = 1 WHERE id = ?", (tournament_id,))
    conn.commit()


def reopen_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute("UPDATE Tournaments SET completed = 0 WHERE id = ?", (tournament_id,))
    conn.commit()


def list_tournaments(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, name, date FROM Tournaments ORDER BY date DESC")
    return cur.fetchall()


def add_tournament_player(conn, tournament_id: int, player_id: int):
    cur = conn.cursor()
    # Prevent adding players to finished tournaments
    if is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")
    cur.execute("INSERT INTO TournamentPlayers (tournament_id, player_id) VALUES (?, ?)", (tournament_id, player_id))
    conn.commit()


def get_tournament_players(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute(
        "SELECT p.id, p.name FROM TournamentPlayers tp JOIN Players p ON tp.player_id = p.id WHERE tp.tournament_id = ?",
        (tournament_id,)
    )
    return cur.fetchall()


def games_played_for_player(conn, player_id: int) -> int:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM Matches WHERE player1_id = ? OR player2_id = ?",
        (player_id, player_id)
    )
    return cur.fetchone()[0]


def delete_player(conn, player_id: int):
    """Remove a player and all their associations from the database.

    This deletes tournament registrations for the player, any matches where
    they participated, and finally the player row itself.
    """
    cur = conn.cursor()
    # remove tournament registrations
    cur.execute("DELETE FROM TournamentPlayers WHERE player_id = ?", (player_id,))
    # remove matches involving the player
    cur.execute("DELETE FROM Matches WHERE player1_id = ? OR player2_id = ?", (player_id, player_id))
    # remove the player row
    cur.execute("DELETE FROM Players WHERE id = ?", (player_id,))
    conn.commit()


def insert_match(conn, tournament_id: int, p1: int, p2: int, result: float, date: str) -> int:
    # Prevent recording matches for completed tournaments
    if is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO Matches (tournament_id, player1_id, player2_id, result, date) VALUES (?, ?, ?, ?, ?)",
        (tournament_id, p1, p2, result, date)
    )
    conn.commit()
    return cur.lastrowid


def create_match(conn, tournament_id: int, p1: int, p2: int, date: str, result: float = None) -> int:
    """Insert a match row without a result (result is NULL).

    This is used when creating scheduled matches where the result is not yet known.
    """
    # Prevent recording matches for completed tournaments
    if is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")
    cur = conn.cursor()
    # insert result value (may be NULL if schema allows it)
    cur.execute(
        "INSERT INTO Matches (tournament_id, player1_id, player2_id, result, date) VALUES (?, ?, ?, ?, ?)",
        (tournament_id, p1, p2, result, date)
    )
    conn.commit()
    return cur.lastrowid


def update_match_result(conn, match_id: int, result: float, date: str = None):
    """High-level: update match result, compute ratings and persist audits.

    This function replaces the former `apply_match_result` and updates the
    stored match row. Rating computation and persistence must be handled by
    the business layer (e.g. `tournament`) to keep repo free of rating logic.
    """
    # Update match row only; business layer must compute & persist ratings.
    update_match_row(conn, match_id, result, date)
    return get_match(conn, match_id)

    # ensure players reference this match as last_game_match_id
    try:
        update_player_profile(conn, p1, last_game_match_id=match_id)
        update_player_profile(conn, p2, last_game_match_id=match_id)
    except Exception:
        pass

    return out


def insert_match_with_elos(conn, tournament_id: int, p1: int, p2: int, result: float, date: str,
                 p1_elo_before: float = None, p1_elo_after: float = None,
                 p2_elo_before: float = None, p2_elo_after: float = None,
                 p1_g2_before: float = None, p1_g2_after: float = None,
                 p1_g2_rd_before: float = None, p1_g2_rd_after: float = None,
                 p1_g2_vol_before: float = None, p1_g2_vol_after: float = None,
                 p2_g2_before: float = None, p2_g2_after: float = None,
                 p2_g2_rd_before: float = None, p2_g2_rd_after: float = None,
                 p2_g2_vol_before: float = None, p2_g2_vol_after: float = None,
                 p1_last_played_before: str = None, p2_last_played_before: str = None) -> int:
    # Prevent recording matches for completed tournaments
    if is_tournament_completed(conn, tournament_id):
        raise ValueError("Tournament is completed")
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO Matches (
            tournament_id, player1_id, player2_id, result, date,
            player1_elo_before, player1_elo_after, player2_elo_before, player2_elo_after,
            player1_g2_rating_before, player1_g2_rating_after, player1_g2_rd_before, player1_g2_rd_after, player1_g2_vol_before, player1_g2_vol_after,
            player2_g2_rating_before, player2_g2_rating_after, player2_g2_rd_before, player2_g2_rd_after, player2_g2_vol_before, player2_g2_vol_after
            player1_last_played_before, player2_last_played_before
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tournament_id, p1, p2, result, date, p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after,
         p1_g2_before, p1_g2_after, p1_g2_rd_before, p1_g2_rd_after, p1_g2_vol_before, p1_g2_vol_after,
         p2_g2_before, p2_g2_after, p2_g2_rd_before, p2_g2_rd_after, p2_g2_vol_before, p2_g2_vol_after,
         p1_last_played_before, p2_last_played_before)
    )
    conn.commit()
    return cur.lastrowid


def update_match_elos(conn, match_id: int, p1_elo_before: float, p1_elo_after: float,
                      p2_elo_before: float, p2_elo_after: float):
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE Matches SET
            player1_elo_before = ?, player1_elo_after = ?,
            player2_elo_before = ?, player2_elo_after = ?
        WHERE id = ?
        """,
        (p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after, match_id)
    )
    conn.commit()


def list_matches_for_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p1.name, p2.name, m.result, m.date,
               m.player1_elo_before, m.player1_elo_after,
               m.player2_elo_before, m.player2_elo_after,
               m.player1_g2_rating_before, m.player1_g2_rating_after,
               m.player1_g2_rd_before, m.player1_g2_rd_after, m.player1_g2_vol_before, m.player1_g2_vol_after,
               m.player2_g2_rating_before, m.player2_g2_rating_after,
               m.player2_g2_rd_before, m.player2_g2_rd_after, m.player2_g2_vol_before, m.player2_g2_vol_after
        FROM Matches m
        JOIN Players p1 ON m.player1_id = p1.id
        JOIN Players p2 ON m.player2_id = p2.id
        WHERE m.tournament_id = ?
        ORDER BY m.id
        """,
        (tournament_id,)
    )
    return cur.fetchall()


def get_all_matches_ordered(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, player1_id, player2_id, result, date FROM Matches ORDER BY date, id")
    return cur.fetchall()


def get_match(conn, match_id: int):
    cur = conn.cursor()
    cur.execute("SELECT id, tournament_id, player1_id, player2_id, result, date FROM Matches WHERE id = ?", (match_id,))
    return cur.fetchone()



def update_match_row(conn, match_id: int, result: float, date: str = None):
    """Low-level: update the match row in the DB. Kept for callers that only
    need to modify the stored match fields without applying rating logic.
    """
    # Implementation identical to previous `update_match_result`
    cur = conn.cursor()
    cur.execute("SELECT id FROM Matches WHERE id = ?", (match_id,))
    row = cur.fetchone()
    if not row:
        raise ValueError("Match not found")

    if date is None:
        cur.execute("UPDATE Matches SET result = ? WHERE id = ?", (result, match_id))
    else:
        cur.execute("UPDATE Matches SET result = ?, date = ? WHERE id = ?", (result, date, match_id))
    conn.commit()


def list_matches_for_player(conn, player_id: int):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            m.id,
            COALESCE(t.name, '') AS tournament,
            m.date,
            p1.id AS p1_id, p1.name AS p1_name, m.player1_elo_before, m.player1_elo_after,
            p2.id AS p2_id, p2.name AS p2_name, m.player2_elo_before, m.player2_elo_after,
            m.player1_g2_rating_before, m.player1_g2_rating_after, m.player1_g2_rd_before, m.player1_g2_rd_after, m.player1_g2_vol_before, m.player1_g2_vol_after,
            m.player2_g2_rating_before, m.player2_g2_rating_after, m.player2_g2_rd_before, m.player2_g2_rd_after, m.player2_g2_vol_before, m.player2_g2_vol_after,
            m.result
        FROM Matches m
        JOIN Players p1 ON m.player1_id = p1.id
        JOIN Players p2 ON m.player2_id = p2.id
        LEFT JOIN Tournaments t ON m.tournament_id = t.id
        WHERE m.player1_id = ? OR m.player2_id = ?
        ORDER BY m.date, m.id
        """,
        (player_id, player_id),
    )
    return cur.fetchall()


def get_player_summary(conn, player_id: int):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*), MAX(date) FROM Matches WHERE player1_id = ? OR player2_id = ?", (player_id, player_id))
    games_played, last_game = cur.fetchone()

    cur.execute(
        "SELECT COUNT(*) FROM Matches WHERE (player1_id = ? AND result = 1.0) OR (player2_id = ? AND result = 0.0)",
        (player_id, player_id)
    )
    wins = cur.fetchone()[0]

    cur.execute(
        "SELECT COUNT(*) FROM Matches WHERE (player1_id = ? OR player2_id = ?) AND result = 0.5",
        (player_id, player_id)
    )
    draws = cur.fetchone()[0]

    losses = games_played - wins - draws

    return games_played, wins, draws, losses, last_game


# NOTE: prefer using the canonical names defined above (add_player, add_tournament,
# add_tournament_player, insert_match, update_match_row, update_match_result).
# Avoid adding convenience alias wrappers here to keep the API surface minimal.




def get_player_glicko(conn, player_id: int):
    cur = conn.cursor()
    cur.execute("SELECT g2_rating, g2_rd, g2_vol FROM Players WHERE id = ?", (player_id,))
    row = cur.fetchone()
    if row:
        return row[0], row[1], row[2]
    return None



def update_match_glicko(conn, match_id: int,
                        p1_g_before: float, p1_g_after: float,
                        p1_g_rd_before: float = None, p1_g_rd_after: float = None,
                        p1_g_vol_before: float = None, p1_g_vol_after: float = None,
                        p2_g_before: float = None, p2_g_after: float = None,
                        p2_g_rd_before: float = None, p2_g_rd_after: float = None,
                        p2_g_vol_before: float = None, p2_g_vol_after: float = None):
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE Matches SET
                player1_g2_rating_before = ?, player1_g2_rating_after = ?,
                player1_g2_rd_before = ?, player1_g2_rd_after = ?,
                player1_g2_vol_before = ?, player1_g2_vol_after = ?,
                player2_g2_rating_before = ?, player2_g2_rating_after = ?,
                player2_g2_rd_before = ?, player2_g2_rd_after = ?,
                player2_g2_vol_before = ?, player2_g2_vol_after = ?
            WHERE id = ?
            """,
            (p1_g_before, p1_g_after, p1_g_rd_before, p1_g_rd_after, p1_g_vol_before, p1_g_vol_after,
             p2_g_before, p2_g_after, p2_g_rd_before, p2_g_rd_after, p2_g_vol_before, p2_g_vol_after, match_id)
        )
        conn.commit()
    except Exception:
        # If columns don't exist, ignore.
        pass


def update_player_last_game(conn, player_id: int, last_game_date: str, last_game_match_id: int = None):
    cur = conn.cursor()
    try:
        cur.execute("UPDATE Players SET last_game_date = ?, last_game_match_id = ? WHERE id = ?",
                    (last_game_date, last_game_match_id, player_id))
        conn.commit()
    except Exception:
        # If columns don't exist, ignore.
        pass
