\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('b1a00000-0000-0000-0000-00000000000a','a@x'), ('b1b00000-0000-0000-0000-00000000000b','b@x'),
 ('b1c00000-0000-0000-0000-00000000000c','c@x'), ('b1d00000-0000-0000-0000-00000000000d','d@x');
update profiles set onboarded = true;
update profiles set username = 'anna' where id = 'b1a00000-0000-0000-0000-00000000000a';
update profiles set username = 'privat', is_private = true where id = 'b1b00000-0000-0000-0000-00000000000b';
update profiles set role = 'moderator' where id = 'b1d00000-0000-0000-0000-00000000000d';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''b1a00000-0000-0000-0000-00000000000a'''
\set B '''b1b00000-0000-0000-0000-00000000000b'''
\set C '''b1c00000-0000-0000-0000-00000000000c'''
\set D '''b1d00000-0000-0000-0000-00000000000d'''

insert into posts (author_id, body, media) values (:A, 'საჯარო პოსტი   ფოტოთი', '[{"url":"https://x/a.jpg","type":"image"}]') returning id as pa \gset
insert into posts (author_id, body) values (:B, 'დახურული') returning id as pb \gset
-- OG ბარათი anon-ისთვის
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.og_preview('p', :'pa') ->> 'title' as post_title, public.og_preview('p', :'pa') ->> 'image' as post_img, public.og_preview('p', :'pa') ->> 'description' as post_desc;
select public.og_preview('p', :'pb') is null as private_hidden, public.og_preview('p', 'not-a-uuid') is null as bad_id;
select public.og_preview('u', 'privat') ->> 'description' as private_profile, public.og_preview('i', 'anna') ->> 'title' as invite_title;
do $$ begin perform count(*) from posts; raise notice 'anon posts visible: %', (select count(*) from posts); end $$;
reset role;

-- მოწვევა: C ახალია, იღებს A-ს მოწვევას
select pg_temp.as_user(:C); set role authenticated;
select public.claim_invite('anna') ->> 'ok' as invite_ok, public.claim_invite('anna') ->> 'reason' as second;
reset role;
select (select invited_by = :A from profiles where id = :C) as invited_by_set,
  (select count(*) from follows where (follower_id = :A and following_id = :C) or (follower_id = :C and following_id = :A)) as mutual,
  (select sum(coins) from progress_events where user_id = :A and kind = 'invite') as inviter_coins,
  (select sum(coins) from progress_events where user_id = :C and kind = 'invited') as invitee_coins,
  (select count(*) from notifications where user_id = :A and type = 'invite_joined') as notif;
update profiles set created_at = now() - interval '30 days' where id = :D;
select pg_temp.as_user(:D); set role authenticated;
select public.claim_invite('anna') ->> 'reason' as old_user;
select (public.invite_stats()) ->> 'count' as d_invites;
update profiles set invited_by = :A where id = auth.uid();
reset role;
select invited_by is null as cannot_self_set from profiles where id = :D;
select pg_temp.as_user(:A); set role authenticated;
select (public.invite_stats()) ->> 'count' as a_invites;
reset role;

-- ლიმიტი: 20 პოსტი 10 წუთში
select pg_temp.as_user(:C); set role authenticated;
do $$ begin for i in 1..20 loop insert into posts (author_id, body) values (auth.uid(), 'p' || i); end loop; end $$;
do $$ begin insert into posts (author_id, body) values (auth.uid(), 'ზედმეტი'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: post rate limit: %', sqlerrm; end $$;
reset role;

-- აკრძალული სიტყვები
select pg_temp.as_user(:A); set role authenticated;
do $$ begin insert into banned_words (word) values ('კაზინო'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: only staff manages words'; end $$;
reset role;
select pg_temp.as_user(:D); set role authenticated;
insert into banned_words (word) values ('კაზინო'), ('spamlink');
select count(*) as words from banned_words;
reset role;
select pg_temp.as_user(:A); set role authenticated;
do $$ begin insert into posts (author_id, body) values (auth.uid(), 'მოდი ონლაინ კაზინოში!'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: banned in post: %', sqlerrm; end $$;
do $$ begin update profiles set bio = 'visit SPAMLINK now' where id = auth.uid(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: banned in bio'; end $$;
insert into posts (author_id, body) values (auth.uid(), 'ჩვეულებრივი ტექსტი');
reset role;

-- 2FA: ფაქტორი ჩართულია → aal1-ით მესიჯები დაკეტილია
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
grant select on auth.mfa_factors to authenticated;
select public.get_or_create_dm(:C) is not null from (select pg_temp.as_user(:A)) x;
select pg_temp.as_user(:A); set role authenticated;
select public.get_or_create_dm(:C) as conv \gset
insert into messages (conversation_id, sender_id, body) values (:'conv', auth.uid(), 'გამარჯობა');
reset role;
insert into auth.mfa_factors (user_id, status) values (:A, 'verified');
select pg_temp.as_user(:A); set role authenticated;
select count(*) as msgs_aal1 from messages;
select count(*) as convs_aal1 from public.my_conversations();
do $$ begin insert into posts (author_id, body) values (auth.uid(), 'aal1 post'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: aal1 cannot post'; end $$;
do $$ begin perform public.export_my_data(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: export needs aal2'; end $$;
select count(*) as public_posts_still_readable from posts where author_id = auth.uid();
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select count(*) as msgs_aal2 from messages;
select count(*) as convs_aal2 from public.my_conversations();
select jsonb_array_length(r -> 'posts') as exported_posts, r -> 'profile' ->> 'username' as uname, r -> 'profile' ? 'role' as leaks_role from (select public.export_my_data() r) x;
reset role;
select set_config('request.jwt.claims', '', false);
-- C ფაქტორის გარეშე — ყველაფერი ჩვეულებრივ
select pg_temp.as_user(:C); set role authenticated;
select count(*) as c_msgs from messages;
-- ანგარიშის წაშლა
select public.delete_my_account();
reset role;
select count(*) as c_left from auth.users where id = :C;
select count(*) as c_profile from profiles where id = :C;
select count(*) as c_posts from posts where author_id = :C;
