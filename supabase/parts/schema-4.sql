-- ეზო — სქემის ნაწილი 4/8. გაუშვი 3-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

-- ---------------------------------------------------------------------
-- უსაფრთხოება: შიდა ფუნქციები კლიენტიდან არ გამოიძახება
-- ---------------------------------------------------------------------
revoke execute on function public.notify(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_result(public.games, uuid) from public, anon, authenticated;
revoke execute on function public.push_dispatch(uuid, jsonb) from public, anon, authenticated;
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

create or replace function public.chat_members(p_conv uuid)
returns table (id uuid, username text, full_name text, avatar_url text, last_seen timestamptz, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.full_name, p.avatar_url, p.last_seen, m.role
  from conversation_members m join profiles p on p.id = m.user_id
  where m.conversation_id = p_conv and public.is_member(p_conv)
  order by m.role, p.full_name;
$$;

-- ---------------------------------------------------------------------
-- ზარები (WebRTC). მოწვევა ბაზაშია — აბონენტის ვინაობა ყალბდება ვერ;
-- SDP/ICE იცვლება Realtime არხზე „call:<id>“ (id შემთხვევითი UUID-ია და მხოლოდ ორმა იცის).
-- ---------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  caller_id uuid not null references public.profiles on delete cascade,
  callee_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended', 'busy')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  check (caller_id <> callee_id)
);
create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);
