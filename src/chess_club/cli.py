"""Interactive CLI for the Chess Club package (src layout).

This is a copy of the package CLI adapted to the `src/` layout. Keep this
in sync with the package's main CLI implementation.
"""
from datetime import date
from . import db, repo, tournament, ranking, config


def add_player_flow(conn):
    name = input("Enter player name: ").strip()
    if not name:
        return
    try:
        repo.add_player(conn, name)
        print(f"✅ Player '{name}' added with initial Elo 1200.")
    except Exception:
        print("⚠️ Player already exists or error adding player.")


def create_tournament_flow(conn):
    name = input("Enter tournament name: ").strip()
    tdate = input("Enter tournament date (YYYY-MM-DD): ").strip()
    try:
        repo.add_tournament(conn, name, tdate)
        print(f"✅ Tournament '{name}' created on {tdate}.")
    except Exception:
        print("⚠️ Tournament already exists or error creating tournament.")


def open_tournament_flow(conn):
    tournaments = repo.list_tournaments(conn)
    if not tournaments:
        print("⚠️ No tournaments exist.")
        return
    print("\nAvailable Tournaments:")
    for tid, name, tdate in tournaments:
        print(f"{tid}: {name} ({tdate})")
    tid = input("Select tournament ID: ").strip()
    try:
        tid_int = int(tid)
    except ValueError:
        print("⚠️ Invalid tournament ID.")
        return
    found = [t for t in tournaments if t[0] == tid_int]
    if not found:
        print("⚠️ Invalid tournament ID.")
        return
    tname, tdate = found[0][1], found[0][2]
    tournament_menu(conn, tid_int, tname, tdate)


def tournament_menu(conn, tid, tname, tdate):
    while True:
        print(f"\n=== Tournament: {tname} ({tdate}) ===")
        print("1. Add Player to Tournament")
        print("2. Record Match")
        print("3. Show Tournament Matches")
        print("4. Return to Main Menu")
        choice = input("Select an option: ").strip()

        if choice == "1":
            # list available players
            players = [p for p in repo.list_players(conn) if p[0] not in [pp[0] for pp in repo.get_tournament_players(conn, tid)]]
            if not players:
                print("⚠️ All players are already in this tournament.")
                continue
            print("\nAvailable Club Players (not yet in tournament):")
            for pid, pname, _ in players:
                print(f"{pid}: {pname}")
            pid = input("Select player ID: ").strip()
            try:
                pid_int = int(pid)
            except ValueError:
                print("⚠️ Invalid player ID.")
                continue
            try:
                tournament.add_player_to_tournament(conn, tid, pid_int)
                print("✅ Player added to tournament.")
            except Exception:
                print("⚠️ Player already registered in this tournament or error.")
        elif choice == "2":
            players = repo.get_tournament_players(conn, tid)
            if len(players) < 2:
                print("⚠️ Not enough players registered.")
                continue
            print("\nTournament Players:")
            for pid, pname in players:
                print(f"{pid}: {pname}")
            pid1 = input("Select Player 1 ID: ").strip()
            pid2 = input("Select Player 2 ID: ").strip()
            if pid1 == pid2:
                print("⚠️ Cannot play against self.")
                continue
            try:
                pid1 = int(pid1)
                pid2 = int(pid2)
            except ValueError:
                print("⚠️ Invalid player ID.")
                continue
            result = input("Result (1 = P1 wins, 0 = P2 wins, 0.5 = draw): ").strip()
            try:
                result = float(result)
                if result not in [0, 0.5, 1]:
                    raise ValueError
            except ValueError:
                print("⚠️ Invalid result.")
                continue
            # get tournament date already provided
            try:
                n1, new1, n2, new2 = tournament.record_match_logic(conn, tid, pid1, pid2, result, tdate)
                print(f"✅ Match recorded. New ratings: {n1}={new1}, {n2}={new2}")
            except Exception as e:
                print("⚠️ Error recording match:", e)
        elif choice == "3":
            rows = repo.list_matches_for_tournament(conn, tid)
            print("\n📜 Tournament Matches:")
            for p1, p2, result, d, p1_before, p1_after, p2_before, p2_after, p1_g_before, p1_g_after, p2_g_before, p2_g_after in rows:
                if result == 1:
                    outcome = f"{p1} beat {p2}"
                elif result == 0:
                    outcome = f"{p2} beat {p1}"
                else:
                    outcome = f"{p1} drew with {p2}"
                # compute deltas when available (Elo)
                if p1_before is not None and p1_after is not None and p2_before is not None and p2_after is not None:
                    p1_delta = p1_after - p1_before
                    p2_delta = p2_after - p2_before
                    elo_part = f"{p1}: {p1_before:.1f} → {p1_after:.1f} ({p1_delta:+.1f}), {p2}: {p2_before:.1f} → {p2_after:.1f} ({p2_delta:+.1f})"
                else:
                    elo_part = None

                # Glicko display when available
                if p1_g_before is not None and p1_g_after is not None and p2_g_before is not None and p2_g_after is not None:
                    p1_g_delta = p1_g_after - p1_g_before
                    p2_g_delta = p2_g_after - p2_g_before
                    g_part = f"G2: {p1}: {p1_g_before:.1f} → {p1_g_after:.1f} ({p1_g_delta:+.1f}), {p2}: {p2_g_before:.1f} → {p2_g_after:.1f} ({p2_g_delta:+.1f})"
                else:
                    g_part = None

                if config.RATING_SYSTEM == 'both':
                    parts = [part for part in (elo_part, g_part) if part]
                    if parts:
                        print(f"{d}: {outcome} | " + " | ".join(parts))
                    else:
                        print(f"{d}: {outcome}")
                elif config.RATING_SYSTEM == 'glicko2':
                    print(f"{d}: {outcome} | " + (g_part if g_part else (elo_part if elo_part else "(no rating data)")))
                else:
                    print(f"{d}: {outcome} | " + (elo_part if elo_part else (g_part if g_part else "(no rating data)")))
            print()
        elif choice == "4":
            break
        else:
            print("⚠️ Invalid choice. Try again.")


