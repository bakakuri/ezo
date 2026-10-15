-- ეზო — სქემის ნაწილი 5/9. გაუშვი 4-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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
