-- ეზო — სქემის ნაწილი 1/8. გაუშვი პირველი. (მთლიანი ფაილი: supabase/schema.sql)
-- =====================================================================
--  ეზო — Supabase სქემა
--  გაუშვი მთლიანად: Supabase Dashboard → SQL Editor → New query → Run
--  შეიცავს: პროფილები, გამოწერები, პოსტები/თრედები/რილსები, მოწონებები,
--  სთორიები, სტუმრები, საჩუქრები, შეტყობინებები, ჩატი, გაცნობა,
--  სამაგიდო თამაშები, რეიტინგი, ბლოკი/რეპორტი, მედიის საცავი, Realtime.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Data API-ს წვდომა (anon / authenticated / service_role).
-- Supabase-ის ახალ პროექტებში public-ის ახალი ცხრილები და ფუნქციები ავტომატურად აღარ იხსნება,
-- ამიტომ წვდომას აქ ცალსახად ვაძლევთ. მწკრივებს RLS იცავს (ჩართულია ყველა ცხრილზე), შიდა ფუნქციებს
-- კი ქვემოთ ცალ-ცალკე ვუკეტავთ (revoke). ეს ბლოკი ფაილის თავშია, რომ ყოველ გაშვებაზე revoke-ები მას მოჰყვეს.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- პროფილები
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  full_name text not null default '' check (char_length(full_name) <= 60),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 300),
  city text not null default '',
  school text not null default '',
  grad_year int check (grad_year between 1940 and 2040),
  onboarded boolean not null default false,
  followers_count int not null default 0,
  following_count int not null default 0,
  posts_count int not null default 0,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text;
-- v10: ვინ მოიწვია (მოწვევის ბმული)
alter table public.profiles add column if not exists invited_by uuid references public.profiles on delete set null;
do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('user', 'moderator', 'admin'));
exception when duplicate_object then null; end $$;
create index if not exists profiles_school_idx on public.profiles (lower(school), grad_year);
create index if not exists profiles_city_idx on public.profiles (lower(city));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (new.id, 'u' || substr(replace(new.id::text, '-', ''), 1, 10),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 60),
          coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- მომხმარებელი ვერ შეცვლის მთვლელებს პირდაპირ
create or replace function public.protect_profile_counters()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.posts_count := old.posts_count;
    new.role := old.role;
    new.banned_until := old.banned_until;
    new.ban_reason := old.ban_reason;
    new.invited_by := old.invited_by;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_counters();

-- ---------------------------------------------------------------------
-- ბლოკი და რეპორტი
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid references public.profiles on delete cascade,
  blocked_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles on delete cascade,
  target_user uuid references public.profiles on delete cascade,
  target_post uuid,
  reason text not null check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.reports add column if not exists category text not null default 'other';
alter table public.reports add column if not exists status text not null default 'open';
alter table public.reports add column if not exists resolved_by uuid references public.profiles on delete set null;
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists action text;
-- v7: ბაზრის განცხადების რეპორტი
alter table public.reports add column if not exists target_listing uuid;
create index if not exists reports_open_idx on public.reports (status, created_at desc);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('moderator', 'admin'));
$$;

-- დაბლოკილ ანგარიშს არ შეუძლია კონტენტის შექმნა
create or replace function public.can_act()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (banned_until is null or banned_until < now()));
$$;

-- 2FA: ვისაც TOTP ჩართული აქვს, მგრძნობიარე მონაცემებზე წვდომა მხოლოდ aal2 სესიით
create or replace function public.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or to_regclass('auth.mfa_factors') is null then return true; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') = 'aal2' then return true; end if;
  return not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
end $$;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ---------------------------------------------------------------------
-- გამოწერები (ორმხრივი გამოწერა = მეგობრები)
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid references public.profiles on delete cascade,
  following_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);

