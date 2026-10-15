\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','a@x.ge','{"full_name":"ნინო"}'),
 ('22222222-2222-2222-2222-222222222222','b@x.ge','{"name":"Gio Google","picture":"https://x/p.jpg"}'),
 ('33333333-3333-3333-3333-333333333333','c@x.ge','{}'),
 ('44444444-4444-4444-4444-444444444444','d@x.ge','{}'),
 ('55555555-5555-5555-5555-555555555555','e@x.ge','{}'),
 ('66666666-6666-6666-6666-666666666666','f@x.ge','{}'),
 ('77777777-7777-7777-7777-777777777777','g@x.ge','{}');
select full_name, avatar_url from profiles where id = '22222222-2222-2222-2222-222222222222';
update profiles set role = 'admin', username = 'nino' where id = '11111111-1111-1111-1111-111111111111';
insert into app_secrets values ('push_url', 'https://proj.supabase.co/functions/v1/push'), ('push_secret', 's3cret');
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- გიო: push გამოწერა, პოსტი; ვერ შეცვლის role-ს
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://push.example/1', 'k', 'a');
update profiles set role = 'admin', banned_until = null, username = 'gio' where id = auth.uid();
insert into posts (author_id, body) values (auth.uid(), 'ცუდი პოსტი') ;
do $$ begin perform public.notify('11111111-1111-1111-1111-111111111111', auth.uid(), 'like'); raise exception 'SHOULD FAIL';
exception when insufficient_privilege then raise notice 'ok: notify revoked'; end $$;
do $$ begin perform public.svc_finish(gen_random_uuid(), null, 'x'); raise exception 'SHOULD FAIL';
exception when insufficient_privilege then raise notice 'ok: svc_finish revoked'; end $$;
do $$ begin perform public.admin_stats(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: admin_stats forbidden for user (%)', sqlerrm; end $$;
reset role;
select username, role from profiles where id = '22222222-2222-2222-2222-222222222222';

-- ნინო მოიწონებს გიოს პოსტს → push ჩანაწერი net.calls-ში
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into likes (user_id, post_id) select auth.uid(), id from posts limit 1;
reset role;
select body->'payload'->>'title' as push_title, body->'payload'->>'body' as push_body, headers->>'x-push-secret' as secret from net.calls order by id desc limit 1;

-- 5 რეპორტი → პოსტი იმალება
do $$ declare u text; begin
  foreach u in array array['33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777'] loop
    perform set_config('request.jwt.claim.sub', u, false);
    insert into reports (reporter_id, target_post, reason, category) select u::uuid, id, 'spam', 'spam' from posts limit 1;
  end loop; end $$;
select hidden as auto_hidden from posts limit 1;
-- სხვა მომხმარებელი დამალულ პოსტს ვეღარ ხედავს, ავტორი ხედავს
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); set role authenticated;
select count(*) as visible_to_others from posts; reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); set role authenticated;
select count(*) as visible_to_author from posts; reset role;

-- ადმინი: რეპორტების სია და ბანი
select pg_temp.as_user('11111111-1111-1111-1111-111111111111'); set role authenticated;
select reports_count, target_user->>'username' as target, target_post->>'hidden' as hidden from public.admin_reports('open');
select public.admin_resolve((select id from public.admin_reports('open') limit 1), 'ban', 7, 'spam');
select public.admin_stats() ->> 'banned' as banned, public.admin_stats() ->> 'open_reports' as open_reports;
reset role;
-- დაბლოკილი ვერ წერს
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); set role authenticated;
do $$ begin insert into posts (author_id, body) values (auth.uid(), 'ისევ'); raise exception 'SHOULD FAIL';
exception when insufficient_privilege then raise notice 'ok: banned user cannot post'; end $$;
reset role;

-- თამაშები: სერვერის ფუნქციები (service role)
set role service_role;
insert into games (id, type, state, player_a, is_public) values ('aaaaaaaa-0000-0000-0000-000000000001', 'domino', '{"turn":"b"}', '11111111-1111-1111-1111-111111111111', true);
insert into game_hands values ('aaaaaaaa-0000-0000-0000-000000000001', 'a', '11111111-1111-1111-1111-111111111111', '[[1,2]]'), ('aaaaaaaa-0000-0000-0000-000000000001', 'b', null, '[[6,6]]');
select public.svc_claim_game('33333333-3333-3333-3333-333333333333', 'domino') = 'aaaaaaaa-0000-0000-0000-000000000001' as claimed;
select status, turn = '33333333-3333-3333-3333-333333333333' as joiner_turn from games;
reset role;
select body->'payload'->>'body' as game_push from net.calls order by id desc limit 2;
-- ხელებს ხედავს მხოლოდ მფლობელი
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); set role authenticated;
select seat, tiles from game_hands; reset role;
set role service_role;
select public.svc_finish('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'domino');
select public.svc_finish('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'domino');
reset role;
select user_id = '33333333-3333-3333-3333-333333333333' as winner_row, rating, wins, losses from game_stats order by rating desc;
