/**
 * Stage 2 Recovery draft templates — copy-only.
 * NEVER queued for sending. NEVER inserted into ai_suggestions.
 * Vanto reviews and copies manually.
 */

const SHOP = 'https://onlinecourseformlm.com/shop';
const LOCAL_NUMBER = '+27 79 083 1530';

function safeName(name?: string | null) {
  const n = (name || '').trim();
  if (!n || /unknown|whatsapp user|^\d+$/i.test(n)) return null;
  return n.split(' ')[0]; // first name only
}

export type RecoveryAngle =
  | 'red_price_leak'
  | 'red_general'
  | 'orange_duplicate'
  | 'orange_weak_first_touch'
  | 'yellow_hot_weak_first_touch'
  | 'name_confirmation';

export interface RecoveryDraftInput {
  name?: string | null;
  damage_score: 'green' | 'yellow' | 'orange' | 'red';
  duplicate_messages?: boolean;
  price_leak_detected?: boolean;
  weak_first_touch?: boolean;
  temperature?: string | null;
  name_known?: boolean;
}

export interface RecoveryDraft {
  angle: RecoveryAngle;
  angle_label: string;
  text: string;
  needs_name_confirmation: boolean;
}

export function buildRecoveryDraft(input: RecoveryDraftInput): RecoveryDraft {
  const first = safeName(input.name);
  const greeting = first ? `Hi ${first}` : 'Hi there';
  const needsName = !input.name_known || !first;
  const nameLine = needsName
    ? '\n\nBefore I continue, may I confirm your name so I address you properly?'
    : '';
  const footer = `\n\n— Vanto\nLocal support: ${LOCAL_NUMBER}`;

  // Priority: price leak > duplicate > weak first-touch hot > weak first-touch > name only
  if (input.price_leak_detected || input.damage_score === 'red') {
    const angle: RecoveryAngle = input.price_leak_detected ? 'red_price_leak' : 'red_general';
    const text =
      `${greeting}, this is Vanto from Get Well Africa.\n\n` +
      `I want to correct something properly. You may have received a system-generated price earlier that was incorrect, and I don’t want to mislead you.\n\n` +
      `Please allow me to confirm the correct product and official price before you decide.\n\n` +
      `You can browse the official shop here:\n${SHOP}\n\n` +
      `What product were you asking about?` +
      nameLine +
      footer;
    return {
      angle,
      angle_label: input.price_leak_detected ? 'Price-leak correction' : 'General trust reset',
      text,
      needs_name_confirmation: needsName,
    };
  }

  if (input.duplicate_messages) {
    const text =
      `${greeting}, this is Vanto from Get Well Africa.\n\n` +
      `I noticed the system may have sent you the same message more than once. Sorry about that — I don’t want your first experience with us to feel cold or robotic.\n\n` +
      `Let me reset properly.\n\n` +
      `Here is the official shop:\n${SHOP}\n\n` +
      `What would you like support with most — sleep, energy, cravings, joints, stomach, hormones, immune support, or business information?` +
      nameLine +
      footer;
    return { angle: 'orange_duplicate', angle_label: 'Duplicate-message apology', text, needs_name_confirmation: needsName };
  }

  if (input.temperature === 'hot' && input.weak_first_touch) {
    const text =
      `${greeting}, this is Vanto from Get Well Africa.\n\n` +
      `Thank you for your interest 🙏. I want to make sure you get the right information from a real person, not just an automated reply.\n\n` +
      `Here is our official shop so you can see the products yourself:\n${SHOP}\n\n` +
      `What would you like support with most — sleep, energy, cravings, joints, stomach, hormones, immune support, or business information?` +
      nameLine +
      footer;
    return { angle: 'yellow_hot_weak_first_touch', angle_label: 'Hot lead trust-first', text, needs_name_confirmation: needsName };
  }

  if (input.weak_first_touch) {
    const text =
      `${greeting}, this is Vanto from Get Well Africa.\n\n` +
      `I want to introduce myself properly so you know who you’re speaking to.\n\n` +
      `Official shop: ${SHOP}\n\n` +
      `What would you like support with most — sleep, energy, cravings, joints, stomach, hormones, immune support, or business information?` +
      nameLine +
      footer;
    return { angle: 'orange_weak_first_touch', angle_label: 'Weak first-touch reset', text, needs_name_confirmation: needsName };
  }

  // Pure name-confirmation case
  const text =
    `Hi there 👋 this is Vanto from Get Well Africa.\n\n` +
    `Before I continue, may I confirm your name so I can address you properly?` +
    footer;
  return { angle: 'name_confirmation', angle_label: 'Name confirmation', text, needs_name_confirmation: true };
}
