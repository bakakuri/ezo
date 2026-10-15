\set ON_ERROR_STOP 1
-- ეტაპი C: ვის გამოიწერო, ნიშანი, მიმაგრება, მონახაზები, ქართული ძებნა
insert into auth.users (id, email) values
 ('d1a00000-0000-0000-0000-00000000000a','a@x'), ('d1b00000-0000-0000-0000-00000000000b','b@x'),
 ('d1c00000-0000-0000-0000-00000000000c','c@x'), ('d1d00000-0000-0000-0000-00000000000d','d@x'),
 ('d1e00000-0000-0000-0000-00000000000e','e@x'), ('d1f00000-0000-0000-0000-00000000000f','f@x'),
 ('d1100000-0000-0000-0000-000000000011','g@x'), ('d1200000-0000-0000-0000-000000000012','h@x');
update profiles set onboarded = true;
update profiles set username = 'gio.b', full_name = 'გიორგი ბერიძე', school = '1-ლი სკოლა', grad_year = 2010, city = 'თბილისი' where id = 'd1a00000-0000-0000-0000-00000000000a';
update profiles set username = 'nino', full_name = 'ნინო კლასელი', school = '1-ლი სკოლა', grad_year = 2010 where id = 'd1b00000-0000-0000-0000-00000000000b';
update profiles set username = 'luka', full_name = 'ლუკა მიმწერი' where id = 'd1c00000-0000-0000-0000-00000000000c';
update profiles set username = 'dato', full_name = 'დათო საერთო' where id = 'd1d00000-0000-0000-0000-00000000000d';
update profiles set username = 'eka', full_name = 'ეკა ქალაქელი', city = 'თბილისი' where id = 'd1e00000-0000-0000-0000-00000000000e';
update profiles set username = 'shota', full_name = 'შოთა ჭავჭავაძე' where id = 'd1f00000-0000-0000-0000-00000000000f';
update profiles set username = 'banned1', full_name = 'დაბლოკილი', banned_until = now() + interval '1 day' where id = 'd1100000-0000-0000-0000-000000000011';
update profiles set username = 'admin1', full_name = 'ადმინი', role = 'admin' where id = 'd1200000-0000-0000-0000-000000000012';
create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
\set A '''d1a00000-0000-0000-0000-00000000000a'''
\set B '''d1b00000-0000-0000-0000-00000000000b'''
\set C '''d1c00000-0000-0000-0000-00000000000c'''
\set D '''d1d00000-0000-0000-0000-00000000000d'''
\set E '''d1e00000-0000-0000-0000-00000000000e'''
\set F '''d1f00000-0000-0000-0000-00000000000f'''
\set ADM '''d1200000-0000-0000-0000-000000000012'''

-- C იწერს A-ს; A იწერს F-ს, F იწერს D-ს (D — საერთო)
insert into follows (follower_id, following_id) values (:C, :A), (:A, :F), (:F, :D);

-- ---- ვის გამოიწერო
select pg_temp.as_user(:A); set role authenticated;
select x ->> 'username' as who, x ->> 'reason' as reason, x ->> 'mutual' as mutual, x ->> 'via' as via
  from jsonb_array_elements(public.who_to_follow(10)) x;
do $$ declare l jsonb := public.who_to_follow(10); names text[];
begin
  select array_agg(x ->> 'username') into names from jsonb_array_elements(l) x;
  if names[1] <> 'luka' or (l -> 0 ->> 'reason') <> 'follows_you' then raise exception 'follows_you first: %', l; end if;
  if names[2] <> 'nino' or (l -> 1 ->> 'reason') <> 'classmate' then raise exception 'classmate second: %', names; end if;
  if not exists (select 1 from jsonb_array_elements(l) x where x ->> 'username' = 'dato' and x ->> 'reason' = 'mutual' and x ->> 'via' = 'შოთა ჭავჭავაძე') then raise exception 'mutual: %', l; end if;
  if not exists (select 1 from jsonb_array_elements(l) x where x ->> 'username' = 'eka' and x ->> 'reason' = 'city') then raise exception 'city: %', l; end if;
  if 'shota' = any(names) or 'banned1' = any(names) or 'gio.b' = any(names) then raise exception 'followed, banned or self listed: %', names; end if;
end $$;
select public.dismiss_suggestion(:B);
do $$ begin
  if exists (select 1 from jsonb_array_elements(public.who_to_follow(10)) x where x ->> 'username' = 'nino') then raise exception 'dismissed still listed'; end if;
end $$;
reset role;

-- ---- დადასტურებული ნიშანი
select pg_temp.as_user(:A); set role authenticated;
update profiles set verified = true, full_name = 'გიორგი ბერიძე' where id = auth.uid();
do $$ begin perform public.admin_set_verified(auth.uid(), true); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: only admin verifies: %', sqlerrm; end $$;
reset role;
select verified as self_verify_ignored from profiles where id = :A;
select pg_temp.as_user(:ADM); set role authenticated;
select public.admin_set_verified(:A, true);
reset role;
do $$ begin if not (select verified from profiles where username = 'gio.b') then raise exception 'admin verify failed'; end if; end $$;

