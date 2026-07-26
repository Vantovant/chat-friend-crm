
create table if not exists public.google_contacts_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  google_email text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  last_pull_at timestamptz,
  last_push_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.google_contacts_tokens to authenticated;
grant all on public.google_contacts_tokens to service_role;

alter table public.google_contacts_tokens enable row level security;

create policy "own token row select" on public.google_contacts_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy "own token row insert" on public.google_contacts_tokens
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own token row update" on public.google_contacts_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own token row delete" on public.google_contacts_tokens
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists trg_gct_updated_at on public.google_contacts_tokens;
create trigger trg_gct_updated_at
  before update on public.google_contacts_tokens
  for each row execute function public.update_updated_at();
