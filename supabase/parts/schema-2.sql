-- ეზო — სქემის ნაწილი 2/8. გაუშვი 1-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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
