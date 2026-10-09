/**
 * Quote one CSV cell. Values starting with = + - @ (or tab/CR) get a leading
 * apostrophe so spreadsheet apps don't evaluate them as formulas (CSV injection).
 */
export function csvCell(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
