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

-- მომხმარებელი ვერ შეცვლის მთვლელებს, როლს და შეზღუდვას პირდაპირ — protect_profile_counters ფაილის ბოლოსაა (ეტაპი C)

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
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention', 'season_end'));

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

-- touch_last_seen ფაილის ბოლოსაა — ეტაპი D (დღიური აქტიურობით)

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

-- =====================================================================
--  v2: მოდერაცია, Push შეტყობინებები, თამაშების სერვერი, უსაფრთხოება
-- =====================================================================

-- ---------------------------------------------------------------------
-- მოდერაცია. ადმინის დანიშვნა (ერთხელ, SQL Editor-ში):
--   update public.profiles set role = 'admin' where username = 'შენი_username';
-- ---------------------------------------------------------------------
-- 5 სხვადასხვა ადამიანის რეპორტის შემდეგ პოსტი ავტომატურად იმალება
create or replace function public.on_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_post is not null and
     (select count(distinct reporter_id) from reports where target_post = new.target_post and status = 'open') >= 5 then
    update posts set hidden = true where id = new.target_post;
  end if;
  if new.target_listing is not null and
     (select count(distinct reporter_id) from reports where target_listing = new.target_listing and status = 'open') >= 5 then
    update listings set hidden = true where id = new.target_listing;
  end if;
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.on_report();

-- ერთი სამიზნე = ერთი რიგი: პოსტი, განცხადება ან პროფილი
create or replace function public.report_key(p_post uuid, p_listing uuid, p_user uuid)
returns text language sql immutable as $$
  select coalesce('p:' || p_post::text, 'l:' || p_listing::text, 'u:' || p_user::text);
$$;
drop function if exists public.admin_reports(text);
create or replace function public.admin_reports(p_status text default 'open')
returns table (id uuid, category text, reason text, status text, action text, created_at timestamptz,
               reports_count bigint, reporter jsonb, target_user jsonb, target_post jsonb, target_listing jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  with latest as (
    select distinct on (public.report_key(r.target_post, r.target_listing, r.target_user)) r.*
    from reports r
    where r.status = p_status
    order by public.report_key(r.target_post, r.target_listing, r.target_user), r.created_at desc
  )
  select l.id, l.category, l.reason, l.status, l.action, l.created_at,
    (select count(distinct r2.reporter_id) from reports r2 where r2.status = p_status and public.report_key(r2.target_post, r2.target_listing, r2.target_user) = public.report_key(l.target_post, l.target_listing, l.target_user)),
    (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
       from profiles p where p.id = l.reporter_id),
    (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
             'banned_until', p.banned_until, 'role', p.role)
       from profiles p where p.id = coalesce(l.target_user, (select x.author_id from posts x where x.id = l.target_post),
                                              (select x.seller_id from listings x where x.id = l.target_listing))),
    (select jsonb_build_object('id', x.id, 'body', x.body, 'media', x.media, 'hidden', x.hidden, 'kind', x.kind, 'created_at', x.created_at)
       from posts x where x.id = l.target_post),
    (select jsonb_build_object('id', x.id, 'title', x.title, 'price', x.price, 'currency', x.currency, 'photo', x.photos ->> 0,
             'description', left(x.description, 300), 'hidden', x.hidden, 'created_at', x.created_at)
       from listings x where x.id = l.target_listing)
  from latest l
  order by l.created_at desc
  limit 200;
end $$;

