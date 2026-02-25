/** Strip all non-digits */
export function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Strip whatsapp: prefix if present, keep + prefix
 */
export function stripWhatsAppPrefix(raw: string): string {
  return (raw || '').replace(/^whatsapp:/i, '').trim();
}

/**
 * Normalize to +E.164 format (single source of truth):
 * - Strips whatsapp: prefix
 * - Removes spaces, dashes, parentheses
 * - Leading 00 → +
 * - Leading 0 + 9 more digits (10 total) → +27...
 * - Leading 0 + 10 more digits (11 total) → +27...
 * - Already starts with 27 and is 11-12 digits → +27...
 * - Already starts with + → keep
 * - Validates length >= 11 for +27 numbers
 * - Otherwise: +{digits}
 */
export function normalizePhone(raw: string): string {
  let cleaned = stripWhatsAppPrefix(raw);
  // Remove formatting characters
  cleaned = cleaned.replace(/[\s\-()]/g, '');
  // 00 international prefix
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  
  const d = digitsOnly(cleaned);
  if (!d) return '';
  
  // SA normalization
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) {
    return '+27' + d.slice(1);
  }
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) {
    return '+' + d;
  }
  // Already international
  if (cleaned.startsWith('+')) return cleaned;
  return '+' + d;
}

/**
 * Ensure a phone number is in +E.164 format for Twilio.
 * Alias for normalizePhone.
 */
export function toE164(raw: string): string {
  return normalizePhone(raw);
}

/**
 * Format whatsapp: address from E.164 number.
 */
export function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${e164}`;
}

/**
 * Display-friendly phone: always show with + prefix.
 */
export function displayPhone(raw: string): string {
  const e164 = normalizePhone(raw);
  return e164 || raw || '';
}
