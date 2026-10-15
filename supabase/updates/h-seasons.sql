-- ეზო — განახლება H: თვიური სეზონები (ლიგები, პრიზები) და მეგობრების რეიტინგი
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- საჭიროა წინა განახლებები (A–G). განმეორებით გაშვება უსაფრთხოა.

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
