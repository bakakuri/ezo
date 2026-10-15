-- ეზო — სქემის ნაწილი 9/9. გაუშვი 8-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

-- რეიტინგის ცხრილი: p_period 'season' (მიმდინარე თვე) ან 'all' (საერთო), p_scope 'all' ან 'friends' (შენ + ვისაც გამოიწერ)
create or replace function public.game_board(p_type text, p_period text default 'season', p_scope text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s date := public.season_now();
  v_rows jsonb; v_me jsonb; v_champs jsonb; v_all int;
begin
  if me is null then return null; end if;
  perform public.season_finalize_due();
  select rating into v_all from game_stats where user_id = me and type = p_type;
  with pool as (
    select x.user_id, x.rating, x.games, x.wins, x.losses, x.draws
      from (select g.user_id, g.rating, g.wins + g.losses + g.draws as games, g.wins, g.losses, g.draws
              from game_stats g where p_period = 'all' and g.type = p_type
            union all
            select ss.user_id, ss.rating, ss.games, ss.wins, ss.losses, ss.draws
              from season_stats ss where p_period <> 'all' and ss.season = s and ss.type = p_type) x
      join profiles p on p.id = x.user_id
     where x.games > 0 and p.onboarded and (p.banned_until is null or p.banned_until < now())
       and not public.is_blocked(me, x.user_id)
       and (p_scope <> 'friends' or x.user_id = me
            or exists (select 1 from follows f where f.follower_id = me and f.following_id = x.user_id))
  ), ranked as (
    select pool.*, rank() over (order by rating desc) as pos from pool
  ), shown as (
    select r.*, jsonb_build_object('pos', r.pos, 'user_id', r.user_id, 'rating', r.rating, 'games', r.games,
             'wins', r.wins, 'losses', r.losses, 'draws', r.draws,
             'league', case when p_period = 'all' then null else public.season_league(r.rating) end,
             'provisional', p_period <> 'all' and r.games < 5,
             'p', jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name,
                                     'avatar_url', p.avatar_url, 'verified', p.verified)) as j
      from ranked r join profiles p on p.id = r.user_id
  )
  select (select coalesce(jsonb_agg(j order by pos, rating desc, user_id), '[]'::jsonb) from (select * from shown order by pos, user_id limit 50) t),
         (select j from shown where user_id = me)
    into v_rows, v_me;
  select coalesce(jsonb_agg(jsonb_build_object('place', r.place, 'rating', r.rating, 'league', r.league,
           'p', jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'verified', p.verified))
           order by r.place), '[]'::jsonb)
    into v_champs
    from season_results r join profiles p on p.id = r.user_id
   where r.season = (s - interval '1 month')::date and r.type = p_type and r.place <= 3;
  return jsonb_build_object(
    'period', p_period, 'scope', p_scope, 'type', p_type,
    'season', s, 'ends_at', (s + interval '1 month')::timestamp at time zone 'Asia/Tbilisi',
    'rows', v_rows, 'me', v_me, 'champions', v_champs,
    'start', public.season_start(v_all));
end $$;
grant execute on function public.game_board(text, text, text) to authenticated;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'like', 'reply', 'follow', 'gift', 'match', 'game_invite', 'quote',
  'group_request', 'group_approved', 'event_rsvp', 'tournament_start', 'tournament_end',
  'follow_request', 'follow_accept', 'listing_price', 'achievement', 'level_up', 'invite_joined', 'mention', 'season_end'));

-- Push: კატეგორიები და ტექსტები (სეზონის დასრულება — „თამაშების“ კატეგორიაში)
create or replace function public.push_category(p_payload jsonb)
returns text language sql immutable as $$
  select case
    when p_payload ->> 'tag' like 'conv-%' then 'messages'
    when p_payload ->> 'tag' like 'call-%' then 'calls'
    when p_payload ->> 'tag' like 'game-%' then 'games'
    when p_payload ->> 'tag' ~ '^n-(reply|quote|mention)-' then 'replies'
    when p_payload ->> 'tag' ~ '^n-like-' then 'likes'
    when p_payload ->> 'tag' ~ '^n-(follow|follow_request|follow_accept|invite_joined)-' then 'follows'
    when p_payload ->> 'tag' ~ '^n-(game_invite|tournament_start|tournament_end|season_end)-' then 'games'
    when p_payload ->> 'tag' ~ '^n-match-' then 'dating'
    when p_payload ->> 'tag' ~ '^n-listing_price-' then 'market'
    when p_payload ->> 'tag' ~ '^n-(group_request|group_approved|event_rsvp)-' then 'groups'
    when p_payload ->> 'tag' ~ '^n-(gift|achievement|level_up)-' then 'rewards'
    else 'other' end;
$$;

