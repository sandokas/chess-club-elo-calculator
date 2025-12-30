import chess_club.repo as repo
import chess_club.elo as elo
import chess_club.config as config
import chess_club.glicko2 as glicko2
import chess_club.ratings as ratings
import chess_club.service as service
import math


def show_leaderboard(conn, show_provisional: bool = True):
    print("\n🏆 Global Leaderboard:")
    players = repo.list_players(conn)

    official = []
    provisional = []

    for pid, name, elo_rating, g2_rating, g2_rd, g2_vol in players:
        # Determine display based on configured rating system
        if config.RATING_SYSTEM == 'glicko2':
            # Do not fall back to Elo when G2 is missing — show explicit placeholder.
            display_str = f"G2: {g2_rating:6.1f}" if g2_rating is not None else "G2:(none)"
        elif config.RATING_SYSTEM == 'both':
            # Show both values; use explicit placeholders when missing.
            elo_part = f'Elo:{elo_rating:6.1f}' if elo_rating is not None else 'Elo:(none)'
            g2_part = f'G2:{g2_rating:6.1f}' if g2_rating is not None else 'G2:(none)'

            display_str = f"{elo_part} / {g2_part}"
        else:
            display_str = f'Elo: {elo_rating:6.1f}' if elo_rating is not None else 'Elo:(none)'

        games_played, wins, draws, losses, last_game = repo.get_player_summary(conn, pid)
        last_game_str = last_game if last_game else "No games"
        player_row = (name, display_str, games_played, wins, draws, losses, last_game_str)
        if games_played >= config.MIN_GAMES_FOR_OFFICIAL:
            official.append(player_row)
        else:
            provisional.append(player_row)

    heading = f"\n📊 Official Leaderboard (≥ {config.MIN_GAMES_FOR_OFFICIAL} games):"
    print(heading)
    if not official:
        print("  (No players with enough games yet.)")
    else:
        for name, display_str, games_played, wins, draws, losses, last_game_str in official:
            print(f"{name:15} {display_str} | Games: {games_played:3d} "
                  f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str}")

    if show_provisional:
        print(f"\n🧪 Provisional Players (< {config.MIN_GAMES_FOR_OFFICIAL} games):")
        if not provisional:
            print("  (No provisional players.)")
        else:
            for name, display_str, games_played, wins, draws, losses, last_game_str in provisional:
                print(f"{name:15} {display_str} | Games: {games_played:3d} "
                      f"| W/D/L: {wins}/{draws}/{losses} | Last game: {last_game_str} (P)")
    else:
        if provisional:
            print(f"\n(ℹ️ {len(provisional)} provisional players hidden. Toggle them ON in the main menu to see them.)")


def recompute(conn):
    """Recompute both Elo and Glicko-2 by replaying matches using
    the canonical `ratings.compute_match` helper to avoid duplicate logic.

    This resets player state to defaults and replays matches in date,id order,
    persisting per-player profile changes and per-match audit columns.
    """
    cur = conn.cursor()
    # reset Elo to default
    cur.execute("UPDATE Players SET elo = ?", (config.DEFAULT_ELO,))
    # reset Glicko columns to defaults
    cur.execute("SELECT id FROM Players")
    pids = [pid for (pid,) in cur.fetchall()]
    for pid in pids:
        cur.execute("UPDATE Players SET g2_rating = ?, g2_rd = ?, g2_vol = ?, last_game_date = NULL, last_game_match_id = NULL WHERE id = ?",
                    (config.G2_DEFAULT_RATING, config.G2_DEFAULT_RD, config.G2_DEFAULT_VOL, pid))
    conn.commit()

    # in-memory counters used for variable-K Elo and last-played dates
    games_played = {pid: 0 for pid in pids}
    last_played = {pid: None for pid in pids}

    matches = repo.get_all_matches_ordered(conn)
    for match_id, p1, p2, result, date_str in matches:
        # compute using overrides so compute_match doesn't run aggregates
        out = ratings.compute_match(conn, p1, p2, result, date_str,
                                    games_played_override_p1=games_played.get(p1, 0),
                                    games_played_override_p2=games_played.get(p2, 0),
                                    last_played_override_p1=last_played.get(p1),
                                    last_played_override_p2=last_played.get(p2))

        # persist via service layer
        service.record_match_result(conn, match_id, p1, p2, out, date_str)

        # advance counters
        games_played[p1] = games_played.get(p1, 0) + 1
        games_played[p2] = games_played.get(p2, 0) + 1
        last_played[p1] = date_str
        last_played[p2] = date_str

    conn.commit()
    print("✅ Ratings successfully recomputed from all matches using compute_match.")



