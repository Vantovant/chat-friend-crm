// Shared Call Sheet rules. Pure TypeScript with no app imports so the browser
// page and the MCP connector tools (bundled into an edge function) use one copy.

export const CALL_OUTCOMES = [
  'Answered - interested',
  'Answered - not now',
  'Booked call/presentation',
  'Registered',
  'Call back',
  'No answer',
  'Wrong number',
  'Not interested',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_CHANNELS = ['phone', 'whatsapp_call', 'whatsapp_voice_note', 'whatsapp_text', 'zoom'] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];

export const CHANNEL_LABELS: Record<CallChannel, string> = {
  phone: 'Phone',
  whatsapp_call: 'WhatsApp call',
  whatsapp_voice_note: 'WhatsApp voice note',
  whatsapp_text: 'WhatsApp text',
  zoom: 'Zoom',
};

export const TIERS = ['hot', 'lukewarm', 'cold'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, { label: string; letter: string }> = {
  hot: { label: 'Hot', letter: 'A' },
  lukewarm: { label: 'Lukewarm', letter: 'B' },
  cold: { label: 'Cold', letter: 'C' },
};
/** Tier → contacts.temperature mapping for "Apply tier to contact temperature". */
export const TIER_TO_TEMPERATURE: Record<Tier, 'hot' | 'warm' | 'cold'> = { hot: 'hot', lukewarm: 'warm', cold: 'cold' };

export const TZ = 'Africa/Johannesburg';

export type CampaignBlock = { date: string; start: string; end?: string; label: string; tier?: Tier };

/** Johannesburg is UTC+2 all year (no DST). */
function blockTime(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm}:00+02:00`).getTime();
}

export function currentBlocks(blocks: CampaignBlock[], now = Date.now()): { current: CampaignBlock | null; next: CampaignBlock | null } {
  const sorted = [...(blocks || [])].sort((a, b) => blockTime(a.date, a.start) - blockTime(b.date, b.start));
  let current: CampaignBlock | null = null;
  let next: CampaignBlock | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const s = blockTime(b.date, b.start);
    const e = b.end ? blockTime(b.date, b.end) : sorted[i + 1] ? blockTime(sorted[i + 1].date, sorted[i + 1].start) : s + 3600_000;
    if (now >= s && now < e) current = b;
    if (s > now && !next) next = b;
  }
  return { current, next };
}

export function describeBlock(b: CampaignBlock | null): string {
  if (!b) return '';
  return `${b.label}, ${b.start}${b.end ? `-${b.end}` : ''}`;
}

export type Scorecard = {
  campaign: null | {
    key: string; name: string; starts_at: string; ends_at: string; cutoff_at: string | null; timezone: string; blocks: CampaignBlock[];
  };
  targets?: { conversations: number; agreed: number; registrations: number };
  actuals?: { conversations: number; agreed: number; registrations: number; confirmed_under_vanto: number };
  elapsed_share?: number;
  uncalled_by_tier?: Partial<Record<Tier, number>>;
  now?: string;
};

export function paceLine(sc: Scorecard, now = Date.now()): { onPace: boolean; text: string; advice: string | null } {
  if (!sc.campaign || !sc.targets || !sc.actuals) return { onPace: true, text: '', advice: null };
  const share = sc.elapsed_share ?? 0;
  const expected = Math.ceil(sc.targets.conversations * share);
  const onPace = sc.actuals.conversations >= expected && sc.actuals.registrations >= Math.floor(sc.targets.registrations * share);
  const text = share <= 0
    ? 'Campaign has not started yet.'
    : onPace
      ? `On pace: ${sc.actuals.conversations} conversations vs ${expected} expected by now.`
      : `Behind pace: ${sc.actuals.conversations} conversations vs ${expected} expected by now.`;
  // Friday evening (SAST) + behind → Saturday advice.
  const sast = new Date(now + 2 * 3600_000);
  const isFriEvening = sast.getUTCDay() === 5 && sast.getUTCHours() >= 17;
  return { onPace, text, advice: !onPace && isFriEvening ? 'Double the 1-on-1 calling on Saturday morning.' : null };
}

export function waLink(phone: string | null | undefined): string | null {
  const d = (phone || '').replace(/\D/g, '');
  return d.length >= 9 ? `https://wa.me/${d}` : null;
}
