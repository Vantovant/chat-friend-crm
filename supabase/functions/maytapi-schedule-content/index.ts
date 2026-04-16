import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Morning content: 30-day APLGO product rotation ──
const MORNING_MESSAGES = [
  "DAY 1 — CARRY 🌿✨ Your daily immune shield. Strengthen your defenses and protect your health from the inside out. Learn more: https://myaplworld.com/pages.cfm?p=F6D3084F",
  "DAY 2 — NRM ⚖️💚 Support your glucose balance and overall metabolic harmony. Your body deserves stability. Learn more: https://myaplworld.com/pages.cfm?p=E1733903",
  "DAY 3 — ALT 🌬️🍃 Breathe easier. Clear your airways and restore your respiratory flow. Learn more: https://myaplworld.com/pages.cfm?p=0BFBACCD",
  "DAY 4 — RLX 😌🧘 Calm your mind, release tension, and restore emotional balance. Learn more: https://myaplworld.com/pages.cfm?p=BB33A1D3",
  "DAY 5 — ICE ❄️💨 Natural cooling relief for headaches, pressure and discomfort. Learn more: https://myaplworld.com/pages.cfm?p=827C327F",
  "DAY 6 — GRW 🌱💪 Whole-body regeneration and vitality support. Learn more: https://myaplworld.com/pages.cfm?p=547E1A15",
  "DAY 7 — MLS 🍇🌈 Your complete multivitamin in a drop. Learn more: https://myaplworld.com/pages.cfm?p=A9CBB9D8",
  "DAY 8 — HPR 🧹💛 Detox your liver and support deep cleansing. Learn more: https://myaplworld.com/pages.cfm?p=1E5EF15A",
  "DAY 9 — ALT 🍃🌬️ Breathing support for allergies and sinus pressure. Learn more: https://myaplworld.com/pages.cfm?p=0BFBACCD",
  "DAY 10 — GTS ⚡🔥 Natural energy + mental focus booster. Learn more: https://myaplworld.com/pages.cfm?p=0F428FA6",
  "DAY 11 — SLD 🟤🌾 Gut movement + digestive relief. Learn more: https://myaplworld.com/pages.cfm?p=67CDB1C7",
  "DAY 12 — HRT ❤️🔄 Circulation + heart wellness support. Learn more: https://myaplworld.com/pages.cfm?p=E7A52E07",
  "DAY 13 — STP 🔥🩹 Natural pain + inflammation support. Learn more: https://myaplworld.com/pages.cfm?p=3EC1A5E0",
  "DAY 14 — BRN 🧠✨ Memory, clarity and focus booster. Learn more: https://myaplworld.com/pages.cfm?p=FC4860C4",
  "DAY 15 — MLS 🌈🍊 Daily nourishment + essential vitamins. Learn more: https://myaplworld.com/pages.cfm?p=A9CBB9D8",
  "DAY 16 — ICE ❄️😮‍💨 Soothing relief for headaches + sinus pressure. Learn more: https://myaplworld.com/pages.cfm?p=827C327F",
  "DAY 17 — RLX 🧘🕊️ Stress release + emotional grounding. Learn more: https://myaplworld.com/pages.cfm?p=BB33A1D3",
  "DAY 18 — CARRY 🌿🛡️ Immune strengthening + defense support. Learn more: https://myaplworld.com/pages.cfm?p=F6D3084F",
  "DAY 19 — GRW 🌱⚡ Regeneration + everyday vitality. Learn more: https://myaplworld.com/pages.cfm?p=547E1A15",
  "DAY 20 — NRM ⚖️🔥 Sugar balance + metabolic support. Learn more: https://myaplworld.com/pages.cfm?p=E1733903",
  "DAY 21 — HPR 💛🧹 Detox + liver cleansing. Learn more: https://myaplworld.com/pages.cfm?p=1E5EF15A",
  "DAY 22 — GTS ⚡🚀 Performance + energy boost. Learn more: https://myaplworld.com/pages.cfm?p=0F428FA6",
  "DAY 23 — SLD 🌾🟤 Gut reset + digestive flow. Learn more: https://myaplworld.com/pages.cfm?p=67CDB1C7",
  "DAY 24 — BRN 🧠💡 Brain clarity + memory enhancement. Learn more: https://myaplworld.com/pages.cfm?p=FC4860C4",
  "DAY 25 — HRT ❤️🌍 Circulation, balance and heart support. Learn more: https://myaplworld.com/pages.cfm?p=E7A52E07",
  "DAY 26 — STP 🔥🩹 Natural support for pain and inflammation. Learn more: https://myaplworld.com/pages.cfm?p=3EC1A5E0",
  "DAY 27 — ALT 🌬️🍃 Airway + sinus support. Learn more: https://myaplworld.com/pages.cfm?p=0BFBACCD",
  "DAY 28 — ICE ❄️💤 Natural soothing support for headaches. Learn more: https://myaplworld.com/pages.cfm?p=827C327F",
  "DAY 29 — MLS 🌈🍇 Full-spectrum nourishment. Learn more: https://myaplworld.com/pages.cfm?p=A9CBB9D8",
  "DAY 30 — GRW 🌱💚 Regeneration + wellness balance. Learn more: https://myaplworld.com/pages.cfm?p=547E1A15",
];

