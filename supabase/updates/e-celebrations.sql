-- ეზო — განახლება E: დაბადების და სახელობის დღეები, @მოხსენიება, რედაქტირება, ბმულის ბარათები, მოგონებები
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- საჭიროა წინა განახლებები (A–D) და განსაკუთრებით C (ქართული ძებნის ka_skeleton). განმეორებით გაშვება უსაფრთხოა.

-- =====================================================================
-- ეტაპი E: დაბადების და სახელობის დღეები, @მოხსენიება, რედაქტირება, ბმულის ბარათები, მოგონებები
-- =====================================================================

-- ---- დაბადების დღე: მხოლოდ თვე და დღე (წელი არ ინახება), ცალკე ცხრილში — სხვები პირდაპირ ვერ კითხულობენ,
-- მხოლოდ celebrations_today აჩვენებს მეგობრებს დღესვე (თუ visible)
create table if not exists public.birthdays (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  visible boolean not null default true,
  check (day <= case month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
);
alter table public.birthdays enable row level security;
drop policy if exists "own birthday" on public.birthdays;
create policy "own birthday" on public.birthdays for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.birthdays to authenticated;

-- ---- სახელობის დღეები (ახალი სტილით). name — სახელის „ჩონჩხი“ (ka_skeleton), რომ ლათინურად დაწერილიც დაემთხვეს.
-- სია შეგიძლია შეავსო: insert into public.name_days (name, month, day, feast) values (public.ka_skeleton('სახელი'), თვე, დღე, 'დღესასწაული');
create table if not exists public.name_days (
  name text not null,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  feast text not null,
  primary key (name, month, day)
);
alter table public.name_days enable row level security;
drop policy if exists "name days read" on public.name_days;
create policy "name days read" on public.name_days for select to authenticated using (true);
grant select on public.name_days to authenticated;

insert into public.name_days (name, month, day, feast)
select public.ka_skeleton(n), m, d, f from (values
  ('გიორგი', 11, 23, 'გიორგობა'), ('გიო', 11, 23, 'გიორგობა'), ('გოგი', 11, 23, 'გიორგობა'), ('გოგა', 11, 23, 'გიორგობა'),
  ('გიორგი', 5, 6, 'გაზაფხულის გიორგობა'), ('გიო', 5, 6, 'გაზაფხულის გიორგობა'), ('გოგი', 5, 6, 'გაზაფხულის გიორგობა'), ('გოგა', 5, 6, 'გაზაფხულის გიორგობა'),
  ('მარიამ', 8, 28, 'მარიამობა'), ('მარიამი', 8, 28, 'მარიამობა'), ('მარი', 8, 28, 'მარიამობა'),
  ('ნინო', 1, 27, 'ნინოობა'),
  ('ანდრია', 5, 12, 'ანდრიაობა'),
  ('ნიკოლოზ', 12, 19, 'ნიკოლოზობა'), ('ნიკოლოზი', 12, 19, 'ნიკოლოზობა'), ('ნიკა', 12, 19, 'ნიკოლოზობა'), ('ნიკო', 12, 19, 'ნიკოლოზობა'),
  ('ბარბარე', 12, 17, 'ბარბარობა'),
  ('ეკატერინე', 12, 7, 'ეკატერინობა'), ('ეკა', 12, 7, 'ეკატერინობა'),
  ('მიხეილ', 11, 21, 'მთავარანგელოზობა'), ('მიხეილი', 11, 21, 'მთავარანგელოზობა'), ('მიშა', 11, 21, 'მთავარანგელოზობა'), ('მიხო', 11, 21, 'მთავარანგელოზობა'),
  ('გაბრიელ', 11, 21, 'მთავარანგელოზობა'), ('გაბრიელი', 11, 21, 'მთავარანგელოზობა'), ('გაბო', 11, 21, 'მთავარანგელოზობა'),
  ('იოანე', 7, 7, 'ივანობა'), ('ივანე', 7, 7, 'ივანობა'), ('ვანო', 7, 7, 'ივანობა'),
  ('პეტრე', 7, 12, 'პეტრე-პავლობა'), ('პავლე', 7, 12, 'პეტრე-პავლობა'),
  ('ელენე', 6, 3, 'კონსტანტინე და ელენე'), ('კონსტანტინე', 6, 3, 'კონსტანტინე და ელენე'), ('კოტე', 6, 3, 'კონსტანტინე და ელენე'),
  ('ილია', 8, 2, 'ილიაობა'),
  ('სოფიო', 9, 30, 'სოფიოობა'), ('სოფო', 9, 30, 'სოფიოობა'), ('სოფია', 9, 30, 'სოფიოობა'),
  ('თამარ', 5, 14, 'თამარობა'), ('თამარი', 5, 14, 'თამარობა'), ('თამუნა', 5, 14, 'თამარობა'),
  ('ქეთევან', 9, 26, 'ქეთევანობა'), ('ქეთევანი', 9, 26, 'ქეთევანობა'), ('ქეთი', 9, 26, 'ქეთევანობა'), ('ქეთო', 9, 26, 'ქეთევანობა'),
  ('ვახტანგ', 12, 13, 'ვახტანგობა'), ('ვახტანგი', 12, 13, 'ვახტანგობა'), ('ვახო', 12, 13, 'ვახტანგობა'),
  ('ლუკა', 10, 31, 'ლუკაობა'), ('მათე', 11, 29, 'მათეობა'), ('თომა', 10, 19, 'თომაობა'),
  ('დიმიტრი', 11, 8, 'დიმიტრობა'), ('თეკლა', 10, 7, 'თეკლაობა'),
  ('ალექსანდრე', 12, 6, 'ალექსანდრობა'), ('სანდრო', 12, 6, 'ალექსანდრობა'), ('ალეკო', 12, 6, 'ალექსანდრობა')
) as v(n, m, d, f)
on conflict do nothing;

-- დღეს: დაბადების დღეები და სახელობის დღეები ჩემს წრეში (ვისაც ვიწერ ან ვინც მიწერს), თბილისის დროით
create or replace function public.celebrations_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Asia/Tbilisi')::date;
  m int := extract(month from (now() at time zone 'Asia/Tbilisi'))::int;
  d int := extract(day from (now() at time zone 'Asia/Tbilisi'))::int;
  -- 29 თებერვალს დაბადებულები ნაკიან წელს 28-ში
  leap_fix boolean := (m = 2 and d = 28 and extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int = 28);
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'date', today,
    'birthdays', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
                                          'verified', p.verified, 'last_seen', p.last_seen) order by p.full_name)
      from profiles p join birthdays b on b.user_id = p.id
      where p.id <> me and p.onboarded and b.visible and (p.banned_until is null or p.banned_until < now())
        and b.month = m and (b.day = d or (leap_fix and b.day = 29))
        and (exists (select 1 from follows where follower_id = me and following_id = p.id)
             or exists (select 1 from follows where follower_id = p.id and following_id = me))
        and not public.is_blocked(me, p.id)), '[]'::jsonb),
    'namedays', coalesce((
      select jsonb_agg(jsonb_build_object('feast', x.feast, 'people', x.people) order by x.feast)
      from (
        select nd.feast, jsonb_agg(distinct jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
                 'avatar_url', p.avatar_url, 'verified', p.verified, 'last_seen', p.last_seen)) as people
        from name_days nd
        join profiles p on public.ka_skeleton(split_part(btrim(p.full_name), ' ', 1)) = nd.name
        where nd.month = m and nd.day = d and p.id <> me and p.onboarded and (p.banned_until is null or p.banned_until < now())
          and (exists (select 1 from follows where follower_id = me and following_id = p.id)
               or exists (select 1 from follows where follower_id = p.id and following_id = me))
          and not public.is_blocked(me, p.id)
        group by nd.feast) x), '[]'::jsonb),
    'feasts', coalesce((select jsonb_agg(distinct feast) from name_days where month = m and day = d), '[]'::jsonb),
    'mine', jsonb_build_object(
      'birthday', exists (select 1 from birthdays b where b.user_id = me and b.month = m and (b.day = d or (leap_fix and b.day = 29))),
      'nameday', (select nd.feast from name_days nd join profiles p on p.id = me
                  where nd.month = m and nd.day = d and public.ka_skeleton(split_part(btrim(p.full_name), ' ', 1)) = nd.name limit 1)));
