-- ეზო — განახლება I: ჩატი — მესიჯებში ძებნა, მიმაგრება და დადუმება, ქრებადი მესიჯები, გამოკითხვა ჯგუფურ ჩატში
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- საჭიროა წინა განახლებები (A–H, განსაკუთრებით C — ქართული ძებნა). განმეორებით გაშვება უსაფრთხოა.

-- =====================================================================
-- ეტაპი I: ჩატი — ძებნა, მიმაგრება და დადუმება, ქრებადი მესიჯები, გამოკითხვა ჯგუფურ ჩატში
-- =====================================================================

-- ---- მიმაგრება (მაქსიმუმ 5) და დადუმება — თითოეულ წევრს თავისი
alter table public.conversation_members add column if not exists pinned_at timestamptz;
alter table public.conversation_members add column if not exists muted_until timestamptz;

-- p_pin: true/false; p_mute_hours: 0 — ხმის ჩართვა, -1 — სამუდამოდ, N — N საათით
create or replace function public.set_chat_prefs(p_conv uuid, p_pin boolean default null, p_mute_hours int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v conversation_members;
begin
  select * into v from conversation_members where conversation_id = p_conv and user_id = auth.uid() for update;
  if not found then raise exception 'ჩატი ვერ მოიძებნა'; end if;
  if p_pin is not null then
    if p_pin and v.pinned_at is null
       and (select count(*) from conversation_members where user_id = auth.uid() and pinned_at is not null) >= 5 then
      raise exception 'მიმაგრება შეიძლება მაქსიმუმ 5 ჩატის';
    end if;
    update conversation_members set pinned_at = case when p_pin then coalesce(pinned_at, now()) end
     where conversation_id = p_conv and user_id = auth.uid();
  end if;
  if p_mute_hours is not null then
    update conversation_members set muted_until = case when p_mute_hours = 0 then null
        when p_mute_hours < 0 then 'infinity'::timestamptz
        else now() + make_interval(hours => least(p_mute_hours, 24 * 365)) end
     where conversation_id = p_conv and user_id = auth.uid();
  end if;
  select * into v from conversation_members where conversation_id = p_conv and user_id = auth.uid();
  return jsonb_build_object('pinned', v.pinned_at is not null, 'muted', coalesce(v.muted_until > now(), false),
    'mute_forever', coalesce(v.muted_until = 'infinity'::timestamptz, false),
    'muted_until', case when v.muted_until <> 'infinity'::timestamptz then v.muted_until end);
end $$;
grant execute on function public.set_chat_prefs(uuid, boolean, int) to authenticated;

-- ---- ქრებადი მესიჯები: ჩატის პარამეტრი — 24 საათი ან 7 დღე. ახალ მესიჯს ვადა უჩნდება;
-- ვადაგასული აღარავის უჩანს (RLS) და დღიური „გაღვიძებისას“ იშლება (ფოტო/ხმოვანიც — ეტაპი G-ის დასუფთავებით)
alter table public.conversations add column if not exists disappear_hours int;
alter table public.conversations drop constraint if exists conversations_disappear_check;
alter table public.conversations add constraint conversations_disappear_check check (disappear_hours is null or disappear_hours in (24, 168));
alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;

-- ახალი მესიჯი: ვადა (ქრებად ჩატში) და გამოკითხვის შემოწმება
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_kind text; v_hours int; v_opts jsonb;
begin
  select kind, disappear_hours into v_kind, v_hours from conversations where id = new.conversation_id;
  new.expires_at := case when v_hours is not null and not (new.meta ? 'system') and not (new.meta ? 'call')
                         then now() + make_interval(hours => v_hours) end;
  if new.meta ? 'poll' then
    v_opts := new.meta -> 'poll' -> 'options';
    if v_kind is distinct from 'group' then raise exception 'გამოკითხვა მხოლოდ ჯგუფურ ჩატშია'; end if;
    if jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) not between 2 and 10
       or exists (select 1 from jsonb_array_elements(v_opts) o where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 100)
       or char_length(btrim(new.body)) not between 1 and 300 then
      raise exception 'გამოკითხვას სჭირდება კითხვა და 2–10 პასუხი';
    end if;
    new.media_url := null; new.media_type := null;
    new.meta := jsonb_build_object('poll', jsonb_build_object(
      'options', (select jsonb_agg(btrim(o #>> '{}')) from jsonb_array_elements(v_opts) o),
      'multi', coalesce((new.meta -> 'poll' ->> 'multi')::boolean, false)));
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated
  using (public.is_member(conversation_id) and (expires_at is null or expires_at > now()));

-- ჩართვა/გამორთვა: პირად ჩატში ორივეს შეუძლია, ჯგუფურში — ადმინს. ჩატში ჩნდება სისტემური შეტყობინება.
create or replace function public.set_disappearing(p_conv uuid, p_hours int)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_old int;
begin
  if p_hours is not null and p_hours not in (24, 168) then raise exception 'ვადა უნდა იყოს 24 საათი ან 7 დღე'; end if;
  if not public.is_member(p_conv) or not public.can_act() then raise exception 'ჩატი ვერ მოიძებნა'; end if;
  select kind, disappear_hours into v_kind, v_old from conversations where id = p_conv for update;
  if v_kind = 'group' and public.chat_role(p_conv) is distinct from 'admin' then
    raise exception 'ჯგუფურ ჩატში ამას მხოლოდ ადმინი ცვლის';
  end if;
  if v_old is not distinct from p_hours then return; end if;
  update conversations set disappear_hours = p_hours where id = p_conv;
  insert into messages (conversation_id, sender_id, body, meta) values (p_conv, auth.uid(),
    case when p_hours is null then 'გამორთო ქრებადი მესიჯები'
         when p_hours = 24 then 'ჩართო ქრებადი მესიჯები: ახალი მესიჯები ქრება 24 საათში'
         else 'ჩართო ქრებადი მესიჯები: ახალი მესიჯები ქრება 7 დღეში' end,
    jsonb_build_object('system', true, 'disappear', p_hours));
end $$;
grant execute on function public.set_disappearing(uuid, int) to authenticated;

create or replace function public.purge_expired_messages()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from messages where id in (select id from messages where expires_at < now() order by expires_at limit 5000);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_expired_messages() from public, anon, authenticated;

-- დღიური „გაღვიძება“ (ეტაპი G, H): სეზონების დახურვა და ვადაგასული მესიჯების წაშლა
create or replace function public.keep_alive()
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  perform public.season_finalize_due();
  perform public.purge_expired_messages();
  return now();
end $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- ---- შემოსულები: მიმაგრებული ზემოთ, დადუმება, ქრებადობა; ვადაგასული ბოლო მესიჯი აღარ ჩანს
drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (id uuid, kind text, updated_at timestamptz, last_message text, last_sender uuid, unread boolean, other jsonb,
               title text, avatar_url text, my_role text, members_count bigint, members jsonb, last_sender_name text,
               pinned boolean, muted boolean, mute_forever boolean, muted_until timestamptz, disappear_hours int)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.updated_at,
    case when c.disappear_hours is not null and c.updated_at < now() - make_interval(hours => c.disappear_hours) then null else c.last_message end,
    c.last_sender,
    (c.last_sender is not null and c.last_sender <> auth.uid() and c.updated_at > m.last_read_at) as unread,
    case when c.kind <> 'group' then
      (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
               'avatar_url', p.avatar_url, 'last_seen', p.last_seen)
         from conversation_members o join profiles p on p.id = o.user_id
        where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end as other,
    c.title, c.avatar_url, m.role,
    (select count(*) from conversation_members x where x.conversation_id = c.id),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)), '[]')
       from (select p.* from conversation_members o join profiles p on p.id = o.user_id
              where o.conversation_id = c.id and o.user_id <> auth.uid() order by o.user_id limit 3) p),
    (select coalesce(nullif(split_part(full_name, ' ', 1), ''), username) from profiles where id = c.last_sender),
    m.pinned_at is not null, coalesce(m.muted_until > now(), false), coalesce(m.muted_until = 'infinity'::timestamptz, false),
    case when m.muted_until <> 'infinity'::timestamptz then m.muted_until end,
    c.disappear_hours
  from conversations c
  join conversation_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  where public.mfa_ok()
  order by m.pinned_at desc nulls last, c.updated_at desc;