// ── Midday content: 30-day business opportunity rotation ──
const MIDDAY_MESSAGES = [
  "🚀 New to APLGO and not sure where to start?\nThis one link answers everything — how to order, costs with VAT, delivery & how to start your wellness biz.\nNo stress. Just start smart.\n🔗 https://myaplworld.com/pages.cfm?p=852EC678",
  "🔑 Your breakthrough starts at R375.\nThis isn't just \"joining\" — it's opening the door to health, purpose, and income.\nActivate your account today.\n🔗 https://myaplworld.com/pages.cfm?p=0D3A4986",
  "💼 Don't just buy one product. Buy your freedom.\nLearn why starting with a status package unlocks your commissions, ranks, and team power.\n🔗 https://myaplworld.com/pages.cfm?p=9866F3A4",
  "🧠 If you don't understand your BackOffice, you're leaving money on the table.\nLearn how to track your team, earnings, orders — and lead like a pro.\n🔗 https://myaplworld.com/pages.cfm?p=65D5A08D",
  "📈 Start at R1,500. End as a Managing Director.\nThis is your 90-day blueprint from first package to real leadership.\nYour move.\n🔗 https://myaplworld.com/pages.cfm?p=4DADD085",
  "💎 From R3,000 Associate to Diamond in 3 months?\nThis isn't just hype. It's a plan. And it works if you do.\n🔗 https://myaplworld.com/pages.cfm?p=120157AD",
  "🔥 Build a life-changing business in 90 days — even if you're starting from zero.\nIf you have R6,000 and a dream, this is your plan.\n🔗 https://myaplworld.com/pages.cfm?p=474A8D20",
  "💰 Why R45,000 is not expensive if it changes your life.\nThe Diamond Package isn't just big — it's smart. Here's why.\n🔗 https://myaplworld.com/pages.cfm?p=7E81F452",
  "🌳 Your APLGO team is your Family Tree.\nBuild it like a legacy. Water it with service. Harvest the rewards.\n🔗 https://myaplworld.com/pages.cfm?p=C626A294",
  "🌱 Gravitropic. Phototropic. What?!\nDiscover the hidden growth secrets inside APLGO — and inside YOU.\n🔗 https://myaplworld.com/pages.cfm?p=54254EAE",
  "🏆 Want to be a legend in network marketing?\nThese 10 habits separate the average from the iconic.\n🔗 https://myaplworld.com/pages.cfm?p=E79CE3F7",
  "📦 SSS = Supplement Support Scheme\nYou earn. Your customer heals. Everyone wins. This is legacy-level business.\n🔗 https://myaplworld.com/pages.cfm?p=2E6F9B0E",
  "👥 Network Marketing is not just business — it's a family empire builder.\nFind out why this is Africa's most powerful legacy tool.\n🔗 https://myaplworld.com/pages.cfm?p=4E65D906",
  "🎯 Prospecting is a skill — not a gamble.\nLearn how to attract the right people without begging, chasing or burning out.\n🔗 https://myaplworld.com/pages.cfm?p=EBCFA889",
  "🎓 Network marketing is officially outpacing traditional careers.\nHere's why professionals are resigning and going full-time networker.\n🔗 https://myaplworld.com/pages.cfm?p=A785E1A3",
  "⚫ Rest is also part of wealth-building.\nThe hustle must be holy. Learn why restoration creates expansion.\n🔗 https://myaplworld.com/pages.cfm?p=903713BF",
  "🏃 GTS is not just a product — it's performance fuel.\nLearn how this product supports your grind and your goals.\n🔗 https://myaplworld.com/pages.cfm?p=890308B4",
  "👑 Your network is your net worth — and your family's safety net.\nBuild wisely. Build now.\n🔗 https://myaplworld.com/pages.cfm?p=4E65D906",
  "🌊 Every wave has a leader. Will it be you?\nSee how Mr. Baloyi turned December struggles into January victories.\n🔗 https://myaplworld.com/pages.cfm?p=ABC27204",
  "🌍 Wellness + Wealth + Wisdom = Future.\nThis is why community-based marketing is Africa's new goldmine.\n🔗 https://myaplworld.com/pages.cfm?p=57748A5C",
  "💡 Network marketing is both heart & smart.\nLearn how to mix relationships and digital systems — like a pro.\n🔗 https://myaplworld.com/pages.cfm?p=14E2BBBF",
  "🏙️ Welcome to APLGO City.\nYour status is your address. Your rank is your work ethic.\n🔗 https://myaplworld.com/pages.cfm?p=A50EBA81",
  "🐘 Selling is natural. Like hunting. Like gathering.\nThis is how South Africa can lead the world in people-powered business.\n🔗 https://myaplworld.com/pages.cfm?p=3CA96ADB",
  "🏠 Home is not just shelter — it's your new palace of prosperity.\nLearn how the new economy begins where you are, not where you work.\n🔗 https://myaplworld.com/pages.cfm?p=40EF631F",
  "⏱️ Your breakthrough might be at the 88th minute.\nNetwork marketing is the come-back story of Africa's future champions.\n🔗 https://myaplworld.com/pages.cfm?p=FE9CE21C",
  "🏗️ Every empire has pillars. What about your health empire?\nDiscover the 6 building blocks of wellness success.\n🔗 https://myaplworld.com/pages.cfm?p=E97D075C",
  "📦 Ready to stop \"watching\" and start earning?\nGet activated. Place your order. Build your empire from home.\n🔗 https://myaplworld.com/pages.cfm?p=852EC678",
  "💼 Still doubting if network marketing is for you?\nLet the results speak louder than the doubts.\n🔗 https://myaplworld.com/pages.cfm?p=0D3A4986",
  "🏢 APLGO isn't just a business — it's your exit strategy.\nWalk out of burnout. Walk into belief.\n🔗 https://myaplworld.com/pages.cfm?p=9866F3A4",
  "🎯 Today's small step could be tomorrow's signature rank.\nWhether you're on R1,500 or R45,000 — just start.\n🔗 https://myaplworld.com/pages.cfm?p=4DADD085",
];

