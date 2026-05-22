import { z } from "zod";

const validFormats = ["manual", "swiss"] as const;
const validPairingMethods = ["seeded_by_rating", "random"] as const;
const validStatuses = ["draft", "active", "completed"] as const;

export const createTournamentSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  startsOn: z.string().optional(),
  format: z.enum(validFormats).optional(),
  totalRounds: z.number().int().positive().max(50, "totalRounds must be at most 50").optional(),
  pairingMethod: z.enum(validPairingMethods).optional()
});

export const updateTournamentSchema = z.object({
  name: z.string().min(1, "name cannot be empty").max(255).optional(),
  startsOn: z.string().optional(),
  status: z.enum(validStatuses).optional(),
  totalRounds: z.number().int().positive().nullable().optional(),
  pairingMethod: z.enum(validPairingMethods).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: "No fields to update"
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;