$$;
grant execute on function public.my_conversations() to authenticated;

-- ---- Push: დადუმებულ წევრს არა; გამოკითხვა — „📊 კითხვა“
create or replace function public.on_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sender text; v_member uuid; v_kind text; v_title text; v_text text;
begin
  if new.meta ? 'call' then return new; end if;
  select coalesce(nullif(full_name, ''), username) into v_sender from profiles where id = new.sender_id;
  select kind, title into v_kind, v_title from conversations where id = new.conversation_id;
  v_text := case when new.meta ? 'poll' then '📊 ' || left(new.body, 130)
                 when new.media_type = 'image' then '📷 ფოტო' when new.media_type = 'audio' then '🎙 ხმოვანი მესიჯი'
                 else left(new.body, 140) end;
  for v_member in
    select user_id from conversation_members
     where conversation_id = new.conversation_id and user_id <> new.sender_id
       and (muted_until is null or muted_until <= now())
  loop
    perform public.push_dispatch(v_member, jsonb_build_object(
      'title', case when v_kind = 'group' then coalesce(v_title, 'ჯგუფური ჩატი') else coalesce(v_sender, 'ეზო') end,
      'body', case when v_kind = 'group' then coalesce(v_sender, '') || ': ' || v_text else v_text end,
      'url', '/chat/' || new.conversation_id,
      'tag', 'conv-' || new.conversation_id));
  end loop;
  return new;
