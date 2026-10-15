-- ეზო — სქემის ნაწილი 3/8. გაუშვი 2-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

-- სტუმრები
create or replace function public.record_visit(p_profile uuid)
returns void language sql security definer set search_path = public as $$
  insert into profile_visits (profile_id, visitor_id) values (p_profile, auth.uid())
  on conflict (profile_id, visitor_id) do update set visited_at = now();
$$;

create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

create or replace function public.suggested_people(p_limit int default 12)
returns setof public.profiles language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid())
  select p.* from profiles p cross join me
  where p.id <> me.id and p.onboarded and (p.banned_until is null or p.banned_until < now())
    and p.id not in (select following_id from follows where follower_id = me.id)
    and not public.is_blocked(me.id, p.id)
  order by
    (me.school <> '' and lower(p.school) = lower(me.school)) desc,
    (me.city <> '' and lower(p.city) = lower(me.city)) desc,
    (select count(*) from follows f1 join follows f2 on f2.follower_id = f1.following_id
      where f1.follower_id = me.id and f2.following_id = p.id) desc,
    p.followers_count desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- დახურული პროფილი და „ახლო მეგობრები“ — ხილვადობის დამხმარე ფუნქციები
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_private boolean not null default false;

create or replace function public.is_private_profile(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_private from profiles where id = p_id), false);
$$;

-- ხედავს თუ არა მიმდინარე მომხმარებელი ავტორის პოსტებს/სთორიებს
create or replace function public.can_see_author(p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_author = auth.uid()
      or not public.is_private_profile(p_author)
      or exists (select 1 from follows where follower_id = auth.uid() and following_id = p_author)
      or public.is_staff();
$$;

create or replace function public.story_audience_ok(p_author uuid, p_audience text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_audience = 'all' or p_author = auth.uid()
      or exists (select 1 from close_friends where owner_id = p_author and friend_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.profile_visits enable row level security;
alter table public.gifts enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.dating_profiles enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.game_stats enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "blocks own" on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "reports insert" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

create policy "follows read" on public.follows for select to authenticated using (true);
create policy "follows insert own" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked(follower_id, following_id) and not public.is_private_profile(following_id));
create policy "follows delete own" on public.follows for delete to authenticated using (follower_id = auth.uid());

create policy "posts read" on public.posts for select to authenticated
  using (not public.is_blocked(auth.uid(), author_id) and (not hidden or author_id = auth.uid() or public.is_staff()));
create policy "posts insert own" on public.posts for insert to authenticated with check (author_id = auth.uid() and public.can_act());
create policy "posts update own" on public.posts for update to authenticated using (author_id = auth.uid());
create policy "posts delete own" on public.posts for delete to authenticated using (author_id = auth.uid());

create policy "likes read" on public.likes for select to authenticated using (true);
create policy "likes insert own" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "likes delete own" on public.likes for delete to authenticated using (user_id = auth.uid());

create policy "stories read active" on public.stories for select to authenticated
  using ((expires_at > now() or author_id = auth.uid()) and not public.is_blocked(auth.uid(), author_id)
         and public.can_see_author(author_id) and public.story_audience_ok(author_id, audience));
create policy "stories insert own" on public.stories for insert to authenticated with check (author_id = auth.uid() and public.can_act());
create policy "stories delete own" on public.stories for delete to authenticated using (author_id = auth.uid());

create policy "story views insert" on public.story_views for insert to authenticated with check (viewer_id = auth.uid());
create policy "story views read" on public.story_views for select to authenticated using (
  viewer_id = auth.uid() or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "visits owner reads" on public.profile_visits for select to authenticated using (profile_id = auth.uid());

create policy "gifts read" on public.gifts for select to authenticated using (true);
create policy "gifts send" on public.gifts for insert to authenticated with check (from_id = auth.uid() and public.can_act());

create policy "notifications own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications mark read" on public.notifications for update to authenticated using (user_id = auth.uid());

create policy "conversations members" on public.conversations for select to authenticated using (public.is_member(id));
create policy "members read" on public.conversation_members for select to authenticated using (public.is_member(conversation_id));
create policy "messages read" on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id) and public.can_act());

create policy "dating own" on public.dating_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_act());
create policy "swipes own insert" on public.swipes for insert to authenticated with check (swiper_id = auth.uid());
create policy "swipes own read" on public.swipes for select to authenticated using (swiper_id = auth.uid());
create policy "matches own" on public.matches for select to authenticated using (auth.uid() in (user_a, user_b));