def show_player_games_flow(conn):
    players = repo.list_players(conn)
    if not players:
        print("⚠️ No players in club.")
        return
    print("\nClub Players:")
    for pid, pname, _ in players:
        print(f"{pid}: {pname}")
    pid_in = input("Select player ID to show games: ").strip()
    try:
        pid = int(pid_in)
    except ValueError:
        print("⚠️ Invalid player ID.")
        return

    matches = repo.list_matches_for_player(conn, pid)
    if not matches:
        print("  (No matches for this player.)")
        return

    print(f"\n📚 Matches for player ID {pid}:")
    for (mid, tname, mdate,
        p1id, p1name, p1_before, p1_after,
        p2id, p2name, p2_before, p2_after,
        p1_g_before, p1_g_after, p2_g_before, p2_g_after,
        result) in matches:

        if pid == p1id:
            me_name, opp_name = p1name, p2name
            me_before, me_after = p1_before, p1_after
            opp_before, opp_after = p2_before, p2_after
            if result == 1:
                outcome = "won"
            elif result == 0.5:
                outcome = "drew"
            elif result == 0:
                outcome = "lost"
            else:
                outcome = f"result={result}"
        else:
            me_name, opp_name = p2name, p1name
            me_before, me_after = p2_before, p2_after
            opp_before, opp_after = p1_before, p1_after
            if result == 0:
                outcome = "won"
            elif result == 0.5:
                outcome = "drew"
            elif result == 1:
                outcome = "lost"
            else:
                outcome = f"result={result}"

        try:
            elo_delta = None if (me_before is None or me_after is None) else round(me_after - me_before, 2)
        except Exception:
            elo_delta = None

        try:
            g_delta = None if (me_g_before is None or me_g_after is None) else round(me_g_after - me_g_before, 2)
        except Exception:
            g_delta = None

        elo_part = None
        if me_before is not None and me_after is not None:
            sign = "+" if elo_delta is not None and elo_delta > 0 else ""
            elo_part = f"Elo: {me_before:.1f} → {me_after:.1f} ({sign}{elo_delta if elo_delta is not None else '0.0'})"

        g_part = None
        # determine me_g_before/me_g_after depending on which side
        if pid == p1id:
            me_g_before, me_g_after = p1_g_before, p1_g_after
        else:
            me_g_before, me_g_after = p2_g_before, p2_g_after

        if me_g_before is not None and me_g_after is not None:
            gsign = "+" if g_delta is not None and g_delta > 0 else ""
            g_part = f"G2: {me_g_before:.1f} → {me_g_after:.1f} ({gsign}{g_delta if g_delta is not None else '0.0'})"

        if config.RATING_SYSTEM == 'both':
            parts = [p for p in (elo_part, g_part) if p]
            combined = " | ".join(parts) if parts else "(no rating data)"
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | {combined}")
        elif config.RATING_SYSTEM == 'glicko2':
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | " + (g_part if g_part else (elo_part if elo_part else "(no rating data)")))
        else:
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | " + (elo_part if elo_part else (g_part if g_part else "(no rating data)")))


def main():
    conn = db.get_connection(config.DB_PATH)
    db.init_db(conn)
    show_prov = config.SHOW_PROVISIONAL_IN_LEADERBOARD
    while True:
        state = "ON" if show_prov else "OFF"
        print("\n=== Chess Club Manager ===")
        print("1. Add Player to Club")
        print("2. Create Tournament")
        print("3. Open Tournament")
        print("4. Show Global Leaderboard")
        print("5. Exit")
        print("6. Recompute ELOs")
        print(f"7. Toggle Provisional in Leaderboard (currently: {state})")
        print("8. Show Player Games")
        choice = input("Select an option: ").strip()

        if choice == "1":
            add_player_flow(conn)
        elif choice == "2":
            create_tournament_flow(conn)
        elif choice == "3":
            open_tournament_flow(conn)
        elif choice == "4":
            ranking.show_leaderboard(conn, show_prov)
        elif choice == "5":
            print("👋 Goodbye!")
            conn.close()
            break
        elif choice == "6":
            ranking.recompute(conn)
        elif choice == "7":
            show_prov = not show_prov
            state = "ON" if show_prov else "OFF"
            print(f"🔁 Provisional players display is now {state}.")
        elif choice == "8":
            show_player_games_flow(conn)
        else:
            print("⚠️ Invalid choice. Try again.")


if __name__ == "__main__":
    main()
