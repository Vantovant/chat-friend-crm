# Architecture Rules

- Facebook-to-WhatsApp media recovery must prefer the exact Facebook post image, then an unambiguous same-Page image within ten minutes, and use the configured fallback only when both fail; Meta may assign scheduled and published copies different post IDs.
- Per-user brand links (website, shop, Facebook Page URL) live in user_brand_settings keyed by user_id, and the env Facebook token serves only the owner Page id; no other account may fall back to the owner's values, so accounts never mix.
- Contact intent tags live in contact_tags (manual rows always win, enforced by trigger); only the contact-intent-tag function writes AI/system tags and it never sends messages, because tagging must stay read-and-tag only.
- Call Sheet tiers are computed only in the security_invoker view call_list_cards, and calls are logged/undone only through the log_call_sheet_call / undo_call_sheet_call RPCs, so the page and MCP tools share one transaction and one rule set.
