\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('a9a00000-0000-0000-0000-00000000000a','a@x'), ('a9b00000-0000-0000-0000-00000000000b','b@x'),
 ('a9c00000-0000-0000-0000-00000000000c','c@x');
update profiles set onboarded = true;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a9a00000-0000-0000-0000-00000000000a'''
\set B '''a9b00000-0000-0000-0000-00000000000b'''
\set C '''a9c00000-0000-0000-0000-00000000000c'''

select public.level_of(0) l0, public.level_of(99) l99, public.level_of(100) l100, public.level_of(300) l300, public.level_of(4500) l4500;

-- დღიური შესვლა
select pg_temp.as_user(:A); set role authenticated;
select public.daily_checkin() ->> 'reward' as first_reward, (public.daily_checkin()) ->> 'claimed' as second_claimed;
select coins, xp, streak from progress;
-- პირდაპირ ვერ შეცვლის
update progress set coins = 9999;
select coins as coins_after_hack from progress;
do $$ begin insert into progress_events (user_id, kind, coins) values (auth.uid(), 'hack', 500); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot insert events'; end $$;
do $$ begin perform public.award(auth.uid(), 'hack', 1000, 1000); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: award not callable: %', sqlerrm; end $$;
reset role;

-- სერიის მე-7 დღე → ბონუსი და ბეჯი
update progress set last_day = public.tbilisi_today() - 1, streak = 6 where user_id = :A;
delete from progress_events where user_id = :A and kind = 'checkin';
select pg_temp.as_user(:A); set role authenticated;
select r ->> 'streak' as streak, r ->> 'reward' as reward from (select public.daily_checkin() as r) x;
select badge from user_badges where user_id = auth.uid() order by badge;
-- 12 პოსტი: XP მხოლოდ 10-ზე
do $$ begin for i in 1..12 loop insert into posts (author_id, body) values (auth.uid(), 'პოსტი ' || i); end loop; end $$;
select count(*) filter (where kind = 'post') as post_events, sum(xp) filter (where kind = 'post') as post_xp from progress_events;
select badge from user_badges where user_id = auth.uid() order by badge;
reset role;

-- B: მოწონება → A-ს XP; საკუთარი არ ითვლება; გამოწერა
select pg_temp.as_user(:B); set role authenticated;
insert into likes (user_id, post_id) select auth.uid(), id from posts where author_id = :A limit 3;
insert into follows (follower_id, following_id) values (auth.uid(), :A);
-- ფასიანი საჩუქარი ბალანსის გარეშე
do $$ begin insert into gifts (from_id, to_id, kind) values (auth.uid(), 'a9a00000-0000-0000-0000-00000000000a', 'wine'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: no coins: %', sqlerrm; end $$;
reset role;
select kind, count(*), sum(xp) from progress_events where user_id = :A and kind in ('like', 'follower') group by kind order by kind;

-- დონის აწევა
select public.award(:A, 'test', 100, 0);
select type, data from notifications where user_id = :A and type in ('level_up', 'achievement') order by created_at, type;

-- A: საჩუქრები (ბალანსი 50)
update progress set coins = 50 where user_id = :A;
select pg_temp.as_user(:A); set role authenticated;
select coins as before_gifts from progress;
do $$ begin insert into gifts (from_id, to_id, kind) values (auth.uid(), 'a9b00000-0000-0000-0000-00000000000b', 'crown'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: crown too expensive'; end $$;
insert into gifts (from_id, to_id, kind) values (auth.uid(), :B, 'rose');
select coins as after_rose from progress;
do $$ begin for i in 1..5 loop insert into gifts (from_id, to_id, kind) values (auth.uid(), 'a9b00000-0000-0000-0000-00000000000b', 'heart'); end loop; end $$;
do $$ begin insert into gifts (from_id, to_id, kind) values (auth.uid(), 'a9b00000-0000-0000-0000-00000000000b', 'heart'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: free gift cap'; end $$;
reset role;
select sum(xp) as b_gift_xp, count(*) as b_gift_events from progress_events where user_id = :B and kind = 'gift_received';

-- თამაში
insert into games (type, status, player_a, player_b, state, move_no) values ('chess', 'active', :A, :B, '{}', 10) returning id as g1 \gset
update games set status = 'finished', winner = :A where id = :'g1';
insert into games (type, status, player_a, player_b, state, move_no) values ('chess', 'active', :A, :B, '{}', 1) returning id as g2 \gset
update games set status = 'finished', winner = :A where id = :'g2';
select user_id = :A as is_a, kind, xp, coins from progress_events where kind in ('game', 'win') order by user_id, kind;
insert into game_stats (user_id, type, wins) values (:A, 'chess', 49);
update game_stats set wins = 50 where user_id = :A;

-- გაყიდვა ერთხელ
select pg_temp.as_user(:A); set role authenticated;
insert into listings (seller_id, title, category, price) values (auth.uid(), 'ველოსიპედი', 'hobby', 100) returning id as l1 \gset
update listings set status = 'sold' where id = :'l1';
update listings set status = 'active' where id = :'l1';
update listings set status = 'sold' where id = :'l1';
reset role;
select count(*) as sale_events from progress_events where user_id = :A and kind = 'sale';

-- ტურნირის პრიზი
insert into tournaments (type, title, starts_at, ends_at) values ('chess', 'თასი', now() - interval '2 hours', now() - interval '1 hour') returning id as t1 \gset
insert into tournament_players (tournament_id, user_id, games) values (:'t1', :A, 3), (:'t1', :B, 3);
update tournament_players set place = case when user_id = :A then 1 else 2 end where tournament_id = :'t1';
update tournament_players set place = 1 where tournament_id = :'t1' and user_id = :A;
select user_id = :A as is_a, coins, xp from progress_events where kind = 'tournament' order by coins desc;
select badge from user_badges where user_id = :A order by badge;

-- სხვისი პროფილი, ლიდერბორდი, ბლოკი
select pg_temp.as_user(:B); set role authenticated;
select (public.profile_progress(:A)) ->> 'level' as a_level, jsonb_array_length((public.profile_progress(:A)) -> 'badges') as a_badges;
select count(*) as b_sees_a_progress_rows from progress where user_id = :A;
select username is not null as has_name, week_xp > 0 as has_xp from public.xp_leaderboard('friends') limit 3;
reset role;
select pg_temp.as_user(:C); set role authenticated;
select count(*) as c_friends_board from public.xp_leaderboard('friends');
select count(*) > 0 as c_all_board from public.xp_leaderboard('all');
reset role;
insert into blocks (blocker_id, blocked_id) values (:A, :C);
select pg_temp.as_user(:C); set role authenticated;
select public.profile_progress(:A) is null as blocked_hidden;
reset role;
select pg_temp.as_user(:A); set role authenticated;
select (r ->> 'level')::int >= 2 as lvl_ok, (r -> 'metrics' ->> 'posts')::int as posts, (r -> 'metrics' ->> 'wins')::int as wins, (r ->> 'claimed_today')::boolean as claimed from (select public.my_progress() as r) x;
select coins from progress;
reset role;
