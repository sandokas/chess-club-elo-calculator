
"""Interactive CLI for the Chess Club package (src layout).

"""
import chess_club.db as db
import chess_club.repo as repo
import chess_club.tournament as tournament
import chess_club.ranking as ranking
import chess_club.config as config


def add_player_flow(conn):
    name = input("Enter player name: ").strip()
    if not name:
        return
    try:
        repo.add_player(conn, name, config.DEFAULT_ELO)
        print(f"✅ Player '{name}' added with initial Elo {config.DEFAULT_ELO}.")
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

    tid = input("Select tournament ID (or leave blank to cancel): ").strip()
    if not tid:
        print("Nothing was selected. Returning.")
        return
    if not tid.isdigit():
        print("⚠️ Invalid tournament ID.")
        return
    tid_int = int(tid)

    # validate against current DB in case list is stale or tournament was removed
    t = repo.get_tournament(conn, tid_int)
    if not t:
        print("⚠️ Tournament not found.")
        return
    tournament_menu(conn, tid_int)


def tournament_menu(conn, tid):
    while True:
        t = repo.get_tournament(conn, tid)
        if not t:
            print("⚠️ Tournament not found (it may have been deleted). Returning to main menu.")
            return
        _, tname, tdate = t
        print(f"\n=== Tournament: {tname} ({tdate}) ===")
        print("1. Add Player to Tournament")
        print("2. Record Match")
        print("3. Show Tournament Matches")
        print("4. Return to Main Menu")
        print("5. Update Tournament")
        print("6. Delete Tournament")
        choice = input("Select an option: ").strip()

        if choice == "1":
            # list available players
            players = [p for p in repo.list_players(conn) if p[0] not in [pp[0] for pp in repo.get_tournament_players(conn, tid)]]
            if not players:
                print("⚠️ All players are already in this tournament.")
                continue
            print("\nAvailable Club Players (not yet in tournament):")
            for pid, pname, elo_val, g2_rating, g2_rd, g2_vol in players:
                # Prepare Elo display (explicit placeholder when missing)
                elo_display = f"Elo:{elo_val:.1f}" if elo_val is not None else "Elo:(none)"

                # Prepare G2 display (explicit placeholder when missing)
                g2_display = f"G2:{g2_rating:.1f}" if g2_rating is not None else "G2:(none)"

                if config.RATING_SYSTEM == 'glicko2':
                    print(f"{pid}: {pname} | {g2_display}")
                elif config.RATING_SYSTEM == 'both':
                    print(f"{pid}: {pname} | {elo_display} / {g2_display}")
                else:
                    print(f"{pid}: {pname} | {elo_display}")
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
                # tournament players source only provides id/name; fetch ratings once
                p = repo.get_player(conn, pid)
                elo_val = p[2] if p else None
                g = repo.get_player_glicko(conn, pid)
                g_rating = g[0] if g else None

                # Elo/G2 placeholders (avoid formatting None)
                elo_display = f"Elo:{elo_val:.1f}" if elo_val is not None else "Elo:(none)"

                g2_display = f"G2:{g_rating:.1f}" if g_rating is not None else "G2:(none)"

                if config.RATING_SYSTEM == 'glicko2':
                    print(f"{pid}: {pname} | {g2_display}")
                elif config.RATING_SYSTEM == 'both':
                    print(f"{pid}: {pname} | {elo_display} / {g2_display}")
                else:
                    print(f"{pid}: {pname} | {elo_display}")
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
                n1, new1, n2, new2 = tournament.create_match(conn, tid, pid1, pid2, result, tdate)
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
                    elo_display = elo_part if elo_part else "Elo:(none)"
                    g_display = g_part if g_part else "G2:(none)"
                    print(f"{d}: {outcome} | {elo_display} | {g_display}")
                elif config.RATING_SYSTEM == 'glicko2':
                    print(f"{d}: {outcome} | " + (g_part if g_part else "G2:(none)"))
                else:
                    print(f"{d}: {outcome} | " + (elo_part if elo_part else "Elo:(none)"))
            print()
        elif choice == "4":
            break
        elif choice == "5":
            # Update tournament name/date
            cur = repo.get_tournament(conn, tid)
            if not cur:
                print("⚠️ Tournament not found.")
                continue
            _, cur_name, cur_date = cur
            new_name = input(f"Enter new tournament name (leave blank to keep '{cur_name}'): ").strip()
            new_date = input(f"Enter new tournament date (YYYY-MM-DD) (leave blank to keep '{cur_date}'): ").strip()
            if not new_name:
                new_name = cur_name
            if not new_date:
                new_date = cur_date
            try:
                repo.update_tournament(conn, tid, new_name, new_date)
                print("✅ Tournament updated.")
            except Exception:
                print("⚠️ Error updating tournament.")
        elif choice == "6":
            # Delete tournament (ask confirmation if games exist)
            try:
                games_count = repo.count_matches_for_tournament(conn, tid)
            except Exception:
                games_count = 0
            if games_count > 0:
                confirm = input(f"Tournament has {games_count} recorded games. Type 'yes' to permanently delete tournament and its games: ").strip().lower()
                if confirm != 'yes':
                    print("Deletion cancelled.")
                    continue
            else:
                confirm = input("Delete this tournament? Type 'yes' to confirm: ").strip().lower()
                if confirm != 'yes':
                    print("Deletion cancelled.")
                    continue

            try:
                repo.delete_tournament(conn, tid)
                # recompute ratings after removing matches
                ranking.recompute(conn)
                print("✅ Tournament and its games deleted. Ratings recomputed.")
                return
            except Exception as e:
                print("⚠️ Error deleting tournament:", e)
                continue
        else:
            print("⚠️ Invalid choice. Try again.")