-- ---------------------------------------------------------------------
-- პოსტები: თრედები (parent/root), ციტირება (quote), რილსები (kind='reel')
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'reel')),
  body text not null default '' check (char_length(body) <= 2000),
  media jsonb not null default '[]'::jsonb,
  parent_id uuid references public.posts on delete cascade,
  root_id uuid references public.posts on delete cascade,
  quote_id uuid references public.posts on delete set null,
  like_count int not null default 0,
  reply_count int not null default 0,
  repost_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.posts add column if not exists hidden boolean not null default false;
alter table public.posts add column if not exists edited_at timestamptz;
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);
create index if not exists posts_feed_idx on public.posts (created_at desc) where parent_id is null;
create index if not exists posts_root_idx on public.posts (root_id, created_at);
create index if not exists posts_reel_idx on public.posts (kind, created_at desc);

create or replace function public.protect_post_counters()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.like_count := old.like_count;
    new.reply_count := old.reply_count;
    new.repost_count := old.repost_count;
    new.author_id := old.author_id;
    new.kind := old.kind;
    new.parent_id := old.parent_id;
    new.root_id := old.root_id;
    new.quote_id := old.quote_id;
    new.hidden := old.hidden;
    new.created_at := old.created_at;
    if new.body is distinct from old.body or new.media is distinct from old.media then
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists posts_protect on public.posts;
create trigger posts_protect before update on public.posts
  for each row execute function public.protect_post_counters();

