// Build an RFC 5545 .ics calendar feed from plan_meetings rows.
function pad(n: number) { return n.toString().padStart(2, '0'); }
function toIcsDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
}
function esc(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function buildIcs(meetings: any[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vanto CRM//PLAN//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const m of meetings) {
    const start = toIcsDate(m.start_time);
    const end = toIcsDate(m.end_time || new Date(new Date(m.start_time).getTime() + 30 * 60 * 1000).toISOString());
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}@vanto-crm`,
      `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${esc(m.title || 'Meeting')}`,
    );
    if (m.location) lines.push(`LOCATION:${esc(m.location)}`);
    if (m.description) lines.push(`DESCRIPTION:${esc(m.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcs(meetings: any[], filename = 'vanto-meetings.ics') {
  const blob = new Blob([buildIcs(meetings)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
