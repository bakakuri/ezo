-- ეზო — სქემის ნაწილი 8/9. გაუშვი 7-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

-- ---- ადმინის ანალიტიკა: დღიური რიგები და შეჯამება (თბილისის დროით)
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  n int := greatest(7, least(coalesce(p_days, 30), 180));
  today date := (now() at time zone 'Asia/Tbilisi')::date;
  since date;
  t0 timestamptz;   -- პერიოდის დასაწყისი (თბილისის შუაღამე)
  tp timestamptz;   -- წინა პერიოდის დასაწყისი
  r jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  since := today - (n - 1);
  t0 := since::timestamp at time zone 'Asia/Tbilisi';
  tp := (since - n)::timestamp at time zone 'Asia/Tbilisi';
  with d as (select generate_series(since, today, interval '1 day')::date as day),
  su as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from profiles where created_at >= t0 group by 1),
  ac as (select day, count(*) as n from daily_active where day >= since group by 1),
  po as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) filter (where parent_id is null) as n,
                count(*) filter (where parent_id is not null) as r from posts where created_at >= t0 group by 1),
  me as (select (created_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from messages where created_at >= t0 group by 1),
  ga as (select (updated_at at time zone 'Asia/Tbilisi')::date as day, count(*) as n from games where status = 'finished' and updated_at >= t0 group by 1)
  select jsonb_agg(jsonb_build_object('day', d.day, 'signups', coalesce(su.n, 0), 'active', coalesce(ac.n, 0),
           'posts', coalesce(po.n, 0), 'replies', coalesce(po.r, 0), 'messages', coalesce(me.n, 0), 'games', coalesce(ga.n, 0)) order by d.day)
    into r
    from d left join su using (day) left join ac using (day) left join po using (day) left join me using (day) left join ga using (day);
  return jsonb_build_object(
    'days', r,
    'totals', jsonb_build_object(
      'users', (select count(*) from profiles where onboarded),
      'dau', (select count(*) from daily_active where day = today),
      'wau', (select count(distinct user_id) from daily_active where day > today - 7),
      'mau', (select count(distinct user_id) from daily_active where day > today - 30),
      'signups', (select count(*) from profiles where created_at >= t0),
      'signups_prev', (select count(*) from profiles where created_at >= tp and created_at < t0),
      'posts', (select count(*) from posts where parent_id is null and created_at >= t0),
      'posts_prev', (select count(*) from posts where parent_id is null and created_at >= tp and created_at < t0),
      -- 7 დღის დაბრუნება: 8–14 დღის წინ დარეგისტრირებულებიდან რამდენი შემოვიდა ბოლო 7 დღეში
      'retention_7d', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (
                          select 1 from daily_active a where a.user_id = p.id and a.day > today - 7)) / count(*)) end
                       from profiles p where (p.created_at at time zone 'Asia/Tbilisi')::date between today - 14 and today - 8)));
end $$;

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
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention', 'season_end'));

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

-- მოხსენიების Push „პასუხების“ კატეგორიაშია; Push-ის ტექსტები და კატეგორიები — ეტაპი H-ში (push_category, on_notification_push)

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

-- =====================================================================
-- ეტაპი G: „გაღვიძება“ და საცავის დასუფთავება
-- =====================================================================

-- ---- გაღვიძება: Supabase-ის უფასო პროექტი 7 დღის უმოქმედობის შემდეგ ჩერდება.
-- Vercel-ის ყოველდღიური cron (api/daily.js) ამას იძახებს — ერთი მარტივი მოთხოვნა ბაზაში საკმარისია.
create or replace function public.keep_alive()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- ---- წაშლილი ფოტოების, ვიდეოების და ხმოვანების დასუფთავება საცავიდან (bucket „media“).
-- 1) ტრიგერები: როცა ჩანაწერი იშლება ან ფოტო იცვლება, ძველი ფაილის გზა რიგში (media_trash) ჩადის;
-- 2) api/daily.js (service გასაღებით) დღეში ერთხელ იღებს რიგს — media_cleanup_take — და შლის მხოლოდ იმას,
--    რასაც აღარაფერი იყენებს (media_in_use: მაგ. სთორი ჰაილაითში ან ჩატში პასუხად რჩება);
-- 3) ატვირთული, მაგრამ არსად მიმაგრებული ფაილები (გაუქმებული პოსტი, შეუნახავი ავატარი) — დღე-ნახევრის შემდეგ.
-- ახალი სვეტი ფოტოთი? დაამატე media_collect ტრიგერში და media_in_use-ში.
create table if not exists public.media_trash (
  path text primary key,
  created_at timestamptz not null default now()
);
alter table public.media_trash enable row level security;
revoke all on public.media_trash from anon, authenticated;

