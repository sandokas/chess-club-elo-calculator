import sqlite3
from datetime import date

# --------------------
# Configuration
# --------------------
MIN_GAMES_FOR_OFFICIAL = 10  # below this = provisional
SHOW_PROVISIONAL_IN_LEADERBOARD = True  # toggle via menu


# --------------------
# Elo helpers
# --------------------
def expected_score(rating_a, rating_b):
    return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))


def k_factor(games_played):
    """Variable K based on how many games a player has already played."""
    if games_played < 20:
        return 40  # provisional, fast changes
    elif games_played < 50:
        return 20  # semi-stable
    else:
        return 10  # stable


def update_elo(rating_a, rating_b, score_a, k_a, k_b):
    """
    rating_a, rating_b : current ratings
    score_a            : 1.0, 0.5, or 0.0 (score of player A)
    k_a, k_b           : K-factors for each player (can differ)
    """
    exp_a = expected_score(rating_a, rating_b)
    exp_b = 1 - exp_a

    s_a = score_a
    s_b = 1 - score_a

    new_a = rating_a + k_a * (s_a - exp_a)
    new_b = rating_b + k_b * (s_b - exp_b)

    return round(new_a, 2), round(new_b, 2)


# --------------------
# Database setup
# --------------------
conn = sqlite3.connect("chessclub.db")
conn.execute("PRAGMA foreign_keys = ON")
cur = conn.cursor()

cur.execute("""
CREATE TABLE IF NOT EXISTS Players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    elo REAL DEFAULT 1200
)
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS Tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL
)
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS TournamentPlayers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    FOREIGN KEY(tournament_id) REFERENCES Tournaments(id),
    FOREIGN KEY(player_id) REFERENCES Players(id)
)
""")

cur.execute("""
CREATE TABLE IF NOT EXISTS Matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    result REAL NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY(tournament_id) REFERENCES Tournaments(id),
    FOREIGN KEY(player1_id) REFERENCES Players(id),
    FOREIGN KEY(player2_id) REFERENCES Players(id)
)
""")
conn.commit()


# --------------------
# Helpers using DB
# --------------------
def games_played_for_player(player_id):
    """Total games this player has already in the DB."""
    cur.execute("""
        SELECT COUNT(*)
        FROM Matches
        WHERE player1_id = ? OR player2_id = ?
    """, (player_id, player_id))
    return cur.fetchone()[0]


# --------------------
# Club-level functions
# --------------------
def add_player():
    name = input("Enter player name: ").strip()
    if not name:
        return
    try:
        cur.execute("INSERT INTO Players (name) VALUES (?)", (name,))
        conn.commit()
        print(f"✅ Player '{name}' added with initial Elo 1200.")
    except sqlite3.IntegrityError:
        print("⚠️ Player already exists.")


def create_tournament():
    name = input("Enter tournament name: ").strip()
    tdate = input("Enter tournament date (YYYY-MM-DD): ").strip()
    try:
        cur.execute("INSERT INTO Tournaments (name, date) VALUES (?, ?)", (name, tdate))
        conn.commit()
        print(f"✅ Tournament '{name}' created on {tdate}.")
    except sqlite3.IntegrityError:
        print("⚠️ Tournament already exists.")


def list_tournaments():
    cur.execute("SELECT id, name, date FROM Tournaments ORDER BY date DESC")
    return cur.fetchall()


def show_leaderboard():
    global SHOW_PROVISIONAL_IN_LEADERBOARD

    print("\n🏆 Global Leaderboard:")

    cur.execute("SELECT id, name, elo FROM Players ORDER BY elo DESC")
    players = cur.fetchall()

    official = []
    provisional = []

    for pid, name, elo in players:
        # Games played + last game
        cur.execute("""
            SELECT COUNT(*), MAX(date)
            FROM Matches
            WHERE player1_id = ? OR player2_id = ?
        """, (pid, pid))
        games_played, last_game = cur.fetchone()
        last_game_str = last_game if last_game else "No games"

        # Wins
        cur.execute("""
            SELECT COUNT(*) FROM Matches
            WHERE (player1_id = ? AND result = 1.0)
               OR (player2_id = ? AND result = 0.0)
        """, (pid, pid))
        wins = cur.fetchone()[0]

        # Draws
        cur.execute("""
            SELECT COUNT(*) FROM Matches
            WHERE (player1_id = ? OR player2_id = ?) AND result = 0.5
        """, (pid, pid))
        draws = cur.fetchone()[0]

        # Losses = total - wins - draws
        losses = games_played - wins - draws

        player_row = (name, elo, games_played, wins, draws, losses, last_game_str)

        if games_played >= MIN_GAMES_FOR_OFFICIAL:
            official.append(player_row)
        else:
            provisional.append(player_row)

    # --- Official leaderboard ---
    print("\n📊 Official Leaderboard (≥ "
          f"{MIN_GAMES_FOR_OFFICIAL} games):")
    if not official:
        print("  (No players with enough games yet.)")
    else:
        for name, elo, games_played, wins, draws, losses, last_game_str in official:
            print(f"{name:15} Elo: {elo:6.1f} | Games: {games_played:3d} "
                  f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str}")

    # --- Provisional section (optional) ---
    if SHOW_PROVISIONAL_IN_LEADERBOARD:
        print("\n🧪 Provisional Players (< "
              f"{MIN_GAMES_FOR_OFFICIAL} games):")
        if not provisional:
            print("  (No provisional players.)")
        else:
            for name, elo, games_played, wins, draws, losses, last_game_str in provisional:
                print(f"{name:15} Elo: {elo:6.1f} | Games: {games_played:3d} "
                      f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str} (P)")
    else:
        if provisional:
            print(f"\n(ℹ️ {len(provisional)} provisional players hidden. "
                  f"Toggle them ON in the main menu to see them.)")

    print()


