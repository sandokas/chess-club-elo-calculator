from . import repo, elo, config, glicko2


def show_leaderboard(conn, show_provisional: bool = True):
    print("\n🏆 Global Leaderboard:")

    players = repo.list_players(conn)

    official = []
    provisional = []

    for pid, name, elo_rating in players:
        games_played, wins, draws, losses, last_game = repo.get_player_summary(conn, pid)
        last_game_str = last_game if last_game else "No games"
        player_row = (name, elo_rating, games_played, wins, draws, losses, last_game_str)
        if games_played >= config.MIN_GAMES_FOR_OFFICIAL:
            official.append(player_row)
        else:
            provisional.append(player_row)

    print("\n📊 Official Leaderboard (≥ " f"{config.MIN_GAMES_FOR_OFFICIAL} games):")
    if not official:
        print("  (No players with enough games yet.)")
    else:
        for name, elo_rating, games_played, wins, draws, losses, last_game_str in official:
            print(f"{name:15} Elo: {elo_rating:6.1f} | Games: {games_played:3d} "
                  f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str}")

    if show_provisional:
        print("\n🧪 Provisional Players (< " f"{config.MIN_GAMES_FOR_OFFICIAL} games):")
        if not provisional:
            print("  (No provisional players.)")
        else:
            for name, elo_rating, games_played, wins, draws, losses, last_game_str in provisional:
                print(f"{name:15} Elo: {elo_rating:6.1f} | Games: {games_played:3d} "
                      f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str} (P)")
    else:
        if provisional:
            print(f"\n(ℹ️ {len(provisional)} provisional players hidden. Toggle them ON in the main menu to see them.)")


def recompute_elos(conn):
    cur = conn.cursor()
    cur.execute("UPDATE Players SET elo = 1200")

    # games played counter
    cur.execute("SELECT id FROM Players")
    games_played = {pid: 0 for (pid,) in cur.fetchall()}

    matches = repo.get_all_matches_ordered(conn)

    for match_id, p1, p2, result, date in matches:
        cur.execute("SELECT elo FROM Players WHERE id = ?", (p1,))
        elo1 = cur.fetchone()[0]
        cur.execute("SELECT elo FROM Players WHERE id = ?", (p2,))
        elo2 = cur.fetchone()[0]

        g1 = games_played.get(p1, 0)
        g2 = games_played.get(p2, 0)

        k1 = elo.k_factor(g1)
        k2 = elo.k_factor(g2)

        new_elo1, new_elo2 = elo.update_elo(elo1, elo2, result, k1, k2)

        # update players
        repo.update_player_elo(conn, p1, new_elo1)
        repo.update_player_elo(conn, p2, new_elo2)

        # backfill per-match elo columns if available
        try:
            repo.update_match_elos(conn, match_id, elo1, new_elo1, elo2, new_elo2)
        except Exception:
            pass

        games_played[p1] = g1 + 1
        games_played[p2] = g2 + 1

    conn.commit()
    print("✅ Elo ratings successfully recomputed from all matches with variable K.")


def recompute_glicko(conn):
    cur = conn.cursor()
    # reset glicko columns to defaults
    cur.execute("SELECT id FROM Players")
    pids = [pid for (pid,) in cur.fetchall()]
    for pid in pids:
        cur.execute("UPDATE Players SET g2_rating = ?, g2_rd = ?, g2_vol = ? WHERE id = ?",
                    (config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL, pid))

    conn.commit()

    # games played counter
    cur.execute("SELECT id FROM Players")
    games_played = {pid: 0 for (pid,) in cur.fetchall()}

    matches = repo.get_all_matches_ordered(conn)

    for match_id, p1, p2, result, date in matches:
        # get current glicko for players
        g1 = repo.get_player_glicko(conn, p1)
        g2 = repo.get_player_glicko(conn, p2)
        if g1 is None:
            r1, rd1, vol1 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
        else:
            r1, rd1, vol1 = g1
        if g2 is None:
            r2, rd2, vol2 = config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL
        else:
            r2, rd2, vol2 = g2

        new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2, vol2, result)
        new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1, vol1, 1 - result)

        repo.update_player_glicko(conn, p1, new_r1, new_rd1, new_vol1)
        repo.update_player_glicko(conn, p2, new_r2, new_rd2, new_vol2)

        # backfill per-match glicko columns if available
        try:
            repo.update_match_glicko(conn, match_id, r1, new_r1, r2, new_r2)
        except Exception:
            pass

        games_played[p1] = games_played.get(p1, 0) + 1
        games_played[p2] = games_played.get(p2, 0) + 1

    conn.commit()
    print("✅ Glicko-2 ratings successfully recomputed from all matches.")


def recompute(conn):
    if config.RATING_SYSTEM == 'glicko2':
        recompute_glicko(conn)
    else:
        recompute_elos(conn)