end $$;

-- ---- @მოხსენიება: შეტყობინება იმას, ვინც პოსტს ხედავს (მაქსიმუმ 10 ერთ პოსტში; რედაქტირებისას — მხოლოდ ახლებს)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote',
  'group_request', 'group_approved', 'event_rsvp', 'tournament_start', 'tournament_end',
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention'));

create or replace function public.extract_mentions(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct rtrim(lower(m[2]), '.')), '{}')
  from regexp_matches(coalesce(t, ''), '(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{3,24})', 'g') as m;
$$;

create or replace function public.on_post_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new text[]; v_old text[] := '{}'; v_user record; v_private boolean;
begin
  v_new := public.extract_mentions(new.body);
  if tg_op = 'UPDATE' then v_old := public.extract_mentions(old.body); end if;
  if cardinality(v_new) = 0 or new.hidden then return null; end if;
  select is_private into v_private from profiles where id = new.author_id;
  for v_user in
    select p.id from profiles p
    where p.username = any (v_new) and not (p.username = any (v_old)) and p.id <> new.author_id and p.onboarded
      -- ხედავს თუ არა მოხსენიებული ამ პოსტს
      and (not coalesce(v_private, false) or exists (select 1 from follows f where f.follower_id = p.id and f.following_id = new.author_id))
      and (new.group_id is null or exists (select 1 from groups g where g.id = new.group_id and g.privacy = 'public')
           or exists (select 1 from group_members gm where gm.group_id = new.group_id and gm.user_id = p.id and gm.status = 'active'))
    limit 10
  loop
    perform public.notify(v_user.id, new.author_id, 'mention', new.id);
  end loop;
  return null;
