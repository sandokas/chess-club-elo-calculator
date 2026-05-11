import { describe, expect, it } from "vitest";
import { matches, players } from "../src/schema.js";

describe("Drizzle schema", () => {
  it("defines white/black match columns and nullable user-linked players", () => {
    expect(matches.whitePlayerId.name).toBe("white_player_id");
    expect(matches.blackPlayerId.name).toBe("black_player_id");
    expect(players.linkedUserId.name).toBe("linked_user_id");
  });
});