# --------------------
# Tournament context functions
# --------------------
def add_player_to_tournament(tid):
    # List only players not already in this tournament
    cur.execute("""
        SELECT id, name
        FROM Players
        WHERE id NOT IN (
            SELECT player_id FROM TournamentPlayers WHERE tournament_id = ?
        )
    """, (tid,))
    players = cur.fetchall()
    if not players:
        print("⚠️ All players are already in this tournament.")
        return

    print("\nAvailable Club Players (not yet in tournament):")
    for pid, pname in players:
        print(f"{pid}: {pname}")

    pid = input("Select player ID: ").strip()
    try:
        cur.execute("INSERT INTO TournamentPlayers (tournament_id, player_id) VALUES (?, ?)", (tid, pid))
        conn.commit()
        print("✅ Player added to tournament.")
    except sqlite3.IntegrityError:
        print("⚠️ Player already registered in this tournament.")


def record_match(tid):
    # Get tournament date
    cur.execute("SELECT date FROM Tournaments WHERE id=?", (tid,))
    tdate = cur.fetchone()[0]

    # Tournament players
    cur.execute("""
        SELECT p.id, p.name
        FROM TournamentPlayers tp
        JOIN Players p ON tp.player_id = p.id
        WHERE tp.tournament_id = ?
    """, (tid,))
    players = cur.fetchall()
    if len(players) < 2:
        print("⚠️ Not enough players registered.")
        return

    print("\nTournament Players:")
    for pid, pname in players:
        print(f"{pid}: {pname}")

    pid1 = input("Select Player 1 ID: ").strip()
    pid2 = input("Select Player 2 ID: ").strip()
    if pid1 == pid2:
        print("⚠️ Cannot play against self.")
        return

    # convert to int for consistency
    try:
        pid1 = int(pid1)
        pid2 = int(pid2)
    except ValueError:
        print("⚠️ Invalid player ID.")
        return

    result = input("Result (1 = P1 wins, 0 = P2 wins, 0.5 = draw): ").strip()
    try:
        result = float(result)
        if result not in [0, 0.5, 1]:
            raise ValueError
    except ValueError:
        print("⚠️ Invalid result.")
        return

    # Ratings
    cur.execute("SELECT elo, name FROM Players WHERE id=?", (pid1,))
    row1 = cur.fetchone()
    if not row1:
        print("⚠️ Player 1 not found.")
        return
    r1, n1 = row1

    cur.execute("SELECT elo, name FROM Players WHERE id=?", (pid2,))
    row2 = cur.fetchone()
    if not row2:
        print("⚠️ Player 2 not found.")
        return
    r2, n2 = row2

    # Games played *before* this match
    g1 = games_played_for_player(pid1)
    g2 = games_played_for_player(pid2)

    k1 = k_factor(g1)
    k2 = k_factor(g2)

    new_elo1, new_elo2 = update_elo(r1, r2, result, k1, k2)

    cur.execute("UPDATE Players SET elo=? WHERE id=?", (new_elo1, pid1))
    cur.execute("UPDATE Players SET elo=? WHERE id=?", (new_elo2, pid2))
    cur.execute(
        "INSERT INTO Matches (tournament_id, player1_id, player2_id, result, date) VALUES (?, ?, ?, ?, ?)",
        (tid, pid1, pid2, result, tdate)
    )
    conn.commit()
    print(f"✅ Match recorded. New ratings: {n1}={new_elo1}, {n2}={new_elo2}")


