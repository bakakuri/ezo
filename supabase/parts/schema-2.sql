-- ეზო — სქემის ნაწილი 2/8. გაუშვი 1-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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
