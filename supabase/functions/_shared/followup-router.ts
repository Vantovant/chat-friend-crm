// Pipeline-stage + demographics aware follow-up router.
// Given a contact snapshot, returns the next best message body & CTA link.
// Callers: cadence-tick, phase3-tick, recovery-tick.
//
// Rules of the road:
//   - AT MOST one URL per outbound (caller must respect appendedLink slot).
//   - No prices. No FIRST-touch pushes (that's the trust protocol's job).
//   - Regional greeting when city + first_name known.
//   - Never re-ask fields already captured (contacts.email/city/province).

import { detectProduct, productBySlug, PRODUCTS, SHOP_BASE, ProductInfo } from "./product-catalogue.ts";

export interface RouterContact {
  first_name?: string | null;
  email?: string | null;
  city?: string | null;
  province?: string | null;
  pipeline_stage_name?: string | null;   // "Lead" | "Contacted" | "Proposal" | "Negotiation" | "Won" | "Lost"
  temperature?: string | null;
  last_inbound_text?: string | null;
  preferred_product_slug?: string | null;
}

export interface RouterOutput {
  templateKey: string;
  body: string;
  appendedLink: string | null;
  productSlug: string | null;
}

const GROUP_INVITE_FALLBACK = "https://chat.whatsapp.com/Efmbxxh5Wrz7ulfzRWVHPL";
const SPONSOR_URL           = "https://backoffice.aplgo.com/register/?sp=787262";
const LOCAL_NUMBER          = "+27 79 083 1530";

function greeting(c: RouterContact): string {
  const name = (c.first_name || "").trim().split(/\s+/)[0];
  const city = (c.city || "").trim();
  if (name && city) return `Hi ${name} in ${city}`;
  if (name) return `Hi ${name}`;
  return `Hi there`;
}

function needsDemographics(c: RouterContact): string[] {
  const missing: string[] = [];
  if (!c.email) missing.push("email");
  if (!c.city) missing.push("city");
  if (!c.province) missing.push("province");
  return missing;
}

function stage(c: RouterContact): string {
  const s = (c.pipeline_stage_name || "Lead").toLowerCase();
  if (s.startsWith("contact")) return "contacted";
  if (s.startsWith("propos"))  return "proposal";
  if (s.startsWith("negot"))   return "negotiation";
  if (s.startsWith("won"))     return "won";
  if (s.startsWith("lost"))    return "lost";
  return "lead";
}

function pickProduct(c: RouterContact): ProductInfo | null {
  if (c.preferred_product_slug) {
    const p = productBySlug(c.preferred_product_slug);
    if (p) return p;
  }
  return detectProduct(c.last_inbound_text || "");
}

export function routeFollowup(c: RouterContact): RouterOutput {
  const g = greeting(c);
  const st = stage(c);
  const missing = needsDemographics(c);
  const product = pickProduct(c);
  const footer = `\n\n— Vanto from GetWellAfrica\nSupport: ${LOCAL_NUMBER}`;

  // Lost — cool down, no CTA.
  if (st === "lost") {
    return {
      templateKey: "router_lost_valuecheck",
      body: `${g}, just checking in — no pressure. If wellness ever becomes a priority again I'm one message away.${footer}`,
      appendedLink: null,
      productSlug: null,
    };
  }

  // Won — onboarding & referral, no shop link.
  if (st === "won") {
    return {
      templateKey: "router_won_referral",
      body: `${g} 🎉 Thanks again for choosing APLGO. If someone close to you could benefit from what you're using, would you feel comfortable introducing us?${footer}`,
      appendedLink: null,
      productSlug: null,
    };
  }

  // Negotiation — send sponsor CTA once.
  if (st === "negotiation") {
    return {
      templateKey: "router_negotiation_close",
      body: `${g}, ready when you are. When you sign up as an APLGO member you get ~25% off every product — permanently. Registration takes 2 minutes:`,
      appendedLink: SPONSOR_URL,
      productSlug: null,
    };
  }

  // Proposal — product-fit pitch (no price) with SKU link if we know their intent.
  if (st === "proposal") {
    if (product) {
      return {
        templateKey: `router_proposal_${product.slug}`,
        body: `${g}, based on what you shared, *${product.code}* fits best:\n${product.tagline}\n\nTake a look — happy to answer anything before you decide.`,
        appendedLink: product.url,
        productSlug: product.slug,
      };
    }
    return {
      templateKey: "router_proposal_menu",
      body: `${g}, quick one — which of these fits you best today? sleep, energy, joints, sugar, stomach, immunity, or a business option. Tell me and I'll send the right product.${footer}`,
      appendedLink: null,
      productSlug: null,
    };
  }

  // Contacted — invite to WhatsApp group + ask focus area if demographics complete.
  if (st === "contacted") {
    if (missing.length) {
      return {
        templateKey: "router_contacted_ask_demo",
        body: `${g}, to send you the most relevant tips, could you share your ${missing.join(", ")}? (Just reply e.g. "Email: you@x.com, City: Pretoria, Province: Gauteng")${footer}`,
        appendedLink: null,
        productSlug: null,
      };
    }
    return {
      templateKey: "router_contacted_group_invite",
      body: `${g}, we run a free wellness group where I share short daily tips and product Q&A. Want to join?`,
      appendedLink: GROUP_INVITE_FALLBACK,
      productSlug: null,
    };
  }

  // Lead — either warm intro-ask or a regional product-tease.
  if (missing.length) {
    return {
      templateKey: "router_lead_ask_demo",
      body: `${g}, so I can send you info that actually helps in your area — could you share your ${missing.join(", ")}? (Just reply e.g. "Email: you@x.com, City: Pretoria, Province: Gauteng")${footer}`,
      appendedLink: null,
      productSlug: null,
    };
  }
  if (product) {
    return {
      templateKey: `router_lead_product_${product.slug}`,
      body: `${g}, thanks for reaching out 🙏. From what you shared, *${product.code}* is the one most people in your situation start with:\n${product.tagline}`,
      appendedLink: product.url,
      productSlug: product.slug,
    };
  }
  return {
    templateKey: "router_lead_menu",
    body: `${g} 👋 quick one — what would you like support with most: sleep, energy, joints, sugar, stomach, immunity, or a business option? I'll point you to the right product.${footer}`,
    appendedLink: null,
    productSlug: null,
  };
}