-- რომელი ფაილებიდან დაიწყო ძებნა (მხოლოდ ამ განახლების შემდეგ ატვირთულები — ძველს არ ვეხებით)
create table if not exists public.media_sweep (
  id boolean primary key default true check (id),
  last_at timestamptz not null default now()
);
insert into public.media_sweep default values on conflict do nothing;
alter table public.media_sweep enable row level security;
revoke all on public.media_sweep from anon, authenticated;

-- ჩვენი საცავის გზები ნებისმიერი მნიშვნელობიდან (ტექსტი, jsonb, მთელი ჩანაწერი)
create or replace function public.media_paths(v jsonb)
returns setof text language sql immutable as $$
  select distinct m[1] from regexp_matches(coalesce(v::text, ''), '/storage/v1/object/public/media/([^"?#\s\\]+)', 'g') as m
$$;

create or replace function public.media_collect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into media_trash (path)
  select p from public.media_paths(to_jsonb(old)) p
  where tg_op = 'DELETE' or p not in (select public.media_paths(to_jsonb(new)))
  on conflict (path) do nothing;
  return null;
end $$;

do $$ declare t record; begin
  for t in select * from (values
    ('profiles', 'avatar_url'), ('posts', 'media'), ('stories', null), ('messages', 'media_url, meta'),
    ('dating_profiles', 'photos'), ('groups', 'cover_url'), ('events', 'cover_url'), ('highlights', 'cover_url'),
    ('highlight_items', null), ('listings', 'photos, thumb'), ('conversations', 'avatar_url')) as v(tbl, cols)
  loop
    execute format('drop trigger if exists media_collect on public.%I', t.tbl);
    execute format('create trigger media_collect after delete%s on public.%I for each row execute function public.media_collect()',
      case when t.cols is null then '' else ' or update of ' || t.cols end, t.tbl);
  end loop;
end $$;

-- ფაილს ჯერ კიდევ რამე იყენებს? გზის პირველი საქაღალდე ამტვირთავის id-ია — დიდ ცხრილებში მხოლოდ მის ჩანაწერებს ვამოწმებთ.
-- უცნობი ფორმის გზა — ყოველთვის „გამოიყენება“ (არასდროს წაიშლება).
create or replace function public.media_in_use(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare o uuid;
begin
  if p is null or split_part(p, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return true; end if;
  o := split_part(p, '/', 1)::uuid;
  return exists (select 1 from profiles where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from groups where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from events where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from conversations where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from posts where author_id = o and strpos(media::text, p) > 0)
    or exists (select 1 from stories where author_id = o and strpos(media_url, p) > 0)
    or exists (select 1 from highlights h where h.owner_id = o and (strpos(coalesce(h.cover_url, ''), p) > 0
               or exists (select 1 from highlight_items i where i.highlight_id = h.id and strpos(i.media_url, p) > 0)))
    or exists (select 1 from listings where seller_id = o and (strpos(photos::text, p) > 0 or strpos(coalesce(thumb, ''), p) > 0))
    or exists (select 1 from dating_profiles where user_id = o and strpos(photos::text, p) > 0)
    or exists (select 1 from messages m join conversation_members c on c.conversation_id = m.conversation_id and c.user_id = o
               where strpos(coalesce(m.media_url, '') || coalesce(m.meta::text, ''), p) > 0);
end $$;

-- დღიური დასუფთავება: აბრუნებს წასაშლელ გზებს (მაქს. p_limit) და რიგიდან იღებს
create or replace function public.media_cleanup_take(p_limit int default 200)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  n int := least(greatest(coalesce(p_limit, 200), 1), 1000);
  out text[] := '{}';
  r record;
  cur timestamptz;
begin
  -- 1) წაშლილი შიგთავსის ფაილები — საათის შემდეგ (თუ ფოტო ისევ სადმე გამოიყენება, რჩება)
  for r in select path from media_trash where created_at < now() - interval '1 hour' order by created_at limit n for update skip locked loop
    delete from media_trash where path = r.path;
    if not public.media_in_use(r.path) then out := out || r.path; end if;
  end loop;
  -- 2) ატვირთული, მაგრამ არსად მიმაგრებული — ერთი დღის შემდეგ, თითოეული ერთხელ (media_sweep.last_at-დან)
  select last_at into cur from media_sweep where id for update;
  if cur is not null and cardinality(out) < n then
    for r in select o.name, o.created_at from storage.objects o
             where o.bucket_id = 'media' and o.created_at > cur and o.created_at < now() - interval '1 day'
             order by o.created_at limit n * 2 loop
      cur := r.created_at;
      if not (r.name = any(out)) and not public.media_in_use(r.name) then out := out || r.name; end if;
      exit when cardinality(out) >= n;
    end loop;
    update media_sweep set last_at = cur where id;
  end if;
  return out;
