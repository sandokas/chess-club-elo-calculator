export function getCurrentDateTime(): string {
  return new Date().toISOString().slice(0, 16);
}
