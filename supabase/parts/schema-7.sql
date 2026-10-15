-- ეზო — სქემის ნაწილი 7/8. გაუშვი 6-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

revoke execute on function public.award(uuid, text, int, int, text, int) from public, anon, authenticated;
revoke execute on function public.spend_coins(uuid, int, text, text) from public, anon, authenticated;
revoke execute on function public.check_badges(uuid, text) from public, anon, authenticated;
revoke execute on function public.badge_metrics(uuid, text) from public, anon, authenticated;
revoke execute on function public.progress_on_post() from public, anon, authenticated;
revoke execute on function public.progress_on_like() from public, anon, authenticated;
revoke execute on function public.progress_on_follow() from public, anon, authenticated;
revoke execute on function public.progress_on_game() from public, anon, authenticated;
revoke execute on function public.progress_on_place() from public, anon, authenticated;
revoke execute on function public.progress_on_stats() from public, anon, authenticated;
revoke execute on function public.progress_on_sale() from public, anon, authenticated;
revoke execute on function public.progress_on_gift() from public, anon, authenticated;
revoke execute on function public.before_gift() from public, anon, authenticated;

-- =====================================================================
--  v9: თამაშები 2.0 — ბურა, ლოტო, დღის ამოცანა, ყურება, რეაქციები და ჩატი თამაშისას
-- =====================================================================
-- ბურა ტურნირებშიც (ლოტო — მხოლოდ მაგიდა)
alter table public.tournaments drop constraint if exists tournaments_type_check;
alter table public.tournaments add constraint tournaments_type_check
  check (type in ('nardi', 'longnardi', 'chess', 'checkers', 'domino', 'durak', 'bura'));
create index if not exists games_live_idx on public.games (updated_at desc) where status = 'active' and is_public;

