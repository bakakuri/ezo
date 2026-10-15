\set ON_ERROR_STOP 1
-- ეტაპი E: დაბადების/სახელობის დღეები, მოხსენიება, რედაქტირება, ბმულის ბარათი, მოგონებები
insert into auth.users (id, email) values
 ('f1a00000-0000-0000-0000-00000000000a','a@x'), ('f1b00000-0000-0000-0000-00000000000b','b@x'),
 ('f1c00000-0000-0000-0000-00000000000c','c@x'), ('f1d00000-0000-0000-0000-00000000000d','d@x');
update profiles set onboarded = true;
update profiles set username = 'anna', full_name = 'ანა ბერიძე' where id = 'f1a00000-0000-0000-0000-00000000000a';
update profiles set username = 'giorgi.b', full_name = 'Giorgi Beridze' where id = 'f1b00000-0000-0000-0000-00000000000b';
update profiles set username = 'private.c', full_name = 'ნინო დახურული', is_private = true where id = 'f1c00000-0000-0000-0000-00000000000c';
update profiles set username = 'stranger', full_name = 'უცხო' where id = 'f1d00000-0000-0000-0000-00000000000d';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''f1a00000-0000-0000-0000-00000000000a'''
\set B '''f1b00000-0000-0000-0000-00000000000b'''
\set C '''f1c00000-0000-0000-0000-00000000000c'''
\set D '''f1d00000-0000-0000-0000-00000000000d'''
insert into follows (follower_id, following_id) values (:A, :B), (:C, :A);

-- ---- დაბადების დღე დღეს (თბილისით) და სახელობის დღე
do $$ declare m int := extract(month from (now() at time zone 'Asia/Tbilisi'))::int; d int := extract(day from (now() at time zone 'Asia/Tbilisi'))::int;
begin
  insert into birthdays (user_id, month, day) select id, m, d from profiles where username in ('giorgi.b', 'private.c', 'stranger');
  update birthdays set visible = false where user_id = 'f1c00000-0000-0000-0000-00000000000c';
  insert into name_days (name, month, day, feast) values (public.ka_skeleton('გიორგი'), m, d, 'სატესტო გიორგობა') on conflict do nothing;
end $$;
select pg_temp.as_user(:A); set role authenticated;
select c -> 'birthdays' as birthdays, c -> 'namedays' as namedays, c -> 'feasts' as feasts from (select public.celebrations_today() c) x;
do $$ declare c jsonb := public.celebrations_today(); begin
  if jsonb_array_length(c -> 'birthdays') <> 1 or (c -> 'birthdays' -> 0 ->> 'username') <> 'giorgi.b' then raise exception 'birthdays: %', c -> 'birthdays'; end if;
  -- ლათინური სახელი „Giorgi“ ქართულ სიას ემთხვევა
  if not exists (select 1 from jsonb_array_elements(c -> 'namedays') n, jsonb_array_elements(n -> 'people') p
                 where n ->> 'feast' = 'სატესტო გიორგობა' and p ->> 'username' = 'giorgi.b') then raise exception 'nameday: %', c -> 'namedays'; end if;
  if (c -> 'mine' ->> 'birthday')::boolean then raise exception 'mine wrong'; end if;
end $$;
-- საკუთარი დაბადების დღე: ჩაწერა და წაკითხვა; სხვისი — არა
insert into birthdays (month, day) values (3, 9);
select count(*) as sees_only_own from birthdays;
do $$ begin insert into birthdays (user_id, month, day) values ('f1d00000-0000-0000-0000-00000000000d', 1, 1); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot write others birthday'; end $$;
do $$ begin update birthdays set day = 31, month = 2 where user_id = auth.uid(); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: 31 Feb rejected'; end $$;
reset role;
do $$ begin if (select count(*) from birthdays) <> 4 then raise exception 'birthdays count'; end if; end $$;
-- ნაკიანი წლის გარეშე 29 თებერვალი 28-ში
select count(*) > 40 as seeded_name_days from name_days;

-- ---- მოხსენიება
select pg_temp.as_user(:A); set role authenticated;
insert into posts (author_id, body) values (auth.uid(), 'გამარჯობა @giorgi.b და @private.c, @nobody, @anna') returning id as p1 \gset
reset role;
select (select count(*) from notifications where type = 'mention' and user_id = :B) as b_mentioned,
       (select count(*) from notifications where type = 'mention' and user_id = :C) as c_mentioned,
       (select count(*) from notifications where type = 'mention' and user_id = :A) as self_mentioned;
do $$ begin
  if (select count(*) from notifications where type = 'mention' and user_id = 'f1b00000-0000-0000-0000-00000000000b') <> 1 then raise exception 'B not mentioned'; end if;
  if (select count(*) from notifications where type = 'mention' and user_id = 'f1a00000-0000-0000-0000-00000000000a') <> 0 then raise exception 'self mention'; end if;
end $$;
-- დახურული ავტორის პოსტში მოხსენიებული უცხო ვერ იღებს (ვერ ხედავს); გამომწერი — იღებს
insert into follows (follower_id, following_id) values (:A, :C);
select pg_temp.as_user(:C); set role authenticated;
insert into posts (author_id, body) values (auth.uid(), 'დახურული: @stranger @anna');
reset role;
do $$ begin
  if exists (select 1 from notifications where type = 'mention' and user_id = 'f1d00000-0000-0000-0000-00000000000d') then raise exception 'stranger saw private post'; end if;
  if not exists (select 1 from notifications where type = 'mention' and user_id = 'f1a00000-0000-0000-0000-00000000000a') then raise exception 'follower not mentioned'; end if;
end $$;

-- ---- რედაქტირება: ახალი მოხსენიება ერთხელ; 15 წუთის შემდეგ — აღარ
select pg_temp.as_user(:A); set role authenticated;
update posts set body = 'გამარჯობა @giorgi.b და @stranger' where id = :'p1';
reset role;
select edited_at is not null as edited, hashtags from posts where id = :'p1';
do $$ begin
  if (select count(*) from notifications where type = 'mention' and user_id = 'f1b00000-0000-0000-0000-00000000000b') <> 1 then raise exception 'old mention repeated'; end if;
  if (select count(*) from notifications where type = 'mention' and user_id = 'f1d00000-0000-0000-0000-00000000000d') <> 1 then raise exception 'new mention missing'; end if;
end $$;
update posts set created_at = now() - interval '20 minutes' where id = :'p1';
select pg_temp.as_user(:A); set role authenticated;
do $$ begin update posts set body = 'გვიან' where body like 'გამარჯობა @giorgi.b და @stranger'; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: edit window: %', sqlerrm; end $$;
do $$ begin update posts set link = '{"url":"https://phish.example/"}' where body like 'გამარჯობა @giorgi.b და @stranger'; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: late link swap rejected'; end $$;
reset role;

-- ---- ბმულის ბარათი
select pg_temp.as_user(:B); set role authenticated;
insert into posts (author_id, body, link) values (auth.uid(), 'ნახე https://example.com/a',
  '{"url":"https://example.com/a","title":"მაგალითი","description":"აღწერა","image":"https://example.com/i.png","site":"example.com"}') returning id as p2 \gset
do $$ begin insert into posts (author_id, body, link) values (auth.uid(), 'x', '{"url":"javascript:alert(1)"}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: bad link url rejected'; end $$;
do $$ begin insert into posts (author_id, body, link) values (auth.uid(), 'x', '{"url":"https://a.ge","image":"http://insecure/i.png"}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: insecure image rejected'; end $$;
reset role;

-- ---- მოგონებები: შარშან ამ დღეს
insert into posts (author_id, body, created_at) values (:A, 'შარშანდელი პოსტი', now() - interval '1 year');
insert into posts (author_id, body, created_at) values (:A, 'გუშინდელი პოსტი', now() - interval '1 day');
select pg_temp.as_user(:A); set role authenticated;
select body from public.my_memories();
do $$ begin
  if (select count(*) from public.my_memories()) <> 1 or (select body from public.my_memories() limit 1) <> 'შარშანდელი პოსტი' then raise exception 'memories wrong'; end if;
end $$;
reset role;
