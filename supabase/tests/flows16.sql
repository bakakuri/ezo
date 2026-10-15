\set ON_ERROR_STOP 1
-- ეტაპი G: „გაღვიძება“ და საცავის დასუფთავება
insert into auth.users (id, email) values
 ('a1a00000-0000-0000-0000-00000000000a','a@x'), ('b1b00000-0000-0000-0000-00000000000b','b@x');
update profiles set onboarded = true;
update profiles set username = 'anna' where id = 'a1a00000-0000-0000-0000-00000000000a';
update profiles set username = 'beka' where id = 'b1b00000-0000-0000-0000-00000000000b';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.u(p text) returns text language sql as $$ select 'https://x.supabase.co/storage/v1/object/public/media/' || p $$;
\set A '''a1a00000-0000-0000-0000-00000000000a'''
\set B '''b1b00000-0000-0000-0000-00000000000b'''

-- ფაილები საცავში (როგორც Storage-ის ატვირთვა): ახლანდელები — რიგით, ორი დღის — ობლების ძებნით
insert into storage.objects (bucket_id, name, owner, created_at) values
 ('media', 'a1a00000-0000-0000-0000-00000000000a/posts/1.jpg', :A, now() - interval '2 hours'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/thumbs/1t.jpg', :A, now() - interval '2 hours'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/stories/s.jpg', :A, now() - interval '2 days'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/stories/s2.jpg', :A, now() - interval '2 days'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/avatars/a.jpg', :A, now() - interval '2 hours'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/avatars/b.jpg', :A, now() - interval '2 days'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/posts/orphan.jpg', :A, now() - interval '2 days'),
 ('media', 'a1a00000-0000-0000-0000-00000000000a/posts/new.jpg', :A, now()),
 ('media', 'misc/legacy.jpg', null, now() - interval '2 days');
update media_sweep set last_at = now() - interval '4 days';

-- პოსტი ფოტოთი და პატარა ასლით, სთორი ჰაილაითში, სთორი ჩატში პასუხად, ავატარი
insert into posts (author_id, body, media) values (:A, 'ფოტო',
  jsonb_build_array(jsonb_build_object('url', pg_temp.u('a1a00000-0000-0000-0000-00000000000a/posts/1.jpg'), 'thumb', pg_temp.u('a1a00000-0000-0000-0000-00000000000a/thumbs/1t.jpg'), 'type', 'image')))
  returning id as p1 \gset
insert into stories (author_id, media_url) values (:A, pg_temp.u('a1a00000-0000-0000-0000-00000000000a/stories/s.jpg')) returning id as s1 \gset
insert into stories (author_id, media_url) values (:A, pg_temp.u('a1a00000-0000-0000-0000-00000000000a/stories/s2.jpg')) returning id as s2 \gset
insert into highlights (owner_id, title) values (:A, 'ზღვა') returning id as h1 \gset
insert into highlight_items (highlight_id, media_url) values (:'h1', pg_temp.u('a1a00000-0000-0000-0000-00000000000a/stories/s.jpg'));
update profiles set avatar_url = pg_temp.u('a1a00000-0000-0000-0000-00000000000a/avatars/a.jpg') where id = :A;
select pg_temp.as_user(:B); set role authenticated;
select public.get_or_create_dm(:A) as conv \gset
insert into messages (conversation_id, sender_id, body, meta) values (:'conv', :B, 'რა ლამაზია',
  jsonb_build_object('story', jsonb_build_object('id', :'s2', 'url', pg_temp.u('a1a00000-0000-0000-0000-00000000000a/stories/s2.jpg'))));
reset role;

-- წაშლა და შეცვლა → რიგი
delete from posts where id = :'p1';
delete from stories where id in (:'s1', :'s2');
update profiles set avatar_url = pg_temp.u('a1a00000-0000-0000-0000-00000000000a/avatars/b.jpg') where id = :A;
update profiles set bio = 'სხვა' where id = :A;
select path from media_trash order by path;
do $$ begin
  if (select count(*) from media_trash) <> 5 then raise exception 'trash: %', (select string_agg(path, ', ') from media_trash); end if;
end $$;

-- ჩვეულებრივ მომხმარებელს ამ ფუნქციებზე წვდომა არ აქვს
select pg_temp.as_user(:A); set role authenticated;
do $$ begin perform public.media_cleanup_take(10); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: take forbidden: %', sqlerrm; end $$;
do $$ begin perform 1 from public.media_trash; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: trash hidden'; end $$;
reset role;
set role anon;
select public.keep_alive() is not null as alive;
reset role;

-- ჯერ ადრეა (საათი არ გასულა) — რიგიდან არაფერი; მაგრამ ობოლი ფაილი უკვე ჩანს
set role service_role;
select public.media_cleanup_take(100) as first_take \gset
reset role;
\echo first: :first_take
do $$ begin
  if (select count(*) from media_trash) <> 5 then raise exception 'trash consumed too early'; end if;
end $$;
select :'first_take'::text[] = array['a1a00000-0000-0000-0000-00000000000a/posts/orphan.jpg'] as only_orphan \gset
\if :only_orphan
\else
  \echo 'FAIL: first take' :first_take
  select 1/0;
\endif

-- საათის შემდეგ: წაიშლება პოსტის ფოტო, პატარა ასლი და ძველი ავატარი; სთორი (ჰაილაითში) და სთორი (ჩატში) რჩება
update media_trash set created_at = now() - interval '2 hours';
set role service_role;
select public.media_cleanup_take(100) as second_take \gset
reset role;
\echo second: :second_take
select (select array_agg(x order by x) from unnest(:'second_take'::text[]) x) = array[
  'a1a00000-0000-0000-0000-00000000000a/avatars/a.jpg',
  'a1a00000-0000-0000-0000-00000000000a/posts/1.jpg',
  'a1a00000-0000-0000-0000-00000000000a/thumbs/1t.jpg'] as second_ok \gset
\if :second_ok
\else
  \echo 'FAIL: second take' :second_take
  select 1/0;
\endif
do $$ begin
  if exists (select 1 from media_trash) then raise exception 'trash not emptied'; end if;
end $$;

-- ვერ წაიშალა → რიგში ბრუნდება
set role service_role;
select public.media_cleanup_return(array['a1a00000-0000-0000-0000-00000000000a/posts/1.jpg']);
select public.media_cleanup_take(100) as third_take \gset
reset role;
select :'third_take'::text[] = array['a1a00000-0000-0000-0000-00000000000a/posts/1.jpg'] as third_ok \gset
\if :third_ok
\else
  \echo 'FAIL: third take' :third_take
  select 1/0;
\endif

-- უცნობი ფორმის გზას (არა მომხმარებლის საქაღალდე) არ ვეხებით; ახალი ფაილი ჯერ ხელუხლებელია
do $$ begin
  if not public.media_in_use('misc/legacy.jpg') then raise exception 'legacy path would be deleted'; end if;
  if public.media_in_use('a1a00000-0000-0000-0000-00000000000a/posts/new.jpg') then raise exception 'new.jpg in use?'; end if;
end $$;

-- ანგარიშის წაშლა: მთელი ფაილები რიგში
select pg_temp.as_user(:B); set role authenticated;
update profiles set avatar_url = pg_temp.u('b1b00000-0000-0000-0000-00000000000b/avatars/z.jpg') where id = auth.uid();
select public.delete_my_account();
reset role;
select count(*) > 0 as b_avatar_queued from media_trash where path like 'b1b00000-%';
