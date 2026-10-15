\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
 ('c1111111-1111-1111-1111-111111111111','a@x'), ('c2222222-2222-2222-2222-222222222222','b@x'), ('c3333333-3333-3333-3333-333333333333','c@x');
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111'); set role authenticated;
select public.create_group_chat('ძველი ბიჭები', array['c2222222-2222-2222-2222-222222222222','c3333333-3333-3333-3333-333333333333']::uuid[]) as gc \gset
select public.get_or_create_dm('c2222222-2222-2222-2222-222222222222') <> :'gc' as dm_is_separate;
select public.get_or_create_dm('c2222222-2222-2222-2222-222222222222') as dm \gset
insert into messages (conversation_id, sender_id, body) values (:'gc', auth.uid(), 'სალამი ყველას') returning id as m1 \gset
-- ყალბი ზარის მესიჯს ვერ შექმნის
insert into messages (conversation_id, sender_id, body, meta) values (:'dm', auth.uid(), 'x', '{"call": {"status": "ended"}, "story": {"id": "s"}}') returning meta;
select kind, title, members_count, my_role, last_sender_name from public.my_conversations() order by kind;
reset role;

select pg_temp.as_user('c2222222-2222-2222-2222-222222222222'); set role authenticated;
insert into messages (conversation_id, sender_id, body, reply_to) values (:'gc', auth.uid(), 'გამარჯობა!', :'m1');
insert into message_reactions (message_id, user_id, emoji) values (:'m1', auth.uid(), '❤️');
select emoji, conversation_id = :'gc' as conv_set from message_reactions;
do $$ begin perform public.delete_message((select id from messages where body = 'სალამი ყველას')); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot delete others message'; end $$;
do $$ begin perform public.rename_chat((select id from conversations where kind = 'group'), 'hack'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: non-admin cannot rename'; end $$;
-- ზარი ჯგუფში არ შეიძლება, DM-ში კი
do $$ begin insert into calls (conversation_id, caller_id, callee_id, kind) values ((select id from conversations where kind = 'group'), auth.uid(), 'c1111111-1111-1111-1111-111111111111', 'video'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: no group calls (%)', sqlerrm; end $$;
insert into calls (conversation_id, caller_id, callee_id, kind, status) values (:'dm', auth.uid(), 'c1111111-1111-1111-1111-111111111111', 'video', 'ended') returning status as forced_status, id as call_id \gset
-- დამრეკი ვერ „მიიღებს“ საკუთარ ზარს
do $$ begin update calls set status = 'accepted'; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: caller cannot accept'; end $$;
reset role;

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111'); set role authenticated;
update calls set status = 'accepted' where id = :'call_id';
select pg_sleep(1.1);
update calls set status = 'ended' where id = :'call_id';
select status, answered_at is not null as answered, ended_at is not null as ended from calls;
do $$ begin update calls set status = 'accepted'; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: ended call immutable'; end $$;
select meta->'call'->>'status' as call_msg, (meta->'call'->>'duration')::int >= 1 as has_duration from messages where meta ? 'call';
select last_message from conversations where kind = 'dm';
select public.rename_chat(:'gc', 'ძველი ბიჭები 2012');
select public.delete_message(:'m1');
select body = '' and deleted_at is not null as deleted from messages where id = :'m1';
reset role;

select pg_temp.as_user('c3333333-3333-3333-3333-333333333333'); set role authenticated;
select public.leave_chat(:'gc');
select count(*) as c3_sees_group from public.my_conversations();
reset role;
select count(*) as members_left from conversation_members where conversation_id = :'gc';
select body from messages where conversation_id = :'gc' and meta ? 'system' order by created_at;
