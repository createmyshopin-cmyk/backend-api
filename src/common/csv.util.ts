/** Sanitize a cell for CSV export — prevents formula injection in Excel/Sheets. */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(raw)) return `'${raw.replace(/"/g, '""')}'`;
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}
