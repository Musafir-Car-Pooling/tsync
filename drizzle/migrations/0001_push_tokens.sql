create table public.push_tokens (id text primary key, user_id uuid not null, token text not null, updated_at bigint not null);
grant select, insert, update, delete on public.push_tokens to authenticated; grant all on public.push_tokens to service_role;
alter table public.push_tokens enable row level security;
create policy "own tokens" on public.push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());