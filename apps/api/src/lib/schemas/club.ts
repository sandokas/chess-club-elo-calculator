import { z } from "zod";

export const createClubSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  description: z.string().max(2000).optional(),
  city: z.string().max(255).optional(),
  country: z.string().max(255).optional()
});

export const updateClubSchema = z.object({
  name: z.string().min(1, "name cannot be empty").max(255).optional(),
  description: z.string().max(2000).optional(),
  city: z.string().max(255).optional(),
  country: z.string().max(255).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: "No fields to update"
});

export type CreateClubInput = z.infer<typeof createClubSchema>;
export type UpdateClubInput = z.infer<typeof updateClubSchema>;