end $$;

-- საცავმა თუ ვერ წაშალა — რიგში ბრუნდება, შემდეგ ჯერზე ვცდით
create or replace function public.media_cleanup_return(p_paths text[])
returns void language sql security definer set search_path = public as $$
  insert into media_trash (path, created_at) select unnest(p_paths), now() - interval '2 hours' on conflict (path) do nothing
$$;

revoke execute on function public.media_in_use(text) from public, anon, authenticated;
revoke execute on function public.media_cleanup_take(int) from public, anon, authenticated;
revoke execute on function public.media_cleanup_return(text[]) from public, anon, authenticated;
grant execute on function public.media_cleanup_take(int) to service_role;
grant execute on function public.media_cleanup_return(text[]) to service_role;

-- =====================================================================
-- ეტაპი H: თვიური სეზონები (ლიგებით და პრიზებით) და მეგობრების რეიტინგი
-- =====================================================================

-- სეზონი = კალენდარული თვე თბილისის დროით. სეზონის რეიტინგი იწყება საერთოდან, ნახევრად 1200-ისკენ დაბრუნებით
-- (1200 + (საერთო − 1200) / 2), და იცვლება ზუსტად იმავე Elo-ცვლილებით, რაც საერთო რეიტინგი.
-- ლიგები: ბრინჯაო < 1100 ≤ ვერცხლი < 1300 ≤ ოქრო < 1500 ≤ პლატინა < 1700 ≤ ალმასი.
-- სეზონის ბოლოს (10+ თამაში): 1-ლი 100, მე-2 60, მე-3 30 ბროწეული; ოქრო და ზემოთ — 15.
create or replace function public.season_now()
returns date language sql stable as $$ select date_trunc('month', now() at time zone 'Asia/Tbilisi')::date $$;

create or replace function public.season_league(r int)
returns text language sql immutable as $$
  select case when r >= 1700 then 'diamond' when r >= 1500 then 'platinum' when r >= 1300 then 'gold'
              when r >= 1100 then 'silver' else 'bronze' end
$$;

create or replace function public.season_start(p_rating int)
returns int language sql immutable as $$ select 1200 + round((coalesce(p_rating, 1200) - 1200) / 2.0)::int $$;

create table if not exists public.season_stats (
  season date not null,
  type text not null,
  user_id uuid not null references public.profiles on delete cascade,
  rating int not null,
  peak int not null,
  games int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season, type, user_id)
);
create index if not exists season_stats_board_idx on public.season_stats (season, type, rating desc);
create index if not exists season_stats_user_idx on public.season_stats (user_id, season);
alter table public.season_stats enable row level security;
drop policy if exists "season stats read" on public.season_stats;
create policy "season stats read" on public.season_stats for select to authenticated using (true);
grant select on public.season_stats to authenticated;

