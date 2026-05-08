-- Backfill rounds for legacy tournaments
--
-- This script infers rounds for tournaments that have matches but no rounds.
-- It uses a greedy algorithm: matches are ordered by (played_on, legacy_id, created_at, id),
-- and each match is assigned to the lowest round number where neither player has already
-- played in that round.
--
-- To run: psql -f packages/db/scripts/backfill-rounds.sql
--
-- This script is idempotent and safe to re-run. It skips tournaments that already have rounds.

DO $$
DECLARE
    tournament_record RECORD;
    match_record RECORD;
    round_number INTEGER;
    round_id UUID;
    player_ids TEXT[];
BEGIN
    -- For each tournament that has matches but no rounds
    FOR tournament_record IN
        SELECT DISTINCT t.id, t.name
        FROM tournaments t
        INNER JOIN matches m ON m.tournament_id = t.id
        WHERE NOT EXISTS (
            SELECT 1 FROM rounds r WHERE r.tournament_id = t.id
        )
    LOOP
        RAISE NOTICE 'Processing tournament: % (%)', tournament_record.name, tournament_record.id;
        
        round_number := 0;
        
        -- Process matches in deterministic order
        FOR match_record IN
            SELECT 
                m.id AS match_id,
                m.white_player_id,
                m.black_player_id,
                m.played_on,
                m.legacy_id,
                m.created_at
            FROM matches m
            WHERE m.tournament_id = tournament_record.id
            ORDER BY 
                m.played_on ASC,
                m.legacy_id ASC NULLS LAST,
                m.created_at ASC,
                m.id ASC
        LOOP
            -- Find the lowest round number where neither player has played
            round_number := 1;
            LOOP
                -- Check if either player already has a match in this round
                SELECT 1 INTO round_id
                FROM matches m
                INNER JOIN rounds r ON r.id = m.round_id
                WHERE r.tournament_id = tournament_record.id
                  AND r.number = round_number
                  AND (m.white_player_id = match_record.white_player_id 
                       OR m.white_player_id = match_record.black_player_id
                       OR m.black_player_id = match_record.white_player_id 
                       OR m.black_player_id = match_record.black_player_id)
                LIMIT 1;
                
                EXIT WHEN round_id IS NULL; -- Found a round where neither player has played
                
                round_number := round_number + 1;
            END LOOP;
            
            -- Check if this round already exists
            SELECT id INTO round_id
            FROM rounds
            WHERE tournament_id = tournament_record.id AND number = round_number;
            
            -- Create the round if it doesn't exist
            IF round_id IS NULL THEN
                INSERT INTO rounds (id, tournament_id, number, status, created_at, updated_at)
                VALUES (gen_random_uuid(), tournament_record.id, round_number, 'completed', NOW(), NOW())
                RETURNING id INTO round_id;
                
                RAISE NOTICE 'Created round % for tournament %', round_number, tournament_record.name;
            END IF;
            
            -- Update the match to reference the round
            UPDATE matches
            SET round_id = round_id, updated_at = NOW()
            WHERE id = match_record.match_id;
            
            RAISE NOTICE 'Assigned match % to round %', match_record.match_id, round_number;
        END LOOP;
        
        RAISE NOTICE 'Completed tournament: % (%)', tournament_record.name, tournament_record.id;
    END LOOP;
    
    RAISE NOTICE 'Backfill complete';
END $$;

-- OPTIONAL: Set tournament format to 'swiss' for legacy tournaments
-- Uncomment the following if you want to update the format field:
--
-- UPDATE tournaments
-- SET format = 'swiss', updated_at = NOW()
-- WHERE format = 'manual'
--   AND legacy_id IS NOT NULL
--   AND EXISTS (SELECT 1 FROM rounds r WHERE r.tournament_id = tournaments.id);
