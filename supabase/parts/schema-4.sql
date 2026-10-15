-- ეზო — სქემის ნაწილი 4/8. გაუშვი 3-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

create or replace function public.before_call_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select kind from conversations where id = new.conversation_id) not in ('dm', 'dating')
     or not exists (select 1 from conversation_members where conversation_id = new.conversation_id and user_id = new.callee_id)
     or not exists (select 1 from conversation_members where conversation_id = new.conversation_id and user_id = new.caller_id)
     or public.is_blocked(new.caller_id, new.callee_id) then
    raise exception 'ზარი ამ ჩატში შეუძლებელია';
  end if;
  new.status := 'ringing'; new.answered_at := null; new.ended_at := null; new.created_at := now();
  return new;
end $$;
drop trigger if exists calls_before_insert on public.calls;
create trigger calls_before_insert before insert on public.calls
  for each row execute function public.before_call_insert();

-- დაშვებული გადასვლები: ringing → accepted/declined/busy (პასუხისმგებელი), ringing → missed/ended (დამრეკი),
-- accepted → ended (ორივე). დასრულებული ზარი აღარ იცვლება.
create or replace function public.before_call_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if old.status in ('declined', 'missed', 'ended', 'busy') then raise exception 'ზარი უკვე დასრულებულია'; end if;
  new.id := old.id; new.conversation_id := old.conversation_id; new.caller_id := old.caller_id;
  new.callee_id := old.callee_id; new.kind := old.kind; new.created_at := old.created_at;
  if old.status = 'ringing' then
    if new.status in ('accepted', 'declined', 'busy') and v_me is distinct from old.callee_id then raise exception 'not allowed'; end if;
    if new.status = 'missed' and v_me is distinct from old.caller_id then raise exception 'not allowed'; end if;
    if new.status = 'ended' and v_me is distinct from old.caller_id then raise exception 'not allowed'; end if;
  elsif old.status = 'accepted' then
    if new.status <> 'ended' then raise exception 'not allowed'; end if;
  end if;
  if new.status = 'accepted' then new.answered_at := now(); end if;
  if new.status in ('declined', 'missed', 'ended', 'busy') then
    new.ended_at := now();
    if new.status = 'ended' and old.status = 'ringing' then new.status := 'missed'; end if;
  end if;
  return new;
end $$;
drop trigger if exists calls_before_update on public.calls;
create trigger calls_before_update before update on public.calls
  for each row execute function public.before_call_update();

create or replace function public.after_call_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_caller text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(full_name, ''), username) into v_caller from profiles where id = new.caller_id;
    perform public.push_dispatch(new.callee_id, jsonb_build_object(
      'title', coalesce(v_caller, 'ეზო'),
      'body', case new.kind when 'video' then '📹 შემომავალი ვიდეოზარი' else '📞 შემომავალი ზარი' end,
      'url', '/chat/' || new.conversation_id, 'tag', 'call-' || new.id));
  elsif new.status in ('declined', 'missed', 'ended', 'busy') and old.status not in ('declined', 'missed', 'ended', 'busy') then
    insert into messages (conversation_id, sender_id, body, meta) values (new.conversation_id, new.caller_id, '',
      jsonb_build_object('call', jsonb_build_object('id', new.id, 'kind', new.kind, 'status', new.status,
        'duration', case when new.answered_at is not null then extract(epoch from new.ended_at - new.answered_at)::int else 0 end)));
  end if;
  return new;
end $$;
drop trigger if exists calls_after_change on public.calls;
create trigger calls_after_change after insert or update on public.calls
  for each row execute function public.after_call_change();

-- Push: ჯგუფური ჩატის სახელი; ზარის მესიჯს ცალკე push არ სჭირდება
create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid; v_kind text; v_title text; v_text text;
begin
  if new.meta ? 'call' then return new; end if;
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  select kind, title into v_kind, v_title from conversations where id = new.conversation_id;
  v_text := case new.media_type when 'image' then '📷 ფოტო' when 'audio' then '🎙 ხმოვანი მესიჯი' else left(new.body, 140) end;
  for v_member in
    select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', case when v_kind = 'group' then coalesce(v_title, 'ჯგუფური ჩატი') else coalesce(v_sender, 'ეზო') end,
      'body', case when v_kind = 'group' then coalesce(v_sender, '') || ': ' || v_text else v_text end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- v4 RLS + Realtime
-- ---------------------------------------------------------------------
alter table public.message_reactions enable row level security;
alter table public.calls enable row level security;

drop policy if exists "reactions read" on public.message_reactions;
drop policy if exists "reactions own" on public.message_reactions;
create policy "reactions read" on public.message_reactions for select to authenticated using (public.is_member(conversation_id));
create policy "reactions own" on public.message_reactions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));

drop policy if exists "calls read" on public.calls;
drop policy if exists "calls start" on public.calls;
drop policy if exists "calls update" on public.calls;
create policy "calls read" on public.calls for select to authenticated using (auth.uid() in (caller_id, callee_id));
create policy "calls start" on public.calls for insert to authenticated with check (caller_id = auth.uid() and public.can_act());
create policy "calls update" on public.calls for update to authenticated using (auth.uid() in (caller_id, callee_id));

do $$ begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.calls; exception when duplicate_object then null; end;
end $$;
-- წაშლილი მესიჯის სრული მონაცემი Realtime-ში
alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;

