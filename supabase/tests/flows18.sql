\set ON_ERROR_STOP 1
-- ეტაპი I: ძებნა, მიმაგრება და დადუმება, ქრებადი მესიჯები, გამოკითხვა
insert into auth.users (id, email) values
 ('a8a00000-0000-0000-0000-00000000000a','a@x'), ('b8b00000-0000-0000-0000-00000000000b','b@x'),
 ('c8c00000-0000-0000-0000-00000000000c','c@x'), ('d8d00000-0000-0000-0000-00000000000d','d@x'),
 ('e8e00000-0000-0000-0000-00000000000e','e@x'), ('f8f00000-0000-0000-0000-00000000000f','f@x'),
 ('98900000-0000-0000-0000-000000000009','g@x');
update profiles set onboarded = true;
update profiles set username = 'u' || left(id::text, 2);
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''a8a00000-0000-0000-0000-00000000000a'''
\set B '''b8b00000-0000-0000-0000-00000000000b'''
\set C '''c8c00000-0000-0000-0000-00000000000c'''
\set D '''d8d00000-0000-0000-0000-00000000000d'''
insert into app_secrets (key, value) values ('push_url', 'https://push.example/send') on conflict (key) do update set value = excluded.value;
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (:A, 'https://push.example/a', 'k', 'a'), (:C, 'https://push.example/c', 'k', 'c');

select pg_temp.as_user(:A); set role authenticated;
select public.get_or_create_dm(:B) as dm \gset
select public.create_group_chat('ეზოს გუნდი', array[:B, :C]::uuid[]) as grp \gset
select public.get_or_create_dm(:D) as dm_d \gset
select public.get_or_create_dm('e8e00000-0000-0000-0000-00000000000e') as dm_e \gset
select public.get_or_create_dm('f8f00000-0000-0000-0000-00000000000f') as dm_f \gset
select public.get_or_create_dm('98900000-0000-0000-0000-000000000009') as dm_g \gset

-- ---- მიმაგრება: ზემოთ ჩანს; მეექვსე — არა
select public.set_chat_prefs(:'dm_d', true) ->> 'pinned' as pinned_d;
select id = :'dm_d' as pinned_first from public.my_conversations() limit 1;
select public.set_chat_prefs(c, true) from unnest(array[:'dm', :'grp', :'dm_e', :'dm_f']::uuid[]) c;
do $$ begin perform public.set_chat_prefs((select id from public.my_conversations() where not pinned limit 1), true); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: 6th pin: %', sqlerrm; end $$;
select public.set_chat_prefs(:'dm_e', false) ->> 'pinned' as unpinned_e;

-- ---- დადუმება: ჯგუფში A დადუმებულია — Push მხოლოდ C-ს
select (public.set_chat_prefs(:'grp', null, 8) ->> 'muted')::boolean as muted_8h;
select muted, mute_forever, muted_until > now() as until_set from public.my_conversations() where id = :'grp';
reset role;
select pg_temp.as_user(:B); set role authenticated;
insert into messages (conversation_id, sender_id, body) values (:'grp', auth.uid(), 'გამარჯობა ყველას, ხვალ ნარდი ვითამაშოთ?');
reset role;
do $$ begin
  if exists (select 1 from net.calls where body ->> 'user_id' = 'a8a00000-0000-0000-0000-00000000000a') then raise exception 'muted user got push'; end if;
  if not exists (select 1 from net.calls where body ->> 'user_id' = 'c8c00000-0000-0000-0000-00000000000c') then raise exception 'C got no push'; end if;
end $$;
select pg_temp.as_user(:A); set role authenticated;
select (public.set_chat_prefs(:'grp', null, -1) ->> 'mute_forever')::boolean as forever;
select (public.set_chat_prefs(:'grp', null, 0) ->> 'muted')::boolean as unmuted;
reset role;

-- ---- ქრებადი მესიჯები: პირად ჩატში B რთავს; A-ს მესიჯს ვადა აქვს; ვადის შემდეგ აღარ ჩანს და იშლება
select pg_temp.as_user(:B); set role authenticated;
select public.set_disappearing(:'dm', 24);
reset role;
select pg_temp.as_user(:A); set role authenticated;
insert into messages (conversation_id, sender_id, body) values (:'dm', auth.uid(), 'ეს გაქრება') returning id as gone \gset
select body, meta ->> 'disappear' as h from messages where conversation_id = :'dm' and meta ? 'system';
select disappear_hours from public.my_conversations() where id = :'dm';
reset role;
do $$ begin
  if (select expires_at from messages where body = 'ეს გაქრება') not between now() + interval '23 hours' and now() + interval '25 hours' then raise exception 'expires_at'; end if;
  if (select expires_at from messages where meta ? 'system' and meta ? 'disappear') is not null then raise exception 'system message expires'; end if;
end $$;
update messages set expires_at = now() - interval '1 minute' where id = :'gone';
select pg_temp.as_user(:A); set role authenticated;
select count(*) as visible_expired from messages where id = :'gone';
do $$ begin if exists (select 1 from messages where body = 'ეს გაქრება') then raise exception 'expired visible'; end if; end $$;
reset role;
set role anon; select public.keep_alive() is not null as alive; reset role;
do $$ begin if exists (select 1 from messages where body = 'ეს გაქრება') then raise exception 'expired not purged'; end if; end $$;
-- ჯგუფში არაადმინი ვერ რთავს
select pg_temp.as_user(:C); set role authenticated;
do $$ begin perform public.set_disappearing((select id from conversations where kind = 'group'), 168); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: member cannot: %', sqlerrm; end $$;
reset role;

-- ---- ძებნა: ლათინურით ქართული; არაწევრი ვერ პოულობს
select pg_temp.as_user(:C); set role authenticated;
select jsonb_array_length(public.search_messages('nardi')) as found_latin, public.search_messages('ნარდ') -> 0 ->> 'title' as conv_title;
do $$ begin
  if jsonb_array_length(public.search_messages('nardi')) <> 1 then raise exception 'latin search'; end if;
  if jsonb_array_length(public.search_messages('nardi', gen_random_uuid())) <> 0 then raise exception 'conv filter'; end if;
  if jsonb_array_length(public.search_messages('nardi', (select id from conversations where kind = 'group'))) <> 1 then raise exception 'conv filter group'; end if;
  if jsonb_array_length(public.search_messages('%%')) <> 0 or jsonb_array_length(public.search_messages('n')) <> 0 then raise exception 'short/wildcard'; end if;
end $$;
reset role;
select pg_temp.as_user(:D); set role authenticated;
do $$ begin if jsonb_array_length(public.search_messages('nardi')) <> 0 then raise exception 'non-member found'; end if; end $$;
reset role;

-- ---- გამოკითხვა
select pg_temp.as_user(:A); set role authenticated;
insert into messages (conversation_id, sender_id, body, meta) values (:'grp', auth.uid(), 'როდის შევხვდეთ?',
  '{"poll": {"options": [" ხვალ ", "ზეგ", "შაბათს"], "multi": false, "extra": 1}}') returning id as poll \gset
select meta from messages where id = :'poll';
do $$ begin insert into messages (conversation_id, sender_id, body, meta) values ((select id from conversations where kind = 'dm' limit 1), auth.uid(), 'x', '{"poll": {"options": ["a", "b"]}}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: poll in dm: %', sqlerrm; end $$;
do $$ begin insert into messages (conversation_id, sender_id, body, meta) values ((select id from conversations where kind = 'group'), auth.uid(), 'x', '{"poll": {"options": ["მხოლოდ ერთი"]}}'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: one option: %', sqlerrm; end $$;
select last_message from public.my_conversations() where id = :'grp';
reset role;
select pg_temp.as_user(:B); set role authenticated;
select public.vote_chat_poll(:'poll', array[1]);
select public.vote_chat_poll(:'poll', array[0]);
do $$ begin perform public.vote_chat_poll((select id from messages where meta ? 'poll'), array[0, 1]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: single choice: %', sqlerrm; end $$;
do $$ begin perform public.vote_chat_poll((select id from messages where meta ? 'poll'), array[7]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: bad option'; end $$;
reset role;
select pg_temp.as_user(:C); set role authenticated;
select public.vote_chat_poll(:'poll', array[2]);
select option, count(*) from chat_poll_votes group by option order by option;
do $$ begin
  if (select string_agg(option::text, ',' order by option) from chat_poll_votes) <> '0,2' then raise exception 'votes: %', (select string_agg(option::text, ',') from chat_poll_votes); end if;
end $$;
select public.vote_chat_poll(:'poll', '{}');
reset role;
select pg_temp.as_user(:D); set role authenticated;
do $$ begin
  if exists (select 1 from chat_poll_votes) then raise exception 'non-member sees votes'; end if;
  perform public.vote_chat_poll((select id from messages where body = 'nonexistent'), array[0]); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: non-member vote: %', sqlerrm; end $$;
reset role;
do $$ begin if (select count(*) from chat_poll_votes) <> 1 then raise exception 'unvote'; end if; end $$;