create policy "games read" on public.games for select to authenticated using (true);
create policy "stats read" on public.game_stats for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- მედიის საცავი (ფოტო, ვიდეო, ხმოვანი) — თითო მომხმარებელს თავისი საქაღალდე
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "media read" on storage.objects;
drop policy if exists "media upload own" on storage.objects;
drop policy if exists "media delete own" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'media');
create policy "media upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
--  v2: მოდერაცია, Push შეტყობინებები, თამაშების სერვერი, უსაფრთხოება
-- =====================================================================

-- ---------------------------------------------------------------------
-- მოდერაცია. ადმინის დანიშვნა (ერთხელ, SQL Editor-ში):
--   update public.profiles set role = 'admin' where username = 'შენი_username';
-- ---------------------------------------------------------------------
-- 5 სხვადასხვა ადამიანის რეპორტის შემდეგ პოსტი ავტომატურად იმალება
create or replace function public.on_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_post is not null and
     (select count(distinct reporter_id) from reports where target_post = new.target_post and status = 'open') >= 5 then
    update posts set hidden = true where id = new.target_post;
  end if;
  if new.target_listing is not null and
     (select count(distinct reporter_id) from reports where target_listing = new.target_listing and status = 'open') >= 5 then
    update listings set hidden = true where id = new.target_listing;
  end if;
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.on_report();

-- ერთი სამიზნე = ერთი რიგი: პოსტი, განცხადება ან პროფილი
create or replace function public.report_key(p_post uuid, p_listing uuid, p_user uuid)
returns text language sql immutable as $$
  select coalesce('p:' || p_post::text, 'l:' || p_listing::text, 'u:' || p_user::text);
$$;
drop function if exists public.admin_reports(text);
create or replace function public.admin_reports(p_status text default 'open')
returns table (id uuid, category text, reason text, status text, action text, created_at timestamptz,
               reports_count bigint, reporter jsonb, target_user jsonb, target_post jsonb, target_listing jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  with latest as (
    select distinct on (public.report_key(r.target_post, r.target_listing, r.target_user)) r.*
    from reports r
    where r.status = p_status
    order by public.report_key(r.target_post, r.target_listing, r.target_user), r.created_at desc
  )
  select l.id, l.category, l.reason, l.status, l.action, l.created_at,
    (select count(distinct r2.reporter_id) from reports r2 where r2.status = p_status and public.report_key(r2.target_post, r2.target_listing, r2.target_user) = public.report_key(l.target_post, l.target_listing, l.target_user)),
    (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
       from profiles p where p.id = l.reporter_id),
    (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
             'banned_until', p.banned_until, 'role', p.role)
       from profiles p where p.id = coalesce(l.target_user, (select x.author_id from posts x where x.id = l.target_post),
                                              (select x.seller_id from listings x where x.id = l.target_listing))),
    (select jsonb_build_object('id', x.id, 'body', x.body, 'media', x.media, 'hidden', x.hidden, 'kind', x.kind, 'created_at', x.created_at)
       from posts x where x.id = l.target_post),
    (select jsonb_build_object('id', x.id, 'title', x.title, 'price', x.price, 'currency', x.currency, 'photo', x.photos ->> 0,
             'description', left(x.description, 300), 'hidden', x.hidden, 'created_at', x.created_at)
       from listings x where x.id = l.target_listing)
  from latest l
  order by l.created_at desc
  limit 200;
end $$;

