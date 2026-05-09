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
});

export type TournamentEditInput = z.infer<typeof tournamentEditSchema>;