create table if not exists public.season_results (
  season date not null,
  type text not null,
  user_id uuid not null references public.profiles on delete cascade,
  place int not null,
  rating int not null,
  games int not null,
  league text not null,
  coins int not null default 0,
  primary key (season, type, user_id)
);
create index if not exists season_results_place_idx on public.season_results (season, type, place);
alter table public.season_results enable row level security;
drop policy if exists "season results read" on public.season_results;
create policy "season results read" on public.season_results for select to authenticated using (true);
grant select on public.season_results to authenticated;

create table if not exists public.seasons_closed (
  season date primary key,
  closed_at timestamptz not null default now()
);
alter table public.seasons_closed enable row level security;
revoke all on public.seasons_closed from anon, authenticated;

-- ყოველი რეიტინგული თამაშის შედეგი (apply_result, svc_finish_table) სეზონის ცხრილშიც აისახება
create or replace function public.season_track()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_d int := new.rating - old.rating; v_start int;
begin
  if new.wins + new.losses + new.draws <= old.wins + old.losses + old.draws then return null; end if;
  v_start := public.season_start(old.rating);
  insert into season_stats as ss (season, type, user_id, rating, peak, games, wins, losses, draws)
  values (public.season_now(), new.type, new.user_id, v_start + v_d, greatest(v_start, v_start + v_d), 1,
          new.wins - old.wins, new.losses - old.losses, new.draws - old.draws)
  on conflict (season, type, user_id) do update set
    rating = ss.rating + v_d,
    peak = greatest(ss.peak, ss.rating + v_d),
    games = ss.games + 1,
    wins = ss.wins + excluded.wins, losses = ss.losses + excluded.losses, draws = ss.draws + excluded.draws,
    updated_at = now();
  return null;
end $$;
drop trigger if exists season_track on public.game_stats;
create trigger season_track after update on public.game_stats
  for each row execute function public.season_track();

-- დასრულებული სეზონების დახურვა: ადგილები, პრიზები, შეტყობინება. ერთხელ თითო სეზონზე (seasons_closed),
-- იძახებს keep_alive (Vercel-ის დღიური cron) და game_board — ვინც პირველი შემოვა ახალ თვეში.
create or replace function public.season_finalize_due()
returns int language plpgsql security definer set search_path = public as $$
declare s date; r record; v_coins int; n int := 0;
begin
  for s in select distinct ss.season from season_stats ss
            where ss.season < public.season_now()
              and not exists (select 1 from seasons_closed c where c.season = ss.season)
            order by 1 loop
    insert into seasons_closed (season) values (s) on conflict do nothing;
    if not found then continue; end if;
    for r in select x.*, row_number() over (partition by x.type order by x.rating desc, x.wins desc, x.updated_at) as place
               from season_stats x join profiles p on p.id = x.user_id
              where x.season = s and x.games >= 10 and (p.banned_until is null or p.banned_until < now()) loop
      v_coins := case r.place when 1 then 100 when 2 then 60 when 3 then 30
                   else case when r.rating >= 1300 then 15 else 0 end end;
      insert into season_results (season, type, user_id, place, rating, games, league, coins)
      values (s, r.type, r.user_id, r.place, r.rating, r.games, public.season_league(r.rating), v_coins)
      on conflict do nothing;
      if v_coins > 0 then perform public.award(r.user_id, 'season', 0, v_coins, s::text || ':' || r.type); end if;
      insert into notifications (user_id, type, data) values (r.user_id, 'season_end', jsonb_build_object(
        'season', s, 'type', r.type, 'place', r.place, 'rating', r.rating, 'league', public.season_league(r.rating),
        'coins', v_coins, 'games', r.games));
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.season_finalize_due() from public, anon, authenticated;

-- გაღვიძება (ეტაპი G) ახლა დასრულებულ სეზონებსაც ხურავს
create or replace function public.keep_alive()
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  perform public.season_finalize_due();
  return now();
end $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;
