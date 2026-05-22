import { z } from "zod";
import { createValidationError } from "./errors.js";

export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw createValidationError(message);
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodSchema<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    const message = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw createValidationError(message);
  }
  return result.data;
}
