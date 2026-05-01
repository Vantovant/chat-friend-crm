/**
 * Build a standards-compliant vCard 3.0 for a Vanto contact.
 * Designed so saving it on a phone makes WhatsApp display the proper name.
 */

export interface VCardContact {
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone: string;
  email?: string | null;
  source?: string | null;
  interest_topic?: string | null;
  temperature?: string | null;
  crm_contact_id?: string | null;
}

function escapeVCardValue(v: string): string {
  return (v || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildVCard(c: VCardContact): string {
  const fullName = c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.phone;
  const last = c.last_name?.trim() || (fullName.includes(' ') ? fullName.split(' ').slice(-1)[0] : '');
  const first = c.first_name?.trim() || (fullName.includes(' ') ? fullName.split(' ').slice(0, -1).join(' ') : fullName);

  const noteParts = [
    'Get Well Africa / APLGO lead',
    c.source ? `Source: ${c.source}` : null,
    c.interest_topic ? `Interest: ${c.interest_topic}` : null,
    c.temperature ? `Temperature: ${c.temperature}` : null,
    c.crm_contact_id ? `CRM ID: ${c.crm_contact_id}` : null,
  ].filter(Boolean).join(' | ');

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCardValue(last)};${escapeVCardValue(first)};;;`,
    `FN:${escapeVCardValue(fullName)}`,
    `ORG:${escapeVCardValue('Get Well Africa (APLGO)')}`,
    `TEL;TYPE=CELL,VOICE:${c.phone}`,
  ];
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(c.email)}`);
  if (noteParts) lines.push(`NOTE:${escapeVCardValue(noteParts)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function downloadVCard(c: VCardContact): void {
  const vcard = buildVCard(c);
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (c.name || c.phone).replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  a.download = `${safeName || 'contact'}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyContactCard(c: VCardContact): string {
  const fullName = c.name || [c.first_name, c.last_name].filter(Boolean).join(' ');
  return [
    `Name: ${fullName}`,
    `Phone: ${c.phone}`,
    c.email ? `Email: ${c.email}` : null,
    c.source ? `Source: ${c.source}` : null,
    c.interest_topic ? `Interest: ${c.interest_topic}` : null,
    'Org: Get Well Africa (APLGO)',
  ].filter(Boolean).join('\n');
}