-- p_action: 'dismiss' | 'hide_post' | 'delete_post' | 'hide_listing' | 'delete_listing' | 'ban'   (ban: p_days = null → სამუდამოდ)
create or replace function public.admin_resolve(p_report uuid, p_action text, p_days int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r reports; v_target uuid; v_key text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select * into r from reports where id = p_report;
  if not found then raise exception 'not found'; end if;
  v_key := public.report_key(r.target_post, r.target_listing, r.target_user);
  v_target := coalesce(r.target_user, (select author_id from posts where id = r.target_post),
                       (select seller_id from listings where id = r.target_listing));
  if p_action = 'hide_post' and r.target_post is not null then
    update posts set hidden = true where id = r.target_post;
  elsif p_action = 'delete_post' and r.target_post is not null then
    delete from posts where id = r.target_post;
  elsif p_action = 'hide_listing' and r.target_listing is not null then
    update listings set hidden = true where id = r.target_listing;
  elsif p_action = 'delete_listing' and r.target_listing is not null then
    delete from listings where id = r.target_listing;
  elsif p_action = 'ban' and v_target is not null then
    perform public.admin_ban(v_target, p_days, coalesce(p_note, r.category));
  end if;
  update reports x set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
         action = p_action, resolved_by = auth.uid(), resolved_at = now()
   where x.status = 'open' and public.report_key(x.target_post, x.target_listing, x.target_user) = v_key;
end $$;

create or replace function public.admin_ban(p_user uuid, p_days int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if (select role from profiles where id = p_user) in ('moderator', 'admin') then raise exception 'მოდერატორს ვერ დაბლოკავ'; end if;
  update profiles set
    banned_until = case when p_days is null then 'infinity'::timestamptz else now() + make_interval(days => p_days) end,
    ban_reason = p_note
   where id = p_user;
  update dating_profiles set enabled = false where user_id = p_user;
end $$;

create or replace function public.admin_unban(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  update profiles set banned_until = null, ban_reason = null where id = p_user;
end $$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from profiles where onboarded),
    'new_users_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'posts_24h', (select count(*) from posts where created_at > now() - interval '24 hours'),
    'open_reports', (select count(distinct public.report_key(r.target_post, r.target_listing, r.target_user)) from reports r where status = 'open'),
    'banned', (select count(*) from profiles where banned_until > now()),
    'active_games', (select count(*) from games where status = 'active'));
end $$;

-- ---------------------------------------------------------------------
-- Push შეტყობინებები (Web Push). ჩართვა — იხ. README, „Push შეტყობინებები“.
-- ---------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net მიუწვდომელია — push არ იმუშავებს';
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- სერვერის საიდუმლოებები (Edge Function-ის მისამართი და გასაღები). კლიენტს წვდომა არ აქვს.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

-- push_dispatch (Push-ის გაგზავნა) ფაილის ბოლოსაა — ეტაპი D (შეტყობინებების პარამეტრებით)

create or replace function public.game_title(p_type text)
returns text language sql immutable as $$
  select case p_type when 'nardi' then 'ნარდი' when 'longnardi' then 'გრძელი ნარდი' when 'chess' then 'ჭადრაკი'
    when 'checkers' then 'შაშკი' when 'domino' then 'დომინო' when 'durak' then 'დურაკი' when 'joker' then 'ჯოკერი' else p_type end;
$$;

create or replace function public.on_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
  select coalesce(nullif(full_name, ''), username) into v_actor from profiles where id = new.actor_id;
  perform public.push_dispatch(new.user_id, jsonb_build_object(
    'title', coalesce(v_actor, 'ეზო'),
    'body', case new.type
      when 'like' then 'მოიწონა შენი პოსტი' when 'reply' then 'გიპასუხა' when 'quote' then 'გაგიზიარა ციტატით'
      when 'follow' then 'გამოგიწერა' when 'gift' then 'საჩუქარი გამოგიგზავნა'
      when 'match' then 'თქვენ ერთმანეთი მოიწონეთ!' when 'game_invite' then 'თამაშში გეპატიჟება'
      else 'ახალი შეტყობინება' end,
    'url', case when new.type = 'game_invite' and new.game_id is not null then '/g/' || new.game_id
                when new.type = 'match' then '/dating?tab=matches'
                when new.post_id is not null then '/p/' || new.post_id else '/notifications' end,
    'tag', 'n-' || new.type || '-' || coalesce(new.post_id::text, new.actor_id::text, '')));
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.on_notification_push();

create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid;
begin
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  for v_member in
    select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', coalesce(v_sender, 'ეზო'),
      'body', case new.media_type when 'image' then '📷 ფოტო' when 'audio' then '🎙 ხმოვანი მესიჯი' else left(new.body, 140) end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.on_message_push();

create or replace function public.on_game_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'waiting' and new.status = 'active' and cardinality(new.bots) = 0 then
    perform public.push_dispatch(new.player_a, jsonb_build_object('title', public.game_title(new.type),
      'body', 'მოწინააღმდეგე შემოგიერთდა', 'url', '/g/' || new.id, 'tag', 'game-' || new.id));
  end if;
  if new.status = 'active' and new.turn is not null and new.turn is distinct from old.turn
     and not (old.status = 'waiting' and new.turn = new.player_a) then
    perform public.push_dispatch(new.turn, jsonb_build_object('title', public.game_title(new.type),
      'body', 'შენი სვლაა', 'url', '/g/' || new.id, 'tag', 'game-' || new.id));
  end if;
  return new;
end $$;
drop trigger if exists games_push on public.games;
create trigger games_push after update on public.games
  for each row execute function public.on_game_push();

-- ---------------------------------------------------------------------
-- v2 RLS
-- ---------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.app_secrets enable row level security;
alter table public.game_private enable row level security;
alter table public.game_hands enable row level security;

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "hands own" on public.game_hands;
create policy "hands own" on public.game_hands for select to authenticated using (user_id = auth.uid());
-- app_secrets და game_private: პოლიტიკა არ არის — მხოლოდ სერვერი (service role)

-- ---------------------------------------------------------------------
-- უსაფრთხოება: შიდა ფუნქციები კლიენტიდან არ გამოიძახება
-- ---------------------------------------------------------------------
revoke execute on function public.notify(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_result(public.games, uuid) from public, anon, authenticated;
revoke execute on function public.svc_claim_game(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.svc_join_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_finish(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_claim_game(uuid, text, text, uuid) to service_role;
grant execute on function public.svc_join_game(uuid, uuid) to service_role;
grant execute on function public.svc_finish(uuid, uuid, text) to service_role;

-- =====================================================================
--  v3: ჯგუფები, ივენთები, #თეგები
-- =====================================================================
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid()
                 and status = 'active' and role in ('owner', 'admin'));
$$;

-- საჯარო ჯგუფის პოსტებს ყველა ხედავს, დახურულისას — მხოლოდ წევრები
create or replace function public.can_see_group(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_group is null
      or exists (select 1 from public.groups where id = p_group and privacy = 'public')
      or public.is_group_member(p_group);
$$;

-- #თეგები ტექსტიდან (ლათინური, ციფრები, ქართული ასოები)
create or replace function public.extract_hashtags(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(coalesce(t, ''), '#([A-Za-z0-9_ა-ჿ]{2,40})', 'g') as m;
$$;

create or replace function public.posts_tags()
returns trigger language plpgsql as $$
begin
  new.hashtags := public.extract_hashtags(new.body);
  return new;
end $$;
drop trigger if exists posts_tags on public.posts;
create trigger posts_tags before insert or update of body on public.posts
  for each row execute function public.posts_tags();
update public.posts set hashtags = public.extract_hashtags(body) where body like '%#%' and hashtags = '{}';

-- ჯგუფის შემქმნელი ავტომატურად მფლობელია
create or replace function public.on_group_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists groups_after_insert on public.groups;
create trigger groups_after_insert after insert on public.groups
  for each row execute function public.on_group_created();

create or replace function public.on_group_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update groups set members_count = (select count(*) from group_members where group_id = coalesce(new.group_id, old.group_id) and status = 'active')
   where id = coalesce(new.group_id, old.group_id);
  return coalesce(new, old);
end $$;
drop trigger if exists group_members_count on public.group_members;
create trigger group_members_count after insert or update or delete on public.group_members
  for each row execute function public.on_group_member_change();

create or replace function public.join_group(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_privacy text; v_status text; v_admin uuid;
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  select privacy into v_privacy from groups where id = p_group;
  if not found then raise exception 'ჯგუფი ვერ მოიძებნა'; end if;
  v_status := case when v_privacy = 'public' then 'active' else 'pending' end;
  insert into group_members (group_id, user_id, status) values (p_group, auth.uid(), v_status)
  on conflict (group_id, user_id) do nothing;
  if v_status = 'pending' then
    for v_admin in select user_id from group_members where group_id = p_group and role in ('owner', 'admin') and status = 'active' loop
      insert into notifications (user_id, actor_id, type, group_id) values (v_admin, auth.uid(), 'group_request', p_group);
    end loop;
  end if;
  return v_status;
end $$;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from groups where id = p_group and owner_id = auth.uid()) then
    raise exception 'მფლობელი ჯგუფს ვერ დატოვებს — ჯერ წაშალე ან გადაეცი სხვას';
  end if;
  delete from group_members where group_id = p_group and user_id = auth.uid();
end $$;

-- p_action: 'approve' | 'remove' | 'make_admin' | 'make_member'
create or replace function public.manage_member(p_group uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'მხოლოდ ადმინისთვის'; end if;
  if exists (select 1 from groups where id = p_group and owner_id = p_user) then raise exception 'მფლობელს ვერ შეცვლი'; end if;
  if p_action = 'approve' then
    update group_members set status = 'active' where group_id = p_group and user_id = p_user and status = 'pending';
    if found then insert into notifications (user_id, actor_id, type, group_id) values (p_user, auth.uid(), 'group_approved', p_group); end if;
  elsif p_action = 'remove' then
    delete from group_members where group_id = p_group and user_id = p_user;
  elsif p_action in ('make_admin', 'make_member') then
    update group_members set role = case p_action when 'make_admin' then 'admin' else 'member' end
     where group_id = p_group and user_id = p_user and status = 'active';
  end if;
end $$;

create or replace function public.tag_posts(p_tag text, p_before timestamptz default now(), p_limit int default 20)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.hashtags @> array[lower(ltrim(p_tag, '#'))] and p.parent_id is null and p.created_at < p_before
  order by p.created_at desc
  limit p_limit;
$$;

create or replace function public.trending_tags(p_limit int default 12)
returns table (tag text, posts bigint) language sql stable security invoker set search_path = public as $$
  select t, count(*) from posts p, unnest(p.hashtags) as t
  where p.created_at > now() - interval '7 days'
  group by t order by count(*) desc, max(p.created_at) desc
  limit p_limit;
$$;

-- RSVP მთვლელები + მასპინძლისთვის შეტყობინება
create or replace function public.on_rsvp_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event uuid := coalesce(new.event_id, old.event_id); v_host uuid;
begin
  update events set
    going_count = (select count(*) from event_rsvps where event_id = v_event and status = 'going'),
    interested_count = (select count(*) from event_rsvps where event_id = v_event and status = 'interested')
   where id = v_event returning host_id into v_host;
  if tg_op = 'INSERT' and new.status = 'going' then
    perform public.notify(v_host, new.user_id, 'event_rsvp');
    update notifications set event_id = v_event
     where id = (select id from notifications where user_id = v_host and actor_id = new.user_id and type = 'event_rsvp' order by created_at desc limit 1);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists event_rsvps_change on public.event_rsvps;
create trigger event_rsvps_change after insert or update or delete on public.event_rsvps
  for each row execute function public.on_rsvp_change();

-- Push-ის ტექსტები (on_notification_push) ფაილის ბოლოსაა — ეტაპი H

-- ---------------------------------------------------------------------
-- v3 RLS
-- ---------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

drop policy if exists "groups read" on public.groups;
drop policy if exists "groups create" on public.groups;
drop policy if exists "groups update admins" on public.groups;
drop policy if exists "groups delete owner" on public.groups;
create policy "groups read" on public.groups for select to authenticated using (true);
create policy "groups create" on public.groups for insert to authenticated with check (owner_id = auth.uid() and public.can_act());
create policy "groups update admins" on public.groups for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy "groups delete owner" on public.groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members read" on public.group_members;
create policy "members read" on public.group_members for select to authenticated using (
  user_id = auth.uid() or public.is_group_admin(group_id) or (status = 'active' and public.can_see_group(group_id)));

drop policy if exists "events read" on public.events;
drop policy if exists "events create" on public.events;
drop policy if exists "events update host" on public.events;
drop policy if exists "events delete host" on public.events;
create policy "events read" on public.events for select to authenticated using (public.can_see_group(group_id));
create policy "events create" on public.events for insert to authenticated
  with check (host_id = auth.uid() and public.can_act() and (group_id is null or public.is_group_member(group_id)));
create policy "events update host" on public.events for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "events delete host" on public.events for delete to authenticated using (host_id = auth.uid() or public.is_group_admin(group_id));

drop policy if exists "rsvps read" on public.event_rsvps;
drop policy if exists "rsvps own" on public.event_rsvps;
create policy "rsvps read" on public.event_rsvps for select to authenticated using (true);
create policy "rsvps own" on public.event_rsvps for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- პოსტები: ჯგუფის ხილვადობა და ჯგუფში წერის უფლება
drop policy if exists "posts read" on public.posts;
drop policy if exists "posts insert own" on public.posts;
drop policy if exists "posts delete own" on public.posts;
create policy "posts read" on public.posts for select to authenticated
  using (not public.is_blocked(auth.uid(), author_id)
         and (not hidden or author_id = auth.uid() or public.is_staff())
         and public.can_see_group(group_id)
         and (group_id is not null or parent_id is not null or public.can_see_author(author_id)));
create policy "posts insert own" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and public.can_act() and (group_id is null or public.is_group_member(group_id)));
create policy "posts delete own" on public.posts for delete to authenticated
  using (author_id = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));

revoke execute on function public.on_rsvp_change() from public, anon, authenticated;

-- =====================================================================
--  v4: ჯგუფური ჩატები, რეაქციები, პასუხები, ზარები
-- =====================================================================
create or replace function public.chat_role(p_conv uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.conversation_members where conversation_id = p_conv and user_id = auth.uid();
$$;

-- პასუხი მხოლოდ იმავე ჩატის მესიჯზე
create or replace function public.before_message_insert()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_lid uuid;
begin
  if new.reply_to is not null and not exists (select 1 from messages where id = new.reply_to and conversation_id = new.conversation_id) then
    new.reply_to := null;
  end if;
  if current_user in ('authenticated', 'anon') then
    new.deleted_at := null;
    new.meta := new.meta - 'call' - 'system';
  end if;
  -- განცხადების ბარათი: მონაცემები ყოველთვის ბაზიდან (გაყალბება შეუძლებელია)
  if new.meta ? 'listing' then
    begin v_lid := (new.meta -> 'listing' ->> 'id')::uuid; exception when others then v_lid := null; end;
    new.meta := (new.meta - 'listing') || coalesce((
      select jsonb_build_object('listing', jsonb_build_object('id', l.id, 'title', l.title, 'price', l.price,
               'currency', l.currency, 'photo', l.photos ->> 0, 'seller_id', l.seller_id))
        from listings l where l.id = v_lid), '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.before_message_insert();

create or replace function public.delete_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update messages set body = '', media_url = null, media_type = null, meta = '{}'::jsonb, deleted_at = now()
   where id = p_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'მესიჯის წაშლა ვერ მოხერხდა'; end if;
end $$;

create table if not exists public.message_reactions (
  message_id uuid references public.messages on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  conversation_id uuid references public.conversations on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists reactions_conv_idx on public.message_reactions (conversation_id);

create or replace function public.before_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select conversation_id into new.conversation_id from messages where id = new.message_id;
  return new;
end $$;
drop trigger if exists reactions_before on public.message_reactions;
create trigger reactions_before before insert or update on public.message_reactions
  for each row execute function public.before_reaction();

create or replace function public.create_group_chat(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user uuid; v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then raise exception 'ჩატის სახელი 1–80 სიმბოლო'; end if;
  if coalesce(array_length(p_members, 1), 0) < 1 or array_length(p_members, 1) > 50 then raise exception 'აირჩიე 1–50 მონაწილე'; end if;
  insert into conversations (kind, title, created_by) values ('group', v_title, auth.uid()) returning id into v_id;
  insert into conversation_members (conversation_id, user_id, role) values (v_id, auth.uid(), 'admin');
  foreach v_user in array p_members loop
    if v_user <> auth.uid() and not public.is_blocked(auth.uid(), v_user) and exists (select 1 from profiles where id = v_user) then
      insert into conversation_members (conversation_id, user_id) values (v_id, v_user) on conflict do nothing;
    end if;
  end loop;
  insert into messages (conversation_id, sender_id, body, meta)
  values (v_id, auth.uid(), 'შექმნა ჩატი „' || v_title || '“', '{"system": true}');
  return v_id;
end $$;

create or replace function public.add_chat_members(p_conv uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_names text;
begin
  if public.chat_role(p_conv) is distinct from 'admin' or (select kind from conversations where id = p_conv) <> 'group' then
    raise exception 'მხოლოდ ჩატის ადმინისთვის';
  end if;
  foreach v_user in array p_members loop
    if not public.is_blocked(auth.uid(), v_user) and exists (select 1 from profiles where id = v_user) then
      insert into conversation_members (conversation_id, user_id) values (p_conv, v_user) on conflict do nothing;
    end if;
  end loop;
  select string_agg(coalesce(nullif(split_part(full_name, ' ', 1), ''), username), ', ') into v_names from profiles where id = any(p_members);
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'დაამატა: ' || coalesce(v_names, ''), '{"system": true}');
end $$;

create or replace function public.leave_chat(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select kind from conversations where id = p_conv) <> 'group' then raise exception 'პირად ჩატს ვერ დატოვებ'; end if;
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'დატოვა ჩატი', '{"system": true}');
  delete from conversation_members where conversation_id = p_conv and user_id = auth.uid();
  -- ადმინი თუ აღარ დარჩა, უძველესი წევრი ხდება ადმინი
  if not exists (select 1 from conversation_members where conversation_id = p_conv and role = 'admin') then
    update conversation_members set role = 'admin'
     where conversation_id = p_conv and user_id = (select user_id from conversation_members where conversation_id = p_conv order by last_read_at limit 1);
  end if;
end $$;

create or replace function public.rename_chat(p_conv uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.chat_role(p_conv) is distinct from 'admin' then raise exception 'მხოლოდ ჩატის ადმინისთვის'; end if;
  update conversations set title = left(btrim(p_title), 80) where id = p_conv and kind = 'group';
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'შეცვალა სახელი: „' || left(btrim(p_title), 80) || '“', '{"system": true}');
end $$;

create or replace function public.chat_members(p_conv uuid)
returns table (id uuid, username text, full_name text, avatar_url text, last_seen timestamptz, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.full_name, p.avatar_url, p.last_seen, m.role
  from conversation_members m join profiles p on p.id = m.user_id
  where m.conversation_id = p_conv and public.is_member(p_conv)
  order by m.role, p.full_name;
$$;

-- ---------------------------------------------------------------------
-- ზარები (WebRTC). მოწვევა ბაზაშია — აბონენტის ვინაობა ყალბდება ვერ;
-- SDP/ICE იცვლება Realtime არხზე „call:<id>“ (id შემთხვევითი UUID-ია და მხოლოდ ორმა იცის).
-- ---------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  caller_id uuid not null references public.profiles on delete cascade,
  callee_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended', 'busy')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  check (caller_id <> callee_id)
);
create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);

create or replace function public.before_call_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select kind from conversations where id = new.conversation_id) not in ('dm', 'dating')
     or not exists (select 1 from conversation_members where conversation_id = new.conversation_id and user_id = new.callee_id)
     or not exists (select 1 from conversation_members where conversation_id = new.conversation_id and user_id = new.caller_id)
     or public.is_blocked(new.caller_id, new.callee_id) then
    raise exception 'ზარი ამ ჩატში შეუძლებელია';
  end if;
  new.status := 'ringing'; new.answered_at := null; new.ended_at := null; new.created_at := now();
  return new;
end $$;
drop trigger if exists calls_before_insert on public.calls;
create trigger calls_before_insert before insert on public.calls
  for each row execute function public.before_call_insert();

-- დაშვებული გადასვლები: ringing → accepted/declined/busy (პასუხისმგებელი), ringing → missed/ended (დამრეკი),
-- accepted → ended (ორივე). დასრულებული ზარი აღარ იცვლება.
create or replace function public.before_call_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if old.status in ('declined', 'missed', 'ended', 'busy') then raise exception 'ზარი უკვე დასრულებულია'; end if;
  new.id := old.id; new.conversation_id := old.conversation_id; new.caller_id := old.caller_id;
  new.callee_id := old.callee_id; new.kind := old.kind; new.created_at := old.created_at;
  if old.status = 'ringing' then
    if new.status in ('accepted', 'declined', 'busy') and v_me is distinct from old.callee_id then raise exception 'not allowed'; end if;
    if new.status = 'missed' and v_me is distinct from old.caller_id then raise exception 'not allowed'; end if;
    if new.status = 'ended' and v_me is distinct from old.caller_id then raise exception 'not allowed'; end if;
  elsif old.status = 'accepted' then
    if new.status <> 'ended' then raise exception 'not allowed'; end if;
  end if;
  if new.status = 'accepted' then new.answered_at := now(); end if;
  if new.status in ('declined', 'missed', 'ended', 'busy') then
    new.ended_at := now();
    if new.status = 'ended' and old.status = 'ringing' then new.status := 'missed'; end if;
  end if;
  return new;
end $$;
drop trigger if exists calls_before_update on public.calls;
create trigger calls_before_update before update on public.calls
  for each row execute function public.before_call_update();

create or replace function public.after_call_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_caller text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(full_name, ''), username) into v_caller from profiles where id = new.caller_id;
    perform public.push_dispatch(new.callee_id, jsonb_build_object(
      'title', coalesce(v_caller, 'ეზო'),
      'body', case new.kind when 'video' then '📹 შემომავალი ვიდეოზარი' else '📞 შემომავალი ზარი' end,
      'url', '/chat/' || new.conversation_id, 'tag', 'call-' || new.id));
  elsif new.status in ('declined', 'missed', 'ended', 'busy') and old.status not in ('declined', 'missed', 'ended', 'busy') then
    insert into messages (conversation_id, sender_id, body, meta) values (new.conversation_id, new.caller_id, '',
      jsonb_build_object('call', jsonb_build_object('id', new.id, 'kind', new.kind, 'status', new.status,
        'duration', case when new.answered_at is not null then extract(epoch from new.ended_at - new.answered_at)::int else 0 end)));
  end if;
  return new;
end $$;
drop trigger if exists calls_after_change on public.calls;
create trigger calls_after_change after insert or update on public.calls
  for each row execute function public.after_call_change();

-- Push: ჯგუფური ჩატის სახელი; ზარის მესიჯს ცალკე push არ სჭირდება
create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid; v_kind text; v_title text; v_text text;
begin
  if new.meta ? 'call' then return new; end if;
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  select kind, title into v_kind, v_title from conversations where id = new.conversation_id;
  v_text := case new.media_type when 'image' then '📷 ფოტო' when 'audio' then '🎙 ხმოვანი მესიჯი' else left(new.body, 140) end;
  for v_member in
    select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', case when v_kind = 'group' then coalesce(v_title, 'ჯგუფური ჩატი') else coalesce(v_sender, 'ეზო') end,
      'body', case when v_kind = 'group' then coalesce(v_sender, '') || ': ' || v_text else v_text end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- v4 RLS + Realtime
-- ---------------------------------------------------------------------
alter table public.message_reactions enable row level security;
alter table public.calls enable row level security;

drop policy if exists "reactions read" on public.message_reactions;
drop policy if exists "reactions own" on public.message_reactions;
create policy "reactions read" on public.message_reactions for select to authenticated using (public.is_member(conversation_id));
create policy "reactions own" on public.message_reactions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));

drop policy if exists "calls read" on public.calls;
drop policy if exists "calls start" on public.calls;
drop policy if exists "calls update" on public.calls;
create policy "calls read" on public.calls for select to authenticated using (auth.uid() in (caller_id, callee_id));
create policy "calls start" on public.calls for insert to authenticated with check (caller_id = auth.uid() and public.can_act());
create policy "calls update" on public.calls for update to authenticated using (auth.uid() in (caller_id, callee_id));

do $$ begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.calls; exception when duplicate_object then null; end;
end $$;
-- წაშლილი მესიჯის სრული მონაცემი Realtime-ში
alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;

-- =====================================================================
--  v5: ჯოკერის მაგიდები (4 ადგილი + კომპიუტერი), ბლიცი, ტურნირები (არენა)
-- =====================================================================
create or replace function public.seat_user(v_g public.games, p_seat text)
returns uuid language sql immutable as $$
  select case p_seat when 'a' then v_g.player_a when 'w' then v_g.player_a when 'b' then v_g.player_b
    when 'c' then v_g.player_c when 'd' then v_g.player_d end;
$$;

-- მაგიდასთან დაჯდომა (მოწვევით ან ღია მაგიდაზე). სავსე მაგიდა თავისით იწყება.
create or replace function public.svc_take_seat(p_user uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_g games; v_seat text;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'waiting' then raise exception 'მაგიდა უკვე დაწყებულია'; end if;
  if v_g.seats <= 2 then raise exception 'ეს თამაში ორ მოთამაშეზეა'; end if;
  if p_user in (v_g.player_a, v_g.player_b, v_g.player_c, v_g.player_d) then return null; end if;
  if not v_g.is_public and not (p_user = any (v_g.invites)) then raise exception 'მოწვევა არ გაქვს'; end if;
  if public.is_blocked(v_g.player_a, p_user) then raise exception 'ამ მაგიდასთან ვერ დაჯდები'; end if;
  v_seat := case when v_g.player_b is null then 'b' when v_g.player_c is null then 'c' when v_g.player_d is null then 'd' end;
  if v_seat is null then raise exception 'მაგიდა სავსეა'; end if;
  update games set
    player_b = case when v_seat = 'b' then p_user else player_b end,
    player_c = case when v_seat = 'c' then p_user else player_c end,
    player_d = case when v_seat = 'd' then p_user else player_d end,
    move_no = move_no + 1, updated_at = now()
   where id = p_id returning * into v_g;
  update game_hands set user_id = p_user where game_id = p_id and seat = v_seat;
  if v_g.player_b is not null and v_g.player_c is not null and v_g.player_d is not null then
    update games set status = 'active', turn = public.seat_user(v_g, v_g.state ->> 'turn'), updated_at = now() where id = p_id;
  end if;
  return v_seat;
end $$;

create or replace function public.svc_take_any_seat(p_user uuid, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from games
   where type = p_type and status = 'waiting' and is_public and seats > 2
     and p_user is distinct from player_a and p_user is distinct from player_b
     and p_user is distinct from player_c and p_user is distinct from player_d
     and (player_b is null or player_c is null or player_d is null)
     and not public.is_blocked(player_a, p_user)
   order by created_at
   limit 1
   for update skip locked;
  if v_id is null then return null; end if;
  perform public.svc_take_seat(p_user, v_id);
  return v_id;
end $$;

create or replace function public.svc_leave_seat(p_user uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games; v_seat text;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'waiting' then return; end if;
  v_seat := case p_user when v_g.player_b then 'b' when v_g.player_c then 'c' when v_g.player_d then 'd' end;
  if v_seat is null then return; end if;
  update games set
    player_b = case when v_seat = 'b' then null else player_b end,
    player_c = case when v_seat = 'c' then null else player_c end,
    player_d = case when v_seat = 'd' then null else player_d end,
    move_no = move_no + 1, updated_at = now()
   where id = p_id;
  update game_hands set user_id = null where game_id = p_id and seat = v_seat;
end $$;

-- მრავალადგილიანი თამაშის დასრულება: Elo წყვილ-წყვილად მხოლოდ ადამიანებს შორის
-- p_scores: {"<user_id>": ქულა}; მაგიდიდან წასულს ძალიან დაბალი ქულა აქვს
create or replace function public.svc_finish_table(p_id uuid, p_winner uuid, p_result text, p_scores jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games; r record; o record; v_delta float; v_k float; v_n int; v_deltas jsonb := '{}'::jsonb;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'active' then return; end if;
  update games set status = 'finished', winner = p_winner, result = p_result, turn = null, updated_at = now() where id = p_id;
  insert into game_stats (user_id, type) select key::uuid, v_g.type from jsonb_each(p_scores) on conflict do nothing;
  v_n := (select count(*) from jsonb_object_keys(p_scores));
  if v_n >= 2 then
    v_k := 32.0 / (v_n - 1);
    for r in select s.key::uuid as uid, (s.value)::numeric as score, gs.rating
               from jsonb_each(p_scores) s join game_stats gs on gs.user_id = s.key::uuid and gs.type = v_g.type loop
      v_delta := 0;
      for o in select s.key::uuid as uid, (s.value)::numeric as score, gs.rating
                 from jsonb_each(p_scores) s join game_stats gs on gs.user_id = s.key::uuid and gs.type = v_g.type
                where s.key::uuid <> r.uid loop
        v_delta := v_delta + v_k * ((case when r.score > o.score then 1 when r.score = o.score then 0.5 else 0 end)
          - 1.0 / (1 + power(10, (o.rating - r.rating) / 400.0)));
      end loop;
      v_deltas := v_deltas || jsonb_build_object(r.uid::text, round(v_delta));
    end loop;
  end if;
  update game_stats gs set
    rating = gs.rating + coalesce((v_deltas ->> gs.user_id::text)::int, 0),
    wins = gs.wins + coalesce(gs.user_id = p_winner, false)::int,
    draws = gs.draws + (p_result = 'jokerdraw')::int,
    losses = gs.losses + (p_result <> 'jokerdraw' and not coalesce(gs.user_id = p_winner, false))::int
   where gs.type = v_g.type and gs.user_id in (select key::uuid from jsonb_each(p_scores));
end $$;

-- ---------------------------------------------------------------------
-- ტურნირები (არენა): დროის ფანჯარაში თამაშობ რამდენიც გინდა, მოგება = 2, ფრე = 1;
-- ზედიზედ ორი მოგების შემდეგ („ცეცხლი“) ქულები ორმაგდება.
-- ---------------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('nardi', 'longnardi', 'chess', 'checkers', 'domino', 'durak')),
  tc text check (tc is null or tc in ('1+0', '3+0', '3+2', '5+0', '10+0')),
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles on delete set null,
  group_id uuid references public.groups on delete cascade,
  created_at timestamptz not null default now(),
  constraint tournaments_window check (ends_at > starts_at and ends_at - starts_at <= interval '6 hours'),
  constraint tournaments_tc check (tc is null or type in ('chess', 'checkers'))
);
create index if not exists tournaments_time_idx on public.tournaments (ends_at desc);

create table if not exists public.tournament_players (
  tournament_id uuid references public.tournaments on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  score int not null default 0,
  games int not null default 0,
  wins int not null default 0,
  streak int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index if not exists tournament_players_rank_idx on public.tournament_players (tournament_id, score desc, wins desc);

alter table public.games drop constraint if exists games_tournament_fk;
alter table public.games add constraint games_tournament_fk foreign key (tournament_id) references public.tournaments on delete set null;

create or replace function public.arena_score(v_g public.games, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_end timestamptz; u uuid;
begin
  select ends_at into v_end from tournaments where id = v_g.tournament_id;
  if v_end is null or v_g.created_at >= v_end or v_g.player_b is null then return; end if;
  foreach u in array array[v_g.player_a, v_g.player_b] loop
    insert into tournament_players (tournament_id, user_id) values (v_g.tournament_id, u) on conflict do nothing;
    update tournament_players set
      score = score + case when p_winner is null then (case when streak >= 2 then 2 else 1 end)
                           when p_winner = u then (case when streak >= 2 then 4 else 2 end) else 0 end,
      wins = wins + coalesce(p_winner = u, false)::int,
      streak = case when p_winner = u then streak + 1 else 0 end,
      games = games + 1
     where tournament_id = v_g.tournament_id and user_id = u;
  end loop;
end $$;

create or replace function public.can_see_tournament(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = p_id and (t.group_id is null or public.can_see_group(t.group_id)));
$$;

create or replace function public.join_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_end timestamptz;
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if not public.can_see_tournament(p_id) then raise exception 'ტურნირი ვერ მოიძებნა'; end if;
  select ends_at into v_end from tournaments where id = p_id;
  if v_end <= now() then raise exception 'ტურნირი დასრულდა'; end if;
  insert into tournament_players (tournament_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.leave_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from tournament_players where tournament_id = p_id and user_id = auth.uid() and games = 0;
end $$;

alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
drop policy if exists "tournaments read" on public.tournaments;
drop policy if exists "tournaments create" on public.tournaments;
drop policy if exists "tournaments delete" on public.tournaments;
create policy "tournaments read" on public.tournaments for select to authenticated
  using (group_id is null or public.can_see_group(group_id));
create policy "tournaments create" on public.tournaments for insert to authenticated
  with check (created_by = auth.uid() and public.can_act() and starts_at > now() - interval '5 minutes'
    and (public.is_staff() or (group_id is not null and public.is_group_admin(group_id))));
create policy "tournaments delete" on public.tournaments for delete to authenticated
  using (public.is_staff() or (created_by = auth.uid() and starts_at > now()));
drop policy if exists "tournament players read" on public.tournament_players;
create policy "tournament players read" on public.tournament_players for select to authenticated
  using (public.can_see_tournament(tournament_id));

revoke execute on function public.svc_take_seat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_take_any_seat(uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_leave_seat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_finish_table(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.arena_score(public.games, uuid) from public, anon, authenticated;
grant execute on function public.svc_take_seat(uuid, uuid) to service_role;
grant execute on function public.svc_take_any_seat(uuid, text) to service_role;
grant execute on function public.svc_leave_seat(uuid, uuid) to service_role;
grant execute on function public.svc_finish_table(uuid, uuid, text, jsonb) to service_role;

do $$ begin
  begin alter publication supabase_realtime add table public.tournament_players; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
-- ტურნირის დაწყება/დასრულება: შეტყობინებები, ადგილები, ტაიმერი (pg_cron)
-- ---------------------------------------------------------------------
alter table public.tournaments add column if not exists start_notified_at timestamptz;
alter table public.tournaments add column if not exists finished_at timestamptz;
alter table public.tournament_players add column if not exists place int;
alter table public.notifications add column if not exists tournament_id uuid references public.tournaments on delete cascade;
alter table public.notifications add column if not exists data jsonb;

-- წუთში ერთხელ (pg_cron) ან ტურნირის გვერდის გახსნისას: აკეთებს მხოლოდ იმას, რისი დროც მოვიდა
create or replace function public.tournament_tick()
returns int language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select * from tournaments where start_notified_at is null and starts_at <= now() and ends_at > now()
           for update skip locked loop
    update tournaments set start_notified_at = now() where id = t.id;
    insert into notifications (user_id, actor_id, type, tournament_id, data)
    select user_id, null, 'tournament_start', t.id, jsonb_build_object('title', t.title, 'game', t.type)
      from tournament_players where tournament_id = t.id;
    n := n + 1;
  end loop;

  for t in select * from tournaments where finished_at is null and ends_at <= now() for update skip locked loop
    update tournaments set finished_at = now(), start_notified_at = coalesce(start_notified_at, now()) where id = t.id;
    with ranked as (
      select user_id, row_number() over (order by score desc, wins desc, joined_at) as place
        from tournament_players where tournament_id = t.id and games > 0)
    update tournament_players tp set place = r.place from ranked r
     where tp.tournament_id = t.id and tp.user_id = r.user_id;
    insert into notifications (user_id, actor_id, type, tournament_id, data)
    select tp.user_id, w.user_id, 'tournament_end', t.id, jsonb_build_object(
             'title', t.title, 'game', t.type, 'place', tp.place, 'score', tp.score,
             'players', (select count(*) from tournament_players x where x.tournament_id = t.id and x.games > 0))
      from tournament_players tp
      left join tournament_players w on w.tournament_id = t.id and w.place = 1
     where tp.tournament_id = t.id and tp.games > 0;
    update games set status = 'cancelled', turn = null, updated_at = now() where tournament_id = t.id and status = 'waiting';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.tournament_tick() from public, anon;
grant execute on function public.tournament_tick() to authenticated, service_role;

-- ტაიმერი: Supabase-ში ჯერ ჩართე Database → Extensions → pg_cron (თუ ეს ბლოკი ვერ ჩართავს)
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron მიუწვდომელია — ჩართე Database → Extensions → pg_cron და ფაილი ხელახლა გაუშვი (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('ezo-tournaments', '* * * * *', 'select public.tournament_tick()');
exception when others then
  raise notice 'ტურნირების ტაიმერი ვერ ჩაირთო: %', sqlerrm;
end $$;

-- =====================================================================
--  v6: სოციალური — დახურული პროფილი, გამოწერის თხოვნები, გამოკითხვები,
--  შენახული პოსტები და კოლექციები, სთორის ჰაილაითები, „ახლო მეგობრები“
-- =====================================================================
create table if not exists public.follow_requests (
  requester_id uuid references public.profiles on delete cascade,
  target_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc);

-- გამოწერა: ღია პროფილზე — მაშინვე, დახურულზე — თხოვნა
create or replace function public.follow_user(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if p_target = auth.uid() then raise exception 'საკუთარ თავს ვერ გამოიწერ'; end if;
  if public.is_blocked(auth.uid(), p_target) then raise exception 'ამ ადამიანს ვერ გამოიწერ'; end if;
  if exists (select 1 from follows where follower_id = auth.uid() and following_id = p_target) then return 'following'; end if;
  if (select count(*) from follows where follower_id = auth.uid() and created_at > now() - interval '1 hour') >= 150 then
    raise exception 'ძალიან ბევრი გამოწერა ცოტა ხანში — სცადე მოგვიანებით';
  end if;
  if public.is_private_profile(p_target) then
    insert into follow_requests (requester_id, target_id) values (auth.uid(), p_target) on conflict do nothing;
    if found then
      insert into notifications (user_id, actor_id, type) values (p_target, auth.uid(), 'follow_request');
    end if;
    return 'requested';
  end if;
  insert into follows (follower_id, following_id) values (auth.uid(), p_target) on conflict do nothing;
  return 'following';
end $$;

create or replace function public.unfollow_user(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from follows where follower_id = auth.uid() and following_id = p_target;
  delete from follow_requests where requester_id = auth.uid() and target_id = p_target;
end $$;

create or replace function public.respond_follow_request(p_requester uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from follow_requests where requester_id = p_requester and target_id = auth.uid();
  if not found then return; end if;
  delete from notifications where user_id = auth.uid() and actor_id = p_requester and type = 'follow_request';
  if p_accept and not public.is_blocked(auth.uid(), p_requester) then
    insert into follows (follower_id, following_id) values (p_requester, auth.uid()) on conflict do nothing;
    insert into notifications (user_id, actor_id, type) values (p_requester, auth.uid(), 'follow_accept');
  end if;
end $$;

-- პროფილის გახსნისას ყველა მოლოდინში მყოფი თხოვნა დასტურდება
create or replace function public.on_profile_privacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_private and not new.is_private then
    insert into follows (follower_id, following_id)
    select requester_id, target_id from follow_requests where target_id = new.id
    on conflict do nothing;
    delete from follow_requests where target_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_privacy on public.profiles;
create trigger profiles_privacy after update of is_private on public.profiles
  for each row execute function public.on_profile_privacy();

-- ---- გამოკითხვები
create table if not exists public.polls (
  post_id uuid primary key references public.posts on delete cascade,
  options jsonb not null,
  multi boolean not null default false,
  closes_at timestamptz not null default now() + interval '1 day',
  constraint polls_options check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  constraint polls_window check (closes_at <= now() + interval '8 days')
);
create table if not exists public.poll_votes (
  post_id uuid references public.polls on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  option int not null check (option between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, option)
);

create or replace function public.before_poll_insert()
returns trigger language plpgsql as $$
declare v text;
begin
  for v in select jsonb_array_elements_text(new.options) loop
    if char_length(btrim(v)) not between 1 and 80 then raise exception 'პასუხი 1–80 სიმბოლო უნდა იყოს'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists polls_validate on public.polls;
create trigger polls_validate before insert or update on public.polls
  for each row execute function public.before_poll_insert();

-- ხმის მიცემა (ძველი ხმა იცვლება). ხმები ანონიმურია: სხვისი ხმები არავის უჩანს.
create or replace function public.vote_poll(p_post uuid, p_options int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_poll polls; v_n int; v_author uuid; v_group uuid;
begin
  select * into v_poll from polls where post_id = p_post;
  if not found then raise exception 'გამოკითხვა ვერ მოიძებნა'; end if;
  select author_id, group_id into v_author, v_group from posts where id = p_post;
  if public.is_blocked(auth.uid(), v_author) or not public.can_see_group(v_group)
     or (v_group is null and not public.can_see_author(v_author)) then raise exception 'გამოკითხვა ვერ მოიძებნა'; end if;
  if v_poll.closes_at <= now() then raise exception 'გამოკითხვა დასრულებულია'; end if;
  v_n := jsonb_array_length(v_poll.options);
  if coalesce(array_length(p_options, 1), 0) = 0 then raise exception 'აირჩიე პასუხი'; end if;
  if not v_poll.multi and array_length(p_options, 1) > 1 then raise exception 'მხოლოდ ერთი პასუხი'; end if;
  if exists (select 1 from unnest(p_options) o where o < 0 or o >= v_n) then raise exception 'ასეთი პასუხი არ არის'; end if;
  delete from poll_votes where post_id = p_post and user_id = auth.uid();
  insert into poll_votes (post_id, user_id, option) select p_post, auth.uid(), o from (select distinct unnest(p_options) o) x;
end $$;

create or replace function public.poll_results(p_posts uuid[])
returns table (post_id uuid, option int, votes bigint, mine boolean)
language sql stable security definer set search_path = public as $$
  select v.post_id, v.option, count(*) as votes, bool_or(v.user_id = auth.uid()) as mine
    from poll_votes v join posts p on p.id = v.post_id
   where v.post_id = any (p_posts)
     and not public.is_blocked(auth.uid(), p.author_id) and public.can_see_group(p.group_id)
     and (p.group_id is not null or public.can_see_author(p.author_id))
   group by v.post_id, v.option;
$$;

-- ---- შენახული პოსტები და კოლექციები
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create table if not exists public.saves (
  user_id uuid references public.profiles on delete cascade,
  post_id uuid references public.posts on delete cascade,
  collection_id uuid references public.collections on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists saves_user_idx on public.saves (user_id, created_at desc);

-- ---- სთორის ჰაილაითები (სთორის ასლი, ამიტომ ორიგინალის წაშლა მათ არ შლის)
create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 30),
  cover_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.highlight_items (
  id uuid primary key default gen_random_uuid(),
  highlight_id uuid not null references public.highlights on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists highlight_items_idx on public.highlight_items (highlight_id, created_at);

-- ჰაილაითი მხოლოდ საკუთარი სთორიებიდან (ახლო მეგობრების სთორი ჰაილაითში არ გადადის)
create or replace function public.create_highlight(p_title text, p_stories uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cover text;
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if coalesce(array_length(p_stories, 1), 0) = 0 then raise exception 'აირჩიე სთორი'; end if;
  select media_url into v_cover from stories where id = p_stories[1] and author_id = auth.uid();
  insert into highlights (owner_id, title, cover_url) values (auth.uid(), btrim(p_title), v_cover) returning id into v_id;
  insert into highlight_items (highlight_id, media_url, media_type, caption, created_at)
  select v_id, s.media_url, s.media_type, s.caption, s.created_at
    from stories s where s.id = any (p_stories) and s.author_id = auth.uid() and s.audience = 'all'
   order by s.created_at;
  if not exists (select 1 from highlight_items where highlight_id = v_id) then
    delete from highlights where id = v_id;
    raise exception 'აირჩიე საჯარო სთორი';
  end if;
  return v_id;
end $$;

-- ---- RLS
alter table public.follow_requests enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.collections enable row level security;
alter table public.saves enable row level security;
alter table public.highlights enable row level security;
alter table public.highlight_items enable row level security;
alter table public.close_friends enable row level security;

drop policy if exists "requests read" on public.follow_requests;
create policy "requests read" on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
drop policy if exists "polls read" on public.polls;
drop policy if exists "polls create" on public.polls;
create policy "polls read" on public.polls for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "polls create" on public.polls for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists "votes own" on public.poll_votes;
create policy "votes own" on public.poll_votes for select to authenticated using (user_id = auth.uid());
drop policy if exists "collections own" on public.collections;
create policy "collections own" on public.collections for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "saves own" on public.saves;
create policy "saves own" on public.saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (collection_id is null
    or exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())));
drop policy if exists "highlights read" on public.highlights;
drop policy if exists "highlights own" on public.highlights;
drop policy if exists "highlights delete" on public.highlights;
create policy "highlights read" on public.highlights for select to authenticated
  using (not public.is_blocked(auth.uid(), owner_id) and public.can_see_author(owner_id));
create policy "highlights own" on public.highlights for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "highlights delete" on public.highlights for delete to authenticated using (owner_id = auth.uid());
drop policy if exists "highlight items read" on public.highlight_items;
drop policy if exists "highlight items delete" on public.highlight_items;
create policy "highlight items read" on public.highlight_items for select to authenticated
  using (exists (select 1 from public.highlights h where h.id = highlight_id));
create policy "highlight items delete" on public.highlight_items for delete to authenticated
  using (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid()));
drop policy if exists "close friends own" on public.close_friends;
create policy "close friends own" on public.close_friends for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke execute on function public.on_profile_privacy() from public, anon, authenticated;

-- =====================================================================
--  v7: ბაზარი — განცხადებები, შენახვა, ნახვები, აწევა, ფასის კლების შეტყობინება
-- =====================================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 3000),
  price numeric(12, 2) check (price is null or (price >= 0 and price <= 99999999)), -- null = შეთანხმებით, 0 = უფასოდ
  currency text not null default 'GEL' check (currency in ('GEL', 'USD')),
  category text not null check (category in ('electronics', 'vehicles', 'realty', 'home', 'fashion', 'kids', 'hobby', 'animals', 'services', 'other')),
  condition text check (condition in ('new', 'used')),
  city text not null default '' check (char_length(city) <= 40),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 8),
  status text not null default 'active' check (status in ('active', 'reserved', 'sold')),
  hidden boolean not null default false,
  views_count int not null default 0,
  saves_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bumped_at timestamptz not null default now()
);
create index if not exists listings_feed_idx on public.listings (status, bumped_at desc);
create index if not exists listings_cat_idx on public.listings (category, status, bumped_at desc);
create index if not exists listings_seller_idx on public.listings (seller_id, created_at desc);

create table if not exists public.listing_saves (
  user_id uuid references public.profiles on delete cascade,
  listing_id uuid references public.listings on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists listing_saves_listing_idx on public.listing_saves (listing_id);

create table if not exists public.listing_views (
  listing_id uuid references public.listings on delete cascade,
  viewer_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_id)
);

create or replace function public.price_text(p_price numeric, p_currency text)
returns text language sql immutable as $$
  select case when p_price is null then 'ფასი შეთანხმებით'
              when p_price = 0 then 'უფასოდ'
              else (case when p_currency = 'USD' then '$' else '' end)
                || replace(to_char(p_price, case when p_price = trunc(p_price) then 'FM999,999,999' else 'FM999,999,990.00' end), ',', ' ')
                || (case when p_currency = 'USD' then '' else ' ₾' end) end;
$$;

-- მომხმარებელი ვერ შეცვლის მთვლელებს, თარიღებს და დამალვას; ლიმიტები სპამის წინააღმდეგ
create or replace function public.listings_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.views_count := 0; new.saves_count := 0; new.hidden := false; new.status := 'active';
      new.created_at := now(); new.bumped_at := now();
      if (select count(*) from listings where seller_id = new.seller_id and created_at > now() - interval '1 day') >= 10 then
        raise exception 'დღეში მაქსიმუმ 10 განცხადების დამატება შეიძლება';
      end if;
      if (select count(*) from listings where seller_id = new.seller_id and status <> 'sold') >= 60 then
        raise exception 'აქტიური განცხადებების ლიმიტი ამოიწურა — ძველები გაყიდულად მონიშნე ან წაშალე';
      end if;
    else
      new.seller_id := old.seller_id; new.views_count := old.views_count; new.saves_count := old.saves_count;
      new.hidden := old.hidden; new.created_at := old.created_at; new.bumped_at := old.bumped_at;
    end if;
  end if;
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.city := btrim(new.city);
  if exists (select 1 from jsonb_array_elements(new.photos) e
              where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 600 or (e #>> '{}') !~ '^https?://') then
    raise exception 'ფოტოს ბმული არასწორია';
  end if;
  if tg_op = 'INSERT' or new is distinct from old then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists listings_guard on public.listings;
create trigger listings_guard before insert or update on public.listings
  for each row execute function public.listings_guard();

-- ფასი დაიკლო → ვინც შეინახა, იმას შეტყობინება (თითო განცხადებაზე 12 საათში ერთხელ)
create or replace function public.on_listing_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and not new.hidden and old.price is not null and new.price is not null
     and new.price < old.price and new.currency = old.currency then
    insert into notifications (user_id, actor_id, type, data)
    select s.user_id, new.seller_id, 'listing_price',
           jsonb_build_object('listing_id', new.id, 'title', new.title, 'price', new.price, 'old_price', old.price,
                              'currency', new.currency, 'photo', new.photos ->> 0)
      from listing_saves s
     where s.listing_id = new.id and s.user_id <> new.seller_id
       and not public.is_blocked(s.user_id, new.seller_id)
       and not exists (select 1 from notifications n where n.user_id = s.user_id and n.type = 'listing_price'
                         and n.data ->> 'listing_id' = new.id::text and n.created_at > now() - interval '12 hours');
  end if;
  return new;
end $$;
drop trigger if exists listings_after_update on public.listings;
create trigger listings_after_update after update of price on public.listings
  for each row execute function public.on_listing_change();

create or replace function public.on_listing_save()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update listings set saves_count = saves_count + 1 where id = new.listing_id;
  else update listings set saves_count = greatest(saves_count - 1, 0) where id = old.listing_id; end if;
  return null;
end $$;
drop trigger if exists listing_saves_count on public.listing_saves;
create trigger listing_saves_count after insert or delete on public.listing_saves
  for each row execute function public.on_listing_save();

-- ნახვა: ერთი ადამიანი = ერთი ნახვა, საკუთარი არ ითვლება
create or replace function public.view_listing(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into listing_views (listing_id, viewer_id)
  select l.id, auth.uid() from listings l
   where l.id = p_id and l.seller_id <> auth.uid() and not l.hidden and not public.is_blocked(auth.uid(), l.seller_id)
  on conflict do nothing;
  if found then update listings set views_count = views_count + 1 where id = p_id; end if;
end $$;

-- აწევა სიის თავში: დღეში ერთხელ
create or replace function public.bump_listing(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v listings;
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  select * into v from listings where id = p_id and seller_id = auth.uid();
  if not found then raise exception 'განცხადება ვერ მოიძებნა'; end if;
  if v.status <> 'active' or v.hidden then raise exception 'მხოლოდ აქტიურ განცხადებას აწევ'; end if;
  if v.bumped_at > now() - interval '24 hours' then raise exception 'აწევა დღეში ერთხელ შეიძლება'; end if;
  update listings set bumped_at = now() where id = p_id;
  return now();
end $$;

-- გამყიდველის სანდოობა: აქტიური და გაყიდული განცხადებები, ეზოზე რამდენი ხანია
create or replace function public.seller_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active', (select count(*) from listings where seller_id = p_user and status <> 'sold' and not hidden),
    'sold', (select count(*) from listings where seller_id = p_user and status = 'sold'),
    'since', (select created_at from profiles where id = p_user));
$$;

-- ---- RLS
alter table public.listings enable row level security;
alter table public.listing_saves enable row level security;
alter table public.listing_views enable row level security;

drop policy if exists "listings read" on public.listings;
drop policy if exists "listings create" on public.listings;
drop policy if exists "listings update own" on public.listings;
drop policy if exists "listings delete" on public.listings;
-- დამალული და დაბლოკილი გამყიდველის განცხადებებს მხოლოდ თვითონ და მოდერატორი ხედავს
create policy "listings read" on public.listings for select to authenticated using (
  seller_id = auth.uid() or public.is_staff()
  or (not hidden and not public.is_blocked(auth.uid(), seller_id)
      and not exists (select 1 from public.profiles p where p.id = seller_id and p.banned_until > now())));
create policy "listings create" on public.listings for insert to authenticated
  with check (seller_id = auth.uid() and public.can_act());
create policy "listings update own" on public.listings for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid() and public.can_act());
create policy "listings delete" on public.listings for delete to authenticated
  using (seller_id = auth.uid() or public.is_staff());

drop policy if exists "listing saves own" on public.listing_saves;
create policy "listing saves own" on public.listing_saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id <> auth.uid()));
-- listing_views: პოლიტიკა არ აქვს — მხოლოდ view_listing()-ით

revoke execute on function public.listings_guard() from public, anon, authenticated;
revoke execute on function public.on_listing_change() from public, anon, authenticated;
revoke execute on function public.on_listing_save() from public, anon, authenticated;

-- =====================================================================
--  v8: ქულები და მიღწევები — XP, დონეები, დღიური სერია, „ბროწეული“ (შიდა ვალუტა, ფულით არ იყიდება), ბეჯები
-- =====================================================================
create table if not exists public.progress (
  user_id uuid primary key references public.profiles on delete cascade,
  xp int not null default 0 check (xp >= 0),
  coins int not null default 0 check (coins >= 0),
  streak int not null default 0,
  best_streak int not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);

create table if not exists public.progress_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  xp int not null default 0,
  coins int not null default 0,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists progress_events_user_idx on public.progress_events (user_id, kind, created_at desc);
create index if not exists progress_events_week_idx on public.progress_events (created_at, user_id) where xp > 0;

-- ბეჯების კატალოგი (სათაურები Push-ისთვის; აღწერა და იკონი — კლიენტში, src/lib/rewards.js)
create table if not exists public.badges (
  key text primary key,
  metric text not null,
  target int not null,
  coins int not null,
  title text not null,
  sort int not null default 0
);
insert into public.badges (key, metric, target, coins, title, sort) values
  ('first_post', 'posts', 1, 10, 'პირველი სიტყვა', 1),
  ('posts_50', 'posts', 50, 50, 'მთხრობელი', 2),
  ('likes_100', 'likes', 100, 40, 'მოსაწონი', 3),
  ('likes_1000', 'likes', 1000, 150, 'ეზოს ვარსკვლავი', 4),
  ('followers_50', 'followers', 50, 50, 'ცნობადი სახე', 5),
  ('streak_7', 'streak', 7, 30, 'ერთი კვირა', 6),
  ('streak_30', 'streak', 30, 150, 'ერთგული', 7),
  ('games_10', 'games', 10, 20, 'მოთამაშე', 8),
  ('wins_50', 'wins', 50, 100, 'ოსტატი', 9),
  ('champion', 'tourney', 1, 100, 'ჩემპიონი', 10),
  ('first_sale', 'sales', 1, 20, 'ვაჭარი', 11),
  ('generous', 'gifts', 10, 30, 'გულუხვი', 12),
  ('level_10', 'level', 10, 100, 'ეზოს ძველი', 13)
on conflict (key) do update set metric = excluded.metric, target = excluded.target, coins = excluded.coins, title = excluded.title, sort = excluded.sort;

create table if not exists public.user_badges (
  user_id uuid references public.profiles on delete cascade,
  badge text references public.badges on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);

-- დონე n იწყება 50·n·(n−1) XP-დან: 2 → 100, 3 → 300, 5 → 1000, 10 → 4500
create or replace function public.level_of(p_xp int)
returns int language sql immutable as $$
  select greatest(1, floor((1 + sqrt(1 + 0.08 * greatest(p_xp, 0))) / 2)::int);
$$;
create or replace function public.tbilisi_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Tbilisi')::date; $$;
create or replace function public.tbilisi_day_start()
returns timestamptz language sql stable as $$ select (public.tbilisi_today()::timestamp at time zone 'Asia/Tbilisi'); $$;

create or replace function public.badge_metrics(p_user uuid, p_metric text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m jsonb := '{}'::jsonb;
begin
  if p_metric is null or p_metric = 'posts' then
    m := m || jsonb_build_object('posts', (select count(*) from posts where author_id = p_user and parent_id is null)); end if;
  if p_metric is null or p_metric = 'likes' then
    m := m || jsonb_build_object('likes', (select coalesce(sum(like_count), 0) from posts where author_id = p_user)); end if;
  if p_metric is null or p_metric = 'followers' then
    m := m || jsonb_build_object('followers', (select followers_count from profiles where id = p_user)); end if;
  if p_metric is null or p_metric = 'streak' then
    m := m || jsonb_build_object('streak', (select coalesce(max(best_streak), 0) from progress where user_id = p_user)); end if;
  if p_metric is null or p_metric in ('games', 'wins') then
    m := m || (select jsonb_build_object('games', coalesce(sum(wins + losses + draws), 0), 'wins', coalesce(sum(wins), 0)) from game_stats where user_id = p_user); end if;
  if p_metric is null or p_metric = 'tourney' then
    m := m || jsonb_build_object('tourney', (select count(*) from tournament_players where user_id = p_user and place = 1)); end if;
  if p_metric is null or p_metric = 'sales' then
    m := m || jsonb_build_object('sales', (select count(*) from progress_events where user_id = p_user and kind = 'sale')); end if;
  if p_metric is null or p_metric = 'gifts' then
    m := m || jsonb_build_object('gifts', (select count(*) from gifts where from_id = p_user)); end if;
  if p_metric is null or p_metric = 'level' then
    m := m || jsonb_build_object('level', (select public.level_of(coalesce(max(xp), 0)) from progress where user_id = p_user)); end if;
  return m;
end $$;

-- ქულის დარიცხვა: p_ref — ერთხელ თითო სამიზნეზე, p_cap — დღიური ლიმიტი ამ ტიპზე (თბილისის დროით)
create or replace function public.award(p_user uuid, p_kind text, p_xp int, p_coins int, p_ref text default null, p_cap int default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_old int; v_new int; v_lvl int;
begin
  if p_user is null then return false; end if;
  if p_ref is not null and exists (select 1 from progress_events where user_id = p_user and kind = p_kind and ref = p_ref) then return false; end if;
  if p_cap is not null and (select count(*) from progress_events where user_id = p_user and kind = p_kind
                              and created_at >= public.tbilisi_day_start()) >= p_cap then return false; end if;
  insert into progress (user_id) values (p_user) on conflict do nothing;
  update progress set xp = xp + p_xp, coins = coins + p_coins, updated_at = now()
   where user_id = p_user returning xp - p_xp, xp into v_old, v_new;
  insert into progress_events (user_id, kind, xp, coins, ref) values (p_user, p_kind, p_xp, p_coins, p_ref);
  v_lvl := public.level_of(v_new);
  if v_lvl > public.level_of(v_old) then
    perform public.award(p_user, 'level', 0, v_lvl * 5, v_lvl::text);
    insert into notifications (user_id, type, data) values (p_user, 'level_up', jsonb_build_object('level', v_lvl, 'coins', v_lvl * 5));
    perform public.check_badges(p_user, 'level');
  end if;
  return true;
end $$;

create or replace function public.spend_coins(p_user uuid, p_amount int, p_kind text, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  update progress set coins = coins - p_amount, updated_at = now() where user_id = p_user and coins >= p_amount;
  if not found then raise exception 'ბროწეული არ გყოფნის'; end if;
  insert into progress_events (user_id, kind, xp, coins, ref) values (p_user, p_kind, 0, -p_amount, p_ref);
end $$;

create or replace function public.check_badges(p_user uuid, p_metric text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m jsonb; b record;
begin
  if p_user is null then return; end if;
  m := public.badge_metrics(p_user, p_metric);
  for b in select * from badges x
            where (p_metric is null or x.metric = p_metric)
              and coalesce((m ->> x.metric)::int, 0) >= x.target
              and not exists (select 1 from user_badges u where u.user_id = p_user and u.badge = x.key)
            order by x.sort loop
    insert into user_badges (user_id, badge) values (p_user, b.key) on conflict do nothing;
    if found then
      perform public.award(p_user, 'badge', 0, b.coins, b.key);
      insert into notifications (user_id, type, data) values (p_user, 'achievement', jsonb_build_object('badge', b.key, 'coins', b.coins));
    end if;
  end loop;
end $$;

-- დღიური შესვლა: სერია, ბროწეული (5 → 15, ყოველ მე-7 დღეს +25), პირველად — მისასალმებელი 25
create or replace function public.daily_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v progress; v_today date := public.tbilisi_today(); v_streak int; v_reward int; v_first boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into progress (user_id) values (auth.uid()) on conflict do nothing;
  select * into v from progress where user_id = auth.uid() for update;
  if v.last_day = v_today or not public.can_act() then
    return jsonb_build_object('claimed', false, 'streak', v.streak, 'coins', v.coins, 'xp', v.xp, 'level', public.level_of(v.xp));
  end if;
  v_first := v.last_day is null;
  v_streak := case when v.last_day = v_today - 1 then v.streak + 1 else 1 end;
  v_reward := 5 + 2 * least(v_streak - 1, 5) + case when v_streak % 7 = 0 then 25 else 0 end;
  update progress set streak = v_streak, best_streak = greatest(best_streak, v_streak), last_day = v_today where user_id = auth.uid();
  perform public.award(auth.uid(), 'checkin', 10, v_reward, v_today::text);
  if v_first then perform public.award(auth.uid(), 'welcome', 0, 25, 'welcome'); end if;
  perform public.check_badges(auth.uid(), case when v_first then null else 'streak' end);
  select * into v from progress where user_id = auth.uid();
  return jsonb_build_object('claimed', true, 'first', v_first, 'streak', v_streak, 'reward', v_reward + case when v_first then 25 else 0 end,
                            'coins', v.coins, 'xp', v.xp, 'level', public.level_of(v.xp));
end $$;

create or replace function public.my_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v progress;
begin
  select * into v from progress where user_id = auth.uid();
  return jsonb_build_object('xp', coalesce(v.xp, 0), 'coins', coalesce(v.coins, 0), 'streak',
      case when v.last_day >= public.tbilisi_today() - 1 then v.streak else 0 end,
    'best_streak', coalesce(v.best_streak, 0), 'last_day', v.last_day, 'level', public.level_of(coalesce(v.xp, 0)),
    'claimed_today', coalesce(v.last_day = public.tbilisi_today(), false), 'metrics', public.badge_metrics(auth.uid()));
end $$;

-- სხვისი პროფილისთვის: დონე, სერია, ბეჯები (ბროწეულის ბალანსი პირადია)
create or replace function public.profile_progress(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', public.level_of(coalesce((select xp from progress where user_id = p_user), 0)),
    'xp', coalesce((select xp from progress where user_id = p_user), 0),
    'streak', coalesce((select streak from progress where user_id = p_user and last_day >= public.tbilisi_today() - 1), 0),
    'badges', coalesce((select jsonb_agg(badge order by earned_at) from user_badges where user_id = p_user), '[]'::jsonb))
  where not public.is_blocked(auth.uid(), p_user);
$$;

-- კვირის ლიდერები: 'friends' — ვისაც გამოვიწერ + მე; 'all' — ყველა
create or replace function public.xp_leaderboard(p_scope text default 'friends')
returns table (user_id uuid, username text, full_name text, avatar_url text, week_xp bigint, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.full_name, p.avatar_url, sum(e.xp)::bigint, public.level_of(coalesce(pr.xp, 0))
    from progress_events e
    join profiles p on p.id = e.user_id
    left join progress pr on pr.user_id = p.id
   where e.xp > 0
     and e.created_at >= (date_trunc('week', now() at time zone 'Asia/Tbilisi') at time zone 'Asia/Tbilisi')
     and (p.banned_until is null or p.banned_until < now())
     and not public.is_blocked(auth.uid(), p.id)
     and (p_scope = 'all' or p.id = auth.uid() or exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = p.id))
   group by p.id, pr.xp
   order by 5 desc, p.username
   limit 50;
$$;

-- ---- ქულები მოქმედებებზე
create or replace function public.progress_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is null then
    perform public.award(new.author_id, 'post', 5, 0, null, 10);
    perform public.check_badges(new.author_id, 'posts');
  else
    perform public.award(new.author_id, 'reply', 2, 0, null, 20);
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_posts on public.posts;
create trigger zz_progress_posts after insert on public.posts for each row execute function public.progress_on_post();

create or replace function public.progress_on_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author_id into v_author from posts where id = new.post_id;
  if v_author is not null and v_author <> new.user_id then
    perform public.award(v_author, 'like', 1, 0, null, 50);
    perform public.check_badges(v_author, 'likes');
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_likes on public.likes;
create trigger zz_progress_likes after insert on public.likes for each row execute function public.progress_on_like();

create or replace function public.progress_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award(new.following_id, 'follower', 3, 0, new.follower_id::text, 20);
  perform public.check_badges(new.following_id, 'followers');
  return null;
end $$;
drop trigger if exists zz_progress_follows on public.follows;
create trigger zz_progress_follows after insert on public.follows for each row execute function public.progress_on_follow();

-- თამაში: მონაწილეობა +5 XP, მოგება +10 XP და 3 ბროწეული (მინიმუმ 4 სვლა, დღიური ლიმიტით)
create or replace function public.progress_on_game()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; s text;
begin
  if new.status = 'finished' and old.status = 'active' and new.move_no >= 4 then
    foreach s in array array['a', 'b', 'c', 'd'] loop
      u := case s when 'a' then new.player_a when 'b' then new.player_b when 'c' then new.player_c else new.player_d end;
      continue when u is null or s = any (new.bots);
      perform public.award(u, 'game', 5, 0, new.id::text, 30);
      if new.winner = u then perform public.award(u, 'win', 10, 3, new.id::text, 10); end if;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_games on public.games;
create trigger zz_progress_games after update of status on public.games for each row execute function public.progress_on_game();
-- ბეჯები სტატისტიკის განახლების შემდეგ (რეიტინგი თამაშის დასრულების შემდეგ ითვლება)
create or replace function public.progress_on_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.check_badges(new.user_id, 'games');
  perform public.check_badges(new.user_id, 'wins');
  return null;
end $$;
drop trigger if exists zz_progress_stats on public.game_stats;
create trigger zz_progress_stats after update on public.game_stats for each row execute function public.progress_on_stats();

-- ტურნირის პრიზები: 50 / 30 / 20 ბროწეული
create or replace function public.progress_on_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.place between 1 and 3 and old.place is distinct from new.place and new.games > 0 then
    perform public.award(new.user_id, 'tournament', (4 - new.place) * 15, case new.place when 1 then 50 when 2 then 30 else 20 end, new.tournament_id::text);
    if new.place = 1 then perform public.check_badges(new.user_id, 'tourney'); end if;
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_places on public.tournament_players;
create trigger zz_progress_places after update of place on public.tournament_players for each row execute function public.progress_on_place();

create or replace function public.progress_on_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sold' and old.status <> 'sold' then
    perform public.award(new.seller_id, 'sale', 10, 5, new.id::text);
    perform public.check_badges(new.seller_id, 'sales');
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_sales on public.listings;
create trigger zz_progress_sales after update of status on public.listings for each row execute function public.progress_on_sale();

-- საჩუქრები: ბროწეული და გული უფასოა (დღეში 5), დანარჩენი ბროწეულით
alter table public.gifts drop constraint if exists gifts_kind_check;
alter table public.gifts add constraint gifts_kind_check check (kind in ('pomegranate', 'churchkhela', 'khachapuri', 'wine', 'rose', 'heart', 'star', 'dice', 'qvevri', 'crown'));
create or replace function public.gift_price(p_kind text)
returns int language sql immutable as $$
  select case p_kind when 'churchkhela' then 10 when 'khachapuri' then 15 when 'rose' then 20 when 'wine' then 25
                     when 'dice' then 30 when 'star' then 40 when 'qvevri' then 60 when 'crown' then 100 else 0 end;
$$;
create or replace function public.before_gift()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_price int := public.gift_price(new.kind);
begin
  if v_price = 0 then
    if (select count(*) from gifts where from_id = new.from_id and created_at > now() - interval '1 day' and public.gift_price(kind) = 0) >= 5 then
      raise exception 'უფასო საჩუქარი დღეში 5-ჯერ შეიძლება — სხვები ბროწეულით იგზავნება';
    end if;
  else
    perform public.spend_coins(new.from_id, v_price, 'gift', new.kind);
  end if;
  return new;
end $$;
drop trigger if exists gifts_before_insert on public.gifts;
create trigger gifts_before_insert before insert on public.gifts for each row execute function public.before_gift();
create or replace function public.progress_on_gift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award(new.to_id, 'gift_received', 5, 0, null, 10);
  perform public.check_badges(new.from_id, 'gifts');
  return null;
end $$;
drop trigger if exists zz_progress_gifts on public.gifts;
create trigger zz_progress_gifts after insert on public.gifts for each row execute function public.progress_on_gift();

-- ---- RLS: ბალანსი და ისტორია მხოლოდ საკუთარი; ცვლილება მხოლოდ ფუნქციებით
alter table public.progress enable row level security;
alter table public.progress_events enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
drop policy if exists "progress own" on public.progress;
create policy "progress own" on public.progress for select to authenticated using (user_id = auth.uid());
drop policy if exists "progress events own" on public.progress_events;
create policy "progress events own" on public.progress_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "badges read" on public.badges;
create policy "badges read" on public.badges for select to authenticated using (true);
drop policy if exists "user badges read" on public.user_badges;
create policy "user badges read" on public.user_badges for select to authenticated using (not public.is_blocked(auth.uid(), user_id));

revoke execute on function public.award(uuid, text, int, int, text, int) from public, anon, authenticated;
revoke execute on function public.spend_coins(uuid, int, text, text) from public, anon, authenticated;
revoke execute on function public.check_badges(uuid, text) from public, anon, authenticated;
revoke execute on function public.badge_metrics(uuid, text) from public, anon, authenticated;
revoke execute on function public.progress_on_post() from public, anon, authenticated;
revoke execute on function public.progress_on_like() from public, anon, authenticated;
revoke execute on function public.progress_on_follow() from public, anon, authenticated;
revoke execute on function public.progress_on_game() from public, anon, authenticated;
revoke execute on function public.progress_on_place() from public, anon, authenticated;
revoke execute on function public.progress_on_stats() from public, anon, authenticated;
revoke execute on function public.progress_on_sale() from public, anon, authenticated;
revoke execute on function public.progress_on_gift() from public, anon, authenticated;
revoke execute on function public.before_gift() from public, anon, authenticated;

-- =====================================================================
--  v9: თამაშები 2.0 — ბურა, ლოტო, დღის ამოცანა, ყურება, რეაქციები და ჩატი თამაშისას
-- =====================================================================
-- ბურა ტურნირებშიც (ლოტო — მხოლოდ მაგიდა)
alter table public.tournaments drop constraint if exists tournaments_type_check;
alter table public.tournaments add constraint tournaments_type_check
  check (type in ('nardi', 'longnardi', 'chess', 'checkers', 'domino', 'durak', 'bura'));
create index if not exists games_live_idx on public.games (updated_at desc) where status = 'active' and is_public;

-- ---- დღის ჭადრაკის ამოცანა (ამონახსნი კლიენტს არ ეგზავნება — სვლებს სერვერი ამოწმებს)
create table if not exists public.chess_puzzles (
  id int primary key,
  title text not null,
  fen text not null,
  solution text[] not null
);
insert into public.chess_puzzles (id, title, fen, solution) values
  (1, 'უკანა რიგი', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', array['d1d8']),
  (2, 'სკოლის მატი', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', array['f3f7']),
  (3, 'ფილიდორის მემკვიდრეობა', 'r6k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1', array['b3g8', 'a8g8', 'h6f7']),
  (4, 'უსწრაფესი მატი', 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', array['d8h4']),
  (5, 'არაბული მატი', '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1', array['a7h7']),
  (6, 'ჩახრჩობილი მეფე', '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', array['g5f7']),
  (7, 'შავების ჯერია: უკანა რიგი', '3r2k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', array['d8d1']),
  (8, 'ეპოლეტები', '3rkr2/8/8/8/2Q5/8/8/4K3 w - - 0 1', array['c4e6']),
  (9, 'დერეფანი', '6k1/5ppp/8/8/8/8/8/K3Q3 w - - 0 1', array['e1e8']),
  (10, 'ფილიდორი შავებით', '6k1/6pp/1q6/8/8/7n/6PP/R6K b - - 0 1', array['b6g1', 'a1g1', 'h3f2']),
  (11, 'მეფე და ეტლი', 'k7/8/1K6/8/8/8/8/7R w - - 0 1', array['h1h8']),
  (12, 'ცხენის ხაფანგი', '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', array['d3f2']),
  (13, 'ოპოზიცია', '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', array['a1a8']),
  (14, 'სკოლის მატი, მეორე ვარიანტი', 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', array['f3f7'])
on conflict (id) do update set title = excluded.title, fen = excluded.fen, solution = excluded.solution;

create table if not exists public.puzzle_solves (
  user_id uuid references public.profiles on delete cascade,
  day date not null,
  puzzle_id int not null references public.chess_puzzles,
  solved boolean not null default false,
  attempts int not null default 0,
  solved_at timestamptz,
  primary key (user_id, day)
);

create or replace function public.puzzle_of_day(p_day date)
returns public.chess_puzzles language sql stable security definer set search_path = public as $$
  select * from public.chess_puzzles
   where id = (((p_day - date '2026-01-01') % (select count(*) from public.chess_puzzles)::int
               + (select count(*) from public.chess_puzzles)::int) % (select count(*) from public.chess_puzzles)::int) + 1;
$$;

create or replace function public.daily_puzzle()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_day date := public.tbilisi_today(); p chess_puzzles; r puzzle_solves;
begin
  p := public.puzzle_of_day(v_day);
  select * into r from puzzle_solves where user_id = auth.uid() and day = v_day;
  return jsonb_build_object('day', v_day, 'id', p.id, 'title', p.title, 'fen', p.fen,
    'moves', ceil(array_length(p.solution, 1) / 2.0)::int,
    'solved', coalesce(r.solved, false), 'attempts', coalesce(r.attempts, 0),
    'solution', case when r.solved then to_jsonb(p.solution) end,
    'solvers', (select count(*) from puzzle_solves where day = v_day and solved));
end $$;

-- p_moves: მთელი თანმიმდევრობა ამ მომენტამდე (ჩემი სვლები და პასუხები), ბოლო — ჩემი ახალი სვლა
create or replace function public.puzzle_move(p_moves text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day date := public.tbilisi_today(); p chess_puzzles; n int := coalesce(array_length(p_moves, 1), 0); v_len int; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  p := public.puzzle_of_day(v_day);
  v_len := array_length(p.solution, 1);
  if n = 0 or n % 2 = 0 or n > v_len then raise exception 'არასწორი სვლა'; end if;
  v_ok := p_moves = p.solution[1:n];
  insert into puzzle_solves (user_id, day, puzzle_id) values (auth.uid(), v_day, p.id) on conflict do nothing;
  if not v_ok then
    update puzzle_solves set attempts = attempts + 1 where user_id = auth.uid() and day = v_day and not solved;
    return jsonb_build_object('correct', false);
  end if;
  if n = v_len then
    update puzzle_solves set solved = true, solved_at = now(), attempts = attempts + 1
     where user_id = auth.uid() and day = v_day and not solved;
    if found then perform public.award(auth.uid(), 'puzzle', 15, 5, v_day::text); end if;
    return jsonb_build_object('correct', true, 'solved', true,
      'attempts', (select attempts from puzzle_solves where user_id = auth.uid() and day = v_day),
      'solvers', (select count(*) from puzzle_solves where day = v_day and solved));
  end if;
  return jsonb_build_object('correct', true, 'solved', false, 'reply', p.solution[n + 1]);
end $$;

-- ---- რეაქციები და ჩატი თამაშისას
create table if not exists public.game_messages (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('emoji', 'text')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists game_messages_game_idx on public.game_messages (game_id, created_at desc);

create or replace function public.is_game_player(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g where g.id = p_game
    and auth.uid() in (g.player_a, g.player_b, g.player_c, g.player_d));
$$;

-- სპამის წინააღმდეგ: 10 წამში მაქსიმუმ 8 მესიჯი
create or replace function public.before_game_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from game_messages where user_id = new.user_id and game_id = new.game_id and created_at > now() - interval '10 seconds') >= 8 then
    raise exception 'ცოტა ნელა — ძალიან ხშირად წერ';
  end if;
  new.body := btrim(new.body);
  return new;
end $$;
drop trigger if exists game_messages_before on public.game_messages;
create trigger game_messages_before before insert on public.game_messages for each row execute function public.before_game_message();

alter table public.chess_puzzles enable row level security;
alter table public.puzzle_solves enable row level security;
alter table public.game_messages enable row level security;
-- ამოცანების ცხრილს პოლიტიკა არ აქვს: ამონახსნი მხოლოდ ფუნქციებით
drop policy if exists "puzzle solves own" on public.puzzle_solves;
create policy "puzzle solves own" on public.puzzle_solves for select to authenticated using (user_id = auth.uid());
drop policy if exists "game messages read" on public.game_messages;
drop policy if exists "game messages send" on public.game_messages;
create policy "game messages read" on public.game_messages for select to authenticated
  using (not public.is_blocked(auth.uid(), user_id));
-- რეაქცია — ყველას (მაყურებელსაც), ტექსტი — მხოლოდ მოთამაშეებს
create policy "game messages send" on public.game_messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_act()
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'active')
    and ((kind = 'emoji' and body in ('👍', '😂', '😮', '🔥', '😡', '🎉', '🤝', '😢'))
         or (kind = 'text' and public.is_game_player(game_id))));

do $$ begin
  begin alter publication supabase_realtime add table public.game_messages; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

revoke execute on function public.before_game_message() from public, anon, authenticated;
revoke execute on function public.puzzle_of_day(date) from public, anon, authenticated;

-- =====================================================================
--  v10: გაზიარება (OG, მოწვევა), უსაფრთხოება (2FA, ლიმიტები, აკრძალული სიტყვები), ანგარიშის წაშლა და ექსპორტი
-- =====================================================================
-- განცხადების ყდის პატარა ასლი (ბადისთვის)
alter table public.listings add column if not exists thumb text check (thumb is null or (thumb ~ '^https?://' and char_length(thumb) <= 600));
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists follows_follower_time_idx on public.follows (follower_id, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists profiles_invited_idx on public.profiles (invited_by) where invited_by is not null;

-- ---- ბმულის „ბარათი“ Facebook/Messenger-ისთვის (anon-საც შეუძლია; მხოლოდ საჯარო შიგთავსი)
create or replace function public.og_preview(p_kind text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_id uuid;
begin
  if p_kind in ('p', 'm', 'e', 't') then
    begin v_id := p_key::uuid; exception when others then return null; end;
  end if;
  if p_kind = 'p' then
    select jsonb_build_object('title', coalesce(nullif(a.full_name, ''), a.username) || ' ეზოში',
             'description', left(regexp_replace(p.body, '\s+', ' ', 'g'), 200), 'image', p.media -> 0 ->> 'url')
      into r from posts p join profiles a on a.id = p.author_id
     where p.id = v_id and not p.hidden and p.group_id is null and not a.is_private
       and (a.banned_until is null or a.banned_until < now());
  elsif p_kind in ('u', 'i') then
    select jsonb_build_object(
             'title', case when p_kind = 'i' then coalesce(nullif(full_name, ''), username) || ' გეპატიჟება ეზოში'
                           else coalesce(nullif(full_name, ''), username) || ' (@' || username || ')' end,
             'description', case when p_kind = 'i' then 'შემოგვიერთდი: მეგობრები, ვიდეოები, ბაზარი და ნარდი ერთ ადგილას.'
                                 when is_private then 'დახურული პროფილი ეზოში' else coalesce(nullif(bio, ''), 'პროფილი ეზოში') end,
             'image', avatar_url, 'name', coalesce(nullif(full_name, ''), username), 'username', username)
      into r from profiles where username = lower(p_key) and onboarded and (banned_until is null or banned_until < now());
  elsif p_kind = 'm' then
    select jsonb_build_object('title', l.title || ' — ' || public.price_text(l.price, l.currency),
             'description', coalesce(nullif(left(l.description, 200), ''), l.city), 'image', l.photos ->> 0)
      into r from listings l join profiles s on s.id = l.seller_id
     where l.id = v_id and not l.hidden and (s.banned_until is null or s.banned_until < now());
  elsif p_kind = 'e' then
    select jsonb_build_object('title', e.title, 'description', left(coalesce(nullif(e.description, ''), e.place, ''), 200), 'image', e.cover_url)
      into r from events e left join groups g on g.id = e.group_id
     where e.id = v_id and (e.group_id is null or g.privacy = 'public');
  elsif p_kind = 't' then
    select jsonb_build_object('title', t.title, 'description', public.game_title(t.type) || ' — არენა ტურნირი ეზოში', 'image', null)
      into r from tournaments t where t.id = v_id and t.group_id is null;
  end if;
  return r;
end $$;
grant execute on function public.og_preview(text, text) to anon, authenticated;

-- ---- მოწვევა: ახალი მომხმარებელი (7 დღემდე) ერთხელ იღებს; ორივე ერთმანეთს იწერს, ორივე იღებს ბროწეულს
create or replace function public.claim_invite(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv profiles; v_me profiles;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'not signed in'; end if;
  select * into v_inv from profiles where username = lower(btrim(p_username));
  if v_inv.id is null or v_inv.id = v_me.id or not v_inv.onboarded then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_me.invited_by is not null or v_me.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'reason', 'old'); end if;
  if public.is_blocked(v_me.id, v_inv.id) then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  update profiles set invited_by = v_inv.id where id = v_me.id;
  perform public.follow_user(v_inv.id);
  insert into follows (follower_id, following_id) values (v_inv.id, v_me.id) on conflict do nothing;
  perform public.award(v_inv.id, 'invite', 10, 20, v_me.id::text);
  perform public.award(v_me.id, 'invited', 0, 10, 'invited');
  insert into notifications (user_id, actor_id, type) values (v_inv.id, v_me.id, 'invite_joined');
  return jsonb_build_object('ok', true, 'inviter', v_inv.username);
end $$;

create or replace function public.invite_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('count', (select count(*) from profiles where invited_by = auth.uid()),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username, 'full_name', full_name, 'avatar_url', avatar_url) order by created_at desc)
                          from (select * from profiles where invited_by = auth.uid() order by created_at desc limit 12) x), '[]'::jsonb));
$$;

-- ---- სპამის ლიმიტები (პირდაპირი ჩანაწერებისთვის; სერვერული ფუნქციები თავისით ამოწმებს)
-- მხოლოდ საკუთარი ჩანაწერები ითვლება (auth.uid())
drop function if exists public.rate_count(text, uuid, timestamptz);
create or replace function public.rate_count(p_table text, p_since timestamptz)
returns int language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  return case p_table
    when 'posts' then (select count(*) from posts where author_id = u and created_at > p_since)
    when 'messages' then (select count(*) from messages where sender_id = u and created_at > p_since)
    when 'reports' then (select count(*) from reports where reporter_id = u and created_at > p_since)
    when 'stories' then (select count(*) from stories where author_id = u and created_at > p_since)
    else 0 end;
end $$;

create or replace function public.rate_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_max int; v_win interval;
begin
  if current_user not in ('authenticated', 'anon') or public.is_staff() then return new; end if;
  case tg_table_name
    when 'posts' then v_max := 20; v_win := interval '10 minutes';
    when 'messages' then v_max := 40; v_win := interval '1 minute';
    when 'reports' then v_max := 20; v_win := interval '1 day';
    when 'stories' then v_max := 30; v_win := interval '1 day';
    else return new;
  end case;
  if public.rate_count(tg_table_name, now() - v_win) >= v_max then
    raise exception 'ძალიან ხშირად — სცადე ცოტა ხანში';
  end if;
  return new;
end $$;
drop trigger if exists rate_guard on public.posts;
create trigger rate_guard before insert on public.posts for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.messages;
create trigger rate_guard before insert on public.messages for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.reports;
create trigger rate_guard before insert on public.reports for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.stories;
create trigger rate_guard before insert on public.stories for each row execute function public.rate_guard();

-- ---- აკრძალული სიტყვები (მოდერატორი მართავს)
create table if not exists public.banned_words (
  word text primary key check (char_length(word) between 2 and 60 and word = lower(word)),
  created_at timestamptz not null default now()
);
create or replace function public.has_banned(p_text text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from banned_words w where position(w.word in lower(coalesce(p_text, ''))) > 0);
$$;
create or replace function public.words_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_text text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  case tg_table_name
    when 'posts' then v_text := new.body;
    when 'messages' then v_text := new.body;
    when 'game_messages' then v_text := new.body;
    when 'listings' then v_text := new.title || ' ' || new.description;
    when 'profiles' then v_text := new.username || ' ' || new.full_name || ' ' || new.bio;
    else return new;
  end case;
  if public.has_banned(v_text) then raise exception 'ტექსტი შეიცავს აკრძალულ სიტყვას'; end if;
  return new;
end $$;
drop trigger if exists words_guard on public.posts;
create trigger words_guard before insert or update of body on public.posts for each row execute function public.words_guard();
drop trigger if exists words_guard on public.messages;
create trigger words_guard before insert on public.messages for each row execute function public.words_guard();
drop trigger if exists words_guard on public.game_messages;
create trigger words_guard before insert on public.game_messages for each row execute function public.words_guard();
drop trigger if exists words_guard on public.listings;
create trigger words_guard before insert or update of title, description on public.listings for each row execute function public.words_guard();
drop trigger if exists words_guard on public.profiles;
create trigger words_guard before update of username, full_name, bio on public.profiles for each row execute function public.words_guard();

-- ---- ჩემი მონაცემები: ჩამოტვირთვა და ანგარიშის წაშლა
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in'; end if;
  if not public.mfa_ok() then raise exception 'საჭიროა ორფაქტორიანი შესვლა'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'role' from profiles p where id = u),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'body', body, 'media', media, 'kind', kind, 'parent_id', parent_id, 'created_at', created_at) order by created_at) from posts where author_id = u), '[]'),
    'likes', coalesce((select jsonb_agg(jsonb_build_object('post_id', post_id, 'created_at', created_at)) from likes where user_id = u), '[]'),
    'following', coalesce((select jsonb_agg(p.username) from follows f join profiles p on p.id = f.following_id where f.follower_id = u), '[]'),
    'followers', coalesce((select jsonb_agg(p.username) from follows f join profiles p on p.id = f.follower_id where f.following_id = u), '[]'),
    'messages_sent', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'body', body, 'media_url', media_url, 'created_at', created_at) order by created_at)
                               from messages where sender_id = u and deleted_at is null), '[]'),
    'stories', coalesce((select jsonb_agg(jsonb_build_object('media_url', media_url, 'caption', caption, 'created_at', created_at)) from stories where author_id = u), '[]'),
    'listings', coalesce((select jsonb_agg(to_jsonb(l) - 'hidden') from listings l where seller_id = u), '[]'),
    'gifts_sent', coalesce((select jsonb_agg(jsonb_build_object('to', to_id, 'kind', kind, 'note', note, 'created_at', created_at)) from gifts where from_id = u), '[]'),
    'gifts_received', coalesce((select jsonb_agg(jsonb_build_object('from', from_id, 'kind', kind, 'note', note, 'created_at', created_at)) from gifts where to_id = u), '[]'),
    'game_stats', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id') from game_stats g where user_id = u), '[]'),
    'progress', (select to_jsonb(x) - 'user_id' from progress x where user_id = u),
    'badges', coalesce((select jsonb_agg(badge) from user_badges where user_id = u), '[]'),
    'dating_profile', (select to_jsonb(d) - 'user_id' from dating_profiles d where user_id = u));
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.mfa_ok() then raise exception 'საჭიროა ორფაქტორიანი შესვლა'; end if;
  delete from auth.users where id = auth.uid();
end $$;

alter table public.banned_words enable row level security;
drop policy if exists "banned words staff" on public.banned_words;
create policy "banned words staff" on public.banned_words for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- 2FA: aal1 სესიით (მხოლოდ პაროლი) მგრძნობიარე ცხრილები არ იხსნება
do $$
declare t text;
begin
  foreach t in array array['messages', 'notifications', 'dating_profiles', 'swipes', 'push_subscriptions', 'follow_requests',
                           'close_friends', 'collections', 'saves', 'listing_saves', 'game_messages'] loop
    execute format('drop policy if exists "mfa guard" on public.%I', t);
    execute format('create policy "mfa guard" on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
  foreach t in array array['posts', 'listings', 'stories', 'follows', 'likes', 'gifts', 'profiles'] loop
    execute format('drop policy if exists "mfa write ins" on public.%I', t);
    execute format('drop policy if exists "mfa write upd" on public.%I', t);
    execute format('drop policy if exists "mfa write del" on public.%I', t);
    execute format('create policy "mfa write ins" on public.%I as restrictive for insert to authenticated with check (public.mfa_ok())', t);
    execute format('create policy "mfa write upd" on public.%I as restrictive for update to authenticated using (public.mfa_ok())', t);
    execute format('create policy "mfa write del" on public.%I as restrictive for delete to authenticated using (public.mfa_ok())', t);
  end loop;
end $$;

revoke execute on function public.rate_count(text, timestamptz) from public, anon;
revoke execute on function public.has_banned(text) from public, anon;

-- ---------------------------------------------------------------------
-- შეცდომების ჟურნალი: აპის შეცდომები ბრაუზერიდან (ადმინ პანელი → „შეცდომები“). 30 დღეზე ძველი თავისით იშლება.
-- ---------------------------------------------------------------------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  message text not null,
  stack text,
  path text,
  source text not null default 'window',
  release text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time_idx on public.client_errors (created_at desc);
create index if not exists client_errors_user_idx on public.client_errors (user_id, created_at desc);
create index if not exists client_errors_msg_idx on public.client_errors (message, created_at desc);
-- ცხრილზე პირდაპირი წვდომა არავის აქვს: ჩაწერა log_client_error-ით, წაკითხვა admin_errors-ით
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- p_source: 'boundary' (ეკრანი ჩავარდა) | 'window' | 'promise' | 'api' (სქემის/API-ს შეუსაბამობა) | 'chunk' (ძველი ვერსიის ფაილები)
create or replace function public.log_client_error(p_message text, p_stack text default null, p_path text default null,
  p_source text default 'window', p_release text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_msg text;
begin
  v_msg := left(btrim(regexp_replace(coalesce(p_message, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi')), 500);
  if v_msg = '' then return; end if;
  -- ზღვარი: ერთ ადამიანზე 30 ჩანაწერი საათში, შეუსვლელებზე ჯამში 300
  if u is not null then
    if (select count(*) from client_errors where user_id = u and created_at > now() - interval '1 hour') >= 30 then return; end if;
  elsif (select count(*) from client_errors where user_id is null and created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;
  insert into client_errors (user_id, message, stack, path, source, release, user_agent)
  values (u, v_msg, left(p_stack, 4000), left(p_path, 300),
          case when p_source in ('boundary', 'window', 'promise', 'api', 'chunk') then p_source else 'window' end,
          left(p_release, 40), left(p_agent, 300));
  if random() < 0.02 then delete from client_errors where created_at < now() - interval '30 days'; end if;
end $$;

-- ერთნაირი შეცდომები ერთად: რამდენჯერ, რამდენ ადამიანთან, ბოლო მისამართი და დეტალები
create or replace function public.admin_errors(p_days int default 7)
returns table (message text, source text, events bigint, users bigint, first_at timestamptz, last_at timestamptz,
               path text, stack text, release text, user_agent text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select e.message,
    (array_agg(e.source order by e.created_at desc))[1],
    count(*), count(distinct e.user_id), min(e.created_at), max(e.created_at),
    (array_agg(e.path order by e.created_at desc))[1],
    (array_agg(e.stack order by e.created_at desc) filter (where e.stack is not null))[1],
    (array_agg(e.release order by e.created_at desc))[1],
    (array_agg(e.user_agent order by e.created_at desc))[1]
  from client_errors e
  where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
  group by e.message
  order by max(e.created_at) desc
  limit 100;
end $$;

-- „მოგვარებულია“: ამ შეცდომის ყველა ჩანაწერი იშლება
create or replace function public.admin_clear_errors(p_message text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  delete from client_errors where message = p_message;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- საძიებო სისტემები: sitemap.xml-ის სია (api/sitemap.js). მხოლოდ საჯარო:
-- ღია პროფილები, აქტიური განცხადებები და მომავალი ღია შეხვედრები.
-- ---------------------------------------------------------------------
create or replace function public.sitemap_entries()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'u', coalesce((select jsonb_agg(a.username) from (
           select p.username from profiles p
            where p.onboarded and not p.is_private and p.username is not null
              and (p.banned_until is null or p.banned_until < now())
            order by p.followers_count desc, p.created_at desc limit 5000) a), '[]'),
    'm', coalesce((select jsonb_agg(jsonb_build_array(b.id, b.changed)) from (
           select l.id, greatest(l.updated_at, coalesce(l.bumped_at, l.updated_at)) changed
             from listings l join profiles s on s.id = l.seller_id
            where l.status = 'active' and not l.hidden and (s.banned_until is null or s.banned_until < now())
            order by coalesce(l.bumped_at, l.created_at) desc limit 3000) b), '[]'),
    'e', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.created_at)) from (
           select e.id, e.created_at from events e left join groups g on g.id = e.group_id
            where coalesce(e.ends_at, e.starts_at) > now() and (e.group_id is null or g.privacy = 'public')
            order by e.starts_at limit 1000) c), '[]'));
$$;
grant execute on function public.sitemap_entries() to anon, authenticated;

-- =====================================================================
-- ეტაპი C: ვის გამოიწერო, მიმაგრებული პოსტი, მონახაზები, დადასტურებული ნიშანი, ქართული ძებნა
-- =====================================================================
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists pinned_post_id uuid references public.posts on delete set null;

-- მომხმარებელი პირდაპირ ვერ შეცვლის: მთვლელებს, როლს, შეზღუდვას, მომწვევს, ნიშანს და მიმაგრებულ პოსტს
-- (ამათ მხოლოდ შესაბამისი ფუნქციები ცვლიან)
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
    new.verified := old.verified;
    new.pinned_post_id := old.pinned_post_id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_counters();

-- ---- დადასტურებული ნიშანი: მხოლოდ ადმინი ანიჭებს
create or replace function public.admin_set_verified(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  update profiles set verified = coalesce(p_on, false) where id = p_user;
end $$;

-- ---- მიმაგრებული პოსტი: საკუთარი, მთავარი (არა პასუხი), ჯგუფის გარეთ. p_post = null — მოხსნა
create or replace function public.pin_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_post is not null and not exists (
    select 1 from posts where id = p_post and author_id = auth.uid() and parent_id is null and group_id is null and not hidden
  ) then raise exception 'ამ პოსტს პროფილზე ვერ მიამაგრებ'; end if;
  update profiles set pinned_post_id = p_post where id = auth.uid();
end $$;

-- ---- მონახაზები: ტექსტი და გამოკითხვა, ყველა მოწყობილობაზე. მაქსიმუმ 50
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  poll jsonb,
  group_id uuid references public.groups on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_user_idx on public.drafts (user_id, updated_at desc);
alter table public.drafts enable row level security;
drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.drafts to authenticated;

create or replace function public.drafts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (select count(*) from drafts where user_id = new.user_id) >= 50 then
    raise exception 'მონახაზი მაქსიმუმ 50 შეიძლება — ძველები წაშალე';
  end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists drafts_guard on public.drafts;
create trigger drafts_guard before insert or update on public.drafts
  for each row execute function public.drafts_guard();

-- ---- ვის გამოიწერო: მიზეზით (გამოგიწერა, კლასელი, საერთო მეგობრები, სკოლა, ქალაქი…). „არ მაინტერესებს“ ინახება
create table if not exists public.suggestion_dismissals (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  dismissed_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dismissed_id)
);
alter table public.suggestion_dismissals enable row level security;
drop policy if exists "own dismissals" on public.suggestion_dismissals;
create policy "own dismissals" on public.suggestion_dismissals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.suggestion_dismissals to authenticated;

create or replace function public.dismiss_suggestion(p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into suggestion_dismissals (user_id, dismissed_id) select auth.uid(), p_user where auth.uid() is not null
  on conflict do nothing;
$$;

create or replace function public.who_to_follow(p_limit int default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  fof as (
    select f2.following_id as id, count(*) as n, min(f1.following_id::text)::uuid as via
      from follows f1 join follows f2 on f2.follower_id = f1.following_id
     where f1.follower_id = auth.uid()
     group by f2.following_id
  ),
  cand as (
    select p.*, coalesce(fof.n, 0) as mutual, fof.via,
      exists (select 1 from follows x where x.follower_id = p.id and x.following_id = me.id) as follows_me,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school)) as same_school,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school) and p.grad_year = me.grad_year) as classmate,
      (coalesce(me.city, '') <> '' and lower(p.city) = lower(me.city)) as same_city,
      (p.id = me.invited_by or p.invited_by = me.id) as invite
    from profiles p cross join me left join fof on fof.id = p.id
    where p.id <> me.id and p.onboarded and (p.banned_until is null or p.banned_until < now())
      and not exists (select 1 from follows f where f.follower_id = me.id and f.following_id = p.id)
      and not exists (select 1 from follow_requests r where r.requester_id = me.id and r.target_id = p.id)
      and not exists (select 1 from suggestion_dismissals d where d.user_id = me.id and d.dismissed_id = p.id)
      and not public.is_blocked(me.id, p.id)
  ),
  ranked as (
    select c.*,
      (case when c.follows_me then 100 else 0 end) + (case when c.invite then 60 else 0 end)
      + (case when c.classmate then 40 when c.same_school then 25 else 0 end)
      + least(c.mutual, 10) * 8 + (case when c.same_city then 8 else 0 end)
      + ln(1 + c.followers_count) + (case when c.created_at > now() - interval '14 days' then 3 else 0 end) as score
    from cand c
    order by score desc, c.followers_count desc
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'username', r.username, 'full_name', r.full_name, 'avatar_url', r.avatar_url, 'last_seen', r.last_seen,
      'verified', r.verified, 'city', r.city, 'school', r.school, 'grad_year', r.grad_year, 'followers_count', r.followers_count,
      'reason', case when r.follows_me then 'follows_you' when r.invite then 'invite' when r.classmate then 'classmate'
                     when r.mutual > 0 then 'mutual' when r.same_school then 'school' when r.same_city then 'city'
                     when r.created_at > now() - interval '14 days' then 'new' else 'popular' end,
      'mutual', r.mutual,
      'via', (select coalesce(nullif(v.full_name, ''), v.username) from profiles v where v.id = r.via))
    order by r.score desc, r.followers_count desc), '[]'::jsonb)
  from ranked r;
$$;

-- ---- ქართული ძებნა: „გიორგი“ = „giorgi“, „beridze“ = „ბერიძე“, „ჭავჭავაძე“ = „chavchavadze“, უმნიშვნელო შეცდომებიც
-- ორივე დამწერლობა ერთ ფორმაზე მიდის; მსგავსი ბგერები ერთდება (თ/ტ, კ/ქ/ყ, პ/ფ, ჩ/ჭ, ც/წ).
-- იგივე წესი აპშია: src/lib/translit.js (ტესტები ამოწმებს, რომ ერთნაირად მუშაობს)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function public.ka_skeleton(p text)
returns text language sql immutable parallel safe as $$
  select translate(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(coalesce(p, '')),
      'ch''', 'č'), 'chh', 'č'), 'ch', 'č'), 'sh', 'š'), 'zh', 'ž'), 'kh', 'x'), 'gh', 'ğ'), 'dz', 'đ'),
      'ts''', 'c'), 'tz', 'c'), 'ts', 'c'), 'th', 't'), 'ph', 'p'), '''', ''),
    'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰqywf',
    'abgdevztiklmnopžrstupkğkščcđcčxjhkkcp');
$$;

-- ინდექსები (pg_trgm-ის სქემა შეიძლება განსხვავდებოდეს — ვპოულობთ)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists profiles_search_trgm on public.profiles using gin (public.ka_skeleton(coalesce(full_name, '''') || '' '' || coalesce(username, '''')) %I.gin_trgm_ops)', s);
  execute format('create index if not exists posts_search_trgm on public.posts using gin (public.ka_skeleton(body) %I.gin_trgm_ops) where parent_id is null', s);
  execute format('create index if not exists groups_search_trgm on public.groups using gin (public.ka_skeleton(name) %I.gin_trgm_ops)', s);
  execute format('create index if not exists listings_search_trgm on public.listings using gin (public.ka_skeleton(title) %I.gin_trgm_ops)', s);
end $$;

-- ერთი ძებნა ყველაფერზე. security invoker — RLS მოქმედებს (დახურული პროფილის პოსტები, დამალული და სხვ. არ ჩანს)
create or replace function public.search_all(p_q text, p_limit int default 20)
returns jsonb language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  raw text := btrim(regexp_replace(coalesce(p_q, ''), '^[#@]+', ''));
  s text := public.ka_skeleton(btrim(regexp_replace(coalesce(p_q, ''), '^[#@]+', '')));
  pat text;
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if char_length(s) < 2 then
    return jsonb_build_object('people', '[]'::jsonb, 'posts', '[]'::jsonb, 'tags', '[]'::jsonb, 'groups', '[]'::jsonb, 'listings', '[]'::jsonb);
  end if;
  pat := replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_');
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(to_jsonb(x) - 'rank' - 'sim' order by x.rank, x.sim desc, x.followers_count desc) from (
        select p.id, p.username, p.full_name, p.avatar_url, p.last_seen, p.verified, p.city, p.followers_count,
          case when lower(p.username) = lower(raw) then 0
               when public.ka_skeleton(p.username) like pat || '%' then 1
               when public.ka_skeleton(p.full_name) like pat || '%' or public.ka_skeleton(p.full_name) like '% ' || pat || '%' then 2
               when public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '')) like '%' || pat || '%' then 3
               else 4 end as rank,
          word_similarity(s, public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, ''))) as sim
        from profiles p
        where p.onboarded and (p.banned_until is null or p.banned_until < now())
          and (public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '')) like '%' || pat || '%'
               or (char_length(s) >= 4 and s <% public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, ''))))
        order by rank, sim desc, p.followers_count desc
        limit lim) x), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(x.id order by x.created_at desc) from (
        select p.id, p.created_at from posts p
        where p.parent_id is null and not p.hidden and public.ka_skeleton(p.body) like '%' || pat || '%'
        order by p.created_at desc limit lim) x), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', x.t, 'posts', x.n) order by x.n desc) from (
        select t, count(*) as n from posts p, unnest(p.hashtags) as t
        where public.ka_skeleton(t) like pat || '%'
        group by t order by count(*) desc limit 8) x), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.members_count desc) from (
        select g.id, g.slug, g.name, g.cover_url, g.privacy, g.members_count from groups g
        where public.ka_skeleton(g.name) like '%' || pat || '%'
        order by g.members_count desc limit 8) x), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
        select l.id, l.title, l.price, l.currency, l.city, coalesce(l.thumb, l.photos ->> 0) as photo, coalesce(l.bumped_at, l.created_at) as at
        from listings l
        where l.status in ('active', 'reserved') and not l.hidden and public.ka_skeleton(l.title) like '%' || pat || '%'
        order by coalesce(l.bumped_at, l.created_at) desc limit 8) x), '[]'::jsonb));
end $$;

-- =====================================================================
-- ეტაპი D: შეტყობინებების პარამეტრები და ადმინის ანალიტიკა
-- =====================================================================

-- ---- შეტყობინებების პარამეტრები: რომელი Push მოვიდეს და „ჩუმი საათები“ (თბილისის დროით; ზარები მაინც მოდის)
create table if not exists public.notification_prefs (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  messages boolean not null default true,
  calls boolean not null default true,
  replies boolean not null default true,
  likes boolean not null default true,
  follows boolean not null default true,
  games boolean not null default true,
  dating boolean not null default true,
  market boolean not null default true,
  groups boolean not null default true,
  rewards boolean not null default true,
  quiet_from smallint check (quiet_from between 0 and 23),
  quiet_to smallint check (quiet_to between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "own prefs" on public.notification_prefs;
create policy "own prefs" on public.notification_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notification_prefs to authenticated;

-- Push-ის კატეგორია მისი tag-ით (conv-, call-, game-, n-<ტიპი>-)
create or replace function public.push_category(p_payload jsonb)
returns text language sql immutable as $$
  select case
    when p_payload ->> 'tag' like 'conv-%' then 'messages'
    when p_payload ->> 'tag' like 'call-%' then 'calls'
    when p_payload ->> 'tag' like 'game-%' then 'games'
    when p_payload ->> 'tag' ~ '^n-(reply|quote)-' then 'replies'
    when p_payload ->> 'tag' ~ '^n-like-' then 'likes'
    when p_payload ->> 'tag' ~ '^n-(follow|follow_request|follow_accept|invite_joined)-' then 'follows'
    when p_payload ->> 'tag' ~ '^n-(game_invite|tournament_start|tournament_end)-' then 'games'
    when p_payload ->> 'tag' ~ '^n-match-' then 'dating'
    when p_payload ->> 'tag' ~ '^n-listing_price-' then 'market'
    when p_payload ->> 'tag' ~ '^n-(group_request|group_approved|event_rsvp)-' then 'groups'
    when p_payload ->> 'tag' ~ '^n-(gift|achievement|level_up)-' then 'rewards'
    else 'other' end;
$$;

create or replace function public.push_allowed(p_user uuid, p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_cat text := public.push_category(p_payload); v_from int; v_to int; v_hour int;
begin
  select to_jsonb(p) into v from notification_prefs p where p.user_id = p_user;
  if v is null then return true; end if;
  if v ? v_cat and (v ->> v_cat)::boolean is false then return false; end if;
  v_from := (v ->> 'quiet_from')::int;
  v_to := (v ->> 'quiet_to')::int;
  if v_cat <> 'calls' and v_from is not null and v_to is not null and v_from <> v_to then
    v_hour := extract(hour from now() at time zone 'Asia/Tbilisi')::int;
    if (v_from < v_to and v_hour >= v_from and v_hour < v_to) or (v_from > v_to and (v_hour >= v_from or v_hour < v_to)) then
      return false;
    end if;
  end if;
  return true;
end $$;

-- Push-ის გაგზავნა Edge Function „push“-ით (მხოლოდ თუ პარამეტრები უშვებს)
create or replace function public.push_dispatch(p_user uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if p_user is null then return; end if;
  select value into v_url from app_secrets where key = 'push_url';
  if v_url is null then return; end if;
  if not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  if not public.push_allowed(p_user, p_payload) then return; end if;
  select value into v_secret from app_secrets where key = 'push_secret';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('user_id', p_user, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_secret, '')));
exception when others then
  raise warning 'push_dispatch: %', sqlerrm;
end $$;
revoke execute on function public.push_dispatch(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.push_allowed(uuid, jsonb) from public, anon, authenticated;

-- ---- აქტიურობა დღეების მიხედვით (ანალიტიკისთვის): აპი ყოველ 2 წუთში იძახებს touch_last_seen-ს
create table if not exists public.daily_active (
  day date not null,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (day, user_id)
);
alter table public.daily_active enable row level security;
revoke all on public.daily_active from anon, authenticated;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
  insert into daily_active (day, user_id)
  select (now() at time zone 'Asia/Tbilisi')::date, auth.uid() where auth.uid() is not null
  on conflict do nothing;
$$;

-- პოსტი ან მესიჯი — ესეც აქტიურობაა (აპი რომც არ იყოს ღია, მაგ. Push-იდან პასუხი)
create or replace function public.mark_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_table_name = 'messages' then v_user := new.sender_id; else v_user := new.author_id; end if;
  insert into daily_active (day, user_id) values ((now() at time zone 'Asia/Tbilisi')::date, v_user)
  on conflict do nothing;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists posts_mark_active on public.posts;
create trigger posts_mark_active after insert on public.posts for each row execute function public.mark_active();
drop trigger if exists messages_mark_active on public.messages;
create trigger messages_mark_active after insert on public.messages for each row execute function public.mark_active();

-- წარსულის შევსება პოსტებიდან და მესიჯებიდან (ერთხელ; განმეორებით გაშვება უსაფრთხოა)
insert into public.daily_active (day, user_id)
select distinct (created_at at time zone 'Asia/Tbilisi')::date, author_id from public.posts
on conflict do nothing;
insert into public.daily_active (day, user_id)
select distinct (created_at at time zone 'Asia/Tbilisi')::date, sender_id from public.messages where sender_id is not null
on conflict do nothing;

-- ---- ადმინის ანალიტიკა: დღიური რიგები და შეჯამება (თბილისის დროით)
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  n int := greatest(7, least(coalesce(p_days, 30), 180));
  today date := (now() at time zone 'Asia/Tbilisi')::date;
  since date;
  t0 timestamptz;   -- პერიოდის დასაწყისი (თბილისის შუაღამე)
  tp timestamptz;   -- წინა პერიოდის დასაწყისი
  r jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  since := today - (n - 1);
  t0 := since::timestamp at time zone 'Asia/Tbilisi';
  tp := (since - n)::timestamp at time zone 'Asia/Tbilisi';
  with d as (select generate_series(since, today, interval '1 day')::date as day),
  su as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from profiles where created_at >= t0 group by 1),
  ac as (select day, count(*) as n from daily_active where day >= since group by 1),
  po as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) filter (where parent_id is null) as n,
                count(*) filter (where parent_id is not null) as r from posts where created_at >= t0 group by 1),
  me as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from messages where created_at >= t0 group by 1),
  ga as (select (updated_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from games where status = 'finished' and updated_at >= t0 group by 1)
  select jsonb_agg(jsonb_build_object('day', d.day, 'signups', coalesce(su.n, 0), 'active', coalesce(ac.n, 0),
           'posts', coalesce(po.n, 0), 'replies', coalesce(po.r, 0), 'messages', coalesce(me.n, 0), 'games', coalesce(ga.n, 0)) order by d.day)
    into r
    from d left join su using (day) left join ac using (day) left join po using (day) left join me using (day) left join ga using (day);
  return jsonb_build_object(
    'days', r,
    'totals', jsonb_build_object(
      'users', (select count(*) from profiles where onboarded),
      'dau', (select count(*) from daily_active where day = today),
      'wau', (select count(distinct user_id) from daily_active where day > today - 7),
      'mau', (select count(distinct user_id) from daily_active where day > today - 30),
      'signups', (select count(*) from profiles where created_at >= t0),
      'signups_prev', (select count(*) from profiles where created_at >= tp and created_at < t0),
      'posts', (select count(*) from posts where parent_id is null and created_at >= t0),
      'posts_prev', (select count(*) from posts where parent_id is null and created_at >= tp and created_at < t0),
      -- 7 დღის დაბრუნება: 8–14 დღის წინ დარეგისტრირებულებიდან რამდენი შემოვიდა ბოლო 7 დღეში
      'retention_7d', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (
                          select 1 from daily_active a where a.user_id = p.id and a.day > today - 7)) / count(*)) end
                       from profiles p where (p.created_at at time zone 'Asia/Tbilisi')::date between today - 14 and today - 8)));
end $$;

-- =====================================================================
-- ეტაპი E: დაბადების და სახელობის დღეები, @მოხსენიება, რედაქტირება, ბმულის ბარათები, მოგონებები
-- =====================================================================

-- ---- დაბადების დღე: მხოლოდ თვე და დღე (წელი არ ინახება), ცალკე ცხრილში — სხვები პირდაპირ ვერ კითხულობენ,
-- მხოლოდ celebrations_today აჩვენებს მეგობრებს დღესვე (თუ visible)
create table if not exists public.birthdays (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  visible boolean not null default true,
  check (day <= case month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
);
alter table public.birthdays enable row level security;
drop policy if exists "own birthday" on public.birthdays;
create policy "own birthday" on public.birthdays for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.birthdays to authenticated;

-- ---- სახელობის დღეები (ახალი სტილით). name — სახელის „ჩონჩხი“ (ka_skeleton), რომ ლათინურად დაწერილიც დაემთხვეს.
-- სია შეგიძლია შეავსო: insert into public.name_days (name, month, day, feast) values (public.ka_skeleton('სახელი'), თვე, დღე, 'დღესასწაული');
create table if not exists public.name_days (
  name text not null,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  feast text not null,
  primary key (name, month, day)
);
alter table public.name_days enable row level security;
drop policy if exists "name days read" on public.name_days;
create policy "name days read" on public.name_days for select to authenticated using (true);
grant select on public.name_days to authenticated;

insert into public.name_days (name, month, day, feast)
select public.ka_skeleton(n), m, d, f from (values
  ('გიორგი', 11, 23, 'გიორგობა'), ('გიო', 11, 23, 'გიორგობა'), ('გოგი', 11, 23, 'გიორგობა'), ('გოგა', 11, 23, 'გიორგობა'),
  ('გიორგი', 5, 6, 'გაზაფხულის გიორგობა'), ('გიო', 5, 6, 'გაზაფხულის გიორგობა'), ('გოგი', 5, 6, 'გაზაფხულის გიორგობა'), ('გოგა', 5, 6, 'გაზაფხულის გიორგობა'),
  ('მარიამ', 8, 28, 'მარიამობა'), ('მარიამი', 8, 28, 'მარიამობა'), ('მარი', 8, 28, 'მარიამობა'),
  ('ნინო', 1, 27, 'ნინოობა'),
  ('ანდრია', 5, 12, 'ანდრიაობა'),
  ('ნიკოლოზ', 12, 19, 'ნიკოლოზობა'), ('ნიკოლოზი', 12, 19, 'ნიკოლოზობა'), ('ნიკა', 12, 19, 'ნიკოლოზობა'), ('ნიკო', 12, 19, 'ნიკოლოზობა'),
  ('ბარბარე', 12, 17, 'ბარბარობა'),
  ('ეკატერინე', 12, 7, 'ეკატერინობა'), ('ეკა', 12, 7, 'ეკატერინობა'),
  ('მიხეილ', 11, 21, 'მთავარანგელოზობა'), ('მიხეილი', 11, 21, 'მთავარანგელოზობა'), ('მიშა', 11, 21, 'მთავარანგელოზობა'), ('მიხო', 11, 21, 'მთავარანგელოზობა'),
  ('გაბრიელ', 11, 21, 'მთავარანგელოზობა'), ('გაბრიელი', 11, 21, 'მთავარანგელოზობა'), ('გაბო', 11, 21, 'მთავარანგელოზობა'),
  ('იოანე', 7, 7, 'ივანობა'), ('ივანე', 7, 7, 'ივანობა'), ('ვანო', 7, 7, 'ივანობა'),
  ('პეტრე', 7, 12, 'პეტრე-პავლობა'), ('პავლე', 7, 12, 'პეტრე-პავლობა'),
  ('ელენე', 6, 3, 'კონსტანტინე და ელენე'), ('კონსტანტინე', 6, 3, 'კონსტანტინე და ელენე'), ('კოტე', 6, 3, 'კონსტანტინე და ელენე'),
  ('ილია', 8, 2, 'ილიაობა'),
  ('სოფიო', 9, 30, 'სოფიოობა'), ('სოფო', 9, 30, 'სოფიოობა'), ('სოფია', 9, 30, 'სოფიოობა'),
  ('თამარ', 5, 14, 'თამარობა'), ('თამარი', 5, 14, 'თამარობა'), ('თამუნა', 5, 14, 'თამარობა'),
  ('ქეთევან', 9, 26, 'ქეთევანობა'), ('ქეთევანი', 9, 26, 'ქეთევანობა'), ('ქეთი', 9, 26, 'ქეთევანობა'), ('ქეთო', 9, 26, 'ქეთევანობა'),
  ('ვახტანგ', 12, 13, 'ვახტანგობა'), ('ვახტანგი', 12, 13, 'ვახტანგობა'), ('ვახო', 12, 13, 'ვახტანგობა'),
  ('ლუკა', 10, 31, 'ლუკაობა'), ('მათე', 11, 29, 'მათეობა'), ('თომა', 10, 19, 'თომაობა'),
  ('დიმიტრი', 11, 8, 'დიმიტრობა'), ('თეკლა', 10, 7, 'თეკლაობა'),
  ('ალექსანდრე', 12, 6, 'ალექსანდრობა'), ('სანდრო', 12, 6, 'ალექსანდრობა'), ('ალეკო', 12, 6, 'ალექსანდრობა')
) as v(n, m, d, f)
on conflict do nothing;

-- დღეს: დაბადების დღეები და სახელობის დღეები ჩემს წრეში (ვისაც ვიწერ ან ვინც მიწერს), თბილისის დროით
create or replace function public.celebrations_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Asia/Tbilisi')::date;
  m int := extract(month from (now() at time zone 'Asia/Tbilisi'))::int;
  d int := extract(day from (now() at time zone 'Asia/Tbilisi'))::int;
  -- 29 თებერვალს დაბადებულები ნაკიან წელს 28-ში
  leap_fix boolean := (m = 2 and d = 28 and extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int = 28);
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'date', today,
    'birthdays', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                                          'verified', p.verified, 'last_seen', p.last_seen) order by p.full_name)
      from profiles p join birthdays b on b.user_id = p.id
      where p.id <> me and p.onboarded and b.visible and (p.banned_until is null or p.banned_until < now())
        and b.month = m and (b.day = d or (leap_fix and b.day = 29))
        and (exists (select 1 from follows where follower_id = me and following_id = p.id)
             or exists (select 1 from follows where follower_id = p.id and following_id = me))
        and not public.is_blocked(me, p.id)), '[]'::jsonb),
    'namedays', coalesce((
      select jsonb_agg(jsonb_build_object('feast', x.feast, 'people', x.people) order by x.feast)
      from (
        select nd.feast, jsonb_agg(distinct jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
                 'avatar_url', p.avatar_url, 'verified', p.verified, 'last_seen', p.last_seen)) as people
        from name_days nd
        join profiles p on public.ka_skeleton(split_part(btrim(p.full_name), ' ', 1)) = nd.name
        where nd.month = m and nd.day = d and p.id <> me and p.onboarded and (p.banned_until is null or p.banned_until < now())
          and (exists (select 1 from follows where follower_id = me and following_id = p.id)
               or exists (select 1 from follows where follower_id = p.id and following_id = me))
          and not public.is_blocked(me, p.id)
        group by nd.feast) x), '[]'::jsonb),
    'feasts', coalesce((select jsonb_agg(distinct feast) from name_days where month = m and day = d), '[]'::jsonb),
    'mine', jsonb_build_object(
      'birthday', exists (select 1 from birthdays b where b.user_id = me and b.month = m and (b.day = d or (leap_fix and b.day = 29))),
      'nameday', (select nd.feast from name_days nd join profiles p on p.id = me
                  where nd.month = m and nd.day = d and public.ka_skeleton(split_part(btrim(p.full_name), ' ', 1)) = nd.name limit 1)));
end $$;

-- ---- @მოხსენიება: შეტყობინება იმას, ვინც პოსტს ხედავს (მაქსიმუმ 10 ერთ პოსტში; რედაქტირებისას — მხოლოდ ახლებს)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote',
  'group_request', 'group_approved', 'event_rsvp', 'tournament_start', 'tournament_end',
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention', 'season_end'));

create or replace function public.extract_mentions(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct rtrim(lower(m[2]), '.')), '{}')
  from regexp_matches(coalesce(t, ''), '(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{3,24})', 'g') as m;
$$;

create or replace function public.on_post_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new text[]; v_old text[] := '{}'; v_user record; v_private boolean;
begin
  v_new := public.extract_mentions(new.body);
  if tg_op = 'UPDATE' then v_old := public.extract_mentions(old.body); end if;
  if cardinality(v_new) = 0 or new.hidden then return null; end if;
  select is_private into v_private from profiles where id = new.author_id;
  for v_user in
    select p.id from profiles p
    where p.username = any (v_new) and not (p.username = any (v_old)) and p.id <> new.author_id and p.onboarded
      -- ხედავს თუ არა მოხსენიებული ამ პოსტს
      and (not coalesce(v_private, false) or exists (select 1 from follows f where f.follower_id = p.id and f.following_id = new.author_id))
      and (new.group_id is null or exists (select 1 from groups g where g.id = new.group_id and g.privacy = 'public')
           or exists (select 1 from group_members gm where gm.group_id = new.group_id and gm.user_id = p.id and gm.status = 'active'))
    limit 10
  loop
    perform public.notify(v_user.id, new.author_id, 'mention', new.id);
  end loop;
  return null;
end $$;
drop trigger if exists posts_mentions on public.posts;
create trigger posts_mentions after insert or update of body on public.posts
  for each row execute function public.on_post_mentions();
revoke execute on function public.on_post_mentions() from public, anon, authenticated;

-- მოხსენიების Push „პასუხების“ კატეგორიაშია; Push-ის ტექსტები და კატეგორიები — ეტაპი H-ში (push_category, on_notification_push)

-- ---- ბმულის ბარათი: { url, title, description, image, site } — ავტორი ამატებს გამოქვეყნებისას (api/unfurl.js)
alter table public.posts add column if not exists link jsonb;
alter table public.posts drop constraint if exists posts_link_check;
alter table public.posts add constraint posts_link_check check (
  link is null or (jsonb_typeof(link) = 'object' and link ->> 'url' ~ '^https?://' and char_length(link::text) <= 2000
                   and coalesce(link ->> 'image', 'https://') ~ '^https://'));

-- ---- რედაქტირება: ტექსტის შესწორება გამოქვეყნებიდან 15 წუთის განმავლობაში („შესწორებულია“ — edited_at)
create or replace function public.posts_edit_window()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (new.body is distinct from old.body or new.link is distinct from old.link)
     and old.created_at < now() - interval '15 minutes' then
    raise exception 'პოსტის შესწორება მხოლოდ გამოქვეყნებიდან 15 წუთის განმავლობაშია შესაძლებელი';
  end if;
  return new;
end $$;
drop trigger if exists posts_edit_window on public.posts;
create trigger posts_edit_window before update of body, link on public.posts
  for each row execute function public.posts_edit_window();

-- ---- „ამ დღეს“: ჩემი პოსტები იგივე დღეს წინა წლებში (თბილისის დროით)
create or replace function public.my_memories()
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.author_id = auth.uid() and p.parent_id is null and not p.hidden
    and extract(month from (p.created_at at time zone 'Asia/Tbilisi')) = extract(month from (now() at time zone 'Asia/Tbilisi'))
    and extract(day from (p.created_at at time zone 'Asia/Tbilisi')) = extract(day from (now() at time zone 'Asia/Tbilisi'))
    and (p.created_at at time zone 'Asia/Tbilisi')::date < date_trunc('year', now() at time zone 'Asia/Tbilisi')::date
  order by p.created_at desc
  limit 3;
$$;

-- =====================================================================
-- ეტაპი G: „გაღვიძება“ და საცავის დასუფთავება
-- =====================================================================

-- ---- გაღვიძება: Supabase-ის უფასო პროექტი 7 დღის უმოქმედობის შემდეგ ჩერდება.
-- Vercel-ის ყოველდღიური cron (api/daily.js) ამას იძახებს — ერთი მარტივი მოთხოვნა ბაზაში საკმარისია.
create or replace function public.keep_alive()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- ---- წაშლილი ფოტოების, ვიდეოების და ხმოვანების დასუფთავება საცავიდან (bucket „media“).
-- 1) ტრიგერები: როცა ჩანაწერი იშლება ან ფოტო იცვლება, ძველი ფაილის გზა რიგში (media_trash) ჩადის;
-- 2) api/daily.js (service გასაღებით) დღეში ერთხელ იღებს რიგს — media_cleanup_take — და შლის მხოლოდ იმას,
--    რასაც აღარაფერი იყენებს (media_in_use: მაგ. სთორი ჰაილაითში ან ჩატში პასუხად რჩება);
-- 3) ატვირთული, მაგრამ არსად მიმაგრებული ფაილები (გაუქმებული პოსტი, შეუნახავი ავატარი) — დღე-ნახევრის შემდეგ.
-- ახალი სვეტი ფოტოთი? დაამატე media_collect ტრიგერში და media_in_use-ში.
create table if not exists public.media_trash (
  path text primary key,
  created_at timestamptz not null default now()
);
alter table public.media_trash enable row level security;
revoke all on public.media_trash from anon, authenticated;

-- რომელი ფაილებიდან დაიწყო ძებნა (მხოლოდ ამ განახლების შემდეგ ატვირთულები — ძველს არ ვეხებით)
create table if not exists public.media_sweep (
  id boolean primary key default true check (id),
  last_at timestamptz not null default now()
);
insert into public.media_sweep default values on conflict do nothing;
alter table public.media_sweep enable row level security;
revoke all on public.media_sweep from anon, authenticated;

-- ჩვენი საცავის გზები ნებისმიერი მნიშვნელობიდან (ტექსტი, jsonb, მთელი ჩანაწერი)
create or replace function public.media_paths(v jsonb)
returns setof text language sql immutable as $$
  select distinct m[1] from regexp_matches(coalesce(v::text, ''), '/storage/v1/object/public/media/([^"?#\s\\]+)', 'g') as m
$$;

create or replace function public.media_collect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into media_trash (path)
  select p from public.media_paths(to_jsonb(old)) p
  where tg_op = 'DELETE' or p not in (select public.media_paths(to_jsonb(new)))
  on conflict (path) do nothing;
  return null;
end $$;

do $$ declare t record; begin
  for t in select * from (values
    ('profiles', 'avatar_url'), ('posts', 'media'), ('stories', null), ('messages', 'media_url, meta'),
    ('dating_profiles', 'photos'), ('groups', 'cover_url'), ('events', 'cover_url'), ('highlights', 'cover_url'),
    ('highlight_items', null), ('listings', 'photos, thumb'), ('conversations', 'avatar_url')) as v(tbl, cols)
  loop
    execute format('drop trigger if exists media_collect on public.%I', t.tbl);
    execute format('create trigger media_collect after delete%s on public.%I for each row execute function public.media_collect()',
      case when t.cols is null then '' else ' or update of ' || t.cols end, t.tbl);
  end loop;
end $$;

-- ფაილს ჯერ კიდევ რამე იყენებს? გზის პირველი საქაღალდე ამტვირთავის id-ია — დიდ ცხრილებში მხოლოდ მის ჩანაწერებს ვამოწმებთ.
-- უცნობი ფორმის გზა — ყოველთვის „გამოიყენება“ (არასდროს წაიშლება).
create or replace function public.media_in_use(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare o uuid;
begin
  if p is null or split_part(p, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return true; end if;
  o := split_part(p, '/', 1)::uuid;
  return exists (select 1 from profiles where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from groups where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from events where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from conversations where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from posts where author_id = o and strpos(media::text, p) > 0)
    or exists (select 1 from stories where author_id = o and strpos(media_url, p) > 0)
    or exists (select 1 from highlights h where h.owner_id = o and (strpos(coalesce(h.cover_url, ''), p) > 0
               or exists (select 1 from highlight_items i where i.highlight_id = h.id and strpos(i.media_url, p) > 0)))
    or exists (select 1 from listings where seller_id = o and (strpos(photos::text, p) > 0 or strpos(coalesce(thumb, ''), p) > 0))
    or exists (select 1 from dating_profiles where user_id = o and strpos(photos::text, p) > 0)
    or exists (select 1 from messages m join conversation_members c on c.conversation_id = m.conversation_id and c.user_id = o
               where strpos(coalesce(m.media_url, '') || coalesce(m.meta::text, ''), p) > 0);
end $$;

-- დღიური დასუფთავება: აბრუნებს წასაშლელ გზებს (მაქს. p_limit) და რიგიდან იღებს
create or replace function public.media_cleanup_take(p_limit int default 200)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  n int := least(greatest(coalesce(p_limit, 200), 1), 1000);
  out text[] := '{}';
  r record;
  cur timestamptz;
begin
  -- 1) წაშლილი შიგთავსის ფაილები — საათის შემდეგ (თუ ფოტო ისევ სადმე გამოიყენება, რჩება)
  for r in select path from media_trash where created_at < now() - interval '1 hour' order by created_at limit n for update skip locked loop
    delete from media_trash where path = r.path;
    if not public.media_in_use(r.path) then out := out || r.path; end if;
  end loop;
  -- 2) ატვირთული, მაგრამ არსად მიმაგრებული — ერთი დღის შემდეგ, თითოეული ერთხელ (media_sweep.last_at-დან)
  select last_at into cur from media_sweep where id for update;
  if cur is not null and cardinality(out) < n then
    for r in select o.name, o.created_at from storage.objects o
             where o.bucket_id = 'media' and o.created_at > cur and o.created_at < now() - interval '1 day'
             order by o.created_at limit n * 2 loop
      cur := r.created_at;
      if not (r.name = any(out)) and not public.media_in_use(r.name) then out := out || r.name; end if;
      exit when cardinality(out) >= n;
    end loop;
    update media_sweep set last_at = cur where id;
  end if;
  return out;
end $$;

-- საცავმა თუ ვერ წაშალა — რიგში ბრუნდება, შემდეგ ჯერზე ვცდით
create or replace function public.media_cleanup_return(p_paths text[])
returns void language sql security definer set search_path = public as $$
  insert into media_trash (path, created_at) select unnest(p_paths), now() - interval '2 hours' on conflict (path) do nothing
$$;

revoke execute on function public.media_in_use(text) from public, anon, authenticated;
revoke execute on function public.media_cleanup_take(int) from public, anon, authenticated;
revoke execute on function public.media_cleanup_return(text[]) from public, anon, authenticated;
grant execute on function public.media_cleanup_take(int) to service_role;
grant execute on function public.media_cleanup_return(text[]) to service_role;

-- =====================================================================
-- ეტაპი H: თვიური სეზონები (ლიგებით და პრიზებით) და მეგობრების რეიტინგი
-- =====================================================================

-- სეზონი = კალენდარული თვე თბილისის დროით. სეზონის რეიტინგი იწყება საერთოდან, ნახევრად 1200-ისკენ დაბრუნებით
-- (1200 + (საერთო − 1200) / 2), და იცვლება ზუსტად იმავე Elo-ცვლილებით, რაც საერთო რეიტინგი.
-- ლიგები: ბრინჯაო < 1100 ≤ ვერცხლი < 1300 ≤ ოქრო < 1500 ≤ პლატინა < 1700 ≤ ალმასი.
-- სეზონის ბოლოს (10+ თამაში): 1-ლი 100, მე-2 60, მე-3 30 ბროწეული; ოქრო და ზემოთ — 15.
create or replace function public.season_now()
returns date language sql stable as $$ select date_trunc('month', now() at time zone 'Asia/Tbilisi')::date $$;

create or replace function public.season_league(r int)
returns text language sql immutable as $$
  select case when r >= 1700 then 'diamond' when r >= 1500 then 'platinum' when r >= 1300 then 'gold'
              when r >= 1100 then 'silver' else 'bronze' end
$$;

create or replace function public.season_start(p_rating int)
returns int language sql immutable as $$ select 1200 + round((coalesce(p_rating, 1200) - 1200) / 2.0)::int $$;

create table if not exists public.season_stats (
  season date not null,
  type text not null,
  user_id uuid not null references public.profiles on delete cascade,
  rating int not null,
  peak int not null,
  games int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season, type, user_id)
);
create index if not exists season_stats_board_idx on public.season_stats (season, type, rating desc);
create index if not exists season_stats_user_idx on public.season_stats (user_id, season);
alter table public.season_stats enable row level security;
drop policy if exists "season stats read" on public.season_stats;
create policy "season stats read" on public.season_stats for select to authenticated using (true);
grant select on public.season_stats to authenticated;

create table if not exists public.season_results (
  season date not null,
  type text not null,
  user_id uuid not null references public.profiles on delete cascade,
  place int not null,
  rating int not null,
  games int not null,
  league text not null,
  coins int not null default 0,
  primary key (season, type, user_id)
);
create index if not exists season_results_place_idx on public.season_results (season, type, place);
alter table public.season_results enable row level security;
drop policy if exists "season results read" on public.season_results;
create policy "season results read" on public.season_results for select to authenticated using (true);
grant select on public.season_results to authenticated;

create table if not exists public.seasons_closed (
  season date primary key,
  closed_at timestamptz not null default now()
);
alter table public.seasons_closed enable row level security;
revoke all on public.seasons_closed from anon, authenticated;

-- ყოველი რეიტინგული თამაშის შედეგი (apply_result, svc_finish_table) სეზონის ცხრილშიც აისახება
create or replace function public.season_track()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_d int := new.rating - old.rating; v_start int;
begin
  if new.wins + new.losses + new.draws <= old.wins + old.losses + old.draws then return null; end if;
  v_start := public.season_start(old.rating);
  insert into season_stats as ss (season, type, user_id, rating, peak, games, wins, losses, draws)
  values (public.season_now(), new.type, new.user_id, v_start + v_d, greatest(v_start, v_start + v_d), 1,
          new.wins - old.wins, new.losses - old.losses, new.draws - old.draws)
  on conflict (season, type, user_id) do update set
    rating = ss.rating + v_d,
    peak = greatest(ss.peak, ss.rating + v_d),
    games = ss.games + 1,
    wins = ss.wins + excluded.wins, losses = ss.losses + excluded.losses, draws = ss.draws + excluded.draws,
    updated_at = now();
  return null;
end $$;
drop trigger if exists season_track on public.game_stats;
create trigger season_track after update on public.game_stats
  for each row execute function public.season_track();

-- დასრულებული სეზონების დახურვა: ადგილები, პრიზები, შეტყობინება. ერთხელ თითო სეზონზე (seasons_closed),
-- იძახებს keep_alive (Vercel-ის დღიური cron) და game_board — ვინც პირველი შემოვა ახალ თვეში.
create or replace function public.season_finalize_due()
returns int language plpgsql security definer set search_path = public as $$
declare s date; r record; v_coins int; n int := 0;
begin
  for s in select distinct ss.season from season_stats ss
            where ss.season < public.season_now()
              and not exists (select 1 from seasons_closed c where c.season = ss.season)
            order by 1 loop
    insert into seasons_closed (season) values (s) on conflict do nothing;
    if not found then continue; end if;
    for r in select x.*, row_number() over (partition by x.type order by x.rating desc, x.wins desc, x.updated_at) as place
               from season_stats x join profiles p on p.id = x.user_id
              where x.season = s and x.games >= 10 and (p.banned_until is null or p.banned_until < now()) loop
      v_coins := case r.place when 1 then 100 when 2 then 60 when 3 then 30
                   else case when r.rating >= 1300 then 15 else 0 end end;
      insert into season_results (season, type, user_id, place, rating, games, league, coins)
      values (s, r.type, r.user_id, r.place, r.rating, r.games, public.season_league(r.rating), v_coins)
      on conflict do nothing;
      if v_coins > 0 then perform public.award(r.user_id, 'season', 0, v_coins, s::text || ':' || r.type); end if;
      insert into notifications (user_id, type, data) values (r.user_id, 'season_end', jsonb_build_object(
        'season', s, 'type', r.type, 'place', r.place, 'rating', r.rating, 'league', public.season_league(r.rating),
        'coins', v_coins, 'games', r.games));
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.season_finalize_due() from public, anon, authenticated;

-- გაღვიძება (ეტაპი G) ახლა დასრულებულ სეზონებსაც ხურავს
create or replace function public.keep_alive()
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  perform public.season_finalize_due();
  return now();
end $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- რეიტინგის ცხრილი: p_period 'season' (მიმდინარე თვე) ან 'all' (საერთო), p_scope 'all' ან 'friends' (შენ + ვისაც გამოიწერ)
create or replace function public.game_board(p_type text, p_period text default 'season', p_scope text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s date := public.season_now();
  v_rows jsonb; v_me jsonb; v_champs jsonb; v_all int;
begin
  if me is null then return null; end if;
  perform public.season_finalize_due();
  select rating into v_all from game_stats where user_id = me and type = p_type;
  with pool as (
    select x.user_id, x.rating, x.games, x.wins, x.losses, x.draws
      from (select g.user_id, g.rating, g.wins + g.losses + g.draws as games, g.wins, g.losses, g.draws
              from game_stats g where p_period = 'all' and g.type = p_type
            union all
            select ss.user_id, ss.rating, ss.games, ss.wins, ss.losses, ss.draws
              from season_stats ss where p_period <> 'all' and ss.season = s and ss.type = p_type) x
      join profiles p on p.id = x.user_id
     where x.games > 0 and p.onboarded and (p.banned_until is null or p.banned_until < now())
       and not public.is_blocked(me, x.user_id)
       and (p_scope <> 'friends' or x.user_id = me
            or exists (select 1 from follows f where f.follower_id = me and f.following_id = x.user_id))
  ), ranked as (
    select pool.*, rank() over (order by rating desc) as pos from pool
  ), shown as (
    select r.*, jsonb_build_object('pos', r.pos, 'user_id', r.user_id, 'rating', r.rating, 'games', r.games,
             'wins', r.wins, 'losses', r.losses, 'draws', r.draws,
             'league', case when p_period = 'all' then null else public.season_league(r.rating) end,
             'provisional', p_period <> 'all' and r.games < 5,
             'p', jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
                                     'avatar_url', p.avatar_url, 'verified', p.verified)) as j
      from ranked r join profiles p on p.id = r.user_id
  )
  select (select coalesce(jsonb_agg(j order by pos, rating desc, user_id), '[]'::jsonb) from (select * from shown order by pos, user_id limit 50) t),
         (select j from shown where user_id = me)
    into v_rows, v_me;
  select coalesce(jsonb_agg(jsonb_build_object('place', r.place, 'rating', r.rating, 'league', r.league,
           'p', jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'verified', p.verified))
           order by r.place), '[]'::jsonb)
    into v_champs
    from season_results r join profiles p on p.id = r.user_id
   where r.season = (s - interval '1 month')::date and r.type = p_type and r.place <= 3;
  return jsonb_build_object(
    'period', p_period, 'scope', p_scope, 'type', p_type,
    'season', s, 'ends_at', (s + interval '1 month')::timestamp at time zone 'Asia/Tbilisi',
    'rows', v_rows, 'me', v_me, 'champions', v_champs,
    'start', public.season_start(v_all));
end $$;
grant execute on function public.game_board(text, text, text) to authenticated;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote',
  'group_request', 'group_approved', 'event_rsvp', 'tournament_start', 'tournament_end',
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention', 'season_end'));

-- Push: კატეგორიები და ტექსტები (სეზონის დასრულება — „თამაშების“ კატეგორიაში)
create or replace function public.push_category(p_payload jsonb)
returns text language sql immutable as $$
  select case
    when p_payload ->> 'tag' like 'conv-%' then 'messages'
    when p_payload ->> 'tag' like 'call-%' then 'calls'
    when p_payload ->> 'tag' like 'game-%' then 'games'
    when p_payload ->> 'tag' ~ '^n-(reply|quote|mention)-' then 'replies'
    when p_payload ->> 'tag' ~ '^n-like-' then 'likes'
    when p_payload ->> 'tag' ~ '^n-(follow|follow_request|follow_accept|invite_joined)-' then 'follows'
    when p_payload ->> 'tag' ~ '^n-(game_invite|tournament_start|tournament_end|season_end)-' then 'games'
    when p_payload ->> 'tag' ~ '^n-match-' then 'dating'
    when p_payload ->> 'tag' ~ '^n-listing_price-' then 'market'
    when p_payload ->> 'tag' ~ '^n-(group_request|group_approved|event_rsvp)-' then 'groups'
    when p_payload ->> 'tag' ~ '^n-(gift|achievement|level_up)-' then 'rewards'
    else 'other' end;
$$;

-- Push-ის ტექსტები ყველა ტიპისთვის (მოხსენიება, სეზონის დასრულება)
create or replace function public.on_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor text; v_group text; v_event text;
begin
  select coalesce(nullif(full_name, ''), username) into v_actor from profiles where id = new.actor_id;
  select name into v_group from groups where id = new.group_id;
  select title into v_event from events where id = new.event_id;
  perform public.push_dispatch(new.user_id, jsonb_build_object(
    'title', case when new.type like 'tournament%' or new.type = 'listing_price' then coalesce(new.data ->> 'title', 'ეზო') else coalesce(v_actor, 'ეზო') end,
    'body', case new.type
      when 'season_end' then case when (new.data ->> 'place')::int = 1
          then '🏆 სეზონის ჩემპიონი — ' || public.game_title(new.data ->> 'type') || '! +' || (new.data ->> 'coins') || ' ბროწეული'
          else 'სეზონი დასრულდა — ' || public.game_title(new.data ->> 'type') || ': მე-' || (new.data ->> 'place') || ' ადგილი'
            || case when (new.data ->> 'coins')::int > 0 then ', +' || (new.data ->> 'coins') || ' ბროწეული' else '' end end
      when 'tournament_start' then 'ტურნირი დაიწყო — შემოდი და ითამაშე'
      when 'tournament_end' then case when (new.data ->> 'place')::int = 1 then '🏆 გაიმარჯვე ტურნირში!'
        else 'ტურნირი დასრულდა. შენი ადგილი: მე-' || (new.data ->> 'place') || ' (' || (new.data ->> 'players') || '-დან)' end
      when 'like' then 'მოიწონა შენი პოსტი' when 'reply' then 'გიპასუხა' when 'quote' then 'გაგიზიარა ციტატით'
      when 'mention' then 'მოგიხსენია: ' || coalesce(left((select body from posts where id = new.post_id), 100), '')
      when 'follow' then 'გამოგიწერა' when 'gift' then 'საჩუქარი გამოგიგზავნა'
      when 'follow_request' then 'გამოწერას გთხოვს' when 'follow_accept' then 'დაგიდასტურა გამოწერა'
      when 'achievement' then 'ახალი მიღწევა: ' || coalesce((select title from badges where key = new.data ->> 'badge'), '') || ' (+' || (new.data ->> 'coins') || ' ბროწეული)'
      when 'invite_joined' then 'შენი მოწვევით შემოგვიერთდა 🎉 +20 ბროწეული'
      when 'level_up' then 'ახალი დონე: ' || (new.data ->> 'level') || '! +' || (new.data ->> 'coins') || ' ბროწეული'
      when 'listing_price' then 'შენახულ განცხადებას ფასი დაუკლეს: ' || public.price_text((new.data ->> 'price')::numeric, new.data ->> 'currency')
      when 'match' then 'თქვენ ერთმანეთი მოიწონეთ!' when 'game_invite' then 'თამაშში გეპატიჟება'
      when 'group_request' then 'ითხოვს გაწევრიანებას: ' || coalesce(v_group, 'ჯგუფი')
      when 'group_approved' then 'მიგიღეს ჯგუფში: ' || coalesce(v_group, '')
      when 'event_rsvp' then 'მოდის: ' || coalesce(v_event, 'შენს ივენთზე')
      else 'ახალი შეტყობინება' end,
    'url', case when new.type = 'game_invite' and new.game_id is not null then '/g/' || new.game_id
                when new.tournament_id is not null then '/t/' || new.tournament_id
                when new.type = 'match' then '/dating?tab=matches'
                when new.type = 'follow_request' then '/requests'
                when new.type = 'listing_price' then '/market/' || (new.data ->> 'listing_id')
                when new.type = 'season_end' then '/games?board=' || (new.data ->> 'type')
                when new.type in ('achievement', 'level_up') then '/rewards'
                when new.group_id is not null then '/groups/' || (select slug from groups where id = new.group_id)
                when new.event_id is not null then '/events/' || new.event_id
                when new.post_id is not null then '/p/' || new.post_id else '/notifications' end,
    'tag', 'n-' || new.type || '-' || coalesce(new.post_id::text, new.group_id::text, new.tournament_id::text, new.data ->> 'listing_id', new.data ->> 'type', new.actor_id::text, '')));
  return new;
end $$;

-- =====================================================================
-- ეტაპი I: ჩატი — ძებნა, მიმაგრება და დადუმება, ქრებადი მესიჯები, გამოკითხვა ჯგუფურ ჩატში
-- =====================================================================

-- ---- მიმაგრება (მაქსიმუმ 5) და დადუმება — თითოეულ წევრს თავისი
alter table public.conversation_members add column if not exists pinned_at timestamptz;
alter table public.conversation_members add column if not exists muted_until timestamptz;

-- p_pin: true/false; p_mute_hours: 0 — ხმის ჩართვა, -1 — სამუდამოდ, N — N საათით
create or replace function public.set_chat_prefs(p_conv uuid, p_pin boolean default null, p_mute_hours int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v conversation_members;
begin
  select * into v from conversation_members where conversation_id = p_conv and user_id = auth.uid() for update;
  if not found then raise exception 'ჩატი ვერ მოიძებნა'; end if;
  if p_pin is not null then
    if p_pin and v.pinned_at is null
       and (select count(*) from conversation_members where user_id = auth.uid() and pinned_at is not null) >= 5 then
      raise exception 'მიმაგრება შეიძლება მაქსიმუმ 5 ჩატის';
    end if;
    update conversation_members set pinned_at = case when p_pin then coalesce(pinned_at, now()) end
     where conversation_id = p_conv and user_id = auth.uid();
  end if;
  if p_mute_hours is not null then
    update conversation_members set muted_until = case when p_mute_hours = 0 then null
        when p_mute_hours < 0 then 'infinity'::timestamptz
        else now() + make_interval(hours => least(p_mute_hours, 24 * 365)) end
     where conversation_id = p_conv and user_id = auth.uid();
  end if;
  select * into v from conversation_members where conversation_id = p_conv and user_id = auth.uid();
  return jsonb_build_object('pinned', v.pinned_at is not null, 'muted', coalesce(v.muted_until > now(), false),
    'mute_forever', coalesce(v.muted_until = 'infinity'::timestamptz, false),
    'muted_until', case when v.muted_until <> 'infinity'::timestamptz then v.muted_until end);
end $$;
grant execute on function public.set_chat_prefs(uuid, boolean, int) to authenticated;

-- ---- ქრებადი მესიჯები: ჩატის პარამეტრი — 24 საათი ან 7 დღე. ახალ მესიჯს ვადა უჩნდება;
-- ვადაგასული აღარავის უჩანს (RLS) და დღიური „გაღვიძებისას“ იშლება (ფოტო/ხმოვანიც — ეტაპი G-ის დასუფთავებით)
alter table public.conversations add column if not exists disappear_hours int;
alter table public.conversations drop constraint if exists conversations_disappear_check;
alter table public.conversations add constraint conversations_disappear_check check (disappear_hours is null or disappear_hours in (24, 168));
alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- ახალი მესიჯი: ვადა (ქრებად ჩატში) და გამოკითხვის შემოწმება
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_kind text; v_hours int; v_opts jsonb;
begin
  select kind, disappear_hours into v_kind, v_hours from conversations where id = new.conversation_id;
  new.expires_at := case when v_hours is not null and not (new.meta ? 'system') and not (new.meta ? 'call')
                         then now() + make_interval(hours => v_hours) end;
  if new.meta ? 'poll' then
    v_opts := new.meta -> 'poll' -> 'options';
    if v_kind is distinct from 'group' then raise exception 'გამოკითხვა მხოლოდ ჯგუფურ ჩატშია'; end if;
    if jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) not between 2 and 10
       or exists (select 1 from jsonb_array_elements(v_opts) o where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 100)
       or char_length(btrim(new.body)) not between 1 and 300 then
      raise exception 'გამოკითხვას სჭირდება კითხვა და 2–10 პასუხი';
    end if;
    new.media_url := null; new.media_type := null;
    new.meta := jsonb_build_object('poll', jsonb_build_object(
      'options', (select jsonb_agg(btrim(o #>> '{}')) from jsonb_array_elements(v_opts) o),
      'multi', coalesce((new.meta -> 'poll' ->> 'multi')::boolean, false)));
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated
  using (public.is_member(conversation_id) and (expires_at is null or expires_at > now()));

-- ჩართვა/გამორთვა: პირად ჩატში ორივეს შეუძლია, ჯგუფურში — ადმინს. ჩატში ჩნდება სისტემური შეტყობინება.
create or replace function public.set_disappearing(p_conv uuid, p_hours int)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_old int;
begin
  if p_hours is not null and p_hours not in (24, 168) then raise exception 'ვადა უნდა იყოს 24 საათი ან 7 დღე'; end if;
  if not public.is_member(p_conv) or not public.can_act() then raise exception 'ჩატი ვერ მოიძებნა'; end if;
  select kind, disappear_hours into v_kind, v_old from conversations where id = p_conv for update;
  if v_kind = 'group' and public.chat_role(p_conv) is distinct from 'admin' then
    raise exception 'ჯგუფურ ჩატში ამას მხოლოდ ადმინი ცვლის';
  end if;
  if v_old is not distinct from p_hours then return; end if;
  update conversations set disappear_hours = p_hours where id = p_conv;
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(),
    case when p_hours is null then 'გამორთო ქრებადი მესიჯები'
         when p_hours = 24 then 'ჩართო ქრებადი მესიჯები: ახალი მესიჯები ქრება 24 საათში'
         else 'ჩართო ქრებადი მესიჯები: ახალი მესიჯები ქრება 7 დღეში' end,
    jsonb_build_object('system', true, 'disappear', p_hours));
end $$;
grant execute on function public.set_disappearing(uuid, int) to authenticated;

create or replace function public.purge_expired_messages()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from messages where id in (select id from messages where expires_at < now() order by expires_at limit 5000);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_expired_messages() from public, anon, authenticated;

-- დღიური „გაღვიძება“ (ეტაპი G, H): სეზონების დახურვა და ვადაგასული მესიჯების წაშლა
create or replace function public.keep_alive()
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  perform public.season_finalize_due();
  perform public.purge_expired_messages();
  return now();
end $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- ---- შემოსულები: მიმაგრებული ზემოთ, დადუმება, ქრებადობა; ვადაგასული ბოლო მესიჯი აღარ ჩანს
drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (id uuid, kind text, updated_at timestamptz, last_message text, last_sender uuid, unread boolean, other jsonb,
               title text, avatar_url text, my_role text, members_count bigint, members jsonb, last_sender_name text,
               pinned boolean, muted boolean, mute_forever boolean, muted_until timestamptz, disappear_hours int)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.updated_at,
    case when c.disappear_hours is not null and c.updated_at < now() - make_interval(hours => c.disappear_hours) then null else c.last_message end,
    c.last_sender,
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
    (select coalesce(nullif(split_part(full_name, ' ', 1), ''), username) from profiles where id = c.last_sender),
    m.pinned_at is not null, coalesce(m.muted_until > now(), false), coalesce(m.muted_until = 'infinity'::timestamptz, false),
    case when m.muted_until <> 'infinity'::timestamptz then m.muted_until end,
    c.disappear_hours
  from conversations c
  join conversation_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  where public.mfa_ok()
  order by m.pinned_at desc nulls last, c.updated_at desc;
$$;
grant execute on function public.my_conversations() to authenticated;

-- ---- Push: დადუმებულ წევრს არა; გამოკითხვა — „📊 კითხვა“
create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid; v_kind text; v_title text; v_text text;
begin
  if new.meta ? 'call' then return new; end if;
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  select kind, title into v_kind, v_title from conversations where id = new.conversation_id;
  v_text := case when new.meta ? 'poll' then '📊 ' || left(new.body, 130)
                 when new.media_type = 'image' then '📷 ფოტო' when new.media_type = 'audio' then '🎙 ხმოვანი მესიჯი'
                 else left(new.body, 140) end;
  for v_member in
    select user_id from conversation_members
     where conversation_id = new.conversation_id and user_id <> new.sender_id
       and (muted_until is null or muted_until <= now())
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', case when v_kind = 'group' then coalesce(v_title, 'ჯგუფური ჩატი') else coalesce(v_sender, 'ეზო') end,
      'body', case when v_kind = 'group' then coalesce(v_sender, '') || ': ' || v_text else v_text end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;

-- შემოსულების ბოლო მესიჯი გამოკითხვისთვის
create or replace function public.on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set
    last_message = case when new.media_type = 'image' then '📷 ფოტო'
                        when new.media_type = 'audio' then '🎙 ხმოვანი'
                        when new.meta ? 'call' then case when new.meta -> 'call' ->> 'status' in ('missed', 'declined', 'busy')
                                                         then '📞 გამოტოვებული ზარი' else '📞 ზარი' end
                        when new.meta ? 'poll' then '📊 ' || left(new.body, 110)
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

-- ---- მესიჯებში ძებნა: ჩემს ჩატებში (ან ერთ ჩატში), ქართული/ლათინური ერთნაირად (ka_skeleton, ეტაპი C)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists messages_search_trgm on public.messages using gin (public.ka_skeleton(body) %I.gin_trgm_ops) where deleted_at is null', s);
  end if;
end $$;

create or replace function public.search_messages(p_q text, p_conv uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k text := public.ka_skeleton(btrim(coalesce(p_q, '')));
begin
  if auth.uid() is null or char_length(k) < 2 or not public.mfa_ok() then return '[]'::jsonb; end if;
  k := replace(replace(replace(k, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select m.id, m.conversation_id, m.sender_id, left(m.body, 300) as body, m.created_at, c.kind, c.title,
           (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
              from profiles p where p.id = m.sender_id) as sender,
           case when c.kind <> 'group' then
             (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
                from conversation_members o join profiles p on p.id = o.user_id
               where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end as other
      from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
      join conversations c on c.id = m.conversation_id
     where (p_conv is null or m.conversation_id = p_conv)
       and m.deleted_at is null and (m.expires_at is null or m.expires_at > now())
       and m.body <> '' and not (m.meta ? 'system')
       and public.ka_skeleton(m.body) like '%' || k || '%'
     order by m.created_at desc
     limit 50) x), '[]'::jsonb);
end $$;
grant execute on function public.search_messages(text, uuid) to authenticated;

-- ---- გამოკითხვა ჯგუფურ ჩატში: მესიჯი meta.poll = { options[], multi }, ხმები — ცალკე (ჩატის წევრები ხედავენ)
create table if not exists public.chat_poll_votes (
  message_id uuid not null references public.messages on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  option int not null check (option between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option)
);
create index if not exists chat_poll_votes_conv_idx on public.chat_poll_votes (conversation_id);
alter table public.chat_poll_votes enable row level security;
drop policy if exists "poll votes read" on public.chat_poll_votes;
create policy "poll votes read" on public.chat_poll_votes for select to authenticated using (public.is_member(conversation_id));
grant select on public.chat_poll_votes to authenticated;
alter table public.chat_poll_votes replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.chat_poll_votes; exception when duplicate_object then null; end;
end $$;

-- ჩემი ხმა: p_options — არჩეული პასუხები (ცარიელი — ხმის გაუქმება)
create or replace function public.vote_chat_poll(p_msg uuid, p_options int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_m messages; v_n int; v_multi boolean; v_opts int[];
begin
  select * into v_m from messages where id = p_msg;
  if not found or not public.is_member(v_m.conversation_id) or v_m.deleted_at is not null or not (v_m.meta ? 'poll')
     or (v_m.expires_at is not null and v_m.expires_at <= now()) then
    raise exception 'გამოკითხვა ვერ მოიძებნა';
  end if;
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  v_n := jsonb_array_length(v_m.meta -> 'poll' -> 'options');
  v_multi := coalesce((v_m.meta -> 'poll' ->> 'multi')::boolean, false);
  v_opts := array(select distinct x from unnest(coalesce(p_options, '{}'::int[])) x order by x);
  if exists (select 1 from unnest(v_opts) x where x < 0 or x >= v_n) then raise exception 'ასეთი პასუხი არ არის'; end if;
  if not v_multi and cardinality(v_opts) > 1 then raise exception 'აქ მხოლოდ ერთი პასუხი შეიძლება'; end if;
  delete from chat_poll_votes where message_id = p_msg and user_id = auth.uid() and not (option = any(v_opts));
  insert into chat_poll_votes (message_id, conversation_id, user_id, option)
  select p_msg, v_m.conversation_id, auth.uid(), x from unnest(v_opts) x
  on conflict do nothing;
end $$;
grant execute on function public.vote_chat_poll(uuid, int[]) to authenticated;