// ── Evening content: day-of-week Zoom invites (0=Sun, 1=Mon, ..., 6=Sat) ──
const EVENING_MESSAGES: Record<number, string> = {
  0: "🔥 SUNDAY — Business Overview\nEvery Sunday we reset the mind and refocus on the mission. Tonight we show the full APLGO picture — health, wealth, family and freedom.\n🕖 Time: 7PM SA / 7PM Botswana / 5PM Ghana\n🌐 Main Zoom: www.AplgoAfricaZoom.com\n🔄 Alternative: https://us06web.zoom.us/j/3013686869\nInvite your prospects. Bring your team. Sundays build momentum for the entire week ahead.",
  1: "🔥 MONDAY — Momentum Monday with Mr M. Baloyi\nTonight we sharpen focus and build momentum for the week. A drifting mind creates a drifting income; a focused mind creates a focused harvest.\n🕖 Time: 7PM (Harare / Pretoria)\n🔗 Zoom: https://us02web.zoom.us/j/82146830295?pwd=B67lalFqxbdc2JL1THQzOfNTrFPfpC.1\n🆔 Meeting ID: 821 4683 0295\n🔑 Passcode: 074482i\nCome ready to win the week. Bring your goals, your notebook, your fire. Tonight we move with intention. 🌍🔥",
  2: "🔥 TUESDAY — APLGO Opportunity Night\nTonight we open the doors for new partners and show them how health, hope and income come together. Someone you invite tonight could change their family's story forever.\n🕖 Time: 7PM (Harare / Pretoria)\n🔗 Zoom: https://us02web.zoom.us/j/81005489695?pwd=9DhPDKb3D1obIeKow6GbrGYUuvTi7b.1\n🆔 Meeting ID: 810 0548 9695\n🔑 Passcode: 302232\nInvite boldly. Lead confidently. The future belongs to those who plug in and show up.",
  3: "🔥 WEDNESDAY — Product Training Night\nA farmer who understands the soil gets better harvests. In the same way, a leader who understands the products gets better results. Tonight we study the APLGO drops so you can recommend with wisdom, confidence and love.\n🕖 Time: 7PM SA / 7PM Botswana / 5PM Ghana\n🌐 Main Zoom: www.AplgoAfricaZoom.com\n🔄 Alternative: https://us06web.zoom.us/j/3013686869\nBring your questions, your testimonies and your hunger to learn. Knowledge strengthens leadership.",
  4: "🔥 THURSDAY — Fast-Start Training\nThis is where new people launch properly and existing leaders sharpen their systems. A slow start creates confusion; a fast start creates belief.\n🕖 Time: 7PM SA / 7PM Botswana / 5PM Ghana\n🌐 Main Zoom: www.AplgoAfricaZoom.com\n🔄 Alternative: https://us06web.zoom.us/j/3013686869\nPlug in every new member. Bring your team. Tonight we build speed, clarity and duplication.",
  5: "🔥 FRIDAY — Goals & Accountability with Mr. Baloyi\nDreams are beautiful, but progress requires measurement. Tonight we look at goals, actions, and the discipline needed to build breakthroughs.\n🕖 Time: 7PM (Harare / Pretoria)\n🔗 Zoom: https://us02web.zoom.us/j/83333969626?pwd=IgJH0JU7P91I2cfGbvSKmznXrnon27.1\n🆔 Meeting ID: 833 3396 9626\n🔑 Passcode: 814691\nShow up with honesty, hunger and a commitment to grow. Let discipline build your destiny.",
  6: "🔥 SATURDAY — Vision Builders with Vanto\nTonight we go deeper — purpose, vision, calling. Saturday is for builders who want legacy, not just income. This is where fire is ignited.\n🕖 Time: 7PM (Harare / Pretoria)\n🔗 Zoom: https://us06web.zoom.us/j/86968140352?pwd=oLTdNxe8rkTQjdaPiYzTKqYYIgIyP8.1\n🆔 Meeting ID: 869 6814 0352\n🔑 Passcode: 790619\nBring your heart, your dreams and your commitment to impact. We build vision here.",
};

