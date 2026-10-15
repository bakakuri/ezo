\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('d1111111-1111-1111-1111-111111111111','a@x'), ('d2222222-2222-2222-2222-222222222222','b@x'),
 ('d3333333-3333-3333-3333-333333333333','c@x'), ('d4444444-4444-4444-4444-444444444444','d@x'),
 ('d5555555-5555-5555-5555-555555555555','e@x');
update profiles set onboarded = true;
update profiles set role = 'admin' where id = 'd5555555-5555-5555-5555-555555555555';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''d1111111-1111-1111-1111-111111111111'''
\set B '''d2222222-2222-2222-2222-222222222222'''
\set C '''d3333333-3333-3333-3333-333333333333'''
\set D '''d4444444-4444-4444-4444-444444444444'''
\set E '''d5555555-5555-5555-5555-555555555555'''

-- ---- ჯოკერის მაგიდა (სერვისის როლით, როგორც Edge Function)
set role service_role;
insert into games (type, state, player_a, seats, invites, is_public, status)
values ('joker', '{"turn":"a"}', :A, 4, array[:B]::uuid[], false, 'waiting') returning id as t1 \gset
insert into game_hands (game_id, seat, user_id, tiles) values (:'t1','a',:A,'[]'), (:'t1','b',null,'[]'), (:'t1','c',null,'[]'), (:'t1','d',null,'[]');
do $$ begin perform public.svc_take_seat('d3333333-3333-3333-3333-333333333333', (select id from games where type='joker')); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: invite required (%)', sqlerrm; end $$;
select public.svc_take_seat(:B, :'t1') as seat_b;
select public.svc_take_seat(:B, :'t1') is null as already_seated;
update games set is_public = true where id = :'t1';
select public.svc_take_any_seat(:C, 'joker') = :'t1' as any_seat;
select public.svc_leave_seat(:C, :'t1');
select player_c is null as c_left, (select user_id is null from game_hands where game_id = :'t1' and seat = 'c') as hand_freed from games where id = :'t1';
select public.svc_take_seat(:C, :'t1'), public.svc_take_seat(:D, :'t1');
select status, turn = :A as turn_a, move_no >= 4 as bumped, (select user_id = :D from game_hands where game_id = :'t1' and seat = 'd') as hand_d from games where id = :'t1';

-- Elo მრავალადგილიანზე: A > B > C > D
select public.svc_finish_table(:'t1', :A, 'joker', jsonb_build_object(:A, 900, :B, 400, :C, 100, :D, -1000000));
select p.username, gs.rating, gs.wins, gs.losses from game_stats gs join profiles p on p.id = gs.user_id where gs.type = 'joker' order by gs.rating desc;
select public.svc_finish_table(:'t1', :B, 'joker', '{}'::jsonb);
select count(*) = 4 as finish_once from game_stats where type = 'joker' and wins + losses = 1;

-- ---- ბლიცი: claim ფილტრავს დროის კონტროლით, ჩემი მოლოდინში მყოფი უქმდება
insert into games (type, state, player_a, tc, status, clock) values ('chess', '{"fen":"x w"}', :A, '3+2', 'waiting', '{"a":180000,"b":180000,"inc":2000,"at":null}') returning id as c1 \gset
insert into games (type, state, player_a, status) values ('chess', '{"fen":"x w"}', :C, 'waiting') returning id as c2 \gset
insert into games (type, state, player_a, tc, status) values ('chess', '{"fen":"x w"}', :B, '3+2', 'waiting') returning id as c3 \gset
select public.svc_claim_game(:B, 'chess', '3+2', null) = :'c1' as claimed_same_tc;
select status from games where id = :'c3';
select public.svc_claim_game(:D, 'chess', '5+0', null) is null as no_other_tc;

-- abort: რეიტინგის გარეშე
select public.svc_finish(:'c1', null, 'abort');
select status, result, (select count(*) from game_stats where type = 'chess') as chess_stats from games where id = :'c1';

-- ---- ტურნირები: RLS
reset role;
select pg_temp.as_user(:A); set role authenticated;
do $$ begin insert into tournaments (type, title, starts_at, ends_at, created_by) values ('nardi', 'ჩემი', now() + interval '1 hour', now() + interval '2 hours', auth.uid()); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: regular user cannot create tournaments'; end $$;
reset role;
select pg_temp.as_user(:E); set role authenticated;
insert into tournaments (type, tc, title, starts_at, ends_at, created_by) values ('chess', '3+2', 'ბლიც არენა', now() - interval '1 minute', now() + interval '1 hour', auth.uid()) returning id as tr \gset
do $$ begin insert into tournaments (type, tc, title, starts_at, ends_at, created_by) values ('nardi', '3+2', 'ნარდი ბლიცი', now() + interval '1 hour', now() + interval '2 hours', auth.uid()); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: clock only for chess/checkers'; end $$;
do $$ begin insert into tournaments (type, title, starts_at, ends_at, created_by) values ('nardi', 'გრძელი', now() + interval '1 hour', now() + interval '9 hours', auth.uid()); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: max 6 hours'; end $$;
reset role;
select pg_temp.as_user(:A); set role authenticated;
select public.join_tournament(:'tr');
do $$ begin insert into tournament_players (tournament_id, user_id, score) values ((select id from tournaments limit 1), auth.uid(), 999); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: score cannot be forged'; end $$;
do $$ begin perform public.svc_take_seat(auth.uid(), gen_random_uuid()); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: service functions are private (%)', sqlerrm; end $$;
reset role;
select pg_temp.as_user(:B); set role authenticated;
select public.join_tournament(:'tr');
reset role;

-- ---- არენის ქულები: მოგება 2, ცეცხლზე 4, ფრე 1
set role service_role;
create or replace function pg_temp.arena_game(w uuid) returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into games (type, state, player_a, player_b, status, tc, tournament_id)
  values ('chess', '{"fen":"x w"}', 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'active', '3+2', (select id from tournaments where title = 'ბლიც არენა'))
  returning id into v_id;
  perform public.svc_finish(v_id, w, case when w is null then 'stalemate' else 'checkmate' end);
end $$;
select pg_temp.arena_game(:A), pg_temp.arena_game(:A), pg_temp.arena_game(:A), pg_temp.arena_game(null), pg_temp.arena_game(:B);
select p.username, tp.score, tp.games, tp.wins, tp.streak from tournament_players tp join profiles p on p.id = tp.user_id order by tp.score desc;
reset role;
select pg_temp.as_user(:A); set role authenticated;
select public.leave_tournament(:'tr');
select count(*) as still_in from tournament_players where user_id = auth.uid();
reset role;

-- ---- დახურული ჯგუფის ტურნირი მხოლოდ წევრებს უჩანს
select pg_temp.as_user(:C); set role authenticated;
insert into groups (id, slug, name, privacy, owner_id) values ('b5000000-0000-0000-0000-000000000001', 'secret-club', 'საიდუმლო კლუბი', 'private', auth.uid());
insert into tournaments (type, title, starts_at, ends_at, created_by, group_id) values ('durak', 'კლუბის დურაკი', now() + interval '1 day', now() + interval '1 day 1 hour', auth.uid(), 'b5000000-0000-0000-0000-000000000001');
select count(*) as owner_sees from tournaments where group_id is not null;
reset role;
select pg_temp.as_user(:D); set role authenticated;
select count(*) as outsider_sees from tournaments where group_id is not null;
do $$ begin perform public.join_tournament((select id from tournaments where title = 'კლუბის დურაკი')); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: outsider cannot join (%)', sqlerrm; end $$;
reset role;
