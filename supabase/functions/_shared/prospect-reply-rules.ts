// Prospect reply rules (owner-approved 2026-10-30) — applied to every
// Twilio and Maytapi private auto-reply right before it is sent:
//  1. https://getwellafrica.com/get-advice is the very first line.
//  2. No heart emojis of any colour.
//  3. No supplement disclaimers in private replies.
export const ADVICE_URL = "https://getwellafrica.com/get-advice";

const HEARTS = /(?:❤️|❤|♥️|♥|💛|💚|💙|💜|🧡|🤍|🖤|🤎|🩷|🩵|🩶|💗|💖|💕|💞|💓|💘|💝|💟|❣️|❣|😍|🥰|😘|💌)\uFE0F?/gu;

const DISCLAIMER_LINE =
  /(not intended to (diagnose|treat|cure|prevent)|not (a )?(substitute|replacement) for (professional )?medical|this (is|does) not (constitute )?medical advice|consult (your|a) (doctor|healthcare|medical|physician)|these statements have not been evaluated|supplements? (are|is) not (a )?medicine|results may vary|disclaimer)/i;

export function applyProspectReplyRules(text: string): string {
  let out = String(text || "").replace(HEARTS, "");
  out = out
    .split("\n")
    .filter((line) => !DISCLAIMER_LINE.test(line))
    .join("\n");
  // Remove any existing occurrence of the advice link, then put it on top.
  const esc = ADVICE_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  out = out.replace(new RegExp(`${esc}[^\\s]*`, "g"), "");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return `${ADVICE_URL}\n\n${out}`.trim();
}
