-- ეზო — სქემის ნაწილი 1/4. გაუშვი პირველი. (მთლიანი ფაილი: supabase/schema.sql)
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

create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_other = auth.uid() then raise exception 'invalid'; end if;
  if public.is_blocked(auth.uid(), p_other) then raise exception 'blocked'; end if;
  select c.id into v_id from conversations c
    join conversation_members a on a.conversation_id = c.id and a.user_id = auth.uid()
    join conversation_members b on b.conversation_id = c.id and b.user_id = p_other
    where c.kind in ('dm', 'dating')
    order by c.kind = 'dm' desc
    limit 1;
  if v_id is null then
    insert into conversations (kind) values ('dm') returning id into v_id;
    insert into conversation_members (conversation_id, user_id) values (v_id, auth.uid()), (v_id, p_other);
  end if;
  return v_id;
end $$;

drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (id uuid, kind text, updated_at timestamptz, last_message text, last_sender uuid, unread boolean, other jsonb,
               title text, avatar_url text, my_role text, members_count bigint, members jsonb, last_sender_name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.updated_at, c.last_message, c.last_sender,
    (c.last_sender is not null and c.last_sender <> auth.uid() and c.updated_at > m.last_read_at) as unread,
    case when c.kind <> 'group' then
      (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
               'avatar_url', p.avatar_url, 'last_seen', p.last_seen)
         from conversation_members o join profiles p on p.id = o.user_id
        where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end as other,
    c.title, c.avatar_url, m.role,
    (select count(*) from conversation_members x where x.conversation_id = c.id),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)), '[]')
       from (select p.* from conversation_members o join profiles p on p.id = o.user_id
              where o.conversation_id = c.id and o.user_id <> auth.uid() order by o.user_id limit 3) p),
    (select coalesce(nullif(split_part(full_name, ' ', 1), ''), username) from profiles where id = c.last_sender)
  from conversations c
  join conversation_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  where public.mfa_ok()
  order by c.updated_at desc;
$$;

create or replace function public.mark_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update conversation_members set last_read_at = now()
  where conversation_id = p_conv and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- გაცნობა (Tinder + Badoo) — მხოლოდ 18+
-- ---------------------------------------------------------------------
create table if not exists public.dating_profiles (
  user_id uuid primary key references public.profiles on delete cascade,
  enabled boolean not null default true,
  birth_date date not null,
  gender text not null check (gender in ('man', 'woman')),
  looking_for text not null default 'everyone' check (looking_for in ('man', 'woman', 'everyone')),
  bio text not null default '' check (char_length(bio) <= 500),
  photos jsonb not null default '[]'::jsonb,
  interests text[] not null default '{}',
  city text not null default '',
  age_min int not null default 18 check (age_min >= 18),
  age_max int not null default 60 check (age_max <= 99),
  created_at timestamptz not null default now()
);

create or replace function public.check_dating_age()
returns trigger language plpgsql as $$
begin
  if new.birth_date > (current_date - interval '18 years')::date then
    raise exception 'გაცნობის რეჟიმი მხოლოდ 18 წლიდანაა';
  end if;
  return new;
end $$;
drop trigger if exists dating_age on public.dating_profiles;
create trigger dating_age before insert or update on public.dating_profiles
  for each row execute function public.check_dating_age();

