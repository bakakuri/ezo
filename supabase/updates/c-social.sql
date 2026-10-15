-- ეზო — განახლება C: ვის გამოიწერო, მიმაგრებული პოსტი, მონახაზები, დადასტურებული ნიშანი, ქართული ძებნა
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- ახალ პროექტზე ეს საჭირო არ არის — უკვე შედის schema.sql-ში (და 8 ნაწილში). განმეორებით გაშვება უსაფრთხოა.

-- =====================================================================
-- ეტაპი C: ვის გამოიწერო, მიმაგრებული პოსტი, მონახაზები, დადასტურებული ნიშანი, ქართული ძებნა
-- =====================================================================
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists pinned_post_id uuid references public.posts on delete set null;

-- მომხმარებელი პირდაპირ ვერ შეცვლის: მთვლელებს, როლს, შეზღუდვას, მომწვევს, ნიშანს და მიმაგრებულ პოსტს
-- (ამათ მხოლოდ შესაბამისი ფუნქციები ცვლიან)
create or replace function public.protect_profile_counters()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.posts_count := old.posts_count;
    new.role := old.role;
    new.banned_until := old.banned_until;
    new.ban_reason := old.ban_reason;
    new.invited_by := old.invited_by;
    new.verified := old.verified;
    new.pinned_post_id := old.pinned_post_id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_counters();

-- ---- დადასტურებული ნიშანი: მხოლოდ ადმინი ანიჭებს
create or replace function public.admin_set_verified(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  update profiles set verified = coalesce(p_on, false) where id = p_user;
end $$;

-- ---- მიმაგრებული პოსტი: საკუთარი, მთავარი (არა პასუხი), ჯგუფის გარეთ. p_post = null — მოხსნა
create or replace function public.pin_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_post is not null and not exists (
    select 1 from posts where id = p_post and author_id = auth.uid() and parent_id is null and group_id is null and not hidden
  ) then raise exception 'ამ პოსტს პროფილზე ვერ მიამაგრებ'; end if;
  update profiles set pinned_post_id = p_post where id = auth.uid();
end $$;

-- ---- მონახაზები: ტექსტი და გამოკითხვა, ყველა მოწყობილობაზე. მაქსიმუმ 50
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  poll jsonb,
  group_id uuid references public.groups on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_user_idx on public.drafts (user_id, updated_at desc);
alter table public.drafts enable row level security;
drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.drafts to authenticated;

create or replace function public.drafts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (select count(*) from drafts where user_id = new.user_id) >= 50 then
    raise exception 'მონახაზი მაქსიმუმ 50 შეიძლება — ძველები წაშალე';
  end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists drafts_guard on public.drafts;
create trigger drafts_guard before insert or update on public.drafts
  for each row execute function public.drafts_guard();

-- ---- ვის გამოიწერო: მიზეზით (გამოგიწერა, კლასელი, საერთო მეგობრები, სკოლა, ქალაქი…). „არ მაინტერესებს“ ინახება
create table if not exists public.suggestion_dismissals (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  dismissed_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dismissed_id)
);
alter table public.suggestion_dismissals enable row level security;
drop policy if exists "own dismissals" on public.suggestion_dismissals;
create policy "own dismissals" on public.suggestion_dismissals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.suggestion_dismissals to authenticated;

create or replace function public.dismiss_suggestion(p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into suggestion_dismissals (user_id, dismissed_id) select auth.uid(), p_user where auth.uid() is not null
  on conflict do nothing;
$$;

create or replace function public.who_to_follow(p_limit int default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  fof as (
    select f2.following_id as id, count(*) as n, min(f1.following_id::text)::uuid as via
      from follows f1 join follows f2 on f2.follower_id = f1.following_id
     where f1.follower_id = auth.uid()
     group by f2.following_id
  ),
  cand as (
    select p.*, coalesce(fof.n, 0) as mutual, fof.via,
      exists (select 1 from follows x where x.follower_id = p.id and x.following_id = me.id) as follows_me,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school)) as same_school,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school) and p.grad_year = me.grad_year) as classmate,
      (coalesce(me.city, '') <> '' and lower(p.city) = lower(me.city)) as same_city,
      (p.id = me.invited_by or p.invited_by = me.id) as invite
    from profiles p cross join me left join fof on fof.id = p.id
    where p.id <> me.id and p.onboarded and (p.banned_until is null or p.banned_until < now())
      and not exists (select 1 from follows f where f.follower_id = me.id and f.following_id = p.id)
      and not exists (select 1 from follow_requests r where r.requester_id = me.id and r.target_id = p.id)
      and not exists (select 1 from suggestion_dismissals d where d.user_id = me.id and d.dismissed_id = p.id)
      and not public.is_blocked(me.id, p.id)
  ),
  ranked as (
    select c.*,
      (case when c.follows_me then 100 else 0 end) + (case when c.invite then 60 else 0 end)
      + (case when c.classmate then 40 when c.same_school then 25 else 0 end)
      + least(c.mutual, 10) * 8 + (case when c.same_city then 8 else 0 end)
      + ln(1 + c.followers_count) + (case when c.created_at > now() - interval '14 days' then 3 else 0 end) as score
    from cand c
    order by score desc, c.followers_count desc
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'username', r.username, 'full_name', r.full_name, 'avatar_url', r.avatar_url, 'last_seen', r.last_seen,
      'verified', r.verified, 'city', r.city, 'school', r.school, 'grad_year', r.grad_year, 'followers_count', r.followers_count,
      'reason', case when r.follows_me then 'follows_you' when r.invite then 'invite' when r.classmate then 'classmate'
                     when r.mutual > 0 then 'mutual' when r.same_school then 'school' when r.same_city then 'city'
                     when r.created_at > now() - interval '14 days' then 'new' else 'popular' end,
      'mutual', r.mutual,
      'via', (select coalesce(nullif(v.full_name, ''), v.username) from profiles v where v.id = r.via))
    order by r.score desc, r.followers_count desc), '[]'::jsonb)
  from ranked r;
