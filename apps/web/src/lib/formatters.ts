export function formatRating(value: number): string {
  return value.toFixed(1);
}

export function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return "N/A";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatResult(result: number, isWhite: boolean): string {
  if (result === 1) return "Win";
  if (result === 0) return "Loss";
  if (result === 0.5) return "Draw";
  return "N/A";
}

export function formatCompactResult(result: number | null): string {
  if (result === null) return "—";
  if (result === 1) return "1–0";
  if (result === 0) return "0–1";
  if (result === 0.5) return "½–½";
  return "—";
}