create table if not exists public.swipes (
  swiper_id uuid references public.profiles on delete cascade,
  target_id uuid references public.profiles on delete cascade,
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (swiper_id, target_id),
  check (swiper_id <> target_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles on delete cascade,
  user_b uuid not null references public.profiles on delete cascade,
  conversation_id uuid references public.conversations on delete set null,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create or replace function public.on_swipe()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_a uuid; v_b uuid;
begin
  if not new.liked then return new; end if;
  if exists (select 1 from swipes where swiper_id = new.target_id and target_id = new.swiper_id and liked) then
    v_a := least(new.swiper_id, new.target_id);
    v_b := greatest(new.swiper_id, new.target_id);
    if not exists (select 1 from matches where user_a = v_a and user_b = v_b) then
      insert into conversations (kind) values ('dating') returning id into v_conv;
      insert into conversation_members (conversation_id, user_id) values (v_conv, v_a), (v_conv, v_b);
      insert into matches (user_a, user_b, conversation_id) values (v_a, v_b, v_conv);
      perform public.notify(new.target_id, new.swiper_id, 'match');
      perform public.notify(new.swiper_id, new.target_id, 'match');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists swipes_after on public.swipes;
create trigger swipes_after after insert on public.swipes
  for each row execute function public.on_swipe();

create or replace function public.age_of(d date)
returns int language sql immutable as $$ select extract(year from age(d))::int $$;

create or replace function public.dating_card(dp public.dating_profiles, p public.profiles)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
    'age', public.age_of(dp.birth_date), 'gender', dp.gender, 'bio', dp.bio, 'photos', dp.photos,
    'interests', dp.interests, 'city', dp.city, 'last_seen', p.last_seen);
$$;

create or replace function public.dating_candidates(p_limit int default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from dating_profiles where user_id = auth.uid() and enabled)
  select public.dating_card(dp, p)
  from dating_profiles dp
  join profiles p on p.id = dp.user_id
  cross join me
  where dp.enabled
    and dp.user_id <> auth.uid()
    and (me.looking_for = 'everyone' or me.looking_for = dp.gender)
    and (dp.looking_for = 'everyone' or dp.looking_for = me.gender)
    and public.age_of(dp.birth_date) between me.age_min and me.age_max
    and not exists (select 1 from swipes s where s.swiper_id = auth.uid() and s.target_id = dp.user_id)
    and not public.is_blocked(auth.uid(), dp.user_id)
  order by (lower(dp.city) = lower(me.city)) desc, random()
  limit p_limit;
$$;

-- Badoo-ს „ახლოს მყოფები“ — იგივე ქალაქი, ბოლოს აქტიურები პირველი
create or replace function public.dating_nearby(p_limit int default 40)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from dating_profiles where user_id = auth.uid() and enabled)
  select public.dating_card(dp, p)
  from dating_profiles dp
  join profiles p on p.id = dp.user_id
  cross join me
  where dp.enabled and dp.user_id <> auth.uid()
    and lower(dp.city) = lower(me.city)
    and not public.is_blocked(auth.uid(), dp.user_id)
  order by p.last_seen desc
  limit p_limit;
$$;

create or replace function public.my_matches()
returns table (id uuid, conversation_id uuid, created_at timestamptz, other jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.conversation_id, m.created_at, public.dating_card(dp, p)
  from matches m
  join profiles p on p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
  left join dating_profiles dp on dp.user_id = p.id
  where auth.uid() in (m.user_a, m.user_b)
  order by m.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- სამაგიდო თამაშები
-- ---------------------------------------------------------------------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('nardi', 'chess', 'checkers', 'domino')),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'cancelled')),
  is_public boolean not null default true,
  player_a uuid not null references public.profiles on delete cascade,
  player_b uuid references public.profiles on delete cascade,
  invited uuid references public.profiles on delete cascade,
  turn uuid,
  state jsonb not null,
  winner uuid,
  result text,
  move_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_lobby_idx on public.games (type, status, created_at) where status = 'waiting';
create index if not exists games_players_idx on public.games (player_a, player_b, updated_at desc);

-- v5: 4-ადგილიანი მაგიდები (ჯოკერი), ბლიცი, ტურნირები
alter table public.games add column if not exists seats int not null default 2;
alter table public.games add column if not exists player_c uuid references public.profiles on delete cascade;
alter table public.games add column if not exists player_d uuid references public.profiles on delete cascade;
alter table public.games add column if not exists invites uuid[] not null default '{}';
alter table public.games add column if not exists bots text[] not null default '{}';
alter table public.games add column if not exists options jsonb not null default '{}'::jsonb;
alter table public.games add column if not exists tc text;
alter table public.games add column if not exists clock jsonb;
alter table public.games add column if not exists tournament_id uuid;
alter table public.games drop constraint if exists games_seats_check;
alter table public.games add constraint games_seats_check check (seats in (2, 4));
create index if not exists games_tournament_idx on public.games (tournament_id, status) where tournament_id is not null;
create index if not exists games_players_cd_idx on public.games (player_c, player_d);

create table if not exists public.game_stats (
  user_id uuid references public.profiles on delete cascade,
  type text not null,
  rating int not null default 1200,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  primary key (user_id, type)
);

-- სვლის რიგი ყოველთვის მდგომარეობიდან გამოითვლება: 'w'/'a' → player_a, 'b' → player_b
create or replace function public.seat_player(p_a uuid, p_b uuid, p_state jsonb)
returns uuid language sql immutable as $$
  select case when p_state ->> 'turn' in ('w', 'a') then p_a else p_b end;
