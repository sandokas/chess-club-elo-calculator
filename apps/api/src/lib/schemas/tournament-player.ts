import { z } from "zod";

export const addPlayerToTournamentSchema = z.object({
  playerId: z.string().uuid()
});

export const createPlayerInTournamentSchema = z.object({
  displayName: z.string().min(1, "displayName is required").max(255)
});

export const updateTournamentPlayerSchema = z.object({
  droppedOutRound: z.number().int().positive()
});

export type AddPlayerToTournamentInput = z.infer<typeof addPlayerToTournamentSchema>;
export type CreatePlayerInTournamentInput = z.infer<typeof createPlayerInTournamentSchema>;
export type UpdateTournamentPlayerInput = z.infer<typeof updateTournamentPlayerSchema>;
