import { z } from "zod";

export const playerEditSchema = z.object({
  displayName: z.string().min(1, "Display name is required").optional(),
  active: z.boolean().optional(),
});

export type PlayerEditInput = z.infer<typeof playerEditSchema>;

export const tournamentEditSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  startsOn: z.string().optional(),
  status: z.enum(["draft", "active", "completed"]).optional(),
  pairingMethod: z.enum(["seeded_by_rating", "random"]).optional(),
  totalRounds: z.number().min(1).max(50).optional(),
});

export type TournamentEditInput = z.infer<typeof tournamentEditSchema>;

export const tournamentCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  format: z.enum(["manual", "swiss"]).default("swiss"),
  startsOn: z.string().optional(),
  totalRounds: z.number().min(1).max(50).optional(),
  pairingMethod: z.enum(["seeded_by_rating", "random"]).default("seeded_by_rating"),
});

export type TournamentCreateInput = z.infer<typeof tournamentCreateSchema>;
