// AI Trainer rule replies for whatsapp-auto-reply (2026-09-25, owner-approved).
// Twilio first touch uses the approved "FB AD" rules; bare 1/2/3 answers to the
// greeting menu get the approved menu follow-up. Answers to the greeting / saw-ad menu
// given in words ("I have blood pressure", "how much", "I want to join") are classified
// the same way (2026-09-26). Returns null to fall back to legacy.

const TRAINER_RULE_IDS: Record<string, string> = {
  greeting: "61bf03b5-9fba-4126-9604-63a07c7c3cb1",
  price: "74ab857f-7c27-4178-bb37-a76071a372bb",
  join: "025e8b22-1f00-41f3-b11e-682cf21ce67c",
  order: "b29ecb9d-2b63-4a94-8a58-d80969946b15",
  saw_ad: "7dd81416-8902-4f02-9131-164ae97c7eb7",
  menu1_health: "acd6f1d3-c525-478f-a51a-64cc3618a00d",
  menu2_prices: "a6575ae3-e040-4f78-b037-ef8e09f2f818",
  menu3_join: "b0d2e95d-1f1f-42cc-9ce6-ef2fe56cb07d",
};

const PRODUCT_CODES = ["ice","nrm","rlx","pwr","grw","sld","dox","gts","brn","chm","stp","hpr","mnd","skn","pft","lft","alt","mls","hrt","air","hpy","bty"];

export async function buildTrainerReply(
  svc: any,
  ctx: { isFirstReply: boolean; lastIn: string; recentBlob: string; prevOutbound: string },
): Promise<{ text: string; rule: string } | null> {
  const msg = (ctx.lastIn || "").trim().toLowerCase();
  let key: string | null = null;

  const classify = (blob: string): string | null => {
    const isHealth = /\b(diabet\w*|sugar diabetes|blood pressure|high blood|bp|cholesterol|arthritis|pregnan\w*|cancer|hiv|kidney|heart|asthma|stroke|ulcer|infection|sick|illness|disease|medication|medicine|doctor|clinic|pain)\b/i.test(blob);
    const isJoin = /\b(join|joining|register|registration|become (a|an) (member|associate|distributor)|sign up|business|opportunity|earn|income|distributor)\b/i.test(blob);
    const isBuy = /\b(buy|order|purchase|shop|how (can|do) i get|where (can|do) i get|i want (it|the product|this|them)|i need (it|the product|this))\b/i.test(blob);
    const isPrice = /\b(price|prices|pricing|cost|costs|how much|amount)\b/i.test(blob);
    if (isHealth) return "menu1_health";
    if (isJoin) return "join";
    if (isBuy) return "order";
    if (isPrice) return "price";
    return null;
  };

  if (!ctx.isFirstReply) {
    // Greeting / saw-ad menu follow-up: only when the previous outbound was that menu.
    const wasMenu = /reply 1, 2 or 3/i.test(ctx.prevOutbound || "") || /just tell me which fits/i.test(ctx.prevOutbound || "");
    if (!wasMenu) return null;
    if (/^(1|1\uFE0F?\u20E3|one|option 1|number 1)[.!]?$/.test(msg)) key = "menu1_health";
    else if (/^(2|2\uFE0F?\u20E3|two|option 2|number 2)[.!]?$/.test(msg)) key = "menu2_prices";
    else if (/^(3|3\uFE0F?\u20E3|three|option 3|number 3)[.!]?$/.test(msg)) key = "menu3_join";
    else key = classify(msg); // answered in words — classify only the reply itself
    if (!key) return null;
  } else {
    const blob = `${msg} ${ctx.recentBlob || ""}`;
    const isHealth = /\b(diabet\w*|sugar diabetes|blood pressure|high blood|bp|cholesterol|arthritis|pregnan\w*|cancer|hiv|kidney|heart|asthma|stroke|ulcer|infection|sick|illness|disease|medication|medicine|doctor|clinic|pain)\b/i.test(blob);
    const isJoin = /\b(join|joining|register|registration|become (a|an) (member|associate|distributor)|sign up|business|opportunity|earn|income|distributor)\b/i.test(blob);
    const isBuy = /\b(buy|order|purchase|shop|how (can|do) i get|where (can|do) i get|i want (it|the product|this|them)|i need (it|the product|this))\b/i.test(blob);
    const isPrice = /\b(price|prices|pricing|cost|costs|how much|amount)\b/i.test(blob);
    const isSawAd = /\b(saw (your|the|this) (ad|advert|post)|facebook (ad|post)|your (ad|advert|post))\b/i.test(blob);
    if (isHealth) key = "menu1_health";
    else if (isJoin) key = "join";
    else if (isBuy) key = "order";
    else if (isPrice) key = "price";
    else if (isSawAd) key = "saw_ad";
    else key = "greeting";
  }

  const { data: rule } = await svc
    .from("ai_trainer_rules")
    .select("id, correct_answer, enabled, channel")
    .eq("id", TRAINER_RULE_IDS[key])
    .maybeSingle();
  if (!rule || !rule.enabled || !rule.correct_answer) return null;

  let text = String(rule.correct_answer);
  if (key === "order") {
    const blob = `${msg} ${ctx.recentBlob || ""}`;
    const code = PRODUCT_CODES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(blob)) || null;
    if (code) {
      text = text.replace(/\*NRM\*/g, `*${code.toUpperCase()}*`).replace(/\/shop\/nrm\b/gi, `/shop/${code}`);
    } else {
      text = text
        .replace(/You can order \*NRM\* here: https:\/\/getwellafrica\.com\/shop\/nrm/i, "You can order here: https://getwellafrica.com/shop")
        .replace(/Anything else you'd like to add to your order\?/i, "Which product(s) did you have in mind?");
    }
  }
  return { text, rule: key };
}