-- Push-ის ტექსტები ყველა ტიპისთვის (მოხსენიება, სეზონის დასრულება)
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
      when 'season_end' then case when (new.data ->> 'place')::int = 1
          then '🏆 სეზონის ჩემპიონი — ' || public.game_title(new.data ->> 'type') || '! +' || (new.data ->> 'coins') || ' ბროწეული'
          else 'სეზონი დასრულდა — ' || public.game_title(new.data ->> 'type') || ': მე-' || (new.data ->> 'place') || ' ადგილი'
            || case when (new.data ->> 'coins')::int > 0 then ', +' || (new.data ->> 'coins') || ' ბროწეული' else '' end end
      when 'tournament_start' then 'ტურნირი დაიწყო — შემოდი და ითამაშე'
      when 'tournament_end' then case when (new.data ->> 'place')::int = 1 then '🏆 გაიმარჯვე ტურნირში!'
        else 'ტურნირი დასრულდა. შენი ადგილი: მე-' || (new.data ->> 'place') || ' (' || (new.data ->> 'players') || '-დან)' end
      when 'like' then 'მოიწონა შენი პოსტი' when 'reply' then 'გიპასუხა' when 'quote' then 'გაგიზიარა ციტატით'
      when 'mention' then 'მოგიხსენია: ' || coalesce(left((select body from posts where id = new.post_id), 100), '')
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
                when new.type = 'season_end' then '/games?board=' || (new.data ->> 'type')
                when new.type in ('achievement', 'level_up') then '/rewards'
                when new.group_id is not null then '/groups/' || (select slug from groups where id = new.group_id)
                when new.event_id is not null then '/events/' || new.event_id
                when new.post_id is not null then '/p/' || new.post_id else '/notifications' end,
    'tag', 'n-' || new.type || '-' || coalesce(new.post_id::text, new.group_id::text, new.tournament_id::text, new.data ->> 'listing_id', new.data ->> 'type', new.actor_id::text, '')));
  return new;
end $$;

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

-- =====================================================================
-- ეტაპი J: ჭადრაკი 960, ხუთი რიგში, პარტიის ჩანაწერი
-- =====================================================================

-- ---- ახალი თამაშები (ჩამონათვალი ზემოთაც სრულია — სქემის თავიდან გაშვება უსაფრთხოა)
alter table public.games drop constraint if exists games_type_check;
alter table public.games add constraint games_type_check
  check (type in ('nardi', 'chess', 'chess960', 'checkers', 'gomoku', 'domino', 'longnardi', 'durak', 'joker', 'bura', 'loto'));
alter table public.tournaments drop constraint if exists tournaments_type_check;
alter table public.tournaments add constraint tournaments_type_check
  check (type in ('nardi', 'longnardi', 'chess', 'chess960', 'checkers', 'gomoku', 'domino', 'durak', 'bura'));
alter table public.tournaments drop constraint if exists tournaments_tc;
alter table public.tournaments add constraint tournaments_tc check (tc is null or type in ('chess', 'chess960', 'checkers'));

create or replace function public.game_title(p_type text)
returns text language sql immutable as $$
  select case p_type when 'nardi' then 'ნარდი' when 'longnardi' then 'გრძელი ნარდი' when 'chess' then 'ჭადრაკი'
    when 'chess960' then 'ჭადრაკი 960' when 'checkers' then 'შაშკი' when 'gomoku' then 'ხუთი რიგში'
    when 'domino' then 'დომინო' when 'durak' then 'დურაკი' when 'joker' then 'ჯოკერი' when 'bura' then 'ბურა'
    when 'loto' then 'ლოტო' else p_type end;
$$;

-- ---- პარტიის ჩანაწერი: ყოველი სვლის შემდეგ საჯარო მდგომარეობა (დამალული ხელები დამალულივე რჩება).
-- ჩაიწერება ტრიგერით — „game“ ფუნქციის შეცვლა არ სჭირდება. კარტის თამაშები და ლოტო — არა.
-- დასრულებული პარტიის ჩანაწერი ინახება 90 დღე.
create table if not exists public.game_moves (
  game_id uuid not null references public.games on delete cascade,
  n int not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, n)
);
alter table public.game_moves enable row level security;
drop policy if exists "game moves read" on public.game_moves;
create policy "game moves read" on public.game_moves for select to authenticated using (true);
grant select on public.game_moves to authenticated;

create or replace function public.record_game_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type not in ('chess', 'chess960', 'checkers', 'gomoku', 'nardi', 'longnardi', 'domino') then return null; end if;
  if tg_op = 'INSERT' then
    insert into game_moves (game_id, n, state) values (new.id, coalesce(new.move_no, 0), new.state) on conflict do nothing;
  elsif new.state is distinct from old.state and new.move_no is distinct from old.move_no then
    insert into game_moves (game_id, n, state) values (new.id, new.move_no, new.state)
    on conflict (game_id, n) do update set state = excluded.state;
  end if;
  return null;
end $$;
drop trigger if exists games_record_move on public.games;
create trigger games_record_move after insert or update of state on public.games
  for each row execute function public.record_game_move();
create index if not exists games_finished_idx on public.games (updated_at) where status in ('finished', 'cancelled');

-- ---- დღიური მომსახურება ერთ ადგილას (keep_alive → daily_maintenance): სეზონები, ქრებადი მესიჯები, ძველი ჩანაწერები
create or replace function public.daily_maintenance()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seasons int; v_msgs int; v_moves int;
begin
  v_seasons := public.season_finalize_due();
  v_msgs := public.purge_expired_messages();
  delete from game_moves where game_id in (
    select g.id from games g
     where g.status in ('finished', 'cancelled') and g.updated_at < now() - interval '90 days'
       and exists (select 1 from game_moves m where m.game_id = g.id)
     limit 500);
  get diagnostics v_moves = row_count;
  return jsonb_build_object('seasons', v_seasons, 'messages', v_msgs, 'moves', v_moves);
end $$;
revoke execute on function public.daily_maintenance() from public, anon, authenticated;

create or replace function public.keep_alive()
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  perform public.daily_maintenance();
  return now();
end $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;
