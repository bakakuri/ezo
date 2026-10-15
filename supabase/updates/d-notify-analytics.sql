-- ეზო — განახლება D: შეტყობინებების პარამეტრები და ადმინის ანალიტიკა
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- ახალ პროექტზე ეს საჭირო არ არის — უკვე შედის schema.sql-ში (და 8 ნაწილში). განმეორებით გაშვება უსაფრთხოა.

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
