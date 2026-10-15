\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('e1111111-1111-1111-1111-111111111111','a@x'), ('e2222222-2222-2222-2222-222222222222','b@x'), ('e3333333-3333-3333-3333-333333333333','c@x');
update profiles set onboarded = true;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''e1111111-1111-1111-1111-111111111111'''
\set B '''e2222222-2222-2222-2222-222222222222'''
\set C '''e3333333-3333-3333-3333-333333333333'''
set role service_role;
insert into tournaments (id, type, title, starts_at, ends_at) values
  ('f0000000-0000-0000-0000-000000000001', 'nardi', 'დასრულებული არენა', now() - interval '2 hours', now() - interval '1 hour'),
  ('f0000000-0000-0000-0000-000000000002', 'durak', 'მიმდინარე არენა', now() - interval '5 minutes', now() + interval '55 minutes'),
  ('f0000000-0000-0000-0000-000000000003', 'chess', 'მომავალი არენა', now() + interval '1 day', now() + interval '1 day 1 hour');
insert into tournament_players (tournament_id, user_id, score, games, wins) values
  ('f0000000-0000-0000-0000-000000000001', :A, 6, 3, 3), ('f0000000-0000-0000-0000-000000000001', :B, 2, 3, 1), ('f0000000-0000-0000-0000-000000000001', :C, 0, 0, 0),
  ('f0000000-0000-0000-0000-000000000002', :A, 0, 0, 0), ('f0000000-0000-0000-0000-000000000002', :C, 0, 0, 0),
  ('f0000000-0000-0000-0000-000000000003', :B, 0, 0, 0);
insert into games (type, state, player_a, status, tournament_id) values ('nardi', '{"turn":"w"}', :B, 'waiting', 'f0000000-0000-0000-0000-000000000001');
reset role;

select pg_temp.as_user(:C); set role authenticated;
select public.tournament_tick() as processed;
select public.tournament_tick() as processed_again;
reset role;
select p.username, tp.place from tournament_players tp join profiles p on p.id = tp.user_id where tournament_id = 'f0000000-0000-0000-0000-000000000001' order by tp.place nulls last;
select n.type, p.username as to_user, a.username as actor, n.data ->> 'place' as place, n.data ->> 'players' as players
  from notifications n join profiles p on p.id = n.user_id left join profiles a on a.id = n.actor_id order by n.type, p.username;
select status from games where tournament_id = 'f0000000-0000-0000-0000-000000000001';
select title, finished_at is not null as finished, start_notified_at is not null as started from tournaments order by starts_at;
select count(*) as push_calls_for_tournaments from net.calls where body::text like '%/t/%';
