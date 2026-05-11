export type HttpError = Error & { statusCode?: number };

/**
 * Converts an unknown error to an HttpError
 */
export function asHttpError(error: unknown): HttpError {
  return error instanceof Error ? error : new Error("Unknown server error");
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(error: unknown) {
  const httpError = asHttpError(error);
  const statusCode = httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500;
  
  return {
    statusCode,
    body: {
      error: statusCode === 500 ? "Internal Server Error" : httpError.name,
      message: statusCode === 500 ? "Unexpected server error." : httpError.message
    }
  };
}

/**
 * Creates a not found error
 */
export function createNotFoundError(message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = 404;
  error.name = "NotFound";
  return error;
}

/**
 * Creates a validation error
 */
export function createValidationError(message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = 400;
  error.name = "ValidationError";
  return error;
}
