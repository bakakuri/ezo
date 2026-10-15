-- ეზო — სქემის ნაწილი 5/8. გაუშვი 4-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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
