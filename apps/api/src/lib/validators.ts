/**
 * Validates and parses pagination parameters
 */
export function parsePaginationParams(query: {
  page?: string;
  limit?: string;
}): { page: number; limit: number } {
  const page = Math.max(1, parseInt(query.page || "1", 10));
  const limit = [10, 20, 50].includes(parseInt(query.limit || "20", 10))
    ? parseInt(query.limit || "20", 10)
    : 20;
  return { page, limit };
}

/**
 * Validates and parses sorting parameters
 */
export function parseSortParams(
  query: { sortBy?: string; sortOrder?: string },
  allowedColumns: string[]
): { sortBy: string; sortOrder: "asc" | "desc" } {
  if (allowedColumns.length === 0) {
    throw new Error("allowedColumns must not be empty");
  }
  const sortBy = (query.sortBy && allowedColumns.includes(query.sortBy))
    ? query.sortBy
    : allowedColumns[0]!;
  const sortOrder =
    query.sortOrder === "asc" || query.sortOrder === "desc"
      ? query.sortOrder
      : "desc";
  return { sortBy, sortOrder };
}

/**
 * Validates a string filter parameter
 */
export function parseStringFilter(value: string | undefined): string {
  return value || "";
}

/**
 * Validates a boolean filter parameter
 */
export function parseBooleanFilter(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Validates a number range filter parameter
 */
export function parseNumberFilter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Validates a date filter parameter
 */
export function parseDateFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (isNaN(Date.parse(value))) return undefined;
  return value;
}

/**
 * Validates tournament status
 */
export function validateTournamentStatus(status: string | undefined): string | undefined {
  const validStatuses = ["draft", "active", "completed"];
  if (!status) return undefined;
  return validStatuses.includes(status) ? status : undefined;
}
