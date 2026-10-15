\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('a1111111-1111-1111-1111-111111111111','a@x'), ('a2222222-2222-2222-2222-222222222222','b@x'), ('a3333333-3333-3333-3333-333333333333','c@x');
update profiles set onboarded = true;
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- A ქმნის დახურულ ჯგუფს და პოსტს
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111'); set role authenticated;
insert into groups (id, slug, name, privacy, owner_id) values ('b0000000-0000-0000-0000-000000000001', 'kutaisi-2012', 'კლასელები 2012', 'private', auth.uid());
insert into posts (author_id, body, group_id) values (auth.uid(), 'შეხვედრა შაბათს #კლასელები #Reunion', 'b0000000-0000-0000-0000-000000000001');
insert into posts (author_id, body) values (auth.uid(), 'საჯარო პოსტი #reunion');
select members_count from groups;
select hashtags from posts order by created_at;
reset role;

-- B ვერ ხედავს დახურული ჯგუფის პოსტს, ვერც წერს; ითხოვს გაწევრიანებას
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222'); set role authenticated;
select count(*) as b_sees_posts from posts;
select count(*) as b_feed_following from public.feed_following();
select tag, posts from public.trending_tags();
do $$ begin insert into posts (author_id, body, group_id) values (auth.uid(), 'x', 'b0000000-0000-0000-0000-000000000001'); raise exception 'SHOULD FAIL';
exception when insufficient_privilege then raise notice 'ok: non-member cannot post in group'; end $$;
select public.join_group('b0000000-0000-0000-0000-000000000001') as join_status;
reset role;
select type from notifications where type = 'group_request';

-- A ამტკიცებს
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111'); set role authenticated;
select public.manage_member('b0000000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'approve');
insert into events (id, title, starts_at, host_id, group_id, place) values ('e0000000-0000-0000-0000-000000000001', 'კლასის შეხვედრა', now() + interval '3 days', auth.uid(), 'b0000000-0000-0000-0000-000000000001', 'ქუთაისი');
reset role;

select pg_temp.as_user('a2222222-2222-2222-2222-222222222222'); set role authenticated;
select count(*) as b_sees_posts_after from posts;
select count(*) as b_feed_following_after from public.feed_following();
select count(*) as tag_reunion from public.tag_posts('#reunion');
insert into event_rsvps values ('e0000000-0000-0000-0000-000000000001', auth.uid(), 'going');
reset role;
select going_count, interested_count from events;
select type, event_id is not null as has_event from notifications where type in ('group_approved', 'event_rsvp') order by type;

-- C (გარეშე) ვერ ხედავს ივენთს და წევრებს
select pg_temp.as_user('a3333333-3333-3333-3333-333333333333'); set role authenticated;
select count(*) as c_events, (select count(*) from group_members) as c_members, (select members_count from groups) as count_public from events;
-- C-ს აქვს საჯარო ჯგუფი, B ფოსტავს
insert into groups (id, slug, name, owner_id) values ('b0000000-0000-0000-0000-000000000002', 'nardi-club', 'ნარდის კლუბი', auth.uid());
reset role;
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222'); set role authenticated;
select public.join_group('b0000000-0000-0000-0000-000000000002') as public_join;
do $$ begin perform public.leave_group('b0000000-0000-0000-0000-000000000002'); end $$;
reset role;
select slug, members_count from groups order by slug;
-- მოდერაცია: დამალული პოსტი ფიდში აღარ ჩანს
update posts set hidden = true where body = 'საჯარო პოსტი #reunion';
select pg_temp.as_user('a3333333-3333-3333-3333-333333333333'); set role authenticated;
select count(*) as hidden_in_foryou from public.feed_foryou();
reset role;
