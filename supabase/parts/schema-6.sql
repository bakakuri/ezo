-- ეზო — სქემის ნაწილი 6/8. გაუშვი 5-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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