end $$;

-- შემოსულების ბოლო მესიჯი გამოკითხვისთვის
create or replace function public.on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set
    last_message = case when new.media_type = 'image' then '📷 ფოტო'
                        when new.media_type = 'audio' then '🎙 ხმოვანი'
                        when new.meta ? 'call' then case when new.meta -> 'call' ->> 'status' in ('missed', 'declined', 'busy')
                                                         then '📞 გამოტოვებული ზარი' else '📞 ზარი' end
                        when new.meta ? 'poll' then '📊 ' || left(new.body, 110)
                        when new.meta ? 'story' then '↩ სთორზე: ' || left(new.body, 100)
                        when new.meta ? 'listing' then '🏷 ' || left(new.body, 110)
                        else left(new.body, 120) end,
    last_sender = new.sender_id,
    updated_at = new.created_at
  where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at
  where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end $$;

-- ---- მესიჯებში ძებნა: ჩემს ჩატებში (ან ერთ ჩატში), ქართული/ლათინური ერთნაირად (ka_skeleton, ეტაპი C)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists messages_search_trgm on public.messages using gin (public.ka_skeleton(body) %I.gin_trgm_ops) where deleted_at is null', s);
  end if;
end $$;

create or replace function public.search_messages(p_q text, p_conv uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k text := public.ka_skeleton(btrim(coalesce(p_q, '')));
begin
  if auth.uid() is null or char_length(k) < 2 or not public.mfa_ok() then return '[]'::jsonb; end if;
  k := replace(replace(replace(k, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select m.id, m.conversation_id, m.sender_id, left(m.body, 300) as body, m.created_at, c.kind, c.title,
           (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
              from profiles p where p.id = m.sender_id) as sender,
           case when c.kind <> 'group' then
             (select jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
                from conversation_members o join profiles p on p.id = o.user_id
               where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1) end as other
      from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
      join conversations c on c.id = m.conversation_id
     where (p_conv is null or m.conversation_id = p_conv)
       and m.deleted_at is null and (m.expires_at is null or m.expires_at > now())
       and m.body <> '' and not (m.meta ? 'system')
       and public.ka_skeleton(m.body) like '%' || k || '%'
     order by m.created_at desc
     limit 50) x), '[]'::jsonb);
end $$;
grant execute on function public.search_messages(text, uuid) to authenticated;

-- ---- გამოკითხვა ჯგუფურ ჩატში: მესიჯი meta.poll = { options[], multi }, ხმები — ცალკე (ჩატის წევრები ხედავენ)
create table if not exists public.chat_poll_votes (
  message_id uuid not null references public.messages on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  option int not null check (option between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option)
);
create index if not exists chat_poll_votes_conv_idx on public.chat_poll_votes (conversation_id);
alter table public.chat_poll_votes enable row level security;
drop policy if exists "poll votes read" on public.chat_poll_votes;
create policy "poll votes read" on public.chat_poll_votes for select to authenticated using (public.is_member(conversation_id));
grant select on public.chat_poll_votes to authenticated;
alter table public.chat_poll_votes replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.chat_poll_votes; exception when duplicate_object then null; end;
end $$;

-- ჩემი ხმა: p_options — არჩეული პასუხები (ცარიელი — ხმის გაუქმება)
create or replace function public.vote_chat_poll(p_msg uuid, p_options int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_m messages; v_n int; v_multi boolean; v_opts int[];
begin
  select * into v_m from messages where id = p_msg;
  if not found or not public.is_member(v_m.conversation_id) or v_m.deleted_at is not null or not (v_m.meta ? 'poll')
     or (v_m.expires_at is not null and v_m.expires_at <= now()) then
    raise exception 'გამოკითხვა ვერ მოიძებნა';
  end if;
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  v_n := jsonb_array_length(v_m.meta -> 'poll' -> 'options');
  v_multi := coalesce((v_m.meta -> 'poll' ->> 'multi')::boolean, false);
  v_opts := array(select distinct x from unnest(coalesce(p_options, '{}'::int[])) x order by x);
  if exists (select 1 from unnest(v_opts) x where x < 0 or x >= v_n) then raise exception 'ასეთი პასუხი არ არის'; end if;
  if not v_multi and cardinality(v_opts) > 1 then raise exception 'აქ მხოლოდ ერთი პასუხი შეიძლება'; end if;
  delete from chat_poll_votes where message_id = p_msg and user_id = auth.uid() and not (option = any(v_opts));
  insert into chat_poll_votes (message_id, conversation_id, user_id, option)
  select p_msg, v_m.conversation_id, auth.uid(), x from unnest(v_opts) x
  on conflict do nothing;
end $$;
grant execute on function public.vote_chat_poll(uuid, int[]) to authenticated;
