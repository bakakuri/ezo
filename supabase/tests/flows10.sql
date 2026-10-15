\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('a0a00000-0000-0000-0000-00000000000a','a@x'), ('a0b00000-0000-0000-0000-00000000000b','b@x'), ('a0c00000-0000-0000-0000-00000000000c','c@x');
update profiles set onboarded = true;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a0a00000-0000-0000-0000-00000000000a'''
\set B '''a0b00000-0000-0000-0000-00000000000b'''
\set C '''a0c00000-0000-0000-0000-00000000000c'''

-- ამოცანა: ყოველდღე სხვა, 14-დღიანი ციკლი
select count(distinct (public.puzzle_of_day(d::date)).id) as distinct_in_cycle from generate_series(date '2026-01-01', date '2026-01-14', '1 day') d;
select (public.puzzle_of_day(date '2026-01-01')).id as jan1, (public.puzzle_of_day(date '2026-01-15')).id as jan15, (public.puzzle_of_day(date '2025-12-31')).id as dec31;
select (public.puzzle_of_day(public.tbilisi_today())).solution as sol \gset
select array_length(:'sol'::text[], 1) as sol_len;
select set_config('test.sol', :'sol', false);

select pg_temp.as_user(:A); set role authenticated;
select count(*) as can_read_solutions from chess_puzzles;
do $$ begin perform public.puzzle_of_day(current_date); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: puzzle_of_day not callable'; end $$;
select (r ->> 'solved')::boolean as solved, r ? 'solution' and r -> 'solution' <> 'null'::jsonb as leaks, (r ->> 'moves')::int as moves from (select public.daily_puzzle() r) x;
select public.puzzle_move(array['a1a2']) ->> 'correct' as wrong_move;
do $$ begin perform public.puzzle_move(array['a1a2', 'a2a3']); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: even-length rejected'; end $$;
-- სწორი გზა ბოლომდე
do $$
declare sol text[] := current_setting('test.sol')::text[]; r jsonb; i int := 1;
begin
  loop
    r := public.puzzle_move(sol[1:i]);
    if not (r ->> 'correct')::boolean then raise exception 'rejected correct move %', i; end if;
    exit when (r ->> 'solved')::boolean;
    if r ->> 'reply' <> sol[i + 1] then raise exception 'bad reply'; end if;
    i := i + 2;
  end loop;
  raise notice 'ok: solved in % plies, attempts %', i, r ->> 'attempts';
  r := public.puzzle_move(sol);
  raise notice 'ok: second solve allowed, solved=%', r ->> 'solved';
end $$;
select solved, attempts from puzzle_solves;
select (r ->> 'solved')::boolean as solved_now, jsonb_array_length(r -> 'solution') > 0 as solution_after, (r ->> 'solvers')::int as solvers from (select public.daily_puzzle() r) x;
reset role;
select count(*) as puzzle_awards, sum(xp) as xp, sum(coins) as coins from progress_events where user_id = :A and kind = 'puzzle';

-- თამაშის ჩატი
insert into games (type, status, player_a, player_b, state, is_public) values ('bura', 'active', :A, :B, '{}', true) returning id as g1 \gset
insert into games (type, status, player_a, player_b, state, is_public) values ('bura', 'finished', :A, :B, '{}', true) returning id as g2 \gset
select pg_temp.as_user(:A); set role authenticated;
insert into game_messages (game_id, user_id, kind, body) values (:'g1', auth.uid(), 'text', '  კარგი სვლა!  ');
insert into game_messages (game_id, user_id, kind, body) values (:'g1', auth.uid(), 'emoji', '🔥');
do $$ begin insert into game_messages (game_id, user_id, kind, body) values ((select id from games where status = 'finished' limit 1), auth.uid(), 'emoji', '🔥'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: finished game closed'; end $$;
reset role;
select pg_temp.as_user(:C); set role authenticated;
insert into game_messages (game_id, user_id, kind, body) values (:'g1', auth.uid(), 'emoji', '👍');
do $$ begin insert into game_messages (game_id, user_id, kind, body) values ((select id from games where status = 'active' limit 1), auth.uid(), 'text', 'მაყურებელი'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: spectator cannot text'; end $$;
do $$ begin insert into game_messages (game_id, user_id, kind, body) values ((select id from games where status = 'active' limit 1), auth.uid(), 'emoji', 'სპამი'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: emoji whitelist'; end $$;
do $$ begin for i in 1..10 loop insert into game_messages (game_id, user_id, kind, body) values ((select id from games where status = 'active' limit 1), auth.uid(), 'emoji', '🎉'); end loop; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: rate limit: %', sqlerrm; end $$;
select kind, body from game_messages order by id limit 3;
reset role;
insert into tournaments (type, title, starts_at, ends_at) values ('bura', 'ბურის თასი', now(), now() + interval '1 hour');
select count(*) as bura_tournaments from tournaments where type = 'bura';