def recompute_from_match(conn, match_id: int):
    """Recompute ratings starting from a given match id.

    This function seeds player ratings and games-played counts using any
    available per-match audit columns (elo_after / g2_after) for matches
    that occurred before the provided match. If audit data is missing it
    falls back to defaults and will still compute correctly by replaying
    forward from the beginning where necessary.
    """
    cur = conn.cursor()

    # Fetch matches with audit columns in a known order
    cur.execute(
        """
        SELECT id, player1_id, player2_id, result, date,
               player1_elo_before, player1_elo_after, player2_elo_before, player2_elo_after,
               player1_g2_rating_before, player1_g2_rating_after,
               player1_g2_rd_before, player1_g2_rd_after,
               player1_g2_vol_before, player1_g2_vol_after,
               player2_g2_rating_before, player2_g2_rating_after,
               player2_g2_rd_before, player2_g2_rd_after,
               player2_g2_vol_before, player2_g2_vol_after
             , player1_last_played_before, player2_last_played_before
        FROM Matches
        ORDER BY date, id
        """
    )
    rows = cur.fetchall()
    if not rows:
        return

    matches = list(rows)
    start_idx = None
    for idx, r in enumerate(matches):
        if r[0] == match_id:
            start_idx = idx
            break

    if start_idx is None:
        raise ValueError("Match not found")

    # Compute games_played counts before the changed match
    games_played = {}
    # Track last played date per player before the changed match
    last_played = {}
    for r in matches[:start_idx]:
        _, p1, p2 = r[0], r[1], r[2]
        games_played[p1] = games_played.get(p1, 0) + 1
        games_played[p2] = games_played.get(p2, 0) + 1
        # record last played date
        try:
            d = r[4]
            last_played[p1] = d
            last_played[p2] = d
        except Exception:
            pass

    # Temporary in-memory current ratings; prefer recalculated values if present
    current_elo = {}
    current_g2 = {}
    # Temporary in-memory last played dates as we replay matches
    current_last_played = {}

    # Process matches from the changed one forward, using per-match before values
    for r in matches[start_idx:]:
        mid = r[0]
        p1 = r[1]
        p2 = r[2]
        result = r[3]

        p1_elo_before = r[5]
        p1_elo_after = r[6]
        p2_elo_before = r[7]
        p2_elo_after = r[8]

        p1_g_before = r[9]
        p1_g_after = r[10]
        p1_g_rd_before = r[11]
        p1_g_rd_after = r[12]
        p1_g_vol_before = r[13]
        p1_g_vol_after = r[14]

        p2_g_before = r[15]
        p2_g_after = r[16]
        p2_g_rd_before = r[17]
        p2_g_rd_after = r[18]
        p2_g_vol_before = r[19]
        p2_g_vol_after = r[20]
        # per-match last-played-before fields (optional)
        try:
            p1_last_played_before = r[21]
        except Exception:
            p1_last_played_before = None
        try:
            p2_last_played_before = r[22]
        except Exception:
            p2_last_played_before = None

        # Determine current elo for each player: prefer temp value, otherwise use per-match before if available, else DB
        if p1 in current_elo:
            elo1 = current_elo[p1]
        elif p1_elo_before is not None:
            elo1 = p1_elo_before
        else:
            raise ValueError(f"Missing per-match before Elo for player {p1}; full recompute required")

        if p2 in current_elo:
            elo2 = current_elo[p2]
        elif p2_elo_before is not None:
            elo2 = p2_elo_before
        else:
            raise ValueError(f"Missing per-match before Elo for player {p2}; full recompute required")

        g1 = games_played.get(p1, 0)
        g2 = games_played.get(p2, 0)

        k1 = elo.k_factor(g1)
        k2 = elo.k_factor(g2)

        new_elo1, new_elo2 = ratings.compute_elo_change(elo1, elo2, g1, g2, result)

        # persist and update temp map (single update per player)
        repo.update_player_profile(conn, p1, elo=new_elo1)
        repo.update_player_profile(conn, p2, elo=new_elo2)
        current_elo[p1] = new_elo1
        current_elo[p2] = new_elo2

        try:
            repo.update_match_elos(conn, mid, elo1, new_elo1, elo2, new_elo2)
        except Exception:
            pass

        # Glicko: require full per-match before-values (rating, rd, vol)
        if p1 in current_g2:
            r1, rd1, vol1 = current_g2[p1]
        elif (p1_g_before is not None) and (p1_g_rd_before is not None) and (p1_g_vol_before is not None):
            r1 = p1_g_before
            rd1 = p1_g_rd_before
            vol1 = p1_g_vol_before
        else:
            raise ValueError(f"Missing per-match before G2 data for player {p1}; full recompute required")

        if p2 in current_g2:
            r2, rd2, vol2 = current_g2[p2]
        elif (p2_g_before is not None) and (p2_g_rd_before is not None) and (p2_g_vol_before is not None):
            r2 = p2_g_before
            rd2 = p2_g_rd_before
            vol2 = p2_g_vol_before
        else:
            raise ValueError(f"Missing per-match before G2 data for player {p2}; full recompute required")

        # compute days since last played for each player
        days1 = 0
        days2 = 0
        try:
            from datetime import date as _date
            md = _date.fromisoformat(r[4])
            # Determine last-played candidate for each player in order of preference:
            # 1) current_last_played (replayed matches in this session)
            # 2) per-match last_played_before (stored on audit)
            # 3) last_played map built from matches before start_idx
            last1 = None
            last2 = None
            if current_last_played.get(p1):
                last1 = current_last_played.get(p1)
            elif p1_last_played_before:
                last1 = p1_last_played_before
            else:
                last1 = last_played.get(p1)

            if current_last_played.get(p2):
                last2 = current_last_played.get(p2)
            elif p2_last_played_before:
                last2 = p2_last_played_before
            else:
                last2 = last_played.get(p2)

            if last1:
                days1 = (md - _date.fromisoformat(last1)).days
                if days1 < 0:
                    days1 = 0
            if last2:
                days2 = (md - _date.fromisoformat(last2)).days
                if days2 < 0:
                    days2 = 0
        except Exception:
            days1 = 0
            days2 = 0

        new_r1, new_rd1, new_vol1 = glicko2.glicko2_update(r1, rd1, vol1, r2, rd2, vol2, result, days=days1)
        new_r2, new_rd2, new_vol2 = glicko2.glicko2_update(r2, rd2, vol2, r1, rd1, vol1, 1 - result, days=days2)

        # persist Glicko + last-game together
        d = r[4]
        repo.update_player_profile(conn, p1,
                                   g2_rating=new_r1, g2_rd=new_rd1, g2_vol=new_vol1,
                                   last_game_date=d, last_game_match_id=mid)
        repo.update_player_profile(conn, p2,
                                   g2_rating=new_r2, g2_rd=new_rd2, g2_vol=new_vol2,
                                   last_game_date=d, last_game_match_id=mid)
        current_g2[p1] = (new_r1, new_rd1, new_vol1)
        current_g2[p2] = (new_r2, new_rd2, new_vol2)
        # update current_last_played for replayed matches
        try:
            d = r[4]
            current_last_played[p1] = d
            current_last_played[p2] = d
        except Exception:
            pass

        try:
            repo.update_match_glicko(conn, mid, r1, new_r1, p1_g_rd_before, new_rd1, p1_g_vol_before, new_vol1,
                                     r2, new_r2, p2_g_rd_before, new_rd2, p2_g_vol_before, new_vol2)
        except Exception:
            pass

        games_played[p1] = games_played.get(p1, 0) + 1
        games_played[p2] = games_played.get(p2, 0) + 1
        # update last_played
        try:
            d = r[4]
            last_played[p1] = d
            last_played[p2] = d
        except Exception:
            pass

    conn.commit()
    print(f"✅ Ratings recomputed from match {match_id} onwards.")
