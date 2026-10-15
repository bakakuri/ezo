\set ON_ERROR_STOP 1
-- ეტაპი J: ჭადრაკი 960, ხუთი რიგში, პარტიის ჩანაწერი, დღიური მომსახურება
insert into auth.users (id, email) values
 ('a9a00000-0000-0000-0000-00000000000a','a@x'), ('b9b00000-0000-0000-0000-00000000000b','b@x'),
 ('c9c00000-0000-0000-0000-00000000000c','c@x');
update profiles set onboarded = true;
update profiles set username = 'u' || left(id::text, 2);
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.ok(b boolean, what text) returns void language plpgsql as $$ begin if not coalesce(b, false) then raise exception 'FAILED: %', what; end if; end $$;
\set A '''a9a00000-0000-0000-0000-00000000000a'''
\set B '''b9b00000-0000-0000-0000-00000000000b'''
\set C '''c9c00000-0000-0000-0000-00000000000c'''

-- ---- ახალი თამაშები ბაზაში
insert into games (type, status, player_a, player_b, state, tc) values ('chess960', 'active', :A, :B, '{"fen":"start","count":0}', '3+2') returning id as g960 \gset
insert into games (type, status, player_a, player_b, state) values ('gomoku', 'active', :A, :B, '{"board":"","count":0}') returning id as ggo \gset
insert into games (type, status, player_a, player_b, state) values ('durak', 'active', :A, :B, '{"x":0}') returning id as gdu \gset
select pg_temp.ok(public.game_title('chess960') = 'ჭადრაკი 960' and public.game_title('gomoku') = 'ხუთი რიგში' and public.game_title('bura') = 'ბურა', 'game_title');
insert into tournaments (type, tc, title, starts_at, ends_at) values ('chess960', '3+2', 'ფიშერის ბლიცი', now(), now() + interval '1 hour');
insert into tournaments (type, title, starts_at, ends_at) values ('gomoku', 'ხუთი რიგში — არენა', now(), now() + interval '1 hour');
do $$ begin insert into tournaments (type, tc, title, starts_at, ends_at) values ('gomoku', '3+2', 'არასწორი', now(), now() + interval '1 hour'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: gomoku with clock: %', sqlerrm; end $$;

-- ---- ჩანაწერი: შექმნისას საწყისი პოზიცია; ყოველი სვლა; სტატუსის/ჯდომის ცვლილება — არა; კარტი — არა
select pg_temp.ok((select count(*) = 1 from game_moves where game_id = :'g960' and n = 0), 'start_recorded');
select pg_temp.ok((select count(*) = 0 from game_moves where game_id = :'gdu'), 'cards_not_recorded');
update games set state = '{"fen":"m1","count":1}', move_no = 1 where id = :'g960';
update games set state = '{"fen":"m2","count":2}', move_no = 2 where id = :'g960';
update games set move_no = 3 where id = :'g960';                              -- მხოლოდ ნომერი (ჯდომა) — არა
update games set state = '{"fen":"m2","count":2}', updated_at = now() where id = :'g960'; -- იგივე მდგომარეობა — არა
update games set state = '{"x":1}', move_no = 1 where id = :'gdu';
update games set status = 'finished', winner = :A, result = 'checkmate', turn = null where id = :'g960';
do $$ declare v text; begin
  select string_agg(m.n || ':' || (m.state ->> 'fen'), ',' order by m.n) into v from game_moves m join games g on g.id = m.game_id where g.type = 'chess960';
  if v <> '0:start,1:m1,2:m2' then raise exception 'bad record: %', v; end if;
  if exists (select 1 from game_moves m join games g on g.id = m.game_id where g.type = 'durak') then raise exception 'durak recorded'; end if;
end $$;
-- ერთი და იგივე სვლის ნომერი მეორედ (მაგ. ხელახალი ჩაწერა) — ახლდება, არ ორდება
update games set state = '{"board":"a","count":1}', move_no = 1 where id = :'ggo';
update games set state = '{"board":"b","count":1}', move_no = 0 where id = :'ggo';
update games set state = '{"board":"c","count":1}', move_no = 1 where id = :'ggo';
select pg_temp.ok((select count(*) = 2 and max(state ->> 'board') filter (where n = 1) = 'c' from game_moves where game_id = :'ggo'), 'upsert_ok');

-- ---- წაკითხვა: შესულ ნებისმიერ მომხმარებელს შეუძლია (გაზიარებული ბმული), სტუმარს — არა, ჩაწერა — არავის
select pg_temp.as_user(:C); set role authenticated;
select pg_temp.ok((select count(*) = 3 from game_moves where game_id = :'g960'), 'c_reads');
do $$ begin insert into game_moves (game_id, n, state) values ((select id from games where type = 'gomoku'), 9, '{}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: client write: %', sqlerrm; end $$;
do $$ begin perform public.daily_maintenance(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: maintenance is server-only: %', sqlerrm; end $$;
reset role;
set role anon;
select pg_temp.ok((select count(*) = 0 from game_moves), 'anon_sees_nothing');
reset role;

-- ---- დღიური მომსახურება: 90 დღეზე ძველი დასრულებული პარტიის ჩანაწერი იშლება, ახალი რჩება; keep_alive ამას იძახებს
insert into games (type, status, player_a, player_b, state) values ('chess', 'active', :A, :B, '{"fen":"old"}') returning id as gold \gset
update games set state = '{"fen":"old2"}', move_no = 1 where id = :'gold';
update games set status = 'finished', updated_at = now() - interval '100 days' where id = :'gold';
select pg_temp.ok((public.daily_maintenance() ->> 'moves')::int = 2, 'moves_purged');
select pg_temp.ok((select count(*) = 0 from game_moves where game_id = :'gold'), 'old_gone');
select pg_temp.ok((select count(*) = 3 from game_moves where game_id = :'g960'), 'recent_kept');
update games set updated_at = now() - interval '91 days' where id = :'g960';
set role anon;
select public.keep_alive() is not null as keep_alive_anon;
reset role;
select pg_temp.ok((select count(*) = 0 from game_moves where game_id = :'g960'), 'purged_via_keep_alive');
-- თამაშის წაშლისას ჩანაწერიც იშლება
delete from games where id = :'ggo';
select pg_temp.ok((select count(*) = 0 from game_moves where game_id = :'ggo'), 'cascade_ok');
