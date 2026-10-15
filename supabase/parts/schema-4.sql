-- ეზო — სქემის ნაწილი 4/9. გაუშვი 3-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

-- ---------------------------------------------------------------------
-- ტურნირები (არენა): დროის ფანჯარაში თამაშობ რამდენიც გინდა, მოგება = 2, ფრე = 1;
-- ზედიზედ ორი მოგების შემდეგ („ცეცხლი“) ქულები ორმაგდება.
-- ---------------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('nardi', 'longnardi', 'chess', 'checkers', 'domino', 'durak')),
  tc text check (tc is null or tc in ('1+0', '3+0', '3+2', '5+0', '10+0')),
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles on delete set null,
  group_id uuid references public.groups on delete cascade,
  created_at timestamptz not null default now(),
  constraint tournaments_window check (ends_at > starts_at and ends_at - starts_at <= interval '6 hours'),
  constraint tournaments_tc check (tc is null or type in ('chess', 'checkers'))
);
create index if not exists tournaments_time_idx on public.tournaments (ends_at desc);

create table if not exists public.tournament_players (
  tournament_id uuid references public.tournaments on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  score int not null default 0,
  games int not null default 0,
  wins int not null default 0,
  streak int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index if not exists tournament_players_rank_idx on public.tournament_players (tournament_id, score desc, wins desc);

alter table public.games drop constraint if exists games_tournament_fk;
alter table public.games add constraint games_tournament_fk foreign key (tournament_id) references public.tournaments on delete set null;

create or replace function public.arena_score(v_g public.games, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_end timestamptz; u uuid;
begin
  select ends_at into v_end from tournaments where id = v_g.tournament_id;
  if v_end is null or v_g.created_at >= v_end or v_g.player_b is null then return; end if;
  foreach u in array array[v_g.player_a, v_g.player_b] loop
    insert into tournament_players (tournament_id, user_id) values (v_g.tournament_id, u) on conflict do nothing;
    update tournament_players set
      score = score + case when p_winner is null then (case when streak >= 2 then 2 else 1 end)
                           when p_winner = u then (case when streak >= 2 then 4 else 2 end) else 0 end,
      wins = wins + coalesce(p_winner = u, false)::int,
      streak = case when p_winner = u then streak + 1 else 0 end,
      games = games + 1
     where tournament_id = v_g.tournament_id and user_id = u;
  end loop;
end $$;

create or replace function public.can_see_tournament(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = p_id and (t.group_id is null or public.can_see_group(t.group_id)));
$$;

create or replace function public.join_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_end timestamptz;
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if not public.can_see_tournament(p_id) then raise exception 'ტურნირი ვერ მოიძებნა'; end if;
  select ends_at into v_end from tournaments where id = p_id;
  if v_end <= now() then raise exception 'ტურნირი დასრულდა'; end if;
  insert into tournament_players (tournament_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.leave_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from tournament_players where tournament_id = p_id and user_id = auth.uid() and games = 0;
end $$;

alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
drop policy if exists "tournaments read" on public.tournaments;
drop policy if exists "tournaments create" on public.tournaments;
drop policy if exists "tournaments delete" on public.tournaments;
create policy "tournaments read" on public.tournaments for select to authenticated
  using (group_id is null or public.can_see_group(group_id));
create policy "tournaments create" on public.tournaments for insert to authenticated
  with check (created_by = auth.uid() and public.can_act() and starts_at > now() - interval '5 minutes'
    and (public.is_staff() or (group_id is not null and public.is_group_admin(group_id))));
create policy "tournaments delete" on public.tournaments for delete to authenticated
  using (public.is_staff() or (created_by = auth.uid() and starts_at > now()));
drop policy if exists "tournament players read" on public.tournament_players;
create policy "tournament players read" on public.tournament_players for select to authenticated
  using (public.can_see_tournament(tournament_id));

revoke execute on function public.svc_take_seat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_take_any_seat(uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_leave_seat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_finish_table(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.arena_score(public.games, uuid) from public, anon, authenticated;
grant execute on function public.svc_take_seat(uuid, uuid) to service_role;
grant execute on function public.svc_take_any_seat(uuid, text) to service_role;
grant execute on function public.svc_leave_seat(uuid, uuid) to service_role;
grant execute on function public.svc_finish_table(uuid, uuid, text, jsonb) to service_role;

do $$ begin
  begin alter publication supabase_realtime add table public.tournament_players; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------
-- ტურნირის დაწყება/დასრულება: შეტყობინებები, ადგილები, ტაიმერი (pg_cron)
-- ---------------------------------------------------------------------
alter table public.tournaments add column if not exists start_notified_at timestamptz;
alter table public.tournaments add column if not exists finished_at timestamptz;
alter table public.tournament_players add column if not exists place int;
alter table public.notifications add column if not exists tournament_id uuid references public.tournaments on delete cascade;
alter table public.notifications add column if not exists data jsonb;

-- წუთში ერთხელ (pg_cron) ან ტურნირის გვერდის გახსნისას: აკეთებს მხოლოდ იმას, რისი დროც მოვიდა
create or replace function public.tournament_tick()
returns int language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select * from tournaments where start_notified_at is null and starts_at <= now() and ends_at > now()
           for update skip locked loop
    update tournaments set start_notified_at = now() where id = t.id;
    insert into notifications (user_id, actor_id, type, tournament_id, data)
    select user_id, null, 'tournament_start', t.id, jsonb_build_object('title', t.title, 'game', t.type)
      from tournament_players where tournament_id = t.id;
    n := n + 1;
  end loop;

  for t in select * from tournaments where finished_at is null and ends_at <= now() for update skip locked loop
    update tournaments set finished_at = now(), start_notified_at = coalesce(start_notified_at, now()) where id = t.id;
    with ranked as (
      select user_id, row_number() over (order by score desc, wins desc, joined_at) as place
        from tournament_players where tournament_id = t.id and games > 0)
    update tournament_players tp set place = r.place from ranked r
     where tp.tournament_id = t.id and tp.user_id = r.user_id;
    insert into notifications (user_id, actor_id, type, tournament_id, data)
    select tp.user_id, w.user_id, 'tournament_end', t.id, jsonb_build_object(
             'title', t.title, 'game', t.type, 'place', tp.place, 'score', tp.score,
             'players', (select count(*) from tournament_players x where x.tournament_id = t.id and x.games > 0))
      from tournament_players tp
      left join tournament_players w on w.tournament_id = t.id and w.place = 1
     where tp.tournament_id = t.id and tp.games > 0;
    update games set status = 'cancelled', turn = null, updated_at = now() where tournament_id = t.id and status = 'waiting';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.tournament_tick() from public, anon;
grant execute on function public.tournament_tick() to authenticated, service_role;

-- ტაიმერი: Supabase-ში ჯერ ჩართე Database → Extensions → pg_cron (თუ ეს ბლოკი ვერ ჩართავს)
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron მიუწვდომელია — ჩართე Database → Extensions → pg_cron და ფაილი ხელახლა გაუშვი (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('ezo-tournaments', '* * * * *', 'select public.tournament_tick()');
exception when others then
  raise notice 'ტურნირების ტაიმერი ვერ ჩაირთო: %', sqlerrm;
end $$;

-- =====================================================================
--  v6: სოციალური — დახურული პროფილი, გამოწერის თხოვნები, გამოკითხვები,
--  შენახული პოსტები და კოლექციები, სთორის ჰაილაითები, „ახლო მეგობრები“
-- =====================================================================
create table if not exists public.follow_requests (
  requester_id uuid references public.profiles on delete cascade,
  target_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc);

-- გამოწერა: ღია პროფილზე — მაშინვე, დახურულზე — თხოვნა
create or replace function public.follow_user(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if p_target = auth.uid() then raise exception 'საკუთარ თავს ვერ გამოიწერ'; end if;
  if public.is_blocked(auth.uid(), p_target) then raise exception 'ამ ადამიანს ვერ გამოიწერ'; end if;
  if exists (select 1 from follows where follower_id = auth.uid() and following_id = p_target) then return 'following'; end if;
  if (select count(*) from follows where follower_id = auth.uid() and created_at > now() - interval '1 hour') >= 150 then
    raise exception 'ძალიან ბევრი გამოწერა ცოტა ხანში — სცადე მოგვიანებით';
  end if;
  if public.is_private_profile(p_target) then
    insert into follow_requests (requester_id, target_id) values (auth.uid(), p_target) on conflict do nothing;
    if found then
      insert into notifications (user_id, actor_id, type) values (p_target, auth.uid(), 'follow_request');
    end if;
    return 'requested';
  end if;
  insert into follows (follower_id, following_id) values (auth.uid(), p_target) on conflict do nothing;
  return 'following';
end $$;

create or replace function public.unfollow_user(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from follows where follower_id = auth.uid() and following_id = p_target;
  delete from follow_requests where requester_id = auth.uid() and target_id = p_target;
end $$;

create or replace function public.respond_follow_request(p_requester uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from follow_requests where requester_id = p_requester and target_id = auth.uid();
  if not found then return; end if;
  delete from notifications where user_id = auth.uid() and actor_id = p_requester and type = 'follow_request';
  if p_accept and not public.is_blocked(auth.uid(), p_requester) then
    insert into follows (follower_id, following_id) values (p_requester, auth.uid()) on conflict do nothing;
    insert into notifications (user_id, actor_id, type) values (p_requester, auth.uid(), 'follow_accept');
  end if;
end $$;

-- პროფილის გახსნისას ყველა მოლოდინში მყოფი თხოვნა დასტურდება
create or replace function public.on_profile_privacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_private and not new.is_private then
    insert into follows (follower_id, following_id)
    select requester_id, target_id from follow_requests where target_id = new.id
    on conflict do nothing;
    delete from follow_requests where target_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_privacy on public.profiles;
create trigger profiles_privacy after update of is_private on public.profiles
  for each row execute function public.on_profile_privacy();

-- ---- გამოკითხვები
create table if not exists public.polls (
  post_id uuid primary key references public.posts on delete cascade,
  options jsonb not null,
  multi boolean not null default false,
  closes_at timestamptz not null default now() + interval '1 day',
  constraint polls_options check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  constraint polls_window check (closes_at <= now() + interval '8 days')
);
create table if not exists public.poll_votes (
  post_id uuid references public.polls on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  option int not null check (option between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, option)
);

create or replace function public.before_poll_insert()
returns trigger language plpgsql as $$
declare v text;
begin
  for v in select jsonb_array_elements_text(new.options) loop
    if char_length(btrim(v)) not between 1 and 80 then raise exception 'პასუხი 1–80 სიმბოლო უნდა იყოს'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists polls_validate on public.polls;
create trigger polls_validate before insert or update on public.polls
  for each row execute function public.before_poll_insert();