$$;

-- ძველი (v1) კლიენტის RPC-ები — v2-ში თამაშებს მხოლოდ სერვერი (Edge Function „game“) ცვლის
drop function if exists public.create_game(text, jsonb, uuid);
drop function if exists public.join_random(text, jsonb);
drop function if exists public.join_game(uuid);
drop function if exists public.submit_move(uuid, jsonb, boolean, text, text);
drop function if exists public.resign_game(uuid);

alter table public.games drop constraint if exists games_type_check;
alter table public.games add constraint games_type_check
  check (type in ('nardi', 'chess', 'checkers', 'domino', 'longnardi', 'durak', 'joker', 'bura', 'loto'));

-- სრული მდგომარეობა (მაგ. დომინოს ბაზარი) — კლიენტისთვის მიუწვდომელი
create table if not exists public.game_private (
  game_id uuid primary key references public.games on delete cascade,
  state jsonb not null
);
-- თითოეული მოთამაშის ხელი (დომინო) — ხედავს მხოლოდ მფლობელი
create table if not exists public.game_hands (
  game_id uuid references public.games on delete cascade,
  seat text not null,
  user_id uuid references public.profiles on delete cascade,
  tiles jsonb not null default '[]'::jsonb,
  primary key (game_id, seat)
);

create or replace function public.apply_result(v_g games, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ra int; rb int; ea float; sa float; k int := 24;
begin
  if v_g.player_b is null then return; end if;
  insert into game_stats (user_id, type) values (v_g.player_a, v_g.type), (v_g.player_b, v_g.type)
  on conflict do nothing;
  select rating into ra from game_stats where user_id = v_g.player_a and type = v_g.type;
  select rating into rb from game_stats where user_id = v_g.player_b and type = v_g.type;
  ea := 1.0 / (1 + power(10, (rb - ra) / 400.0));
  sa := case when p_winner is null then 0.5 when p_winner = v_g.player_a then 1 else 0 end;
  update game_stats set rating = ra + round(k * (sa - ea)),
    wins = wins + (sa = 1)::int, losses = losses + (sa = 0)::int, draws = draws + (sa = 0.5)::int
   where user_id = v_g.player_a and type = v_g.type;
  update game_stats set rating = rb + round(k * ((1 - sa) - (1 - ea))),
    wins = wins + (sa = 0)::int, losses = losses + (sa = 1)::int, draws = draws + (sa = 0.5)::int
   where user_id = v_g.player_b and type = v_g.type;
end $$;

-- შემთხვევითი მოწინააღმდეგე: ატომურად ვუერთდებით მოლოდინში მყოფ თამაშს
-- (იგივე დროის კონტროლით და იგივე ტურნირში). ჩემი მოლოდინში მყოფი თამაში უქმდება.
drop function if exists public.svc_claim_game(uuid, text);
create or replace function public.svc_claim_game(p_user uuid, p_type text, p_tc text default null, p_tournament uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games
   where type = p_type and status = 'waiting' and is_public and seats = 2 and player_a <> p_user
     and tc is not distinct from p_tc and tournament_id is not distinct from p_tournament
     and not public.is_blocked(player_a, p_user)
   order by created_at
   limit 1
   for update skip locked;
  if not found then return null; end if;
  update games set player_b = p_user, status = 'active',
    turn = public.seat_player(v_g.player_a, p_user, v_g.state), updated_at = now()
   where id = v_g.id;
  update game_hands set user_id = p_user where game_id = v_g.id and seat = 'b';
  update games set status = 'cancelled', updated_at = now()
   where player_a = p_user and status = 'waiting' and type = p_type and is_public
     and tc is not distinct from p_tc and tournament_id is not distinct from p_tournament;
  return v_g.id;
end $$;

create or replace function public.svc_join_game(p_user uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'waiting' then raise exception 'თამაში უკვე დაწყებულია'; end if;
  if v_g.player_a = p_user then raise exception 'საკუთარ თამაშს ვერ შეუერთდები'; end if;
  if not v_g.is_public and v_g.invited is distinct from p_user then raise exception 'მოწვევა არ გაქვს'; end if;
  update games set player_b = p_user, status = 'active',
    turn = public.seat_player(v_g.player_a, p_user, v_g.state), updated_at = now()
   where id = p_id;
  update game_hands set user_id = p_user where game_id = p_id and seat = 'b';
end $$;

-- შედეგის ჩაწერა + რეიტინგი (ერთხელ)
create or replace function public.svc_finish(p_id uuid, p_winner uuid, p_result text)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games;
begin
  select * into v_g from games where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if v_g.status = 'waiting' or (v_g.status = 'active' and p_result = 'abort') then
    update games set status = 'cancelled', result = nullif(p_result, 'cancel'), turn = null, updated_at = now() where id = p_id;
    return;
  end if;
  if v_g.status <> 'active' then return; end if;
  update games set status = 'finished', winner = p_winner, result = p_result, turn = null, updated_at = now()
   where id = p_id;
  perform public.apply_result(v_g, p_winner);
  if v_g.tournament_id is not null then perform public.arena_score(v_g, p_winner); end if;
end $$;

-- ---------------------------------------------------------------------
-- ჯგუფები, ივენთები, #თეგები (ცხრილები; ლოგიკა და RLS — ფაილის ბოლოს, v3)
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  cover_url text,
  privacy text not null default 'public' check (privacy in ('public', 'private')),
  owner_id uuid not null references public.profiles on delete cascade,
  members_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists groups_popular_idx on public.groups (members_count desc);

create table if not exists public.group_members (
  group_id uuid references public.groups on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id, status);

alter table public.posts add column if not exists group_id uuid references public.groups on delete cascade;
alter table public.posts add column if not exists hashtags text[] not null default '{}';
create index if not exists posts_group_idx on public.posts (group_id, created_at desc) where group_id is not null;
create index if not exists posts_tags_idx on public.posts using gin (hashtags);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  place text not null default '' check (char_length(place) <= 200),
  city text not null default '',
  cover_url text,
  host_id uuid not null references public.profiles on delete cascade,
  group_id uuid references public.groups on delete cascade,
  going_count int not null default 0,
  interested_count int not null default 0,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_upcoming_idx on public.events (starts_at);

create table if not exists public.event_rsvps (
  event_id uuid references public.events on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  status text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.notifications add column if not exists group_id uuid references public.groups on delete cascade;
alter table public.notifications add column if not exists event_id uuid references public.events on delete cascade;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote',
  'group_request', 'group_approved', 'event_rsvp', 'tournament_start', 'tournament_end',
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined'));

-- ---------------------------------------------------------------------
-- ფიდები: „შენთვის“ (რეიტინგით) და „გამოწერები“ (ქრონოლოგიით)
-- ---------------------------------------------------------------------
create or replace function public.feed_following(p_before timestamptz default now(), p_limit int default 20)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.parent_id is null and p.kind = 'post' and p.created_at < p_before
    and (p.author_id = auth.uid() or p.author_id in (select following_id from follows where follower_id = auth.uid())
         or p.group_id in (select group_id from group_members where user_id = auth.uid() and status = 'active'))
  order by p.created_at desc
  limit p_limit;
$$;

create or replace function public.feed_foryou(p_offset int default 0, p_limit int default 20)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.parent_id is null and p.kind = 'post'
    and p.created_at > now() - interval '30 days'
    and not public.is_blocked(auth.uid(), p.author_id)
  order by (
      (p.like_count * 2 + p.reply_count * 3 + p.repost_count * 2 + 1)
      * case when p.author_id in (select following_id from follows where follower_id = auth.uid()) then 1.6 else 1 end
    ) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.4) desc,
    p.created_at desc
  limit p_limit offset p_offset;
$$;

create or replace function public.reels_feed(p_offset int default 0, p_limit int default 10)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.kind = 'reel' and p.parent_id is null
    and not public.is_blocked(auth.uid(), p.author_id)
  order by (p.like_count * 2 + p.reply_count * 3 + 1)
           / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.2) desc,
           p.created_at desc
  limit p_limit offset p_offset;
$$;

create or replace function public.explore_media(p_limit int default 30)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.parent_id is null and jsonb_array_length(p.media) > 0
    and p.created_at > now() - interval '60 days'
    and not public.is_blocked(auth.uid(), p.author_id)
  order by (p.like_count + p.reply_count * 2 + 1) / power(extract(epoch from now() - p.created_at) / 3600 + 2, 1.1) desc
  limit p_limit;
$$;

-- სტუმრები
create or replace function public.record_visit(p_profile uuid)
returns void language sql security definer set search_path = public as $$
  insert into profile_visits (profile_id, visitor_id) values (p_profile, auth.uid())
  on conflict (profile_id, visitor_id) do update set visited_at = now();
$$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

create or replace function public.suggested_people(p_limit int default 12)
returns setof public.profiles language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid())
  select p.* from profiles p cross join me
  where p.id <> me.id and p.onboarded and (p.banned_until is null or p.banned_until < now())
    and p.id not in (select following_id from follows where follower_id = me.id)
    and not public.is_blocked(me.id, p.id)
  order by
    (me.school <> '' and lower(p.school) = lower(me.school)) desc,
    (me.city <> '' and lower(p.city) = lower(me.city)) desc,
    (select count(*) from follows f1 join follows f2 on f2.follower_id = f1.following_id
      where f1.follower_id = me.id and f2.following_id = p.id) desc,
    p.followers_count desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- დახურული პროფილი და „ახლო მეგობრები“ — ხილვადობის დამხმარე ფუნქციები
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_private boolean not null default false;

create or replace function public.is_private_profile(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from profiles where id = p_id), false);
$$;

