\set ON_ERROR_STOP 1
-- შეცდომების ჟურნალი: ჩაწერა (შესული და შეუსვლელი), ზღვარი, დაჯგუფება, წვდომა მხოლოდ მოდერატორს
insert into auth.users (id, email) values
 ('c1a00000-0000-0000-0000-00000000000a','a@x'), ('c1b00000-0000-0000-0000-00000000000b','b@x'),
 ('c1d00000-0000-0000-0000-00000000000d','d@x');
update profiles set onboarded = true;
update profiles set role = 'moderator' where id = 'c1d00000-0000-0000-0000-00000000000d';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''c1a00000-0000-0000-0000-00000000000a'''
\set B '''c1b00000-0000-0000-0000-00000000000b'''
\set D '''c1d00000-0000-0000-0000-00000000000d'''

-- A: ორი ერთნაირი შეცდომა სხვადასხვა id-ით ერთ ჯგუფში ხვდება
select pg_temp.as_user(:A); set role authenticated;
select public.log_client_error('cannot add callbacks for realtime:notif:c1a00000-0000-0000-0000-00000000000a', 'Error: x\n at y', '/inbox', 'boundary', 'abc1234', 'Mozilla/5.0 (Linux; Android 14)');
select public.log_client_error('cannot add callbacks for realtime:notif:c1b00000-0000-0000-0000-00000000000b', null, '/inbox', 'boundary', 'abc1234', null);
select public.log_client_error('   ', null, '/', 'window', null, null);
select public.log_client_error('PGRST200: Could not find a relationship', 'details', '/', 'nonsense', null, null);
-- პირდაპირ ცხრილს ვერ ხედავს და ვერ წერს
do $$ begin perform count(*) from client_errors; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: table closed: %', sqlerrm; end $$;
do $$ begin insert into client_errors (message) values ('x'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: direct insert closed'; end $$;
-- ჟურნალი მხოლოდ მოდერატორს
do $$ begin perform * from public.admin_errors(7); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: admin_errors forbidden: %', sqlerrm; end $$;
do $$ begin perform public.admin_clear_errors('x'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: admin_clear_errors forbidden'; end $$;
reset role;

-- შეუსვლელიც წერს (მაგ. შესვლის გვერდზე)
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.log_client_error('Failed to load module script', null, '/login', 'chunk', null, null);
reset role;

-- ზღვარი: ერთ ადამიანზე 30 საათში
select pg_temp.as_user(:B); set role authenticated;
do $$ begin for i in 1..40 loop perform public.log_client_error('loop ' || i, null, '/', 'promise', null, null); end loop; end $$;
reset role;

select count(*) filter (where user_id = :A) as a_rows, count(*) filter (where user_id = :B) as b_rows_capped,
  count(*) filter (where user_id is null) as anon_rows,
  bool_and(source in ('boundary', 'window', 'promise', 'api', 'chunk')) as sources_valid,
  count(*) filter (where message like '%<id>%') as normalized
from client_errors;
do $$ declare r record; begin
  select count(*) filter (where user_id = 'c1a00000-0000-0000-0000-00000000000a') a, count(*) filter (where user_id = 'c1b00000-0000-0000-0000-00000000000b') b,
         count(*) filter (where user_id is null) anon, count(*) filter (where message like '%<id>%') norm,
         count(*) filter (where message like 'PGRST200%' and source = 'window') fallback
    into r from client_errors;
  if (r.a, r.b, r.anon, r.norm, r.fallback) <> (3::bigint, 30::bigint, 1::bigint, 2::bigint, 1::bigint) then raise exception 'unexpected counts: %', r; end if;
end $$;

select pg_temp.as_user(:D); set role authenticated;
select message, source, events, users, path, release from public.admin_errors(7) where message like 'cannot add%';
select count(*) as groups from public.admin_errors(1);
select public.admin_clear_errors('cannot add callbacks for realtime:notif:<id>') as cleared;
select count(*) as left_after_clear from public.admin_errors(30) where message like 'cannot add%';
do $$ begin
  if (select events from public.admin_errors(30) where message like 'loop 1') <> 1 then raise exception 'grouping wrong'; end if;
  if exists (select 1 from public.admin_errors(30) where message like 'cannot add%') then raise exception 'clear failed'; end if;
end $$;
reset role;

-- ძველი ჩანაწერები ჟურნალში არ ჩანს
update client_errors set created_at = now() - interval '10 days' where message = 'Failed to load module script';
select pg_temp.as_user(:D); set role authenticated;
select count(*) as old_hidden_in_7d from public.admin_errors(7) where message = 'Failed to load module script';
select count(*) as old_visible_in_30d from public.admin_errors(30) where message = 'Failed to load module script';
reset role;

-- ანგარიშის წაშლისას ჩანაწერი რჩება, ადამიანი — აღარ
delete from auth.users where id = :A;
select count(*) as kept_after_delete, count(user_id) as user_cleared from client_errors where message like 'PGRST200%';
do $$ begin
  if (select count(*) from client_errors where message like 'PGRST200%' and user_id is null) <> 1 then raise exception 'user not cleared'; end if;
end $$;
