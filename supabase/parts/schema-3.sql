-- ეზო — სქემის ნაწილი 3/8. გაუშვი 2-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

-- push_dispatch (Push-ის გაგზავნა) ფაილის ბოლოსაა — ეტაპი D (შეტყობინებების პარამეტრებით)

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

-- ---------------------------------------------------------------------
-- v2 RLS
-- ---------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.app_secrets enable row level security;
alter table public.game_private enable row level security;
alter table public.game_hands enable row level security;

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "hands own" on public.game_hands;
create policy "hands own" on public.game_hands for select to authenticated using (user_id = auth.uid());
-- app_secrets და game_private: პოლიტიკა არ არის — მხოლოდ სერვერი (service role)

-- ---------------------------------------------------------------------
-- უსაფრთხოება: შიდა ფუნქციები კლიენტიდან არ გამოიძახება
-- ---------------------------------------------------------------------
revoke execute on function public.notify(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_result(public.games, uuid) from public, anon, authenticated;
revoke execute on function public.svc_claim_game(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.svc_join_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_finish(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_claim_game(uuid, text, text, uuid) to service_role;
grant execute on function public.svc_join_game(uuid, uuid) to service_role;
grant execute on function public.svc_finish(uuid, uuid, text) to service_role;

-- =====================================================================
--  v3: ჯგუფები, ივენთები, #თეგები
-- =====================================================================
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid()
                 and status = 'active' and role in ('owner', 'admin'));
$$;

-- საჯარო ჯგუფის პოსტებს ყველა ხედავს, დახურულისას — მხოლოდ წევრები
create or replace function public.can_see_group(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_group is null
      or exists (select 1 from public.groups where id = p_group and privacy = 'public')
      or public.is_group_member(p_group);
$$;

-- #თეგები ტექსტიდან (ლათინური, ციფრები, ქართული ასოები)
create or replace function public.extract_hashtags(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(coalesce(t, ''), '#([A-Za-z0-9_ა-ჿ]{2,40})', 'g') as m;
$$;

create or replace function public.posts_tags()
returns trigger language plpgsql as $$
begin
  new.hashtags := public.extract_hashtags(new.body);
  return new;
end $$;
drop trigger if exists posts_tags on public.posts;
create trigger posts_tags before insert or update of body on public.posts
  for each row execute function public.posts_tags();
update public.posts set hashtags = public.extract_hashtags(body) where body like '%#%' and hashtags = '{}';

-- ჯგუფის შემქმნელი ავტომატურად მფლობელია
create or replace function public.on_group_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists groups_after_insert on public.groups;
create trigger groups_after_insert after insert on public.groups
  for each row execute function public.on_group_created();

create or replace function public.on_group_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update groups set members_count = (select count(*) from group_members where group_id = coalesce(new.group_id, old.group_id) and status = 'active')
   where id = coalesce(new.group_id, old.group_id);
  return coalesce(new, old);
end $$;
drop trigger if exists group_members_count on public.group_members;
create trigger group_members_count after insert or update or delete on public.group_members
  for each row execute function public.on_group_member_change();

create or replace function public.join_group(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_privacy text; v_status text; v_admin uuid;
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  select privacy into v_privacy from groups where id = p_group;
  if not found then raise exception 'ჯგუფი ვერ მოიძებნა'; end if;
  v_status := case when v_privacy = 'public' then 'active' else 'pending' end;
  insert into group_members (group_id, user_id, status) values (p_group, auth.uid(), v_status)
  on conflict (group_id, user_id) do nothing;
  if v_status = 'pending' then
    for v_admin in select user_id from group_members where group_id = p_group and role in ('owner', 'admin') and status = 'active' loop
      insert into notifications (user_id, actor_id, type, group_id) values (v_admin, auth.uid(), 'group_request', p_group);
    end loop;
  end if;
  return v_status;
end $$;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from groups where id = p_group and owner_id = auth.uid()) then
    raise exception 'მფლობელი ჯგუფს ვერ დატოვებს — ჯერ წაშალე ან გადაეცი სხვას';
  end if;
  delete from group_members where group_id = p_group and user_id = auth.uid();
end $$;

-- p_action: 'approve' | 'remove' | 'make_admin' | 'make_member'
create or replace function public.manage_member(p_group uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'მხოლოდ ადმინისთვის'; end if;
  if exists (select 1 from groups where id = p_group and owner_id = p_user) then raise exception 'მფლობელს ვერ შეცვლი'; end if;
  if p_action = 'approve' then
    update group_members set status = 'active' where group_id = p_group and user_id = p_user and status = 'pending';
    if found then insert into notifications (user_id, actor_id, type, group_id) values (p_user, auth.uid(), 'group_approved', p_group); end if;
  elsif p_action = 'remove' then
    delete from group_members where group_id = p_group and user_id = p_user;
  elsif p_action in ('make_admin', 'make_member') then
    update group_members set role = case p_action when 'make_admin' then 'admin' else 'member' end
     where group_id = p_group and user_id = p_user and status = 'active';
  end if;
end $$;

create or replace function public.tag_posts(p_tag text, p_before timestamptz default now(), p_limit int default 20)
returns setof public.posts language sql stable security invoker set search_path = public as $$
  select p.* from posts p
  where p.hashtags @> array[lower(ltrim(p_tag, '#'))] and p.parent_id is null and p.created_at < p_before
  order by p.created_at desc
  limit p_limit;
$$;

create or replace function public.trending_tags(p_limit int default 12)
returns table (tag text, posts bigint) language sql stable security invoker set search_path = public as $$
  select t, count(*) from posts p, unnest(p.hashtags) as t
  where p.created_at > now() - interval '7 days'
  group by t order by count(*) desc, max(p.created_at) desc
  limit p_limit;
$$;

-- RSVP მთვლელები + მასპინძლისთვის შეტყობინება
create or replace function public.on_rsvp_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event uuid := coalesce(new.event_id, old.event_id); v_host uuid;
begin
  update events set
    going_count = (select count(*) from event_rsvps where event_id = v_event and status = 'going'),
    interested_count = (select count(*) from event_rsvps where event_id = v_event and status = 'interested')
   where id = v_event returning host_id into v_host;
  if tg_op = 'INSERT' and new.status = 'going' then
    perform public.notify(v_host, new.user_id, 'event_rsvp');
    update notifications set event_id = v_event
     where id = (select id from notifications where user_id = v_host and actor_id = new.user_id and type = 'event_rsvp' order by created_at desc limit 1);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists event_rsvps_change on public.event_rsvps;
create trigger event_rsvps_change after insert or update or delete on public.event_rsvps
  for each row execute function public.on_rsvp_change();

-- Push: ახალი ტიპების ტექსტები
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
