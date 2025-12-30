
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
    cur.execute("SELECT id, name, elo FROM Players ORDER BY elo DESC")
    return cur.fetchall()


def get_player(conn, player_id: int) -> Optional[Dict]:
    cur = conn.cursor()
    cur.execute("SELECT id, name, elo FROM Players WHERE id = ?", (player_id,))
    return cur.fetchone()


def update_player_elo(conn, player_id: int, elo: float):
    cur = conn.cursor()
    cur.execute("UPDATE Players SET elo = ? WHERE id = ?", (elo, player_id))
    conn.commit()


def add_tournament(conn, name: str, date: str) -> int:
    cur = conn.cursor()
    cur.execute("INSERT INTO Tournaments (name, date) VALUES (?, ?)", (name, date))
    conn.commit()
    return cur.lastrowid


def get_tournament(conn, tournament_id: int):
    cur = conn.cursor()
    cur.execute("SELECT id, name, date FROM Tournaments WHERE id = ?", (tournament_id,))
    return cur.fetchone()


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


def list_tournaments(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, name, date FROM Tournaments ORDER BY date DESC")
    return cur.fetchall()


def add_tournament_player(conn, tournament_id: int, player_id: int):
    cur = conn.cursor()
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


def insert_match(conn, tournament_id: int, p1: int, p2: int, result: float, date: str) -> int:
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO Matches (tournament_id, player1_id, player2_id, result, date) VALUES (?, ?, ?, ?, ?)",
        (tournament_id, p1, p2, result, date)
    )
    conn.commit()
    return cur.lastrowid


def insert_match_with_elos(conn, tournament_id: int, p1: int, p2: int, result: float, date: str,
                 p1_elo_before: float = None, p1_elo_after: float = None,
                 p2_elo_before: float = None, p2_elo_after: float = None) -> int:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO Matches (
            tournament_id, player1_id, player2_id, result, date,
            player1_elo_before, player1_elo_after, player2_elo_before, player2_elo_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tournament_id, p1, p2, result, date, p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after)
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
               m.player2_g2_rating_before, m.player2_g2_rating_after
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
            m.player1_g2_rating_before, m.player1_g2_rating_after,
            m.player2_g2_rating_before, m.player2_g2_rating_after,
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


def get_player_glicko(conn, player_id: int):
    cur = conn.cursor()
    cur.execute("SELECT g2_rating, g2_rd, g2_vol FROM Players WHERE id = ?", (player_id,))
    row = cur.fetchone()
    if row:
        return row[0], row[1], row[2]
    return None


def update_player_glicko(conn, player_id: int, rating: float, rd: float, vol: float):
    cur = conn.cursor()
    cur.execute("UPDATE Players SET g2_rating = ?, g2_rd = ?, g2_vol = ? WHERE id = ?", (rating, rd, vol, player_id))
    conn.commit()


def update_match_glicko(conn, match_id: int, p1_g_before: float, p1_g_after: float, p2_g_before: float, p2_g_after: float):
    cur = conn.cursor()
    try:
        cur.execute(
            """
            UPDATE Matches SET
                player1_g2_rating_before = ?, player1_g2_rating_after = ?,
                player2_g2_rating_before = ?, player2_g2_rating_after = ?
            WHERE id = ?
            """,
            (p1_g_before, p1_g_after, p2_g_before, p2_g_after, match_id)
        )
        conn.commit()
    except Exception:
        # If columns don't exist, ignore.
        pass