create table if not exists public.likes (
  user_id uuid references public.profiles on delete cascade,
  post_id uuid references public.posts on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists likes_post_idx on public.likes (post_id);

-- ---------------------------------------------------------------------
-- სთორიები (24 საათი)
-- ---------------------------------------------------------------------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists stories_active_idx on public.stories (expires_at desc);
-- ვინ ხედავს: ყველა ან მხოლოდ „ახლო მეგობრები“
alter table public.stories add column if not exists audience text not null default 'all';
do $$ begin
  alter table public.stories add constraint stories_audience_check check (audience in ('all', 'close'));
exception when duplicate_object then null; end $$;
create index if not exists stories_author_idx on public.stories (author_id, created_at desc);
create table if not exists public.close_friends (
  owner_id uuid references public.profiles on delete cascade,
  friend_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  check (owner_id <> friend_id)
);

create table if not exists public.story_views (
  story_id uuid references public.stories on delete cascade,
  viewer_id uuid references public.profiles on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

-- ---------------------------------------------------------------------
-- სტუმრები (ვინ ნახა პროფილი) და საჩუქრები — ოდნოკლასნიკების სტილში
-- ---------------------------------------------------------------------
create table if not exists public.profile_visits (
  profile_id uuid references public.profiles on delete cascade,
  visitor_id uuid references public.profiles on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (profile_id, visitor_id)
);

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('pomegranate', 'churchkhela', 'khachapuri', 'wine', 'rose', 'heart', 'star', 'dice')),
  note text not null default '' check (char_length(note) <= 140),
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create index if not exists gifts_to_idx on public.gifts (to_id, created_at desc);

-- ---------------------------------------------------------------------
-- შეტყობინებები
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  actor_id uuid references public.profiles on delete cascade,
  type text not null check (type in ('like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote')),
  post_id uuid references public.posts on delete cascade,
  game_id uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create or replace function public.notify(p_user uuid, p_actor uuid, p_type text, p_post uuid default null, p_game uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor or public.is_blocked(p_user, p_actor) then return; end if;
  insert into public.notifications (user_id, actor_id, type, post_id, game_id)
  values (p_user, p_actor, p_type, p_post, p_game);
end $$;

-- ---------------------------------------------------------------------
-- მთვლელები და შეტყობინებები — ტრიგერები
-- ---------------------------------------------------------------------
create or replace function public.on_follow_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set following_count = following_count + 1 where id = new.follower_id;
    update profiles set followers_count = followers_count + 1 where id = new.following_id;
    perform public.notify(new.following_id, new.follower_id, 'follow');
    return new;
  else
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
    return old;
  end if;
end $$;
drop trigger if exists follows_change on public.follows;
create trigger follows_change after insert or delete on public.follows
  for each row execute function public.on_follow_change();

create or replace function public.on_like_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update posts set like_count = like_count + 1 where id = new.post_id returning author_id into v_author;
    perform public.notify(v_author, new.user_id, 'like', new.post_id);
    return new;
  else
    update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
end $$;
drop trigger if exists likes_change on public.likes;
create trigger likes_change after insert or delete on public.likes
  for each row execute function public.on_like_change();

-- root_id ავტომატურად
create or replace function public.before_post_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    select coalesce(root_id, id) into new.root_id from posts where id = new.parent_id;
    new.kind := 'post';
  else
    new.root_id := null;
  end if;
  return new;
end $$;
drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts
  for each row execute function public.before_post_insert();

create or replace function public.on_post_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      update posts set reply_count = reply_count + 1 where id = new.parent_id returning author_id into v_author;
      perform public.notify(v_author, new.author_id, 'reply', new.id);
    else
      update profiles set posts_count = posts_count + 1 where id = new.author_id;
    end if;
    if new.quote_id is not null then
      update posts set repost_count = repost_count + 1 where id = new.quote_id returning author_id into v_author;
      perform public.notify(v_author, new.author_id, 'quote', new.id);
    end if;
    return new;
  else
    if old.parent_id is not null then
      update posts set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
    else
      update profiles set posts_count = greatest(posts_count - 1, 0) where id = old.author_id;
    end if;
    if old.quote_id is not null then
      update posts set repost_count = greatest(repost_count - 1, 0) where id = old.quote_id;
    end if;
    return old;
  end if;
end $$;
drop trigger if exists posts_change on public.posts;
create trigger posts_change after insert or delete on public.posts
  for each row execute function public.on_post_change();

create or replace function public.on_gift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.to_id, new.from_id, 'gift');
  return new;
end $$;
drop trigger if exists gifts_notify on public.gifts;
create trigger gifts_notify after insert on public.gifts
  for each row execute function public.on_gift();

-- ---------------------------------------------------------------------
-- ჩატი
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'dm' check (kind in ('dm', 'dating')),
  last_message text,
  last_sender uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid references public.conversations on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on public.conversation_members (user_id);
-- v4: ჯგუფური ჩატები
alter table public.conversations add column if not exists title text check (char_length(title) <= 80);
alter table public.conversations add column if not exists avatar_url text;
alter table public.conversations add column if not exists created_by uuid references public.profiles on delete set null;
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('dm', 'dating', 'group'));
alter table public.conversation_members add column if not exists role text not null default 'member';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  sender_id uuid not null references public.profiles on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  media_url text,
  media_type text check (media_type in ('image', 'audio')),
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);
-- v4: პასუხი, წაშლა, დამატებითი მონაცემი (ზარი, სთორზე პასუხი, სისტემური)
alter table public.messages add column if not exists reply_to uuid references public.messages on delete set null;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists meta jsonb not null default '{}'::jsonb;

create or replace function public.is_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
    where conversation_id = p_conv and user_id = auth.uid());
$$;

create or replace function public.on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set
    last_message = case when new.media_type = 'image' then '📷 ფოტო'
                        when new.media_type = 'audio' then '🎙 ხმოვანი'
                        when new.meta ? 'call' then case when new.meta -> 'call' ->> 'status' in ('missed', 'declined', 'busy')
                                                         then '📞 გამოტოვებული ზარი' else '📞 ზარი' end
                        when new.meta ? 'story' then '↩ სთორზე: ' || left(new.body, 100)
                        when new.meta ? 'listing' then '🏷 ' || left(new.body, 110)
                        else left(new.body, 120) end,
    last_sender = new.sender_id,
    updated_at = new.created_at
  where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at
  where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.on_message();
