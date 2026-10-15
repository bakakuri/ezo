\set ON_ERROR_STOP 1
-- ეტაპი H: თვიური სეზონები, ლიგები, პრიზები, მეგობრების რეიტინგი
insert into auth.users (id, email) values
 ('a7a00000-0000-0000-0000-00000000000a','a@x'), ('b7b00000-0000-0000-0000-00000000000b','b@x'),
 ('c7c00000-0000-0000-0000-00000000000c','c@x');
update profiles set onboarded = true;
update profiles set username = 'anna', full_name = 'ანა' where id = 'a7a00000-0000-0000-0000-00000000000a';
update profiles set username = 'beka', full_name = 'ბექა' where id = 'b7b00000-0000-0000-0000-00000000000b';
update profiles set username = 'cira', full_name = 'ცირა' where id = 'c7c00000-0000-0000-0000-00000000000c';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a7a00000-0000-0000-0000-00000000000a'''
\set B '''b7b00000-0000-0000-0000-00000000000b'''
\set C '''c7c00000-0000-0000-0000-00000000000c'''
insert into follows (follower_id, following_id) values (:A, :B);

-- საერთო რეიტინგი: ანა 1400 (სეზონი იწყება 1300-ით), ბექა 1200, ცირა 1100 (→ 1150)
insert into game_stats (user_id, type, rating, wins, losses) values (:A, 'nardi', 1400, 20, 5), (:B, 'nardi', 1200, 3, 3), (:C, 'nardi', 1100, 1, 4);

-- თამაშის შედეგი (როგორც apply_result): ანამ მოიგო ბექასთან (+10 / −10)
update game_stats set rating = rating + 10, wins = wins + 1 where user_id = :A and type = 'nardi';
update game_stats set rating = rating - 10, losses = losses + 1 where user_id = :B and type = 'nardi';
-- ფრე: ცირა +4
update game_stats set rating = rating + 4, draws = draws + 1 where user_id = :C and type = 'nardi';
-- მხოლოდ რეიტინგის შეცვლა (თამაშის გარეშე) სეზონს არ ეხება
update game_stats set rating = rating + 100 where user_id = :C and type = 'nardi';
select user_id, rating, peak, games, wins, losses, draws from season_stats order by rating desc;
do $$ begin
  if (select rating from season_stats where user_id = 'a7a00000-0000-0000-0000-00000000000a') <> 1310 then raise exception 'A season rating'; end if;
  if (select rating from season_stats where user_id = 'b7b00000-0000-0000-0000-00000000000b') <> 1190 then raise exception 'B season rating'; end if;
  if (select rating || '/' || draws || '/' || games from season_stats where user_id = 'c7c00000-0000-0000-0000-00000000000c') <> '1154/1/1' then raise exception 'C season'; end if;
  if public.season_league(1310) <> 'gold' or public.season_league(1099) <> 'bronze' or public.season_league(1700) <> 'diamond' then raise exception 'leagues'; end if;
end $$;
-- მეორე თამაში — სეზონის ჩანაწერი იზრდება
update game_stats set rating = rating + 8, wins = wins + 1 where user_id = :A and type = 'nardi';
do $$ begin
  if (select rating || '/' || games || '/' || peak from season_stats where user_id = 'a7a00000-0000-0000-0000-00000000000a') <> '1318/2/1318' then raise exception 'A second game'; end if;
end $$;

-- ცხრილი: სეზონი, ყველა / მეგობრები; საერთო
select pg_temp.as_user(:A); set role authenticated;
select jsonb_array_length(b -> 'rows') as season_rows, b -> 'me' ->> 'pos' as my_pos, b -> 'me' ->> 'league' as my_league,
       b -> 'me' ->> 'provisional' as prov from (select public.game_board('nardi', 'season', 'all') b) x;
do $$ declare b jsonb; begin
  b := public.game_board('nardi', 'season', 'all');
  if jsonb_array_length(b -> 'rows') <> 3 or (b -> 'rows' -> 0 -> 'p' ->> 'username') <> 'anna' then raise exception 'season board: %', b -> 'rows'; end if;
  if (b -> 'me' ->> 'pos')::int <> 1 or (b -> 'me' ->> 'league') <> 'gold' or not (b -> 'me' ->> 'provisional')::boolean then raise exception 'me: %', b -> 'me'; end if;
  b := public.game_board('nardi', 'season', 'friends');
  if jsonb_array_length(b -> 'rows') <> 2 or exists (select 1 from jsonb_array_elements(b -> 'rows') r where r -> 'p' ->> 'username' = 'cira') then raise exception 'friends: %', b -> 'rows'; end if;
  b := public.game_board('nardi', 'all', 'all');
  if (b -> 'rows' -> 0 ->> 'rating')::int <> 1418 or (b -> 'rows' -> 0 ->> 'league') is not null then raise exception 'all-time: %', b -> 'rows' -> 0; end if;
  if (b ->> 'start')::int <> 1309 then raise exception 'start: %', b ->> 'start'; end if;
  b := public.game_board('chess', 'season', 'all');
  if jsonb_array_length(b -> 'rows') <> 0 or b -> 'me' <> 'null'::jsonb then raise exception 'empty chess: %', b; end if;
end $$;
-- პირდაპირ ჩაწერა და დახურვა — აკრძალულია
do $$ begin insert into season_stats (season, type, user_id, rating, peak) values (public.season_now(), 'nardi', auth.uid(), 3000, 3000); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: no direct writes'; end $$;
do $$ begin perform public.season_finalize_due(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: finalize not callable'; end $$;
reset role;

insert into app_secrets (key, value) values ('push_url', 'https://push.example/send') on conflict (key) do update set value = excluded.value;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (:A, 'https://push.example/a', 'k', 'a'), (:B, 'https://push.example/b', 'k', 'b');
-- წინა თვის სეზონი: ანა 1400 (12 თამაში), ბექა 1350 (11), ცირა 1500 მაგრამ 3 თამაში (პრიზის გარეშე)
insert into season_stats (season, type, user_id, rating, peak, games, wins) values
  ((public.season_now() - interval '1 month')::date, 'nardi', :A, 1400, 1420, 12, 9),
  ((public.season_now() - interval '1 month')::date, 'nardi', :B, 1350, 1350, 11, 7),
  ((public.season_now() - interval '1 month')::date, 'nardi', :C, 1500, 1500, 3, 3);
select pg_temp.as_user(:B); set role authenticated;
select b -> 'champions' as champions from (select public.game_board('nardi') b) x;
reset role;
select user_id, place, coins, league from season_results order by place;
do $$ begin
  if (select string_agg(place || ':' || coins || ':' || league, ',' order by place) from season_results) <> '1:100:gold,2:60:gold' then raise exception 'results: %', (select string_agg(place || ':' || coins, ',') from season_results); end if;
  if (select sum(coins) from progress_events where user_id = 'a7a00000-0000-0000-0000-00000000000a' and kind = 'season') <> 100 then raise exception 'A coins'; end if;
  if (select count(*) from notifications where type = 'season_end') <> 2 then raise exception 'notifications'; end if;
end $$;
-- განმეორებით — არაფერი იცვლება
set role anon;
select public.keep_alive() is not null as alive;
reset role;
do $$ begin
  if (select count(*) from notifications where type = 'season_end') <> 2 or (select count(*) from progress_events where kind = 'season') <> 2 then raise exception 'finalized twice'; end if;
  if (select count(*) from seasons_closed) <> 1 then raise exception 'closed'; end if;
end $$;
-- Push: სეზონის დასრულება „თამაშების“ კატეგორიაშია
select public.push_category('{"tag":"n-season_end-nardi"}') as cat;
do $$ begin if public.push_category('{"tag":"n-season_end-nardi"}') <> 'games' then raise exception 'category'; end if; end $$;
select body -> 'payload' ->> 'body' as push_text, body -> 'payload' ->> 'url' as url from net.calls where body -> 'payload' ->> 'tag' like 'n-season_end-%' order by id;
do $$ begin
  if (select count(*) from net.calls where body -> 'payload' ->> 'tag' = 'n-season_end-nardi') <> 2 then raise exception 'season push count'; end if;
  if not exists (select 1 from net.calls where body -> 'payload' ->> 'body' like '🏆 სეზონის ჩემპიონი — ნარდი! +100 ბროწეული') then raise exception 'champion push text'; end if;
  if not exists (select 1 from net.calls where body -> 'payload' ->> 'body' = 'სეზონი დასრულდა — ნარდი: მე-2 ადგილი, +60 ბროწეული' and body -> 'payload' ->> 'url' = '/games?board=nardi') then raise exception 'second place push'; end if;
end $$;
