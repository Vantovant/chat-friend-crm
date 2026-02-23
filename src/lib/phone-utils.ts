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
 * Normalize to +E.164 format:
 * - Strips whatsapp: prefix
 * - Leading 0 + 9 more digits (10 total) → +27...
 * - Leading 0 + 10 more digits (11 total) → +27...
 * - Already starts with 27 and is 11-12 digits → +27...
 * - Already starts with + → keep
 * - Otherwise: +{digits}
 */
export function normalizePhone(raw: string): string {
  const cleaned = stripWhatsAppPrefix(raw);
  // If already has +, strip and re-normalize
  const hasPlus = cleaned.startsWith('+');
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
  return '+' + d;
}

/**
 * Ensure a phone number is in +E.164 format for Twilio.
 * If stored as digits only (e.g. 27790831530), prepends +
 */
export function toE164(raw: string): string {
  if (!raw) return '';
  const cleaned = stripWhatsAppPrefix(raw);
  if (cleaned.startsWith('+')) return cleaned;
  const d = digitsOnly(cleaned);
  if (!d) return '';
  // SA fix
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) {
    return '+27' + d.slice(1);
  }
  return '+' + d;
}
