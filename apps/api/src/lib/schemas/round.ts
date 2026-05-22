import { z } from "zod";

export const createRoundSchema = z.object({
  startsOn: z.string().optional()
});

export const updateRoundStartSchema = z.object({
  startsOn: z.string()
});

export type CreateRoundInput = z.infer<typeof createRoundSchema>;
export type UpdateRoundStartInput = z.infer<typeof updateRoundStartSchema>;
