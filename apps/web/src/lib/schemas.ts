import { z } from "zod";

export const playerEditSchema = z.object({
  displayName: z.string().min(1, "Display name is required").optional(),
  active: z.boolean().optional(),
});

export type PlayerEditInput = z.infer<typeof playerEditSchema>;

/**
 * Single source of truth for the totalRounds field across all tournament forms.
 * `null` means "clear the value" (server will treat as auto-suggest).
 * `undefined` means "field not provided".
 * Bounds must match TOTAL_ROUNDS_MIN/MAX in apps/api/src/lib/validators.ts.
 */
const totalRoundsSchema = z.number().min(1).max(50).nullable().optional();

const pairingMethodSchema = z.enum(["seeded_by_rating", "random"]);

export const tournamentEditSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  startsOn: z.string().optional(),
  status: z.enum(["draft", "active", "completed"]).optional(),
  pairingMethod: pairingMethodSchema.optional(),
  totalRounds: totalRoundsSchema,
});

export type TournamentEditInput = z.infer<typeof tournamentEditSchema>;

export const tournamentCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  format: z.enum(["manual", "swiss"]).default("swiss"),
  startsOn: z.string().optional(),
  totalRounds: totalRoundsSchema,
  pairingMethod: pairingMethodSchema.default("seeded_by_rating"),
});

export type TournamentCreateInput = z.infer<typeof tournamentCreateSchema>;