end $$;
drop trigger if exists posts_mentions on public.posts;
create trigger posts_mentions after insert or update of body on public.posts
  for each row execute function public.on_post_mentions();
revoke execute on function public.on_post_mentions() from public, anon, authenticated;

-- მოხსენიების Push „პასუხების“ კატეგორიაშია
create or replace function public.push_category(p_payload jsonb)
returns text language sql immutable as $$
  select case
    when p_payload ->> 'tag' like 'conv-%' then 'messages'
    when p_payload ->> 'tag' like 'call-%' then 'calls'
    when p_payload ->> 'tag' like 'game-%' then 'games'
    when p_payload ->> 'tag' ~ '^n-(reply|quote|mention)-' then 'replies'
    when p_payload ->> 'tag' ~ '^n-like-' then 'likes'
    when p_payload ->> 'tag' ~ '^n-(follow|follow_request|follow_accept|invite_joined)-' then 'follows'
    when p_payload ->> 'tag' ~ '^n-(game_invite|tournament_start|tournament_end)-' then 'games'
    when p_payload ->> 'tag' ~ '^n-match-' then 'dating'
    when p_payload ->> 'tag' ~ '^n-listing_price-' then 'market'
    when p_payload ->> 'tag' ~ '^n-(group_request|group_approved|event_rsvp)-' then 'groups'
    when p_payload ->> 'tag' ~ '^n-(gift|achievement|level_up)-' then 'rewards'
    else 'other' end;
$$;

