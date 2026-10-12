# Architecture Rules

- Facebook-to-WhatsApp media recovery must prefer the exact Facebook post image, then an unambiguous same-Page image within ten minutes, and use the configured fallback only when both fail; Meta may assign scheduled and published copies different post IDs.
- Per-user brand links (website, shop, Facebook Page URL) live in user_brand_settings keyed by user_id, and the env Facebook token serves only the owner Page id; no other account may fall back to the owner's values, so accounts never mix.
