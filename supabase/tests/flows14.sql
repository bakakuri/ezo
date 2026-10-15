\set ON_ERROR_STOP 1
-- ეტაპი D: შეტყობინებების პარამეტრები (სერვერზე მოწმდება) და ადმინის ანალიტიკა
insert into auth.users (id, email) values
 ('e1a00000-0000-0000-0000-00000000000a','a@x'), ('e1b00000-0000-0000-0000-00000000000b','b@x'),
 ('e1c00000-0000-0000-0000-00000000000c','c@x');
update profiles set onboarded = true;
update profiles set username = 'anna' where id = 'e1a00000-0000-0000-0000-00000000000a';
update profiles set username = 'boss', role = 'admin' where id = 'e1c00000-0000-0000-0000-00000000000c';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''e1a00000-0000-0000-0000-00000000000a'''
\set B '''e1b00000-0000-0000-0000-00000000000b'''
\set C '''e1c00000-0000-0000-0000-00000000000c'''
insert into app_secrets (key, value) values ('push_url', 'https://push.example/send') on conflict (key) do update set value = excluded.value;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (:A, 'https://push.example/a', 'k', 'a');

-- კატეგორიები
select public.push_category('{"tag":"conv-1"}') = 'messages' and public.push_category('{"tag":"call-1"}') = 'calls'
   and public.push_category('{"tag":"n-like-x"}') = 'likes' and public.push_category('{"tag":"n-reply-x"}') = 'replies'
   and public.push_category('{"tag":"n-follow_request-x"}') = 'follows' and public.push_category('{"tag":"n-tournament_end-x"}') = 'games'
   and public.push_category('{"tag":"game-1"}') = 'games' and public.push_category('{"tag":"n-match-x"}') = 'dating'
   and public.push_category('{"tag":"n-listing_price-x"}') = 'market' and public.push_category('{"tag":"n-level_up-x"}') = 'rewards'
   and public.push_category('{"tag":"n-event_rsvp-x"}') = 'groups' as categories_ok;

-- პარამეტრების გარეშე ყველაფერი მოდის
insert into posts (author_id, body) values (:A, 'ანას პოსტი') returning id as pa \gset
select pg_temp.as_user(:B); set role authenticated;
insert into likes (user_id, post_id) values (auth.uid(), :'pa');
reset role;
do $$ begin if (select count(*) from net.calls where body -> 'payload' ->> 'tag' like 'n-like-%') <> 1 then raise exception 'like push missing'; end if; end $$;

-- ანამ მოწონებები გამორთო: მოწონებაზე Push აღარ, პასუხზე — კი
select pg_temp.as_user(:A); set role authenticated;
insert into notification_prefs (likes) values (false);
reset role;
select pg_temp.as_user(:B); set role authenticated;
delete from likes where user_id = auth.uid();
insert into likes (user_id, post_id) values (auth.uid(), :'pa');
insert into posts (author_id, body, parent_id) values (auth.uid(), 'პასუხი', :'pa');
reset role;
select (select count(*) from net.calls where body -> 'payload' ->> 'tag' like 'n-like-%') as like_pushes,
       (select count(*) from net.calls where body -> 'payload' ->> 'tag' like 'n-reply-%') as reply_pushes;
do $$ begin
  if (select count(*) from net.calls where body -> 'payload' ->> 'tag' like 'n-like-%') <> 1 then raise exception 'like push not blocked'; end if;
  if (select count(*) from net.calls where body -> 'payload' ->> 'tag' like 'n-reply-%') <> 1 then raise exception 'reply push blocked'; end if;
end $$;

-- ჩუმი საათები ახლანდელ საათზე: ყველაფერი დაბლოკილია ზარების გარდა
do $$ declare h int := extract(hour from now() at time zone 'Asia/Tbilisi')::int; begin
  update notification_prefs set quiet_from = h, quiet_to = (h + 1) % 24 where user_id = 'e1a00000-0000-0000-0000-00000000000a';
end $$;
select public.push_allowed(:A, '{"tag":"n-reply-x"}') as reply_in_quiet, public.push_allowed(:A, '{"tag":"call-1"}') as call_in_quiet,
       public.push_allowed(:B, '{"tag":"n-like-x"}') as other_user_unaffected;
do $$ begin
  if public.push_allowed('e1a00000-0000-0000-0000-00000000000a', '{"tag":"n-reply-x"}') then raise exception 'quiet hours ignored'; end if;
  if not public.push_allowed('e1a00000-0000-0000-0000-00000000000a', '{"tag":"call-1"}') then raise exception 'calls blocked in quiet hours'; end if;
end $$;
-- შუაღამეზე გადასული ჩუმი საათები (მაგ. 22–08): ახლანდელი საათი ფანჯრის გარეთ და შიგნით
do $$ declare h int := extract(hour from now() at time zone 'Asia/Tbilisi')::int; begin
  update notification_prefs set quiet_from = (h + 1) % 24, quiet_to = h where user_id = 'e1a00000-0000-0000-0000-00000000000a';
  if not public.push_allowed('e1a00000-0000-0000-0000-00000000000a', '{"tag":"n-reply-x"}') then raise exception 'wrap: current hour is outside the window'; end if;
  update notification_prefs set quiet_from = h, quiet_to = (h + 23) % 24 where user_id = 'e1a00000-0000-0000-0000-00000000000a';
  if public.push_allowed('e1a00000-0000-0000-0000-00000000000a', '{"tag":"n-reply-x"}') then raise exception 'wrap: current hour is inside the window'; end if;
end $$;

-- სხვისი პარამეტრები არ ჩანს და არ იცვლება; push_allowed კლიენტიდან არ იძახება
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_prefs from notification_prefs;
update notification_prefs set likes = true where user_id = 'e1a00000-0000-0000-0000-00000000000a';
do $$ begin perform public.push_allowed('e1a00000-0000-0000-0000-00000000000a', '{}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: push_allowed closed: %', sqlerrm; end $$;
reset role;
do $$ begin if (select likes from notification_prefs where user_id = 'e1a00000-0000-0000-0000-00000000000a') then raise exception 'other user changed prefs'; end if; end $$;

-- ---- დღიური აქტიურობა და ანალიტიკა
select pg_temp.as_user(:A); set role authenticated;
select public.touch_last_seen();
select public.touch_last_seen();
do $$ begin perform count(*) from daily_active; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: daily_active closed'; end $$;
do $$ begin perform public.admin_analytics(30); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: analytics admin only: %', sqlerrm; end $$;
reset role;
select count(*) as a_active_today from daily_active where user_id = :A;
select pg_temp.as_user(:C); set role authenticated;
select jsonb_array_length(r -> 'days') as days, r -> 'totals' ->> 'users' as users, r -> 'totals' ->> 'dau' as dau,
       r -> 'days' -> -1 ->> 'posts' as posts_today, r -> 'days' -> -1 ->> 'replies' as replies_today, r -> 'days' -> -1 ->> 'signups' as signups_today
  from (select public.admin_analytics(30) as r) x;
do $$ declare r jsonb := public.admin_analytics(30); begin
  if jsonb_array_length(r -> 'days') <> 30 then raise exception 'days: %', jsonb_array_length(r -> 'days'); end if;
  if (r -> 'days' -> -1 ->> 'day')::date <> (now() at time zone 'Asia/Tbilisi')::date then raise exception 'last day is not today'; end if;
  if (r -> 'days' -> -1 ->> 'posts')::int <> 1 or (r -> 'days' -> -1 ->> 'replies')::int <> 1 then raise exception 'posts: %', r -> 'days' -> -1; end if;
  if (r -> 'days' -> -1 ->> 'signups')::int <> 3 then raise exception 'signups: %', r -> 'days' -> -1; end if;
  -- პოსტის და პასუხის ავტორები აქტიურად ითვლება (A — touch-ით და პოსტით, B — პასუხით)
  if (r -> 'totals' ->> 'dau')::int <> 2 then raise exception 'dau: %', r -> 'totals'; end if;
  if jsonb_array_length(public.admin_analytics(1000) -> 'days') <> 180 or jsonb_array_length(public.admin_analytics(1) -> 'days') <> 7 then raise exception 'range clamp'; end if;
end $$;
reset role;