// Default target (can be overridden via request body)
const DEFAULT_TARGET = { name: "APLGO | Health and Biz", jid: "120363419298058298@g.us" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      user_id,
      start_date,         // ISO date string e.g. "2026-04-17"
      morning_start_day,  // 1-30, which day in the cycle to start (default 5 = current)
      days = 30,          // how many days to schedule
      target_groups,      // optional array of { name, jid } — defaults to APLGO | Health and Biz
    } = body;

    if (!user_id || !start_date) {
      return new Response(JSON.stringify({ error: "user_id and start_date required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const morningStart = (morning_start_day || 5) - 1; // convert to 0-indexed
    const groups = Array.isArray(target_groups) && target_groups.length > 0
      ? target_groups
      : [DEFAULT_TARGET];
    const rows: any[] = [];

    for (const group of groups) {
      const groupName = group.name || DEFAULT_TARGET.name;
      const groupJid = group.jid || DEFAULT_TARGET.jid;

      for (let i = 0; i < days; i++) {
        const date = new Date(start_date + "T00:00:00+02:00"); // SAST
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];
        const dayOfWeek = date.getDay(); // 0=Sun

        // Morning post at 07:00 SAST (05:00 UTC)
        const morningIdx = (morningStart + i) % 30;
        rows.push({
          user_id,
          target_group_name: groupName,
          target_group_jid: groupJid,
          message_content: MORNING_MESSAGES[morningIdx],
          scheduled_at: `${dateStr}T05:00:00+00:00`,
          status: "pending",
        });

        // Midday post at 12:00 SAST (10:00 UTC)
        const middayIdx = (morningStart + i) % 30;
        rows.push({
          user_id,
          target_group_name: groupName,
          target_group_jid: groupJid,
          message_content: MIDDAY_MESSAGES[middayIdx],
          scheduled_at: `${dateStr}T10:00:00+00:00`,
          status: "pending",
        });

        // Evening post at 17:00 SAST (15:00 UTC)
        const eveningMsg = EVENING_MESSAGES[dayOfWeek];
        if (eveningMsg) {
          rows.push({
            user_id,
            target_group_name: groupName,
            target_group_jid: groupJid,
            message_content: eveningMsg,
            scheduled_at: `${dateStr}T15:00:00+00:00`,
            status: "pending",
          });
        }
      }
    }

    // Insert in batches of 50
    let inserted = 0;
    for (let b = 0; b < rows.length; b += 50) {
      const batch = rows.slice(b, b + 50);
      const { error } = await supabase.from("scheduled_group_posts").insert(batch);
      if (error) {
        console.error("Insert error at batch", b, error);
        return new Response(JSON.stringify({ error: error.message, inserted_so_far: inserted }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inserted += batch.length;
    }

    return new Response(JSON.stringify({
      success: true,
      total_posts: inserted,
      days_scheduled: days,
      morning_cycle_start: morningStart + 1,
      date_range: `${start_date} → +${days} days`,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("schedule-content error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
