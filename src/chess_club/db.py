import sqlite3

CREATE_PLAYERS = """
CREATE TABLE IF NOT EXISTS Players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    elo REAL
)
"""

CREATE_TOURNAMENTS = """
CREATE TABLE IF NOT EXISTS Tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    completed INTEGER DEFAULT 0
)
"""

CREATE_TOURNAMENT_PLAYERS = """
CREATE TABLE IF NOT EXISTS TournamentPlayers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    FOREIGN KEY(tournament_id) REFERENCES Tournaments(id),
    FOREIGN KEY(player_id) REFERENCES Players(id)
)
"""

CREATE_MATCHES = """
CREATE TABLE IF NOT EXISTS Matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    result REAL NOT NULL,
    date TEXT NOT NULL,
    player1_elo_before REAL,
    player1_elo_after REAL,
    player2_elo_before REAL,
    player2_elo_after REAL,
    player1_g2_rating_before REAL,
    player1_g2_rating_after REAL,
    player1_g2_rd_before REAL,
    player1_g2_rd_after REAL,
    player1_g2_vol_before REAL,
    player1_g2_vol_after REAL,
    player2_g2_rating_before REAL,
    player2_g2_rating_after REAL,
    player2_g2_rd_before REAL,
    player2_g2_rd_after REAL,
    player2_g2_vol_before REAL,
    player2_g2_vol_after REAL,
    FOREIGN KEY(tournament_id) REFERENCES Tournaments(id),
    FOREIGN KEY(player1_id) REFERENCES Players(id),
    FOREIGN KEY(player2_id) REFERENCES Players(id)
)
"""


def get_connection(path="chessclub.db"):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn):
    cur = conn.cursor()
    cur.execute(CREATE_PLAYERS)
    cur.execute(CREATE_TOURNAMENTS)
    cur.execute(CREATE_TOURNAMENT_PLAYERS)
    cur.execute(CREATE_MATCHES)
    conn.commit()
    # Run migrations to bring older DBs up-to-date
    migrate_add_match_elo_columns(conn)
    migrate_add_player_g2_columns(conn)
    migrate_add_tournament_completed(conn)
    migrate_add_player_last_game_columns(conn)
    migrate_add_match_last_played_columns(conn)


def _column_exists(conn, table: str, column: str) -> bool:
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def migrate_add_match_elo_columns(conn):
    """Add per-match Elo audit columns to Matches table if missing.

    This is safe to run repeatedly and will ALTER TABLE only when required.
    """
    cols = [
        ("player1_elo_before", "REAL"),
        ("player1_elo_after", "REAL"),
        ("player2_elo_before", "REAL"),
        ("player2_elo_after", "REAL"),
        ("player1_g2_rating_before", "REAL"),
        ("player1_g2_rating_after", "REAL"),
        ("player1_g2_rd_before", "REAL"),
        ("player1_g2_rd_after", "REAL"),
        ("player1_g2_vol_before", "REAL"),
        ("player1_g2_vol_after", "REAL"),
        ("player2_g2_rating_before", "REAL"),
        ("player2_g2_rating_after", "REAL"),
        ("player2_g2_rd_before", "REAL"),
        ("player2_g2_rd_after", "REAL"),
        ("player2_g2_vol_before", "REAL"),
        ("player2_g2_vol_after", "REAL"),
    ]
    cur = conn.cursor()
    for name, typ in cols:
        try:
            if not _column_exists(conn, "Matches", name):
                cur.execute(f"ALTER TABLE Matches ADD COLUMN {name} {typ}")
        except Exception:
            # Be conservative: if ALTER fails for any reason, continue.
            pass
    conn.commit()


def migrate_add_player_g2_columns(conn):
    cols = [
        ("g2_rating", "REAL"),
        ("g2_rd", "REAL"),
        ("g2_vol", "REAL"),
    ]
    cur = conn.cursor()
    for name, typ in cols:
        try:
            if not _column_exists(conn, "Players", name):
                cur.execute(f"ALTER TABLE Players ADD COLUMN {name} {typ}")
        except Exception:
            pass
    conn.commit()


def migrate_add_player_last_game_columns(conn):
    """Add `last_game_date` and `last_game_match_id` to Players."""
    cols = [
        ("last_game_date", "TEXT"),
        ("last_game_match_id", "INTEGER"),
    ]
    cur = conn.cursor()
    for name, typ in cols:
        try:
            if not _column_exists(conn, "Players", name):
                cur.execute(f"ALTER TABLE Players ADD COLUMN {name} {typ}")
        except Exception:
            pass
    conn.commit()


def migrate_add_match_last_played_columns(conn):
    """Add per-match last-played audit columns to Matches."""
    cols = [
        ("player1_last_played_before", "TEXT"),
        ("player2_last_played_before", "TEXT"),
    ]
    cur = conn.cursor()
    for name, typ in cols:
        try:
            if not _column_exists(conn, "Matches", name):
                cur.execute(f"ALTER TABLE Matches ADD COLUMN {name} {typ}")
        except Exception:
            pass
    conn.commit()


def migrate_add_tournament_completed(conn):
    """Add a 'completed' flag to Tournaments so older DBs can be updated.

    This is safe to run repeatedly and will ALTER TABLE only when required.
    """
    cur = conn.cursor()
    try:
        if not _column_exists(conn, "Tournaments", "completed"):
            cur.execute("ALTER TABLE Tournaments ADD COLUMN completed INTEGER DEFAULT 0")
    except Exception:
        # Be conservative: if ALTER fails for any reason, continue.
        pass
    conn.commit()