-- ---- მიმაგრებული პოსტი
insert into posts (author_id, body) values (:A, 'მიმაგრებული პოსტი #ნარდი') returning id as pa \gset
insert into posts (author_id, body, parent_id) values (:A, 'პასუხი', :'pa') returning id as reply \gset
insert into posts (author_id, body) values (:B, 'სხვისი პოსტი') returning id as pb \gset
select pg_temp.as_user(:A); set role authenticated;
select public.pin_post(:'pa');
do $$ begin perform public.pin_post((select id from posts where body = 'სხვისი პოსტი')); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot pin others: %', sqlerrm; end $$;
do $$ begin perform public.pin_post((select id from posts where body = 'პასუხი')); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot pin reply'; end $$;
update profiles set pinned_post_id = (select id from posts where body = 'სხვისი პოსტი') where id = auth.uid();
reset role;
do $$ begin
  if (select pinned_post_id from profiles where username = 'gio.b') <> (select id from posts where body like 'მიმაგრებული%') then raise exception 'pin wrong or direct update not ignored'; end if;
end $$;
delete from posts where id = :'pa';
select pinned_post_id is null as unpinned_on_delete from profiles where id = :A;

-- ---- მონახაზები
select pg_temp.as_user(:A); set role authenticated;
insert into drafts (body, poll) values ('ჯერ არ გამოვაქვეყნე', '{"options":["ა","ბ"],"days":1}');
update drafts set body = 'შესწორებული', user_id = :B where body = 'ჯერ არ გამოვაქვეყნე';
select count(*) as a_drafts, max(body) as body from drafts;
reset role;
select pg_temp.as_user(:B); set role authenticated;
select count(*) as b_sees_a_drafts from drafts;
do $$ begin insert into drafts (user_id, body) values ('d1a00000-0000-0000-0000-00000000000a', 'სხვის სახელით'); raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: cannot write others drafts'; end $$;
do $$ begin for i in 1..51 loop insert into drafts (body) values ('d' || i); end loop; raise exception 'SHOULD FAIL';
exception when others then if sqlerrm = 'SHOULD FAIL' then raise; end if; raise notice 'ok: drafts limit: %', sqlerrm; end $$;
reset role;
do $$ begin
  if (select user_id from drafts where body = 'შესწორებული') <> 'd1a00000-0000-0000-0000-00000000000a' then raise exception 'draft owner changed'; end if;
end $$;

-- ---- ქართული ძებნა
insert into posts (author_id, body) values (:F, 'ნარდის ტურნირი ვაკეში #ნარდი'), (:F, 'სხვა რამე');
insert into groups (slug, name, owner_id) values ('nardi-club', 'ნარდის კლუბი', :F);
insert into listings (seller_id, title, price, currency, category, condition, city) values (:F, 'ნარდის დაფა', 50, 'GEL', 'hobby', 'used', 'თბილისი');
update profiles set is_private = true where id = :E;
insert into posts (author_id, body) values (:E, 'დახურული ნარდი');
select pg_temp.as_user(:B); set role authenticated;
select q, (select string_agg(x ->> 'username', ',') from jsonb_array_elements(public.search_all(q) -> 'people') x) as people
  from unnest(array['giorgi', 'beridze', 'ბერიძ', 'gio', 'giorgii', 'chavchavadze', 'შოთა', '@shota', 'x']) q;
do $$ declare r jsonb;
begin
  for r in select public.search_all(q) from unnest(array['giorgi', 'beridze', 'ბერიძ', 'gio', 'giorgii']) q loop
    if (r -> 'people' -> 0 ->> 'username') is distinct from 'gio.b' then raise exception 'people search: %', r -> 'people'; end if;
  end loop;
  if (public.search_all('gio') -> 'people' -> 0 ->> 'verified')::boolean is not true then raise exception 'verified missing'; end if;
  if (public.search_all('chavchavadze') -> 'people' -> 0 ->> 'username') <> 'shota' then raise exception 'translit surname'; end if;
  if (public.search_all('@shota') -> 'people' -> 0 ->> 'username') <> 'shota' then raise exception '@ prefix'; end if;
  if exists (select 1 from jsonb_array_elements(public.search_all('dablok') -> 'people') x where x ->> 'username' = 'banned1') then raise exception 'banned found'; end if;
  r := public.search_all('nardi');
  if jsonb_array_length(r -> 'posts') <> 1 then raise exception 'posts (private must be hidden): %', r -> 'posts'; end if;
  if (r -> 'tags' -> 0 ->> 'tag') <> 'ნარდი' then raise exception 'tags: %', r -> 'tags'; end if;
  if (r -> 'groups' -> 0 ->> 'slug') <> 'nardi-club' then raise exception 'groups: %', r -> 'groups'; end if;
  if (r -> 'listings' -> 0 ->> 'title') <> 'ნარდის დაფა' then raise exception 'listings: %', r -> 'listings'; end if;
  if public.search_all('x') <> '{"tags": [], "posts": [], "groups": [], "people": [], "listings": []}'::jsonb then raise exception 'short query'; end if;
  if jsonb_array_length(public.search_all('%_%') -> 'people') <> 0 then raise exception 'wildcards not escaped'; end if;
end $$;
reset role;
-- ძებნისთვის ინდექსი არსებობს
select count(*) as trgm_indexes from pg_indexes where indexname in ('profiles_search_trgm', 'posts_search_trgm', 'groups_search_trgm', 'listings_search_trgm');
