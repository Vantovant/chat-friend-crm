/** Strip all non-digits */
export function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Normalize to SA E.164-ish digits:
 * - Leading 0 + 9 more digits (10 total)  → replace 0 with 27
 * - Leading 0 + 10 more digits (11 total) → replace 0 with 27
 * - Already starts with 27 and is 11-12 digits → keep
 * - Otherwise: keep digits as-is
 */
export function normalizePhone(raw: string): string {
  const d = digitsOnly(raw);
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) {
    return '27' + d.slice(1);
  }
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) {
    return d;
  }
  return d;
}
