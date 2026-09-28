// AI Trainer rule replies for whatsapp-auto-reply (2026-09-25, owner-approved).
// Twilio/Messenger first touch uses the approved "FB AD" rules; bare 1/2/3 answers to
// the greeting menu get the approved menu follow-up; answers to the menu in words are
// classified the same way (2026-09-26).
// 2026-09-28: condition-specific health replies (sugar, blood pressure, stroke, joints)
// and clear intents (buy, price, join, membership benefits) now use the trained rule on
// ANY message, not only the first one — the legacy knowledge path was pasting raw
// document text. A rule is never sent twice in a row. Returns null to fall back.

const TRAINER_RULE_IDS: Record<string, string> = {
  greeting: "61bf03b5-9fba-4126-9604-63a07c7c3cb1",
  price: "74ab857f-7c27-4178-bb37-a76071a372bb",
  join: "025e8b22-1f00-41f3-b11e-682cf21ce67c",
  order: "b29ecb9d-2b63-4a94-8a58-d80969946b15",
  saw_ad: "7dd81416-8902-4f02-9131-164ae97c7eb7",
  menu1_health: "acd6f1d3-c525-478f-a51a-64cc3618a00d",
  menu2_prices: "a6575ae3-e040-4f78-b037-ef8e09f2f818",
  menu3_join: "b0d2e95d-1f1f-42cc-9ce6-ef2fe56cb07d",
  health_sugar: "c6641f9b-980e-433d-88ab-56ce4ec8eb7e",
  health_bp: "a815cb98-cd50-4e5e-a715-d0f3744358d4",
  health_stroke: "25c5a4eb-b094-47f9-a4ba-1185f7e97404",
  health_joints: "a3dd9b61-c0e5-441b-88bf-785aa9a58994",
};
// Rules looked up by title prefix (created later, id not fixed here).
const TRAINER_RULE_TITLES: Record<string, string> = {
  membership: "MEMBERSHIP — R375 benefits",
};

const PRODUCT_CODES = ["ice","nrm","rlx","pwr","grw","sld","dox","gts","brn","chm","stp","hpr","mnd","skn","pft","lft","alt","mls","hrt","air","hpy","bty"];

function healthKey(blob: string): string | null {
  if (/\b(stroke|paraly[sz]ed)\b/i.test(blob)) return "health_stroke";
  if (/\b(diabet\w*|sugar|glucose)\b/i.test(blob)) return "health_sugar";
  if (/\b(blood pressure|high blood|bp|hypertension|cholesterol)\b/i.test(blob)) return "health_bp";
  if (/\b(joints?|arthritis|knee|knees|back pain|stiff\w*)\b/i.test(blob)) return "health_joints";
  if (/\b(pregnan\w*|cancer|hiv|kidney|heart|asthma|ulcer|infection|sick|illness|disease|medication|medicine|pain)\b/i.test(blob)) return "menu1_health";
  return null;
}

function intentKey(blob: string): string | null {
  const h = healthKey(blob);
  if (h) return h;
  if (/\b(benefits?|advantages?)\b.*\b(membership|member|r ?375|register\w*)\b|\bwhat (is|are|does) (the )?r ?375\b|\br ?375 membership\b/i.test(blob)) return "membership";
  if (/\b(join|joining|become (a|an) (member|associate|distributor)|sign up|business opportunity|opportunity|earn|income|distributor)\b/i.test(blob)) return "join";
  if (/\b(buy|order|purchase|how (can|do) i get|where (can|do) i get|i want (it|the product|this|them)|i need (it|the product|this))\b/i.test(blob)) return "order";
  if (/\b(price|prices|pricing|cost|costs|how much)\b/i.test(blob)) return "price";
  return null;
}

async function loadRule(svc: any, key: string): Promise<string | null> {
  if (TRAINER_RULE_IDS[key]) {
    const { data } = await svc.from("ai_trainer_rules").select("correct_answer, enabled")
      .eq("id", TRAINER_RULE_IDS[key]).maybeSingle();
    return data && data.enabled && data.correct_answer ? String(data.correct_answer) : null;
  }
  if (TRAINER_RULE_TITLES[key]) {
    const { data } = await svc.from("ai_trainer_rules").select("correct_answer, enabled")
      .ilike("title", `${TRAINER_RULE_TITLES[key]}%`).eq("enabled", true).limit(1).maybeSingle();
    return data && data.correct_answer ? String(data.correct_answer) : null;
  }
  return null;
}

export async function buildTrainerReply(
  svc: any,
  ctx: { isFirstReply: boolean; lastIn: string; recentBlob: string; prevOutbound: string },
): Promise<{ text: string; rule: string } | null> {
  const msg = (ctx.lastIn || "").trim().toLowerCase();
  let key: string | null = null;

  if (!ctx.isFirstReply) {
    const wasMenu = /reply 1, 2 or 3/i.test(ctx.prevOutbound || "") || /just tell me which fits/i.test(ctx.prevOutbound || "");
    if (wasMenu && /^(1|1\uFE0F?\u20E3|one|option 1|number 1)[.!]?$/.test(msg)) key = "menu1_health";
    else if (wasMenu && /^(2|2\uFE0F?\u20E3|two|option 2|number 2)[.!]?$/.test(msg)) key = "menu2_prices";
    else if (wasMenu && /^(3|3\uFE0F?\u20E3|three|option 3|number 3)[.!]?$/.test(msg)) key = "menu3_join";
    else key = intentKey(msg); // any later message with a clear intent — classify the message itself
    if (!key) return null;
  } else {
    const blob = `${msg} ${ctx.recentBlob || ""}`;
    key = intentKey(blob);
    if (!key) {
      const isSawAd = /\b(saw (your|the|this) (ad|advert|post)|facebook (ad|post)|your (ad|advert|post))\b/i.test(blob);
      key = isSawAd ? "saw_ad" : "greeting";
    }
  }

  let text = await loadRule(svc, key);
  if (!text && key === "membership") return null;
  if (!text) return null;

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

  // Never send the same trained reply twice in a row.
  const head = text.slice(0, 60);
  if (!ctx.isFirstReply && ctx.prevOutbound && ctx.prevOutbound.includes(head)) return null;

  return { text, rule: key };
}