-- =====================================================================
--  v5: ჯოკერის მაგიდები (4 ადგილი + კომპიუტერი), ბლიცი, ტურნირები (არენა)
-- =====================================================================
create or replace function public.seat_user(v_g public.games, p_seat text)
returns uuid language sql immutable as $$
  select case p_seat when 'a' then v_g.player_a when 'w' then v_g.player_a when 'b' then v_g.player_b
    when 'c' then v_g.player_c when 'd' then v_g.player_d end;
$$;

-- მაგიდასთან დაჯდომა (მოწვევით ან ღია მაგიდაზე). სავსე მაგიდა თავისით იწყება.
create or replace function public.svc_take_seat(p_user uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_g games; v_seat text;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'waiting' then raise exception 'მაგიდა უკვე დაწყებულია'; end if;
  if v_g.seats <= 2 then raise exception 'ეს თამაში ორ მოთამაშეზეა'; end if;
  if p_user in (v_g.player_a, v_g.player_b, v_g.player_c, v_g.player_d) then return null; end if;
  if not v_g.is_public and not (p_user = any (v_g.invites)) then raise exception 'მოწვევა არ გაქვს'; end if;
  if public.is_blocked(v_g.player_a, p_user) then raise exception 'ამ მაგიდასთან ვერ დაჯდები'; end if;
  v_seat := case when v_g.player_b is null then 'b' when v_g.player_c is null then 'c' when v_g.player_d is null then 'd' end;
  if v_seat is null then raise exception 'მაგიდა სავსეა'; end if;
  update games set
    player_b = case when v_seat = 'b' then p_user else player_b end,
    player_c = case when v_seat = 'c' then p_user else player_c end,
    player_d = case when v_seat = 'd' then p_user else player_d end,
    move_no = move_no + 1, updated_at = now()
   where id = p_id returning * into v_g;
  update game_hands set user_id = p_user where game_id = p_id and seat = v_seat;
  if v_g.player_b is not null and v_g.player_c is not null and v_g.player_d is not null then
    update games set status = 'active', turn = public.seat_user(v_g, v_g.state ->> 'turn'), updated_at = now() where id = p_id;
  end if;
  return v_seat;
end $$;

create or replace function public.svc_take_any_seat(p_user uuid, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from games
   where type = p_type and status = 'waiting' and is_public and seats > 2
     and p_user is distinct from player_a and p_user is distinct from player_b
     and p_user is distinct from player_c and p_user is distinct from player_d
     and (player_b is null or player_c is null or player_d is null)
     and not public.is_blocked(player_a, p_user)
   order by created_at
   limit 1
   for update skip locked;
  if v_id is null then return null; end if;
  perform public.svc_take_seat(p_user, v_id);
  return v_id;
end $$;

create or replace function public.svc_leave_seat(p_user uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games; v_seat text;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'waiting' then return; end if;
  v_seat := case p_user when v_g.player_b then 'b' when v_g.player_c then 'c' when v_g.player_d then 'd' end;
  if v_seat is null then return; end if;
  update games set
    player_b = case when v_seat = 'b' then null else player_b end,
    player_c = case when v_seat = 'c' then null else player_c end,
    player_d = case when v_seat = 'd' then null else player_d end,
    move_no = move_no + 1, updated_at = now()
   where id = p_id;
  update game_hands set user_id = null where game_id = p_id and seat = v_seat;
end $$;

-- მრავალადგილიანი თამაშის დასრულება: Elo წყვილ-წყვილად მხოლოდ ადამიანებს შორის
-- p_scores: {"<user_id>": ქულა}; მაგიდიდან წასულს ძალიან დაბალი ქულა აქვს
create or replace function public.svc_finish_table(p_id uuid, p_winner uuid, p_result text, p_scores jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_g games; r record; o record; v_delta float; v_k float; v_n int; v_deltas jsonb := '{}'::jsonb;
begin
  select * into v_g from games where id = p_id for update;
  if not found or v_g.status <> 'active' then return; end if;
  update games set status = 'finished', winner = p_winner, result = p_result, turn = null, updated_at = now() where id = p_id;
  insert into game_stats (user_id, type) select key::uuid, v_g.type from jsonb_each(p_scores) on conflict do nothing;
  v_n := (select count(*) from jsonb_object_keys(p_scores));
  if v_n >= 2 then
    v_k := 32.0 / (v_n - 1);
    for r in select s.key::uuid as uid, (s.value)::numeric as score, gs.rating
               from jsonb_each(p_scores) s join game_stats gs on gs.user_id = s.key::uuid and gs.type = v_g.type loop
      v_delta := 0;
      for o in select s.key::uuid as uid, (s.value)::numeric as score, gs.rating
                 from jsonb_each(p_scores) s join game_stats gs on gs.user_id = s.key::uuid and gs.type = v_g.type
                where s.key::uuid <> r.uid loop
        v_delta := v_delta + v_k * ((case when r.score > o.score then 1 when r.score = o.score then 0.5 else 0 end)
          - 1.0 / (1 + power(10, (o.rating - r.rating) / 400.0)));
      end loop;
      v_deltas := v_deltas || jsonb_build_object(r.uid::text, round(v_delta));
    end loop;
  end if;
  update game_stats gs set
    rating = gs.rating + coalesce((v_deltas ->> gs.user_id::text)::int, 0),
    wins = gs.wins + coalesce(gs.user_id = p_winner, false)::int,
    draws = gs.draws + (p_result = 'jokerdraw')::int,
    losses = gs.losses + (p_result <> 'jokerdraw' and not coalesce(gs.user_id = p_winner, false))::int
   where gs.type = v_g.type and gs.user_id in (select key::uuid from jsonb_each(p_scores));
end $$;
