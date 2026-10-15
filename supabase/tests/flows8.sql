\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('a8a00000-0000-0000-0000-00000000000a','a@x'), ('a8b00000-0000-0000-0000-00000000000b','b@x'),
 ('a8c00000-0000-0000-0000-00000000000c','c@x'), ('a8d00000-0000-0000-0000-00000000000d','d@x');
update profiles set onboarded = true;
update profiles set role = 'moderator' where id = 'a8d00000-0000-0000-0000-00000000000d';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a8a00000-0000-0000-0000-00000000000a'''
\set B '''a8b00000-0000-0000-0000-00000000000b'''
\set C '''a8c00000-0000-0000-0000-00000000000c'''
\set D '''a8d00000-0000-0000-0000-00000000000d'''

insert into app_secrets (key, value) values ('push_url', 'https://push.example/send') on conflict (key) do update set value = excluded.value;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('a8b00000-0000-0000-0000-00000000000b', 'https://push.example/b', 'k', 'a');
select public.price_text(1250, 'GEL') as p1, public.price_text(900.5, 'USD') as p2, public.price_text(null, 'GEL') as p3, public.price_text(0, 'GEL') as p4;

-- A: განცხადება; მთვლელების გაყალბება არ გამოდის
select pg_temp.as_user(:A); set role authenticated;
insert into listings (seller_id, title, price, category, condition, city, photos, views_count, saves_count, hidden)
values (auth.uid(), '  iPhone   13,  128GB ', 1200, 'electronics', 'used', 'თბილისი', '["https://cdn.x/1.jpg","https://cdn.x/2.jpg"]', 999, 50, true)
returning id as l1 \gset
select title, views_count, saves_count, hidden, status from listings where id = :'l1';
do $$ begin insert into listings (seller_id, title, category, photos) values (auth.uid(), 'ცუდი ფოტო', 'other', '["javascript:alert(1)"]'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: bad photo url rejected: %', sqlerrm; end $$;
update listings set views_count = 500, hidden = true, bumped_at = now() - interval '9 days' where id = :'l1';
select views_count, hidden, bumped_at > now() - interval '1 minute' as bump_kept from listings where id = :'l1';
do $$ begin perform public.bump_listing((select id from listings limit 1)); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: bump too soon: %', sqlerrm; end $$;
-- საკუთარს ვერ შეინახავს
do $$ begin insert into listing_saves (user_id, listing_id) values (auth.uid(), (select id from listings limit 1)); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot save own'; end $$;
select public.view_listing(:'l1');
reset role;

-- B: ხედავს, ნახვა ერთხელ ითვლება, ინახავს
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees from listings;
select public.view_listing(:'l1'); select public.view_listing(:'l1');
insert into listing_saves (user_id, listing_id) values (auth.uid(), :'l1');
select views_count as views_after_b, saves_count from listings where id = :'l1';
do $$ begin update listings set price = 1 where true; if (select price from listings limit 1) = 1 then raise exception 'SHOULD FAIL'; end if; raise notice 'ok: B cannot edit A listing'; end $$;
-- ჩატი: ყალბი ბარათი ჩანაცვლდება ნამდვილით
select public.get_or_create_dm(:A) as conv \gset
insert into messages (conversation_id, sender_id, body, meta) values (:'conv', auth.uid(), 'ჯერ იყიდება?',
  jsonb_build_object('listing', jsonb_build_object('id', :'l1', 'title', 'FAKE', 'photo', 'https://evil/x.png', 'price', 1)));
select last_message as first_last from conversations where id = :'conv';
insert into messages (conversation_id, sender_id, body, meta) values (:'conv', auth.uid(), 'ცუდი id', '{"listing": {"id": "abc"}}');
select body, meta -> 'listing' ->> 'title' as card_title, meta -> 'listing' ->> 'photo' as card_photo, meta -> 'listing' ->> 'price' as card_price from messages where conversation_id = :'conv' order by created_at;
select last_message from conversations where id = :'conv';
reset role;

-- A: ფასს უკლებს → B-ს შეტყობინება (12 სთ-ში ერთხელ)
select pg_temp.as_user(:A); set role authenticated;
update listings set price = 1000 where id = :'l1';
update listings set price = 1100 where id = :'l1';
update listings set price = 900 where id = :'l1';
update listings set title = 'iPhone 13' where id = :'l1';
reset role;
select type, data ->> 'price' as price, data ->> 'old_price' as old_price, data ->> 'title' as title from notifications where user_id = :B and type = 'listing_price';
select body -> 'payload' ->> 'title' as push_title, body -> 'payload' ->> 'body' as push_body, body -> 'payload' ->> 'url' like '/market/%' as push_url from net.calls where body::text like '%შენახულ%';

-- აწევა 24 სთ-ის შემდეგ
update listings set bumped_at = now() - interval '25 hours' where id = :'l1';
select pg_temp.as_user(:A); set role authenticated;
select public.bump_listing(:'l1') is not null as bumped;
insert into blocks (blocker_id, blocked_id) values (auth.uid(), :C);
reset role;

-- C დაბლოკილია → ვერ ხედავს
select pg_temp.as_user(:C); set role authenticated;
select count(*) as c_sees from listings;
reset role;

-- რეპორტები: 5 → დაიმალა
insert into auth.users (id, email) select ('a8e0000' || g || '-0000-0000-0000-000000000000')::uuid, 'r' || g || '@x' from generate_series(1, 5) g;
update profiles set onboarded = true;
do $$ declare u uuid; begin
  for u in select id from profiles where id::text like 'a8e0000%' loop
    perform set_config('request.jwt.claim.sub', u::text, false);
    insert into reports (reporter_id, target_user, target_listing, category, reason)
    values (u, 'a8a00000-0000-0000-0000-00000000000a', (select id from listings limit 1), 'fake', 'თაღლითობა');
  end loop; end $$;
select hidden as hidden_after_reports from listings where id = :'l1';
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_hidden from listings;
reset role;
select pg_temp.as_user(:A); set role authenticated;
select count(*) as a_sees_own_hidden from listings;
reset role;
select pg_temp.as_user(:D); set role authenticated;
select reports_count, target_listing ->> 'title' as listing, target_user ->> 'username' is not null as has_seller, target_post is null as no_post from public.admin_reports('open');
select (public.admin_stats()) ->> 'open_reports' as open_reports;
select public.admin_resolve((select id from public.admin_reports('open') limit 1), 'delete_listing');
select count(*) as listings_left from listings;
select count(*) as open_left from public.admin_reports('open');
reset role;

-- სპამის ლიმიტი: დღეში 10
select pg_temp.as_user(:A); set role authenticated;
do $$ begin for i in 1..10 loop insert into listings (seller_id, title, category, price) values (auth.uid(), 'ნივთი ' || i, 'other', i); end loop; end $$;
do $$ begin insert into listings (seller_id, title, category) values (auth.uid(), 'მე-11', 'other'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: rate limit: %', sqlerrm; end $$;
select public.seller_stats(auth.uid()) ->> 'active' as active;
reset role;

-- დაბლოკილი (ban) გამყიდველის განცხადებები ქრება
update profiles set banned_until = now() + interval '3 days' where id = :A;
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_banned_seller from listings;
reset role;
