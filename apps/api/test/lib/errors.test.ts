import { describe, it, expect } from "vitest";
import { asHttpError, createErrorResponse, createNotFoundError, createValidationError } from "../../src/lib/errors.js";

describe("errors", () => {
  describe("asHttpError", () => {
    it("should return error if input is Error", () => {
      const error = new Error("Test error");
      const result = asHttpError(error);
      expect(result).toBe(error);
    });

    it("should create new error if input is not Error", () => {
      const result = asHttpError("string error");
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("Unknown server error");
    });

    it("should create new error if input is null", () => {
      const result = asHttpError(null);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("Unknown server error");
    });
  });

  describe("createErrorResponse", () => {
    it("should return 500 for unknown error", () => {
      const result = createErrorResponse("unknown");
      expect(result.statusCode).toBe(500);
      expect(result.body.error).toBe("Internal Server Error");
      expect(result.body.message).toBe("Unexpected server error.");
    });

    it("should return 400 for validation error", () => {
      const error = new Error("Invalid input") as any;
      error.statusCode = 400;
      error.name = "ValidationError";
      const result = createErrorResponse(error);
      expect(result.statusCode).toBe(400);
      expect(result.body.error).toBe("ValidationError");
      expect(result.body.message).toBe("Invalid input");
    });

    it("should return 404 for not found error", () => {
      const error = new Error("Not found") as any;
      error.statusCode = 404;
      error.name = "NotFound";
      const result = createErrorResponse(error);
      expect(result.statusCode).toBe(404);
      expect(result.body.error).toBe("NotFound");
      expect(result.body.message).toBe("Not found");
    });

    it("should return 500 for error with statusCode below 400", () => {
      const error = new Error("Bad error") as any;
      error.statusCode = 399;
      const result = createErrorResponse(error);
      expect(result.statusCode).toBe(500);
      expect(result.body.error).toBe("Internal Server Error");
    });
  });

  describe("createNotFoundError", () => {
    it("should create not found error", () => {
      const error = createNotFoundError("Resource not found");
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe("NotFound");
      expect(error.message).toBe("Resource not found");
    });
  });

  describe("createValidationError", () => {
    it("should create validation error", () => {
      const error = createValidationError("Invalid field");
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe("ValidationError");
      expect(error.message).toBe("Invalid field");
    });
  });
});