-- p_action: 'dismiss' | 'hide_post' | 'delete_post' | 'hide_listing' | 'delete_listing' | 'ban'   (ban: p_days = null → სამუდამოდ)
create or replace function public.admin_resolve(p_report uuid, p_action text, p_days int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r reports; v_target uuid; v_key text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select * into r from reports where id = p_report;
  if not found then raise exception 'not found'; end if;
  v_key := public.report_key(r.target_post, r.target_listing, r.target_user);
  v_target := coalesce(r.target_user, (select author_id from posts where id = r.target_post),
                       (select seller_id from listings where id = r.target_listing));
  if p_action = 'hide_post' and r.target_post is not null then
    update posts set hidden = true where id = r.target_post;
  elsif p_action = 'delete_post' and r.target_post is not null then
    delete from posts where id = r.target_post;
  elsif p_action = 'hide_listing' and r.target_listing is not null then
    update listings set hidden = true where id = r.target_listing;
  elsif p_action = 'delete_listing' and r.target_listing is not null then
    delete from listings where id = r.target_listing;
  elsif p_action = 'ban' and v_target is not null then
    perform public.admin_ban(v_target, p_days, coalesce(p_note, r.category));
  end if;
  update reports x set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
         action = p_action, resolved_by = auth.uid(), resolved_at = now()
   where x.status = 'open' and public.report_key(x.target_post, x.target_listing, x.target_user) = v_key;
end $$;

create or replace function public.admin_ban(p_user uuid, p_days int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if (select role from profiles where id = p_user) in ('moderator', 'admin') then raise exception 'მოდერატორს ვერ დაბლოკავ'; end if;
  update profiles set
    banned_until = case when p_days is null then 'infinity'::timestamptz else now() + make_interval(days => p_days) end,
    ban_reason = p_note
   where id = p_user;
  update dating_profiles set enabled = false where user_id = p_user;
end $$;

create or replace function public.admin_unban(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  update profiles set banned_until = null, ban_reason = null where id = p_user;
end $$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from profiles where onboarded),
    'new_users_7d', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'posts_24h', (select count(*) from posts where created_at > now() - interval '24 hours'),
    'open_reports', (select count(distinct public.report_key(r.target_post, r.target_listing, r.target_user)) from reports r where status = 'open'),
    'banned', (select count(*) from profiles where banned_until > now()),
    'active_games', (select count(*) from games where status = 'active'));
end $$;

-- ---------------------------------------------------------------------
-- Push შეტყობინებები (Web Push). ჩართვა — იხ. README, „Push შეტყობინებები“.
-- ---------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net მიუწვდომელია — push არ იმუშავებს';
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- სერვერის საიდუმლოებები (Edge Function-ის მისამართი და გასაღები). კლიენტს წვდომა არ აქვს.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

create or replace function public.push_dispatch(p_user uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if p_user is null then return; end if;
  select value into v_url from app_secrets where key = 'push_url';
  if v_url is null then return; end if;
  if not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  select value into v_secret from app_secrets where key = 'push_secret';
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('user_id', p_user, 'payload', p_payload),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_secret, '')));
exception when others then
  raise warning 'push_dispatch: %', sqlerrm;
end $$;

create or replace function public.game_title(p_type text)
returns text language sql immutable as $$
  select case p_type when 'nardi' then 'ნარდი' when 'longnardi' then 'გრძელი ნარდი' when 'chess' then 'ჭადრაკი'
    when 'checkers' then 'შაშკი' when 'domino' then 'დომინო' when 'durak' then 'დურაკი' when 'joker' then 'ჯოკერი' else p_type end;
$$;

create or replace function public.on_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
  select coalesce(nullif(full_name, ''), username) into v_actor from profiles where id = new.actor_id;
  perform public.push_dispatch(new.user_id, jsonb_build_object(
    'title', coalesce(v_actor, 'ეზო'),
    'body', case new.type
      when 'like' then 'მოიწონა შენი პოსტი' when 'reply' then 'გიპასუხა' when 'quote' then 'გაგიზიარა ციტატით'
      when 'follow' then 'გამოგიწერა' when 'gift' then 'საჩუქარი გამოგიგზავნა'
      when 'match' then 'თქვენ ერთმანეთი მოიწონეთ!' when 'game_invite' then 'თამაშში გეპატიჟება'
      else 'ახალი შეტყობინება' end,
    'url', case when new.type = 'game_invite' and new.game_id is not null then '/g/' || new.game_id
                when new.type = 'match' then '/dating?tab=matches'
                when new.post_id is not null then '/p/' || new.post_id else '/notifications' end,
    'tag', 'n-' || new.type || '-' || coalesce(new.post_id::text, new.actor_id::text, '')));
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.on_notification_push();

create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid;
begin
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  for v_member in
    select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', coalesce(v_sender, 'ეზო'),
      'body', case new.media_type when 'image' then '📷 ფოტო' when 'audio' then '🎙 ხმოვანი მესიჯი' else left(new.body, 140) end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row execute function public.on_message_push();

create or replace function public.on_game_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'waiting' and new.status = 'active' and cardinality(new.bots) = 0 then
    perform public.push_dispatch(new.player_a, jsonb_build_object('title', public.game_title(new.type),
      'body', 'მოწინააღმდეგე შემოგიერთდა', 'url', '/g/' || new.id, 'tag', 'game-' || new.id));
  end if;
  if new.status = 'active' and new.turn is not null and new.turn is distinct from old.turn
     and not (old.status = 'waiting' and new.turn = new.player_a) then
    perform public.push_dispatch(new.turn, jsonb_build_object('title', public.game_title(new.type),
      'body', 'შენი სვლაა', 'url', '/g/' || new.id, 'tag', 'game-' || new.id));
  end if;
  return new;
end $$;
drop trigger if exists games_push on public.games;
create trigger games_push after update on public.games
  for each row execute function public.on_game_push();
