UPDATE public.scheduled_group_posts
SET scheduled_at = now() - interval '10 seconds'
WHERE target_group_jid = '120363419298058298@g.us'
  AND status = 'pending'
  AND message_content LIKE 'Team, let%wake this group up%';