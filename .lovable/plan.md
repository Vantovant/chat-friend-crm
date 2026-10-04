# Facebook photo recovery for WhatsApp group posts

## Diagnosis
- The WhatsApp screenshot shows the fallback product-stack image, not the Facebook post's own photo.
- The sender is attaching media correctly; this is why the post has a large image instead of a broken Facebook link preview.
- Facebook created two records about five minutes apart for this scheduled post:
  - the first record triggered the WhatsApp queue but contained no message or photo;
  - the later published record contained the real post text and photo.
- Retrying the first Facebook record cannot find the photo because Facebook assigned the published copy a different post ID.

## Changes
1. Extend the shared Facebook image recovery helper so that, after the existing exact-post retry fails, it can inspect the same Page's newly published posts around the original post time.
2. Accept a nearby photo only under strict matching rules: same Page, tightly bounded time window, and an unambiguous candidate. Otherwise keep the configured fallback image.
3. Use that recovery in both queue creation and final WhatsApp send, preserving the current order:
   - exact Facebook photo or video thumbnail;
   - safely matched published-copy photo;
   - configured product-stack fallback.
4. Update only still-pending rows for this affected Facebook post with its verified real Facebook image, so remaining scheduled groups do not receive the fallback.
5. Deploy only the affected Facebook ingest/queue and WhatsApp group sender functions, then verify the stored rows and function health without sending a test message.

## Unchanged
- Scheduling times, statuses, caps, group allowlist, message wording, UTM tagging, and `trg_a_normalize_facebook_links`.
- No new tables or RLS changes.
- The fallback remains available only when no safe real Facebook image can be found.

## Rollback
- Revert the helper and caller edits and redeploy the same functions.
- No schema rollback is required; any pending-row image correction can be cleared without affecting sent posts.