$$;

-- ---- ქართული ძებნა: „გიორგი“ = „giorgi“, „beridze“ = „ბერიძე“, „ჭავჭავაძე“ = „chavchavadze“, უმნიშვნელო შეცდომებიც
-- ორივე დამწერლობა ერთ ფორმაზე მიდის; მსგავსი ბგერები ერთდება (თ/ტ, კ/ქ/ყ, პ/ფ, ჩ/ჭ, ც/წ).
-- იგივე წესი აპშია: src/lib/translit.js (ტესტები ამოწმებს, რომ ერთნაირად მუშაობს)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function public.ka_skeleton(p text)
returns text language sql immutable parallel safe as $$
  select translate(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(coalesce(p, '')),
      'ch''', 'č'), 'chh', 'č'), 'ch', 'č'), 'sh', 'š'), 'zh', 'ž'), 'kh', 'x'), 'gh', 'ğ'), 'dz', 'đ'),
      'ts''', 'c'), 'tz', 'c'), 'ts', 'c'), 'th', 't'), 'ph', 'p'), '''', ''),
    'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰqywf',
    'abgdevztiklmnopžrstupkğkščcđcčxjhkkcp');
$$;

-- ინდექსები (pg_trgm-ის სქემა შეიძლება განსხვავდებოდეს — ვპოულობთ)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists profiles_search_trgm on public.profiles using gin (public.ka_skeleton(coalesce(full_name, '''') || '' '' || coalesce(username, '''')) %I.gin_trgm_ops)', s);
  execute format('create index if not exists posts_search_trgm on public.posts using gin (public.ka_skeleton(body) %I.gin_trgm_ops) where parent_id is null', s);
  execute format('create index if not exists groups_search_trgm on public.groups using gin (public.ka_skeleton(name) %I.gin_trgm_ops)', s);
  execute format('create index if not exists listings_search_trgm on public.listings using gin (public.ka_skeleton(title) %I.gin_trgm_ops)', s);
end $$;

-- ერთი ძებნა ყველაფერზე. security invoker — RLS მოქმედებს (დახურული პროფილის პოსტები, დამალული და სხვ. არ ჩანს)
create or replace function public.search_all(p_q text, p_limit int default 20)
returns jsonb language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  raw text := btrim(regexp_replace(coalesce(p_q, ''), '^[#@]+', ''));
  s text := public.ka_skeleton(btrim(regexp_replace(coalesce(p_q, ''), '^[#@]+', '')));
  pat text;
  lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if char_length(s) < 2 then
    return jsonb_build_object('people', '[]'::jsonb, 'posts', '[]'::jsonb, 'tags', '[]'::jsonb, 'groups', '[]'::jsonb, 'listings', '[]'::jsonb);
  end if;
  pat := replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_');
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(to_jsonb(x) - 'rank' - 'sim' order by x.rank, x.sim desc, x.followers_count desc) from (
        select p.id, p.username, p.full_name, p.avatar_url, p.last_seen, p.verified, p.city, p.followers_count,
          case when lower(p.username) = lower(raw) then 0
               when public.ka_skeleton(p.username) like pat || '%' then 1
               when public.ka_skeleton(p.full_name) like pat || '%' or public.ka_skeleton(p.full_name) like '% ' || pat || '%' then 2
               when public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '')) like '%' || pat || '%' then 3
               else 4 end as rank,
          word_similarity(s, public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, ''))) as sim
        from profiles p
        where p.onboarded and (p.banned_until is null or p.banned_until < now())
          and (public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '')) like '%' || pat || '%'
               or (char_length(s) >= 4 and s <% public.ka_skeleton(coalesce(p.full_name, '') || ' ' || coalesce(p.username, ''))))
        order by rank, sim desc, p.followers_count desc
        limit lim) x), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(x.id order by x.created_at desc) from (
        select p.id, p.created_at from posts p
        where p.parent_id is null and not p.hidden and public.ka_skeleton(p.body) like '%' || pat || '%'
        order by p.created_at desc limit lim) x), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', x.t, 'posts', x.n) order by x.n desc) from (
        select t, count(*) as n from posts p, unnest(p.hashtags) as t
        where public.ka_skeleton(t) like pat || '%'
        group by t order by count(*) desc limit 8) x), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.members_count desc) from (
        select g.id, g.slug, g.name, g.cover_url, g.privacy, g.members_count from groups g
        where public.ka_skeleton(g.name) like '%' || pat || '%'
        order by g.members_count desc limit 8) x), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
        select l.id, l.title, l.price, l.currency, l.city, coalesce(l.thumb, l.photos ->> 0) as photo, coalesce(l.bumped_at, l.created_at) as at
        from listings l
        where l.status in ('active', 'reserved') and not l.hidden and public.ka_skeleton(l.title) like '%' || pat || '%'
        order by coalesce(l.bumped_at, l.created_at) desc limit 8) x), '[]'::jsonb));
end $$;