-- ---- დღის ჭადრაკის ამოცანა (ამონახსნი კლიენტს არ ეგზავნება — სვლებს სერვერი ამოწმებს)
create table if not exists public.chess_puzzles (
  id int primary key,
  title text not null,
  fen text not null,
  solution text[] not null
);
insert into public.chess_puzzles (id, title, fen, solution) values
  (1, 'უკანა რიგი', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', array['d1d8']),
  (2, 'სკოლის მატი', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', array['f3f7']),
  (3, 'ფილიდორის მემკვიდრეობა', 'r6k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1', array['b3g8', 'a8g8', 'h6f7']),
  (4, 'უსწრაფესი მატი', 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', array['d8h4']),
  (5, 'არაბული მატი', '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1', array['a7h7']),
  (6, 'ჩახრჩობილი მეფე', '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', array['g5f7']),
  (7, 'შავების ჯერია: უკანა რიგი', '3r2k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', array['d8d1']),
  (8, 'ეპოლეტები', '3rkr2/8/8/8/2Q5/8/8/4K3 w - - 0 1', array['c4e6']),
  (9, 'დერეფანი', '6k1/5ppp/8/8/8/8/8/K3Q3 w - - 0 1', array['e1e8']),
  (10, 'ფილიდორი შავებით', '6k1/6pp/1q6/8/8/7n/6PP/R6K b - - 0 1', array['b6g1', 'a1g1', 'h3f2']),
  (11, 'მეფე და ეტლი', 'k7/8/1K6/8/8/8/8/7R w - - 0 1', array['h1h8']),
  (12, 'ცხენის ხაფანგი', '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', array['d3f2']),
  (13, 'ოპოზიცია', '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', array['a1a8']),
  (14, 'სკოლის მატი, მეორე ვარიანტი', 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', array['f3f7'])
on conflict (id) do update set title = excluded.title, fen = excluded.fen, solution = excluded.solution;

create table if not exists public.puzzle_solves (
  user_id uuid references public.profiles on delete cascade,
  day date not null,
  puzzle_id int not null references public.chess_puzzles,
  solved boolean not null default false,
  attempts int not null default 0,
  solved_at timestamptz,
  primary key (user_id, day)
);

create or replace function public.puzzle_of_day(p_day date)
returns public.chess_puzzles language sql stable security definer set search_path = public as $$
  select * from public.chess_puzzles
   where id = (((p_day - date '2026-01-01') % (select count(*) from public.chess_puzzles)::int
               + (select count(*) from public.chess_puzzles)::int) % (select count(*) from public.chess_puzzles)::int) + 1;
$$;

create or replace function public.daily_puzzle()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_day date := public.tbilisi_today(); p chess_puzzles; r puzzle_solves;
begin
  p := public.puzzle_of_day(v_day);
  select * into r from puzzle_solves where user_id = auth.uid() and day = v_day;
  return jsonb_build_object('day', v_day, 'id', p.id, 'title', p.title, 'fen', p.fen,
    'moves', ceil(array_length(p.solution, 1) / 2.0)::int,
    'solved', coalesce(r.solved, false), 'attempts', coalesce(r.attempts, 0),
    'solution', case when r.solved then to_jsonb(p.solution) end,
    'solvers', (select count(*) from puzzle_solves where day = v_day and solved));
end $$;

-- p_moves: მთელი თანმიმდევრობა ამ მომენტამდე (ჩემი სვლები და პასუხები), ბოლო — ჩემი ახალი სვლა
create or replace function public.puzzle_move(p_moves text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_day date := public.tbilisi_today(); p chess_puzzles; n int := coalesce(array_length(p_moves, 1), 0); v_len int; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  p := public.puzzle_of_day(v_day);
  v_len := array_length(p.solution, 1);
  if n = 0 or n % 2 = 0 or n > v_len then raise exception 'არასწორი სვლა'; end if;
  v_ok := p_moves = p.solution[1:n];
  insert into puzzle_solves (user_id, day, puzzle_id) values (auth.uid(), v_day, p.id) on conflict do nothing;
  if not v_ok then
    update puzzle_solves set attempts = attempts + 1 where user_id = auth.uid() and day = v_day and not solved;
    return jsonb_build_object('correct', false);
  end if;
  if n = v_len then
    update puzzle_solves set solved = true, solved_at = now(), attempts = attempts + 1
     where user_id = auth.uid() and day = v_day and not solved;
    if found then perform public.award(auth.uid(), 'puzzle', 15, 5, v_day::text); end if;
    return jsonb_build_object('correct', true, 'solved', true,
      'attempts', (select attempts from puzzle_solves where user_id = auth.uid() and day = v_day),
      'solvers', (select count(*) from puzzle_solves where day = v_day and solved));
  end if;
  return jsonb_build_object('correct', true, 'solved', false, 'reply', p.solution[n + 1]);
end $$;

-- ---- რეაქციები და ჩატი თამაშისას
create table if not exists public.game_messages (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('emoji', 'text')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists game_messages_game_idx on public.game_messages (game_id, created_at desc);

create or replace function public.is_game_player(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from games g where g.id = p_game
    and auth.uid() in (g.player_a, g.player_b, g.player_c, g.player_d));
$$;

-- სპამის წინააღმდეგ: 10 წამში მაქსიმუმ 8 მესიჯი
create or replace function public.before_game_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from game_messages where user_id = new.user_id and game_id = new.game_id and created_at > now() - interval '10 seconds') >= 8 then
    raise exception 'ცოტა ნელა — ძალიან ხშირად წერ';
  end if;
  new.body := btrim(new.body);
  return new;
end $$;
drop trigger if exists game_messages_before on public.game_messages;
create trigger game_messages_before before insert on public.game_messages for each row execute function public.before_game_message();

alter table public.chess_puzzles enable row level security;
alter table public.puzzle_solves enable row level security;
alter table public.game_messages enable row level security;
-- ამოცანების ცხრილს პოლიტიკა არ აქვს: ამონახსნი მხოლოდ ფუნქციებით
drop policy if exists "puzzle solves own" on public.puzzle_solves;
create policy "puzzle solves own" on public.puzzle_solves for select to authenticated using (user_id = auth.uid());
drop policy if exists "game messages read" on public.game_messages;
drop policy if exists "game messages send" on public.game_messages;
create policy "game messages read" on public.game_messages for select to authenticated
  using (not public.is_blocked(auth.uid(), user_id));
-- რეაქცია — ყველას (მაყურებელსაც), ტექსტი — მხოლოდ მოთამაშეებს
create policy "game messages send" on public.game_messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_act()
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'active')
    and ((kind = 'emoji' and body in ('👍', '😂', '😮', '🔥', '😡', '🎉', '🤝', '😢'))
         or (kind = 'text' and public.is_game_player(game_id))));

do $$ begin
  begin alter publication supabase_realtime add table public.game_messages; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

revoke execute on function public.before_game_message() from public, anon, authenticated;
revoke execute on function public.puzzle_of_day(date) from public, anon, authenticated;

-- =====================================================================
--  v10: გაზიარება (OG, მოწვევა), უსაფრთხოება (2FA, ლიმიტები, აკრძალული სიტყვები), ანგარიშის წაშლა და ექსპორტი
-- =====================================================================
-- განცხადების ყდის პატარა ასლი (ბადისთვის)
alter table public.listings add column if not exists thumb text check (thumb is null or (thumb ~ '^https?://' and char_length(thumb) <= 600));
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists follows_follower_time_idx on public.follows (follower_id, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists profiles_invited_idx on public.profiles (invited_by) where invited_by is not null;

-- ---- ბმულის „ბარათი“ Facebook/Messenger-ისთვის (anon-საც შეუძლია; მხოლოდ საჯარო შიგთავსი)
create or replace function public.og_preview(p_kind text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_id uuid;
begin
  if p_kind in ('p', 'm', 'e', 't') then
    begin v_id := p_key::uuid; exception when others then return null; end;
  end if;
  if p_kind = 'p' then
    select jsonb_build_object('title', coalesce(nullif(a.full_name, ''), a.username) || ' ეზოში',
             'description', left(regexp_replace(p.body, '\s+', ' ', 'g'), 200), 'image', p.media -> 0 ->> 'url')
      into r from posts p join profiles a on a.id = p.author_id
     where p.id = v_id and not p.hidden and p.group_id is null and not a.is_private
       and (a.banned_until is null or a.banned_until < now());
  elsif p_kind in ('u', 'i') then
    select jsonb_build_object(
             'title', case when p_kind = 'i' then coalesce(nullif(full_name, ''), username) || ' გეპატიჟება ეზოში'
                           else coalesce(nullif(full_name, ''), username) || ' (@' || username || ')' end,
             'description', case when p_kind = 'i' then 'შემოგვიერთდი: მეგობრები, ვიდეოები, ბაზარი და ნარდი ერთ ადგილას.'
                                 when is_private then 'დახურული პროფილი ეზოში' else coalesce(nullif(bio, ''), 'პროფილი ეზოში') end,
             'image', avatar_url, 'name', coalesce(nullif(full_name, ''), username), 'username', username)
      into r from profiles where username = lower(p_key) and onboarded and (banned_until is null or banned_until < now());
  elsif p_kind = 'm' then
    select jsonb_build_object('title', l.title || ' — ' || public.price_text(l.price, l.currency),
             'description', coalesce(nullif(left(l.description, 200), ''), l.city), 'image', l.photos ->> 0)
      into r from listings l join profiles s on s.id = l.seller_id
     where l.id = v_id and not l.hidden and (s.banned_until is null or s.banned_until < now());
  elsif p_kind = 'e' then
    select jsonb_build_object('title', e.title, 'description', left(coalesce(nullif(e.description, ''), e.place, ''), 200), 'image', e.cover_url)
      into r from events e left join groups g on g.id = e.group_id
     where e.id = v_id and (e.group_id is null or g.privacy = 'public');
  elsif p_kind = 't' then
    select jsonb_build_object('title', t.title, 'description', public.game_title(t.type) || ' — არენა ტურნირი ეზოში', 'image', null)
      into r from tournaments t where t.id = v_id and t.group_id is null;
  end if;
  return r;
end $$;
grant execute on function public.og_preview(text, text) to anon, authenticated;

-- ---- მოწვევა: ახალი მომხმარებელი (7 დღემდე) ერთხელ იღებს; ორივე ერთმანეთს იწერს, ორივე იღებს ბროწეულს
create or replace function public.claim_invite(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv profiles; v_me profiles;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null then raise exception 'not signed in'; end if;
  select * into v_inv from profiles where username = lower(btrim(p_username));
  if v_inv.id is null or v_inv.id = v_me.id or not v_inv.onboarded then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_me.invited_by is not null or v_me.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'reason', 'old'); end if;
  if public.is_blocked(v_me.id, v_inv.id) then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  update profiles set invited_by = v_inv.id where id = v_me.id;
  perform public.follow_user(v_inv.id);
  insert into follows (follower_id, following_id) values (v_inv.id, v_me.id) on conflict do nothing;
  perform public.award(v_inv.id, 'invite', 10, 20, v_me.id::text);
  perform public.award(v_me.id, 'invited', 0, 10, 'invited');
  insert into notifications (user_id, actor_id, type) values (v_inv.id, v_me.id, 'invite_joined');
  return jsonb_build_object('ok', true, 'inviter', v_inv.username);
end $$;

create or replace function public.invite_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('count', (select count(*) from profiles where invited_by = auth.uid()),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username, 'full_name', full_name, 'avatar_url', avatar_url) order by created_at desc)
                          from (select * from profiles where invited_by = auth.uid() order by created_at desc limit 12) x), '[]'::jsonb));
$$;

-- ---- სპამის ლიმიტები (პირდაპირი ჩანაწერებისთვის; სერვერული ფუნქციები თავისით ამოწმებს)
-- მხოლოდ საკუთარი ჩანაწერები ითვლება (auth.uid())
drop function if exists public.rate_count(text, uuid, timestamptz);
create or replace function public.rate_count(p_table text, p_since timestamptz)
returns int language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  return case p_table
    when 'posts' then (select count(*) from posts where author_id = u and created_at > p_since)
    when 'messages' then (select count(*) from messages where sender_id = u and created_at > p_since)
    when 'reports' then (select count(*) from reports where reporter_id = u and created_at > p_since)
    when 'stories' then (select count(*) from stories where author_id = u and created_at > p_since)
    else 0 end;
end $$;

create or replace function public.rate_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_max int; v_win interval;
begin
  if current_user not in ('authenticated', 'anon') or public.is_staff() then return new; end if;
  case tg_table_name
    when 'posts' then v_max := 20; v_win := interval '10 minutes';
    when 'messages' then v_max := 40; v_win := interval '1 minute';
    when 'reports' then v_max := 20; v_win := interval '1 day';
    when 'stories' then v_max := 30; v_win := interval '1 day';
    else return new;
  end case;
  if public.rate_count(tg_table_name, now() - v_win) >= v_max then
    raise exception 'ძალიან ხშირად — სცადე ცოტა ხანში';
  end if;
  return new;
end $$;
drop trigger if exists rate_guard on public.posts;
create trigger rate_guard before insert on public.posts for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.messages;
create trigger rate_guard before insert on public.messages for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.reports;
create trigger rate_guard before insert on public.reports for each row execute function public.rate_guard();
drop trigger if exists rate_guard on public.stories;
create trigger rate_guard before insert on public.stories for each row execute function public.rate_guard();

-- ---- აკრძალული სიტყვები (მოდერატორი მართავს)
create table if not exists public.banned_words (
  word text primary key check (char_length(word) between 2 and 60 and word = lower(word)),
  created_at timestamptz not null default now()
);
create or replace function public.has_banned(p_text text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from banned_words w where position(w.word in lower(coalesce(p_text, ''))) > 0);
$$;
create or replace function public.words_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_text text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  case tg_table_name
    when 'posts' then v_text := new.body;
    when 'messages' then v_text := new.body;
    when 'game_messages' then v_text := new.body;
    when 'listings' then v_text := new.title || ' ' || new.description;
    when 'profiles' then v_text := new.username || ' ' || new.full_name || ' ' || new.bio;
    else return new;
  end case;
  if public.has_banned(v_text) then raise exception 'ტექსტი შეიცავს აკრძალულ სიტყვას'; end if;
  return new;
end $$;
drop trigger if exists words_guard on public.posts;
create trigger words_guard before insert or update of body on public.posts for each row execute function public.words_guard();
drop trigger if exists words_guard on public.messages;
create trigger words_guard before insert on public.messages for each row execute function public.words_guard();
drop trigger if exists words_guard on public.game_messages;
create trigger words_guard before insert on public.game_messages for each row execute function public.words_guard();
drop trigger if exists words_guard on public.listings;
create trigger words_guard before insert or update of title, description on public.listings for each row execute function public.words_guard();
drop trigger if exists words_guard on public.profiles;
create trigger words_guard before update of username, full_name, bio on public.profiles for each row execute function public.words_guard();

-- ---- ჩემი მონაცემები: ჩამოტვირთვა და ანგარიშის წაშლა
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in'; end if;
  if not public.mfa_ok() then raise exception 'საჭიროა ორფაქტორიანი შესვლა'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'role' from profiles p where id = u),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'body', body, 'media', media, 'kind', kind, 'parent_id', parent_id, 'created_at', created_at) order by created_at) from posts where author_id = u), '[]'),
    'likes', coalesce((select jsonb_agg(jsonb_build_object('post_id', post_id, 'created_at', created_at)) from likes where user_id = u), '[]'),
    'following', coalesce((select jsonb_agg(p.username) from follows f join profiles p on p.id = f.following_id where f.follower_id = u), '[]'),
    'followers', coalesce((select jsonb_agg(p.username) from follows f join profiles p on p.id = f.follower_id where f.following_id = u), '[]'),
    'messages_sent', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'body', body, 'media_url', media_url, 'created_at', created_at) order by created_at)
                               from messages where sender_id = u and deleted_at is null), '[]'),
    'stories', coalesce((select jsonb_agg(jsonb_build_object('media_url', media_url, 'caption', caption, 'created_at', created_at)) from stories where author_id = u), '[]'),
    'listings', coalesce((select jsonb_agg(to_jsonb(l) - 'hidden') from listings l where seller_id = u), '[]'),
    'gifts_sent', coalesce((select jsonb_agg(jsonb_build_object('to', to_id, 'kind', kind, 'note', note, 'created_at', created_at)) from gifts where from_id = u), '[]'),
    'gifts_received', coalesce((select jsonb_agg(jsonb_build_object('from', from_id, 'kind', kind, 'note', note, 'created_at', created_at)) from gifts where to_id = u), '[]'),
    'game_stats', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id') from game_stats g where user_id = u), '[]'),
    'progress', (select to_jsonb(x) - 'user_id' from progress x where user_id = u),
    'badges', coalesce((select jsonb_agg(badge) from user_badges where user_id = u), '[]'),
    'dating_profile', (select to_jsonb(d) - 'user_id' from dating_profiles d where user_id = u));
end $$;

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