def show_player_games_flow(conn):
    players = repo.list_players(conn)
    if not players:
        print("⚠️ No players in club.")
        return
    print("\nClub Players:")
    for pid, pname, elo_val, g2_rating, g2_rd, g2_vol in players:
        # Elo placeholder
        elo_display = f"Elo:{elo_val:.1f}" if elo_val is not None else "Elo:(none)"

        # G2 placeholder
        g2_display = f"G2:{g2_rating:.1f}" if g2_rating is not None else "G2:(none)"

        if config.RATING_SYSTEM == 'glicko2':
            print(f"{pid}: {pname} | {g2_display}")
        elif config.RATING_SYSTEM == 'both':
            print(f"{pid}: {pname} | {elo_display} / {g2_display}")
        else:
            print(f"{pid}: {pname} | {elo_display}")
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

        # compute G2 delta and part after we know me_g_before/me_g_after
        g_part = None
        try:
            g_delta = None if (me_g_before is None or me_g_after is None) else round(me_g_after - me_g_before, 2)
        except Exception:
            g_delta = None
        if me_g_before is not None and me_g_after is not None:
            gsign = "+" if g_delta is not None and g_delta > 0 else ""
            g_part = f"G2: {me_g_before:.1f} → {me_g_after:.1f} ({gsign}{g_delta if g_delta is not None else '0.0'})"

        if config.RATING_SYSTEM == 'both':
            elo_display = elo_part if elo_part else "Elo:(none)"
            g_display = g_part if g_part else "G2:(none)"
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | {elo_display} | {g_display}")
        elif config.RATING_SYSTEM == 'glicko2':
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | " + (g_part if g_part else "G2:(none)"))
        else:
            print(f"{mdate} | Tournament: {tname or '(none)'} | {me_name} {outcome} vs {opp_name} | " + (elo_part if elo_part else "Elo:(none)"))


def delete_player_flow(conn):
    players = repo.list_players(conn)
    if not players:
        print("⚠️ No players in club.")
        return
    print("\nClub Players:")
    for pid, pname, elo_val, g2_rating, g2_rd, g2_vol in players:
        elo_display = f"Elo:{elo_val:.1f}" if elo_val is not None else "Elo:(none)"
        # prepare G2 display safely
        g2_display = f"G2:{g2_rating:.1f}" if g2_rating is not None else "G2:(none)"
        if config.RATING_SYSTEM == 'glicko2':
            print(f"{pid}: {pname} | {g2_display}")
        elif config.RATING_SYSTEM == 'both':
            print(f"{pid}: {pname} | {elo_display} / {g2_display}")
        else:
            print(f"{pid}: {pname} | {elo_display}")

    pid_in = input("Select player ID to delete (or leave blank to cancel): ").strip()
    if not pid_in:
        print("Deletion cancelled.")
        return
    try:
        pid = int(pid_in)
    except ValueError:
        print("⚠️ Invalid player ID.")
        return

    p = repo.get_player(conn, pid)
    if not p:
        print("⚠️ Player not found.")
        return

    try:
        games_count = repo.games_played_for_player(conn, pid)
    except Exception:
        games_count = 0

    if games_count > 0:
        confirm = input(f"Player has {games_count} recorded games. Type 'yes' to permanently delete player and their games: ").strip().lower()
        if confirm != 'yes':
            print("Deletion cancelled.")
            return
    else:
        confirm = input("Delete this player? Type 'yes' to confirm: ").strip().lower()
        if confirm != 'yes':
            print("Deletion cancelled.")
            return

    try:
        repo.delete_player(conn, pid)
        ranking.recompute(conn)
        print("✅ Player and their games deleted. Ratings recomputed.")
    except Exception as e:
        print("⚠️ Error deleting player:", e)


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
        print("9. Delete Player")
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
        elif choice == "9":
            delete_player_flow(conn)
        else:
            print("⚠️ Invalid choice. Try again.")


if __name__ == "__main__":
    main()
