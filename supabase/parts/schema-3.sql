-- ეზო — სქემის ნაწილი 3/9. გაუშვი 2-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

-- Push-ის ტექსტები (on_notification_push) ფაილის ბოლოსაა — ეტაპი H

-- ---------------------------------------------------------------------
-- v3 RLS
-- ---------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;

drop policy if exists "groups read" on public.groups;
drop policy if exists "groups create" on public.groups;
drop policy if exists "groups update admins" on public.groups;
drop policy if exists "groups delete owner" on public.groups;
create policy "groups read" on public.groups for select to authenticated using (true);
create policy "groups create" on public.groups for insert to authenticated with check (owner_id = auth.uid() and public.can_act());
create policy "groups update admins" on public.groups for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy "groups delete owner" on public.groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members read" on public.group_members;
create policy "members read" on public.group_members for select to authenticated using (
  user_id = auth.uid() or public.is_group_admin(group_id) or (status = 'active' and public.can_see_group(group_id)));

drop policy if exists "events read" on public.events;
drop policy if exists "events create" on public.events;
drop policy if exists "events update host" on public.events;
drop policy if exists "events delete host" on public.events;
create policy "events read" on public.events for select to authenticated using (public.can_see_group(group_id));
create policy "events create" on public.events for insert to authenticated
  with check (host_id = auth.uid() and public.can_act() and (group_id is null or public.is_group_member(group_id)));
create policy "events update host" on public.events for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy "events delete host" on public.events for delete to authenticated using (host_id = auth.uid() or public.is_group_admin(group_id));

drop policy if exists "rsvps read" on public.event_rsvps;
drop policy if exists "rsvps own" on public.event_rsvps;
create policy "rsvps read" on public.event_rsvps for select to authenticated using (true);
create policy "rsvps own" on public.event_rsvps for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- პოსტები: ჯგუფის ხილვადობა და ჯგუფში წერის უფლება
drop policy if exists "posts read" on public.posts;
drop policy if exists "posts insert own" on public.posts;
drop policy if exists "posts delete own" on public.posts;
create policy "posts read" on public.posts for select to authenticated
  using (not public.is_blocked(auth.uid(), author_id)
         and (not hidden or author_id = auth.uid() or public.is_staff())
         and public.can_see_group(group_id)
         and (group_id is not null or parent_id is not null or public.can_see_author(author_id)));
create policy "posts insert own" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and public.can_act() and (group_id is null or public.is_group_member(group_id)));
create policy "posts delete own" on public.posts for delete to authenticated
  using (author_id = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));

revoke execute on function public.on_rsvp_change() from public, anon, authenticated;

-- =====================================================================
--  v4: ჯგუფური ჩატები, რეაქციები, პასუხები, ზარები
-- =====================================================================
create or replace function public.chat_role(p_conv uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.conversation_members where conversation_id = p_conv and user_id = auth.uid();
$$;

-- პასუხი მხოლოდ იმავე ჩატის მესიჯზე
create or replace function public.before_message_insert()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_lid uuid;
begin
  if new.reply_to is not null and not exists (select 1 from messages where id = new.reply_to and conversation_id = new.conversation_id) then
    new.reply_to := null;
  end if;
  if current_user in ('authenticated', 'anon') then
    new.deleted_at := null;
    new.meta := new.meta - 'call' - 'system';
  end if;
  -- განცხადების ბარათი: მონაცემები ყოველთვის ბაზიდან (გაყალბება შეუძლებელია)
  if new.meta ? 'listing' then
    begin v_lid := (new.meta -> 'listing' ->> 'id')::uuid; exception when others then v_lid := null; end;
    new.meta := (new.meta - 'listing') || coalesce((
      select jsonb_build_object('listing', jsonb_build_object('id', l.id, 'title', l.title, 'price', l.price,
               'currency', l.currency, 'photo', l.photos ->> 0, 'seller_id', l.seller_id))
        from listings l where l.id = v_lid), '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.before_message_insert();

create or replace function public.delete_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update messages set body = '', media_url = null, media_type = null, meta = '{}'::jsonb, deleted_at = now()
   where id = p_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'მესიჯის წაშლა ვერ მოხერხდა'; end if;
end $$;

create table if not exists public.message_reactions (
  message_id uuid references public.messages on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  conversation_id uuid references public.conversations on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists reactions_conv_idx on public.message_reactions (conversation_id);

create or replace function public.before_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select conversation_id into new.conversation_id from messages where id = new.message_id;
  return new;
end $$;
drop trigger if exists reactions_before on public.message_reactions;
create trigger reactions_before before insert or update on public.message_reactions
  for each row execute function public.before_reaction();

create or replace function public.create_group_chat(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user uuid; v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then raise exception 'ჩატის სახელი 1–80 სიმბოლო'; end if;
  if coalesce(array_length(p_members, 1), 0) < 1 or array_length(p_members, 1) > 50 then raise exception 'აირჩიე 1–50 მონაწილე'; end if;
  insert into conversations (kind, title, created_by) values ('group', v_title, auth.uid()) returning id into v_id;
  insert into conversation_members (conversation_id, user_id, role) values (v_id, auth.uid(), 'admin');
  foreach v_user in array p_members loop
    if v_user <> auth.uid() and not public.is_blocked(auth.uid(), v_user) and exists (select 1 from profiles where id = v_user) then
      insert into conversation_members (conversation_id, user_id) values (v_id, v_user) on conflict do nothing;
    end if;
  end loop;
  insert into messages (conversation_id, sender_id, body, meta)
  values (v_id, auth.uid(), 'შექმნა ჩატი „' || v_title || '“', '{"system": true}');
  return v_id;
end $$;

create or replace function public.add_chat_members(p_conv uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_names text;
begin
  if public.chat_role(p_conv) is distinct from 'admin' or (select kind from conversations where id = p_conv) <> 'group' then
    raise exception 'მხოლოდ ჩატის ადმინისთვის';
  end if;
  foreach v_user in array p_members loop
    if not public.is_blocked(auth.uid(), v_user) and exists (select 1 from profiles where id = v_user) then
      insert into conversation_members (conversation_id, user_id) values (p_conv, v_user) on conflict do nothing;
    end if;
  end loop;
  select string_agg(coalesce(nullif(split_part(full_name, ' ', 1), ''), username), ', ') into v_names from profiles where id = any(p_members);
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'დაამატა: ' || coalesce(v_names, ''), '{"system": true}');
end $$;

create or replace function public.leave_chat(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select kind from conversations where id = p_conv) <> 'group' then raise exception 'პირად ჩატს ვერ დატოვებ'; end if;
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'დატოვა ჩატი', '{"system": true}');
  delete from conversation_members where conversation_id = p_conv and user_id = auth.uid();
  -- ადმინი თუ აღარ დარჩა, უძველესი წევრი ხდება ადმინი
  if not exists (select 1 from conversation_members where conversation_id = p_conv and role = 'admin') then
    update conversation_members set role = 'admin'
     where conversation_id = p_conv and user_id = (select user_id from conversation_members where conversation_id = p_conv order by last_read_at limit 1);
  end if;
end $$;

create or replace function public.rename_chat(p_conv uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.chat_role(p_conv) is distinct from 'admin' then raise exception 'მხოლოდ ჩატის ადმინისთვის'; end if;
  update conversations set title = left(btrim(p_title), 80) where id = p_conv and kind = 'group';
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(), 'შეცვალა სახელი: „' || left(btrim(p_title), 80) || '“', '{"system": true}');
end $$;