-- Push-ის ტექსტები ყველა ტიპისთვის (მოხსენიების ჩათვლით)
create or replace function public.on_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor text; v_group text; v_event text;
begin
  select coalesce(nullif(full_name, ''), username) into v_actor from profiles where id = new.actor_id;
  select name into v_group from groups where id = new.group_id;
  select title into v_event from events where id = new.event_id;
  perform public.push_dispatch(new.user_id, jsonb_build_object(
    'title', case when new.type like 'tournament%' or new.type = 'listing_price' then coalesce(new.data ->> 'title', 'ეზო') else coalesce(v_actor, 'ეზო') end,
    'body', case new.type
      when 'tournament_start' then 'ტურნირი დაიწყო — შემოდი და ითამაშე'
      when 'tournament_end' then case when (new.data ->> 'place')::int = 1 then '🏆 გაიმარჯვე ტურნირში!'
        else 'ტურნირი დასრულდა. შენი ადგილი: მე-' || (new.data ->> 'place') || ' (' || (new.data ->> 'players') || '-დან)' end
      when 'like' then 'მოიწონა შენი პოსტი' when 'reply' then 'გიპასუხა' when 'quote' then 'გაგიზიარა ციტატით'
      when 'mention' then 'მოგიხსენია: ' || coalesce(left((select body from posts where id = new.post_id), 100), '')
      when 'follow' then 'გამოგიწერა' when 'gift' then 'საჩუქარი გამოგიგზავნა'
      when 'follow_request' then 'გამოწერას გთხოვს' when 'follow_accept' then 'დაგიდასტურა გამოწერა'
      when 'achievement' then 'ახალი მიღწევა: ' || coalesce((select title from badges where key = new.data ->> 'badge'), '') || ' (+' || (new.data ->> 'coins') || ' ბროწეული)'
      when 'invite_joined' then 'შენი მოწვევით შემოგვიერთდა 🎉 +20 ბროწეული'
      when 'level_up' then 'ახალი დონე: ' || (new.data ->> 'level') || '! +' || (new.data ->> 'coins') || ' ბროწეული'
      when 'listing_price' then 'შენახულ განცხადებას ფასი დაუკლეს: ' || public.price_text((new.data ->> 'price')::numeric, new.data ->> 'currency')
      when 'match' then 'თქვენ ერთმანეთი მოიწონეთ!' when 'game_invite' then 'თამაშში გეპატიჟება'
      when 'group_request' then 'ითხოვს გაწევრიანებას: ' || coalesce(v_group, 'ჯგუფი')
      when 'group_approved' then 'მიგიღეს ჯგუფში: ' || coalesce(v_group, '')
      when 'event_rsvp' then 'მოდის: ' || coalesce(v_event, 'შენს ივენთზე')
      else 'ახალი შეტყობინება' end,
    'url', case when new.type = 'game_invite' and new.game_id is not null then '/g/' || new.game_id
                when new.tournament_id is not null then '/t/' || new.tournament_id
                when new.type = 'match' then '/dating?tab=matches'
                when new.type = 'follow_request' then '/requests'
                when new.type = 'listing_price' then '/market/' || (new.data ->> 'listing_id')
                when new.type in ('achievement', 'level_up') then '/rewards'
                when new.group_id is not null then '/groups/' || (select slug from groups where id = new.group_id)
                when new.event_id is not null then '/events/' || new.event_id
                when new.post_id is not null then '/p/' || new.post_id else '/notifications' end,
    'tag', 'n-' || new.type || '-' || coalesce(new.post_id::text, new.group_id::text, new.tournament_id::text, new.data ->> 'listing_id', new.actor_id::text, '')));
  return new;
end $$;

-- ---- ბმულის ბარათი: { url, title, description, image, site } — ავტორი ამატებს გამოქვეყნებისას (api/unfurl.js)
alter table public.posts add column if not exists link jsonb;
alter table public.posts drop constraint if exists posts_link_check;
alter table public.posts add constraint posts_link_check check (
  link is null or (jsonb_typeof(link) = 'object' and link ->> 'url' ~ '^https?://' and char_length(link::text) <= 2000
                   and coalesce(link ->> 'image', 'https://') ~ '^https://'));

-- ---- რედაქტირება: ტექსტის შესწორება გამოქვეყნებიდან 15 წუთის განმავლობაში („შესწორებულია“ — edited_at)
create or replace function public.posts_edit_window()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (new.body is distinct from old.body or new.link is distinct from old.link)
     and old.created_at < now() - interval '15 minutes' then
    raise exception 'პოსტის შესწორება მხოლოდ გამოქვეყნებიდან 15 წუთის განმავლობაშია შესაძლებელი';
  end if;
  return new;
end $$;
drop trigger if exists posts_edit_window on public.posts;
create trigger posts_edit_window before update of body, link on public.posts
  for each row execute function public.posts_edit_window();

-- ---- „ამ დღეს“: ჩემი პოსტები იგივე დღეს წინა წლებში (თბილისის დროით)
create or replace function public.my_memories()
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.author_id = auth.uid() and p.parent_id is null and not p.hidden
    and extract(month from (p.created_at at time zone 'Asia/Tbilisi')) = extract(month from (now() at time zone 'Asia/Tbilisi'))
    and extract(day from (p.created_at at time zone 'Asia/Tbilisi')) = extract(day from (now() at time zone 'Asia/Tbilisi'))
    and (p.created_at at time zone 'Asia/Tbilisi')::date < date_trunc('year', now() at time zone 'Asia/Tbilisi')::date
  order by p.created_at desc
  limit 3;
$$;