def show_tournament_matches(tid):
    cur.execute("""
        SELECT p1.name, p2.name, m.result, m.date
        FROM Matches m
        JOIN Players p1 ON m.player1_id = p1.id
        JOIN Players p2 ON m.player2_id = p2.id
        WHERE m.tournament_id = ?
        ORDER BY m.id
    """, (tid,))
    rows = cur.fetchall()
    print("\n📜 Tournament Matches:")
    for p1, p2, result, d in rows:
        if result == 1:
            outcome = f"{p1} beat {p2}"
        elif result == 0:
            outcome = f"{p2} beat {p1}"
        else:
            outcome = f"{p1} drew with {p2}"
        print(f"{d}: {outcome}")
    print()


# --------------------
# Menus
# --------------------
def tournament_menu(tid, tname, tdate):
    """Work inside a specific tournament until user exits."""
    while True:
        print(f"\n=== Tournament: {tname} ({tdate}) ===")
        print("1. Add Player to Tournament")
        print("2. Record Match")
        print("3. Show Tournament Matches")
        print("4. Return to Main Menu")
        choice = input("Select an option: ").strip()

        if choice == "1":
            add_player_to_tournament(tid)
        elif choice == "2":
            record_match(tid)
        elif choice == "3":
            show_tournament_matches(tid)
        elif choice == "4":
            break
        else:
            print("⚠️ Invalid choice. Try again.")


def recompute_elos():
    # 1. Reset all players to default Elo
    cur.execute("UPDATE Players SET elo = 1200")

    # 1b. Build games_played dict for all players (start at 0)
    cur.execute("SELECT id FROM Players")
    games_played = {pid: 0 for (pid,) in cur.fetchall()}

    # 2. Load all matches ordered by date, then by ID (for consistent replay)
    cur.execute("""
        SELECT id, player1_id, player2_id, result
        FROM Matches
        ORDER BY date, id
    """)
    matches = cur.fetchall()

    # 3. Re-apply matches in chronological order
    for match_id, p1, p2, result in matches:
        # Fetch current Elos
        cur.execute("SELECT elo FROM Players WHERE id = ?", (p1,))
        elo1 = cur.fetchone()[0]
        cur.execute("SELECT elo FROM Players WHERE id = ?", (p2,))
        elo2 = cur.fetchone()[0]

        # Games played so far (before this match)
        g1 = games_played.get(p1, 0)
        g2 = games_played.get(p2, 0)

        k1 = k_factor(g1)
        k2 = k_factor(g2)

        # Update Elos
        new_elo1, new_elo2 = update_elo(elo1, elo2, result, k1, k2)

        # Save new Elos back to Players
        cur.execute("UPDATE Players SET elo = ? WHERE id = ?", (new_elo1, p1))
        cur.execute("UPDATE Players SET elo = ? WHERE id = ?", (new_elo2, p2))

        # Increment games played AFTER the match is processed
        games_played[p1] = g1 + 1
        games_played[p2] = g2 + 1

    conn.commit()
    print("✅ Elo ratings successfully recomputed from all matches with variable K.")


def toggle_provisional_display():
    global SHOW_PROVISIONAL_IN_LEADERBOARD
    SHOW_PROVISIONAL_IN_LEADERBOARD = not SHOW_PROVISIONAL_IN_LEADERBOARD
    state = "ON" if SHOW_PROVISIONAL_IN_LEADERBOARD else "OFF"
    print(f"🔁 Provisional players display is now {state}.")


def main():
    while True:
        state = "ON" if SHOW_PROVISIONAL_IN_LEADERBOARD else "OFF"
        print("\n=== Chess Club Manager ===")
        print("1. Add Player to Club")
        print("2. Create Tournament")
        print("3. Open Tournament")
        print("4. Show Global Leaderboard")
        print("5. Exit")
        print("6. Recompute ELOs")
        print(f"7. Toggle Provisional in Leaderboard (currently: {state})")
        choice = input("Select an option: ").strip()

        if choice == "1":
            add_player()
        elif choice == "2":
            create_tournament()
        elif choice == "3":
            tournaments = list_tournaments()
            if not tournaments:
                print("⚠️ No tournaments exist.")
                continue
            print("\nAvailable Tournaments:")
            for tid, name, tdate in tournaments:
                print(f"{tid}: {name} ({tdate})")
            tid = input("Select tournament ID: ").strip()
            cur.execute("SELECT name, date FROM Tournaments WHERE id=?", (tid,))
            result = cur.fetchone()
            if result:
                tname, tdate = result
                tournament_menu(tid, tname, tdate)
            else:
                print("⚠️ Invalid tournament ID.")
        elif choice == "4":
            show_leaderboard()
        elif choice == "5":
            print("👋 Goodbye!")
            conn.close()
            break
        elif choice == "6":
            recompute_elos()
        elif choice == "7":
            toggle_provisional_display()
        else:
            print("⚠️ Invalid choice. Try again.")


if __name__ == "__main__":
    main()

