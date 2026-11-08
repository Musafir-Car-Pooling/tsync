create type public.app_role as enum ('admin','user');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade not null, role app_role not null, unique(user_id, role));
grant select on public.user_roles to authenticated; grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'pp@gmail.com' then insert into public.user_roles(user_id, role) values (new.id, 'admin') on conflict do nothing; end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, data jsonb not null default '{}', active boolean not null default true, verified boolean not null default false, hide_phone boolean not null default false, created_at timestamptz not null default now());
grant select, insert, update, delete on public.profiles to authenticated; grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "create own active" on public.profiles for insert to authenticated with check (id = auth.uid() and active = true);
create policy "update own or admin" on public.profiles for update to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin delete" on public.profiles for delete to authenticated using (public.has_role(auth.uid(),'admin'));
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then
    if tg_op = 'INSERT' then new.verified := coalesce((new.data->>'verified')::boolean,false); -- prototype verified via official email
    else new.active := old.active; new.verified := old.verified; end if;
  end if;
  new.hide_phone := coalesce((new.data->>'hidePhone')::boolean,false);
  return new;
end $$;
create trigger guard_profile before insert or update on public.profiles for each row execute function public.guard_profile();

create table public.app_settings (id text primary key, data jsonb not null default '{}');
grant select on public.app_settings to anon, authenticated; grant insert, update, delete on public.app_settings to authenticated; grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "public read" on public.app_settings for select to anon, authenticated using (true);
create policy "admin write" on public.app_settings for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.companies (id text primary key, data jsonb not null default '{}');
grant select on public.companies to anon, authenticated; grant insert, update, delete on public.companies to authenticated; grant all on public.companies to service_role;
alter table public.companies enable row level security;
create policy "public read" on public.companies for select to anon, authenticated using (true);
create policy "admin write" on public.companies for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.posts (id text primary key, owner_id uuid not null, active boolean not null default true, data jsonb not null default '{}', created_at timestamptz not null default now());
grant select, insert, update, delete on public.posts to authenticated; grant all on public.posts to service_role;
alter table public.posts enable row level security;
create policy "signed in read" on public.posts for select to authenticated using (true);
create policy "own create" on public.posts for insert to authenticated with check (owner_id = auth.uid());
create policy "own or admin update" on public.posts for update to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(),'admin')) with check (owner_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own or admin delete" on public.posts for delete to authenticated using (owner_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.post_owner(_pid text) returns uuid language sql stable security definer set search_path = public as $$ select owner_id from public.posts where id=_pid $$;
create or replace function public.post_active(_pid text) returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select active from public.posts where id=_pid), false) $$;
create or replace function public.setting_flag(_key text) returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select (data->>_key)::boolean from public.app_settings where id='app'), false) $$;

create table public.interests (post_id text not null references public.posts(id) on delete cascade, id text not null, data jsonb not null default '{}', primary key (post_id, id));
grant select, insert, update, delete on public.interests to authenticated; grant all on public.interests to service_role;
alter table public.interests enable row level security;
create policy "read" on public.interests for select to authenticated using (id = auth.uid()::text or public.has_role(auth.uid(),'admin') or public.post_owner(post_id) = auth.uid());
create policy "create" on public.interests for insert to authenticated with check (public.post_active(post_id) and (id = auth.uid()::text or (id like 'demo\_%' and public.post_owner(post_id) = auth.uid() and public.setting_flag('demoMode'))));
create policy "update" on public.interests for update to authenticated using (id = auth.uid()::text or (id like 'demo\_%' and public.post_owner(post_id) = auth.uid()));
create policy "delete" on public.interests for delete to authenticated using (id = auth.uid()::text or public.has_role(auth.uid(),'admin') or public.post_owner(post_id) = auth.uid());