-- ხედავს თუ არა მიმდინარე მომხმარებელი ავტორის პოსტებს/სთორიებს
create or replace function public.can_see_author(p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_author = auth.uid()
      or not public.is_private_profile(p_author)
      or exists (select 1 from follows where follower_id = auth.uid() and following_id = p_author)
      or public.is_staff();
$$;

create or replace function public.story_audience_ok(p_author uuid, p_audience text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_audience = 'all' or p_author = auth.uid()
      or exists (select 1 from close_friends where owner_id = p_author and friend_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.profile_visits enable row level security;
alter table public.gifts enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.dating_profiles enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.game_stats enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "blocks own" on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "reports insert" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

create policy "follows read" on public.follows for select to authenticated using (true);
create policy "follows insert own" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked(follower_id, following_id) and not public.is_private_profile(following_id));
create policy "follows delete own" on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy "posts read" on public.posts for select to authenticated
  using (not public.is_blocked(auth.uid(), author_id) and (not hidden or author_id = auth.uid() or public.is_staff()));
create policy "posts insert own" on public.posts for insert to authenticated with check (author_id = auth.uid() and public.can_act());
create policy "posts update own" on public.posts for update to authenticated using (author_id = auth.uid());
create policy "posts delete own" on public.posts for delete to authenticated using (author_id = auth.uid());

create policy "likes read" on public.likes for select to authenticated using (true);
create policy "likes insert own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes delete own" on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "stories read active" on public.stories for select to authenticated
  using ((expires_at > now() or author_id = auth.uid()) and not public.is_blocked(auth.uid(), author_id)
         and public.can_see_author(author_id) and public.story_audience_ok(author_id, audience));
create policy "stories insert own" on public.stories for insert to authenticated with check (author_id = auth.uid() and public.can_act());
create policy "stories delete own" on public.stories for delete to authenticated using (author_id = auth.uid());

create policy "story views insert" on public.story_views for insert to authenticated with check (viewer_id = auth.uid());
create policy "story views read" on public.story_views for select to authenticated using (
  viewer_id = auth.uid() or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "visits owner reads" on public.profile_visits for select to authenticated using (profile_id = auth.uid());

create policy "gifts read" on public.gifts for select to authenticated using (true);
create policy "gifts send" on public.gifts for insert to authenticated with check (from_id = auth.uid() and public.can_act());

create policy "notifications own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications mark read" on public.notifications for update to authenticated using (user_id = auth.uid());

create policy "conversations members" on public.conversations for select to authenticated using (public.is_member(id));
create policy "members read" on public.conversation_members for select to authenticated using (public.is_member(conversation_id));
create policy "messages read" on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id) and public.can_act());

create policy "dating own" on public.dating_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_act());
create policy "swipes own insert" on public.swipes for insert to authenticated with check (swiper_id = auth.uid());
create policy "swipes own read" on public.swipes for select to authenticated using (swiper_id = auth.uid());
create policy "matches own" on public.matches for select to authenticated using (auth.uid() in (user_a, user_b));

create policy "games read" on public.games for select to authenticated using (true);
create policy "stats read" on public.game_stats for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- მედიის საცავი (ფოტო, ვიდეო, ხმოვანი) — თითო მომხმარებელს თავისი საქაღალდე
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "media read" on storage.objects;
drop policy if exists "media upload own" on storage.objects;
drop policy if exists "media delete own" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'media');
create policy "media upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
end $$;

