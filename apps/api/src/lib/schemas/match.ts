import { z } from "zod";

export const setMatchResultSchema = z.object({
  result: z.union([
    z.literal(1),
    z.literal(0.5),
    z.literal(0),
    z.null()
  ])
});

export type SetMatchResultInput = z.infer<typeof setMatchResultSchema>;