create table public.unlocks (id text primary key, user_id uuid not null, interest_id text not null, post_id text not null, kind text not null default 'phone', status text not null default 'pending', data jsonb not null default '{}', created_at timestamptz not null default now());
grant select, insert, update, delete on public.unlocks to authenticated; grant all on public.unlocks to service_role;
alter table public.unlocks enable row level security;
create or replace function public.valid_pay_proof(_id text, _user uuid, _interest text, _post text, _status text) returns boolean language sql stable security definer set search_path = public as $$
  select _user = auth.uid() and _id = auth.uid()::text || '_' || _interest
    and public.post_owner(_post) = auth.uid()
    and exists(select 1 from public.interests where post_id=_post and id=_interest)
    and (_status = 'pending' or (_status = 'unlocked' and public.setting_flag('instantUnlock')))
$$;
create policy "read" on public.unlocks for select to authenticated using (public.has_role(auth.uid(),'admin') or user_id = auth.uid() or (kind='chat' and interest_id = auth.uid()::text));
create policy "create" on public.unlocks for insert to authenticated with check (public.valid_pay_proof(id, user_id, interest_id, post_id, status));
create policy "update" on public.unlocks for update to authenticated using (public.has_role(auth.uid(),'admin') or (user_id = auth.uid() and status='rejected')) with check (public.has_role(auth.uid(),'admin') or public.valid_pay_proof(id, user_id, interest_id, post_id, status));
create policy "admin delete" on public.unlocks for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.is_unlocked(_a text, _b text) returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.unlocks where id = _a || '_' || _b and status='unlocked') $$;

create table public.private_phones (id text primary key, phone text not null default '');
grant select, insert, update, delete on public.private_phones to authenticated; grant all on public.private_phones to service_role;
alter table public.private_phones enable row level security;
create policy "read" on public.private_phones for select to authenticated using (
  id = auth.uid()::text or public.has_role(auth.uid(),'admin')
  or (public.is_unlocked(auth.uid()::text, id) and not exists(select 1 from public.profiles p where p.id::text = private_phones.id and p.hide_phone)));
create policy "write" on public.private_phones for all to authenticated using (id = auth.uid()::text or public.has_role(auth.uid(),'admin')) with check (id = auth.uid()::text or public.has_role(auth.uid(),'admin'));

create table public.reviews (id text primary key, reviewer_id uuid not null, target_id text not null, rating int not null, text text not null default '', data jsonb not null default '{}');
grant select, insert, update, delete on public.reviews to authenticated; grant all on public.reviews to service_role;
alter table public.reviews enable row level security;
create policy "read" on public.reviews for select to authenticated using (true);
create policy "write" on public.reviews for insert to authenticated with check (reviewer_id = auth.uid() and id = auth.uid()::text || '_' || target_id and rating between 1 and 5 and length(text) <= 500 and (public.is_unlocked(auth.uid()::text, target_id) or public.is_unlocked(target_id, auth.uid()::text)));
create policy "update" on public.reviews for update to authenticated using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid() and id = auth.uid()::text || '_' || target_id and rating between 1 and 5 and length(text) <= 500);
create policy "delete" on public.reviews for delete to authenticated using (reviewer_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.chat_member(_cid text) returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.unlocks where id=_cid and status='unlocked' and kind='chat' and (user_id = auth.uid() or interest_id = auth.uid()::text)) $$;
create table public.chat_messages (id uuid primary key default gen_random_uuid(), chat_id text not null, from_id uuid not null, text text not null, at bigint not null, delivered_at bigint, read_at bigint);
create index on public.chat_messages(chat_id, at);
grant select, insert, update on public.chat_messages to authenticated; grant all on public.chat_messages to service_role;
alter table public.chat_messages enable row level security;
create policy "read" on public.chat_messages for select to authenticated using (public.chat_member(chat_id));
create policy "send" on public.chat_messages for insert to authenticated with check (public.chat_member(chat_id) and from_id = auth.uid() and length(text) between 1 and 1000);
create policy "ticks" on public.chat_messages for update to authenticated using (public.chat_member(chat_id) and from_id <> auth.uid());
create or replace function public.guard_chat_update() returns trigger language plpgsql as $$ begin new.text := old.text; new.from_id := old.from_id; new.at := old.at; new.chat_id := old.chat_id; return new; end $$;
create trigger guard_chat_update before update on public.chat_messages for each row execute function public.guard_chat_update();

alter publication supabase_realtime add table public.posts, public.interests, public.unlocks, public.reviews, public.profiles, public.app_settings, public.companies, public.chat_messages;