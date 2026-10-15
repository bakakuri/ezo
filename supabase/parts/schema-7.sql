-- ეზო — სქემის ნაწილი 7/9. გაუშვი 6-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.mfa_ok() then raise exception 'საჭიროა ორფაქტორიანი შესვლა'; end if;
  delete from auth.users where id = auth.uid();
end $$;

alter table public.banned_words enable row level security;
drop policy if exists "banned words staff" on public.banned_words;
create policy "banned words staff" on public.banned_words for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- 2FA: aal1 სესიით (მხოლოდ პაროლი) მგრძნობიარე ცხრილები არ იხსნება
do $$
declare t text;
begin
  foreach t in array array['messages', 'notifications', 'dating_profiles', 'swipes', 'push_subscriptions', 'follow_requests',
                           'close_friends', 'collections', 'saves', 'listing_saves', 'game_messages'] loop
    execute format('drop policy if exists "mfa guard" on public.%I', t);
    execute format('create policy "mfa guard" on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
  foreach t in array array['posts', 'listings', 'stories', 'follows', 'likes', 'gifts', 'profiles'] loop
    execute format('drop policy if exists "mfa write ins" on public.%I', t);
    execute format('drop policy if exists "mfa write upd" on public.%I', t);
    execute format('drop policy if exists "mfa write del" on public.%I', t);
    execute format('create policy "mfa write ins" on public.%I as restrictive for insert to authenticated with check (public.mfa_ok())', t);
    execute format('create policy "mfa write upd" on public.%I as restrictive for update to authenticated using (public.mfa_ok())', t);
    execute format('create policy "mfa write del" on public.%I as restrictive for delete to authenticated using (public.mfa_ok())', t);
  end loop;
end $$;

revoke execute on function public.rate_count(text, timestamptz) from public, anon;
revoke execute on function public.has_banned(text) from public, anon;

-- ---------------------------------------------------------------------
-- შეცდომების ჟურნალი: აპის შეცდომები ბრაუზერიდან (ადმინ პანელი → „შეცდომები“). 30 დღეზე ძველი თავისით იშლება.
-- ---------------------------------------------------------------------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  message text not null,
  stack text,
  path text,
  source text not null default 'window',
  release text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_time_idx on public.client_errors (created_at desc);
create index if not exists client_errors_user_idx on public.client_errors (user_id, created_at desc);
create index if not exists client_errors_msg_idx on public.client_errors (message, created_at desc);
-- ცხრილზე პირდაპირი წვდომა არავის აქვს: ჩაწერა log_client_error-ით, წაკითხვა admin_errors-ით
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- p_source: 'boundary' (ეკრანი ჩავარდა) | 'window' | 'promise' | 'api' (სქემის/API-ს შეუსაბამობა) | 'chunk' (ძველი ვერსიის ფაილები)
create or replace function public.log_client_error(p_message text, p_stack text default null, p_path text default null,
  p_source text default 'window', p_release text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_msg text;
begin
  v_msg := left(btrim(regexp_replace(coalesce(p_message, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi')), 500);
  if v_msg = '' then return; end if;
  -- ზღვარი: ერთ ადამიანზე 30 ჩანაწერი საათში, შეუსვლელებზე ჯამში 300
  if u is not null then
    if (select count(*) from client_errors where user_id = u and created_at > now() - interval '1 hour') >= 30 then return; end if;
  elsif (select count(*) from client_errors where user_id is null and created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;
  insert into client_errors (user_id, message, stack, path, source, release, user_agent)
  values (u, v_msg, left(p_stack, 4000), left(p_path, 300),
          case when p_source in ('boundary', 'window', 'promise', 'api', 'chunk') then p_source else 'window' end,
          left(p_release, 40), left(p_agent, 300));
  if random() < 0.02 then delete from client_errors where created_at < now() - interval '30 days'; end if;
end $$;

-- ერთნაირი შეცდომები ერთად: რამდენჯერ, რამდენ ადამიანთან, ბოლო მისამართი და დეტალები
create or replace function public.admin_errors(p_days int default 7)
returns table (message text, source text, events bigint, users bigint, first_at timestamptz, last_at timestamptz,
               path text, stack text, release text, user_agent text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select e.message,
    (array_agg(e.source order by e.created_at desc))[1],
    count(*), count(distinct e.user_id), min(e.created_at), max(e.created_at),
    (array_agg(e.path order by e.created_at desc))[1],
    (array_agg(e.stack order by e.created_at desc) filter (where e.stack is not null))[1],
    (array_agg(e.release order by e.created_at desc))[1],
    (array_agg(e.user_agent order by e.created_at desc))[1]
  from client_errors e
  where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
  group by e.message
  order by max(e.created_at) desc
  limit 100;
end $$;

-- „მოგვარებულია“: ამ შეცდომის ყველა ჩანაწერი იშლება
create or replace function public.admin_clear_errors(p_message text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  delete from client_errors where message = p_message;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- საძიებო სისტემები: sitemap.xml-ის სია (api/sitemap.js). მხოლოდ საჯარო:
-- ღია პროფილები, აქტიური განცხადებები და მომავალი ღია შეხვედრები.
-- ---------------------------------------------------------------------
create or replace function public.sitemap_entries()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'u', coalesce((select jsonb_agg(a.username) from (
           select p.username from profiles p
            where p.onboarded and not p.is_private and p.username is not null
              and (p.banned_until is null or p.banned_until < now())
            order by p.followers_count desc, p.created_at desc limit 5000) a), '[]'),
    'm', coalesce((select jsonb_agg(jsonb_build_array(b.id, b.changed)) from (
           select l.id, greatest(l.updated_at, coalesce(l.bumped_at, l.updated_at)) changed
             from listings l join profiles s on s.id = l.seller_id
            where l.status = 'active' and not l.hidden and (s.banned_until is null or s.banned_until < now())
            order by coalesce(l.bumped_at, l.created_at) desc limit 3000) b), '[]'),
    'e', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.created_at)) from (
           select e.id, e.created_at from events e left join groups g on g.id = e.group_id
            where coalesce(e.ends_at, e.starts_at) > now() and (e.group_id is null or g.privacy = 'public')
            order by e.starts_at limit 1000) c), '[]'));
$$;
grant execute on function public.sitemap_entries() to anon, authenticated;

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

-- =====================================================================
-- ეტაპი D: შეტყობინებების პარამეტრები და ადმინის ანალიტიკა
-- =====================================================================

-- ---- შეტყობინებების პარამეტრები: რომელი Push მოვიდეს და „ჩუმი საათები“ (თბილისის დროით; ზარები მაინც მოდის)
create table if not exists public.notification_prefs (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  messages boolean not null default true,
  calls boolean not null default true,
  replies boolean not null default true,
  likes boolean not null default true,
  follows boolean not null default true,
  games boolean not null default true,
  dating boolean not null default true,
  market boolean not null default true,
  groups boolean not null default true,
  rewards boolean not null default true,
  quiet_from smallint check (quiet_from between 0 and 23),
  quiet_to smallint check (quiet_to between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "own prefs" on public.notification_prefs;
create policy "own prefs" on public.notification_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notification_prefs to authenticated;

-- Push-ის კატეგორია მისი tag-ით (conv-, call-, game-, n-<ტიპი>-)
create or replace function public.push_category(p_payload jsonb)
returns text language sql immutable as $$
  select case
    when p_payload ->> 'tag' like 'conv-%' then 'messages'
    when p_payload ->> 'tag' like 'call-%' then 'calls'
    when p_payload ->> 'tag' like 'game-%' then 'games'
    when p_payload ->> 'tag' ~ '^n-(reply|quote)-' then 'replies'
    when p_payload ->> 'tag' ~ '^n-like-' then 'likes'
    when p_payload ->> 'tag' ~ '^n-(follow|follow_request|follow_accept|invite_joined)-' then 'follows'
    when p_payload ->> 'tag' ~ '^n-(game_invite|tournament_start|tournament_end)-' then 'games'
    when p_payload ->> 'tag' ~ '^n-match-' then 'dating'
    when p_payload ->> 'tag' ~ '^n-listing_price-' then 'market'
    when p_payload ->> 'tag' ~ '^n-(group_request|group_approved|event_rsvp)-' then 'groups'
    when p_payload ->> 'tag' ~ '^n-(gift|achievement|level_up)-' then 'rewards'
    else 'other' end;
$$;

create or replace function public.push_allowed(p_user uuid, p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_cat text := public.push_category(p_payload); v_from int; v_to int; v_hour int;
begin
  select to_jsonb(p) into v from notification_prefs p where p.user_id = p_user;
  if v is null then return true; end if;
  if v ? v_cat and (v ->> v_cat)::boolean is false then return false; end if;
  v_from := (v ->> 'quiet_from')::int;
  v_to := (v ->> 'quiet_to')::int;
  if v_cat <> 'calls' and v_from is not null and v_to is not null and v_from <> v_to then
    v_hour := extract(hour from now() at time zone 'Asia/Tbilisi')::int;
    if (v_from < v_to and v_hour >= v_from and v_hour < v_to) or (v_from > v_to and (v_hour >= v_from or v_hour < v_to)) then
      return false;
    end if;
  end if;
  return true;
end $$;

-- Push-ის გაგზავნა Edge Function „push“-ით (მხოლოდ თუ პარამეტრები უშვებს)
create or replace function public.push_dispatch(p_user uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if p_user is null then return; end if;
  select value into v_url from app_secrets where key = 'push_url';
  if v_url is null then return; end if;
  if not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  if not public.push_allowed(p_user, p_payload) then return; end if;
  select value into v_secret from app_secrets where key = 'push_secret';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('user_id', p_user, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_secret, '')));
exception when others then
  raise warning 'push_dispatch: %', sqlerrm;
end $$;
revoke execute on function public.push_dispatch(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.push_allowed(uuid, jsonb) from public, anon, authenticated;

-- ---- აქტიურობა დღეების მიხედვით (ანალიტიკისთვის): აპი ყოველ 2 წუთში იძახებს touch_last_seen-ს
create table if not exists public.daily_active (
  day date not null,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (day, user_id)
);
alter table public.daily_active enable row level security;
revoke all on public.daily_active from anon, authenticated;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
  insert into daily_active (day, user_id)
  select (now() at time zone 'Asia/Tbilisi')::date, auth.uid() where auth.uid() is not null
  on conflict do nothing;
$$;

-- პოსტი ან მესიჯი — ესეც აქტიურობაა (აპი რომც არ იყოს ღია, მაგ. Push-იდან პასუხი)
create or replace function public.mark_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_table_name = 'messages' then v_user := new.sender_id; else v_user := new.author_id; end if;
  insert into daily_active (day, user_id) values ((now() at time zone 'Asia/Tbilisi')::date, v_user)
  on conflict do nothing;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists posts_mark_active on public.posts;
create trigger posts_mark_active after insert on public.posts for each row execute function public.mark_active();
drop trigger if exists messages_mark_active on public.messages;
create trigger messages_mark_active after insert on public.messages for each row execute function public.mark_active();

-- წარსულის შევსება პოსტებიდან და მესიჯებიდან (ერთხელ; განმეორებით გაშვება უსაფრთხოა)
insert into public.daily_active (day, user_id)
select distinct (created_at at time zone 'Asia/Tbilisi')::date, author_id from public.posts
on conflict do nothing;
insert into public.daily_active (day, user_id)
select distinct (created_at at time zone 'Asia/Tbilisi')::date, sender_id from public.messages where sender_id is not null
on conflict do nothing;
