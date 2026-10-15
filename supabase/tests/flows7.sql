\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('a7a00000-0000-0000-0000-00000000000a','a@x'), ('a7b00000-0000-0000-0000-00000000000b','b@x'),
 ('a7c00000-0000-0000-0000-00000000000c','c@x'), ('a7d00000-0000-0000-0000-00000000000d','d@x');
update profiles set onboarded = true;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a7a00000-0000-0000-0000-00000000000a'''
\set B '''a7b00000-0000-0000-0000-00000000000b'''
\set C '''a7c00000-0000-0000-0000-00000000000c'''
\set D '''a7d00000-0000-0000-0000-00000000000d'''

-- A: დახურული პროფილი, პოსტი, სთორიები
select pg_temp.as_user(:A); set role authenticated;
update profiles set is_private = true where id = auth.uid();
insert into posts (author_id, body) values (auth.uid(), 'დახურული პოსტი') returning id as ap \gset
insert into stories (author_id, media_url, audience) values (auth.uid(), 'u/all.jpg', 'all') returning id as s_all \gset
insert into stories (author_id, media_url, audience) values (auth.uid(), 'u/close.jpg', 'close') returning id as s_close \gset
insert into stories (author_id, media_url, expires_at) values (auth.uid(), 'u/old.jpg', now() - interval '1 day');
select count(*) as a_sees_own_archive from stories;
reset role;

-- B: თხოვნა → ვერ ხედავს; პირდაპირი insert დაბლოკილია
select pg_temp.as_user(:B); set role authenticated;
select public.follow_user(:A) as b_follow;
select count(*) as b_sees_posts_before from posts where author_id = :A;
do $$ begin insert into follows (follower_id, following_id) values (auth.uid(), 'a7a00000-0000-0000-0000-00000000000a'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot bypass follow request'; end $$;
reset role;

select pg_temp.as_user(:A); set role authenticated;
select count(*) as a_requests from follow_requests where target_id = auth.uid();
select public.respond_follow_request(:B, true);
insert into close_friends (owner_id, friend_id) values (auth.uid(), :C);
reset role;

select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_posts_after from posts where author_id = :A;
select media_url from stories where author_id = :A order by media_url;
select type from notifications where user_id = auth.uid();
reset role;

-- C: თხოვნა გაგზავნა, შემდეგ A ხსნის პროფილს → ავტომატურად დასტური
select pg_temp.as_user(:C); set role authenticated;
select public.follow_user(:A) as c_follow;
reset role;
select pg_temp.as_user(:A); set role authenticated;
update profiles set is_private = false where id = auth.uid();
reset role;
select pg_temp.as_user(:C); set role authenticated;
select count(*) as c_follows_after_open from follows where follower_id = auth.uid() and following_id = :A;
select media_url from stories where author_id = :A order by media_url;
reset role;

-- გამოკითხვა
select pg_temp.as_user(:A); set role authenticated;
insert into posts (author_id, body) values (auth.uid(), 'ხინკალი თუ ხაჭაპური?') returning id as pp \gset
insert into polls (post_id, options) values (:'pp', '["ხინკალი","ხაჭაპური","ორივე"]');
do $$ begin insert into polls (post_id, options) values ((select id from posts where body = 'დახურული პოსტი'), '["ერთი"]'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: poll needs 2+ options'; end $$;
reset role;
select pg_temp.as_user(:B); set role authenticated;
select public.vote_poll(:'pp', array[1]);
select public.vote_poll(:'pp', array[2]);
do $$ begin perform public.vote_poll((select post_id from polls limit 1), array[0, 1]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: single choice (%)', sqlerrm; end $$;
do $$ begin perform public.vote_poll((select post_id from polls limit 1), array[7]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: option range'; end $$;
do $$ begin insert into polls (post_id, options) values ((select id from posts where body = 'ხინკალი თუ ხაჭაპური?'), '["a","b"]'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: only author attaches poll'; end $$;
reset role;
select pg_temp.as_user(:C); set role authenticated;
select public.vote_poll(:'pp', array[2]);
select count(*) as c_sees_votes_rows from poll_votes;
select option, votes, mine from public.poll_results(array[:'pp']::uuid[]) order by option;
reset role;
update polls set closes_at = now() - interval '1 minute' where post_id = :'pp';
select pg_temp.as_user(:D); set role authenticated;
do $$ begin perform public.vote_poll((select post_id from polls limit 1), array[0]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: closed poll (%)', sqlerrm; end $$;
reset role;

-- შენახული და კოლექციები
select pg_temp.as_user(:C); set role authenticated;
insert into collections (owner_id, name) values (auth.uid(), 'რეცეპტები') returning id as cc \gset
reset role;
select set_config('test.cc', :'cc', false);
select pg_temp.as_user(:B); set role authenticated;
insert into collections (owner_id, name) values (auth.uid(), 'მოგზაურობა') returning id as bc \gset
insert into saves (user_id, post_id, collection_id) values (auth.uid(), :'pp', :'bc');
do $$ begin insert into saves (user_id, post_id, collection_id) values (auth.uid(), (select id from posts where body = 'დახურული პოსტი'), current_setting('test.cc')::uuid); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot save into foreign collection'; end $$;
select count(*) as b_saves, count(*) filter (where collection_id is not null) as in_collection from saves;
reset role;

-- ჰაილაითები: მხოლოდ საჯარო სთორი; D ხედავს ახლა (პროფილი ღიაა)
select pg_temp.as_user(:A); set role authenticated;
select public.create_highlight('ზაფხული', array[:'s_all', :'s_close']::uuid[]) as hl \gset
select count(*) as items from highlight_items where highlight_id = :'hl';
update profiles set is_private = true where id = auth.uid();
reset role;
select pg_temp.as_user(:D); set role authenticated;
select count(*) as d_sees_highlights_private from highlights;
reset role;
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_highlights from highlights;
reset role;
