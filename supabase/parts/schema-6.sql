-- ეზო — სქემის ნაწილი 6/8. გაუშვი 5-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

-- ქულის დარიცხვა: p_ref — ერთხელ თითო სამიზნეზე, p_cap — დღიური ლიმიტი ამ ტიპზე (თბილისის დროით)
create or replace function public.award(p_user uuid, p_kind text, p_xp int, p_coins int, p_ref text default null, p_cap int default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_old int; v_new int; v_lvl int;
begin
  if p_user is null then return false; end if;
  if p_ref is not null and exists (select 1 from progress_events where user_id = p_user and kind = p_kind and ref = p_ref) then return false; end if;
  if p_cap is not null and (select count(*) from progress_events where user_id = p_user and kind = p_kind
                              and created_at >= public.tbilisi_day_start()) >= p_cap then return false; end if;
  insert into progress (user_id) values (p_user) on conflict do nothing;
  update progress set xp = xp + p_xp, coins = coins + p_coins, updated_at = now()
   where user_id = p_user returning xp - p_xp, xp into v_old, v_new;
  insert into progress_events (user_id, kind, xp, coins, ref) values (p_user, p_kind, p_xp, p_coins, p_ref);
  v_lvl := public.level_of(v_new);
  if v_lvl > public.level_of(v_old) then
    perform public.award(p_user, 'level', 0, v_lvl * 5, v_lvl::text);
    insert into notifications (user_id, type, data) values (p_user, 'level_up', jsonb_build_object('level', v_lvl, 'coins', v_lvl * 5));
    perform public.check_badges(p_user, 'level');
  end if;
  return true;
end $$;

create or replace function public.spend_coins(p_user uuid, p_amount int, p_kind text, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then return; end if;
  update progress set coins = coins - p_amount, updated_at = now() where user_id = p_user and coins >= p_amount;
  if not found then raise exception 'ბროწეული არ გყოფნის'; end if;
  insert into progress_events (user_id, kind, xp, coins, ref) values (p_user, p_kind, 0, -p_amount, p_ref);
end $$;

create or replace function public.check_badges(p_user uuid, p_metric text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m jsonb; b record;
begin
  if p_user is null then return; end if;
  m := public.badge_metrics(p_user, p_metric);
  for b in select * from badges x
            where (p_metric is null or x.metric = p_metric)
              and coalesce((m ->> x.metric)::int, 0) >= x.target
              and not exists (select 1 from user_badges u where u.user_id = p_user and u.badge = x.key)
            order by x.sort loop
    insert into user_badges (user_id, badge) values (p_user, b.key) on conflict do nothing;
    if found then
      perform public.award(p_user, 'badge', 0, b.coins, b.key);
      insert into notifications (user_id, type, data) values (p_user, 'achievement', jsonb_build_object('badge', b.key, 'coins', b.coins));
    end if;
  end loop;
end $$;

-- დღიური შესვლა: სერია, ბროწეული (5 → 15, ყოველ მე-7 დღეს +25), პირველად — მისასალმებელი 25
create or replace function public.daily_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v progress; v_today date := public.tbilisi_today(); v_streak int; v_reward int; v_first boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into progress (user_id) values (auth.uid()) on conflict do nothing;
  select * into v from progress where user_id = auth.uid() for update;
  if v.last_day = v_today or not public.can_act() then
    return jsonb_build_object('claimed', false, 'streak', v.streak, 'coins', v.coins, 'xp', v.xp, 'level', public.level_of(v.xp));
  end if;
  v_first := v.last_day is null;
  v_streak := case when v.last_day = v_today - 1 then v.streak + 1 else 1 end;
  v_reward := 5 + 2 * least(v_streak - 1, 5) + case when v_streak % 7 = 0 then 25 else 0 end;
  update progress set streak = v_streak, best_streak = greatest(best_streak, v_streak), last_day = v_today where user_id = auth.uid();
  perform public.award(auth.uid(), 'checkin', 10, v_reward, v_today::text);
  if v_first then perform public.award(auth.uid(), 'welcome', 0, 25, 'welcome'); end if;
  perform public.check_badges(auth.uid(), case when v_first then null else 'streak' end);
  select * into v from progress where user_id = auth.uid();
  return jsonb_build_object('claimed', true, 'first', v_first, 'streak', v_streak, 'reward', v_reward + case when v_first then 25 else 0 end,
                            'coins', v.coins, 'xp', v.xp, 'level', public.level_of(v.xp));
end $$;

create or replace function public.my_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v progress;
begin
  select * into v from progress where user_id = auth.uid();
  return jsonb_build_object('xp', coalesce(v.xp, 0), 'coins', coalesce(v.coins, 0), 'streak',
      case when v.last_day >= public.tbilisi_today() - 1 then v.streak else 0 end,
    'best_streak', coalesce(v.best_streak, 0), 'last_day', v.last_day, 'level', public.level_of(coalesce(v.xp, 0)),
    'claimed_today', coalesce(v.last_day = public.tbilisi_today(), false), 'metrics', public.badge_metrics(auth.uid()));
end $$;

-- სხვისი პროფილისთვის: დონე, სერია, ბეჯები (ბროწეულის ბალანსი პირადია)
create or replace function public.profile_progress(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'level', public.level_of(coalesce((select xp from progress where user_id = p_user), 0)),
    'xp', coalesce((select xp from progress where user_id = p_user), 0),
    'streak', coalesce((select streak from progress where user_id = p_user and last_day >= public.tbilisi_today() - 1), 0),
    'badges', coalesce((select jsonb_agg(badge order by earned_at) from user_badges where user_id = p_user), '[]'::jsonb))
  where not public.is_blocked(auth.uid(), p_user);
$$;

-- კვირის ლიდერები: 'friends' — ვისაც გამოვიწერ + მე; 'all' — ყველა
create or replace function public.xp_leaderboard(p_scope text default 'friends')
returns table (user_id uuid, username text, full_name text, avatar_url text, week_xp bigint, level int)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.full_name, p.avatar_url, sum(e.xp)::bigint, public.level_of(coalesce(pr.xp, 0))
    from progress_events e
    join profiles p on p.id = e.user_id
    left join progress pr on pr.user_id = p.id
   where e.xp > 0
     and e.created_at >= (date_trunc('week', now() at time zone 'Asia/Tbilisi') at time zone 'Asia/Tbilisi')
     and (p.banned_until is null or p.banned_until < now())
     and not public.is_blocked(auth.uid(), p.id)
     and (p_scope = 'all' or p.id = auth.uid() or exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = p.id))
   group by p.id, pr.xp
   order by 5 desc, p.username
   limit 50;
$$;

-- ---- ქულები მოქმედებებზე
create or replace function public.progress_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is null then
    perform public.award(new.author_id, 'post', 5, 0, null, 10);
    perform public.check_badges(new.author_id, 'posts');
  else
    perform public.award(new.author_id, 'reply', 2, 0, null, 20);
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_posts on public.posts;
create trigger zz_progress_posts after insert on public.posts for each row execute function public.progress_on_post();

create or replace function public.progress_on_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author_id into v_author from posts where id = new.post_id;
  if v_author is not null and v_author <> new.user_id then
    perform public.award(v_author, 'like', 1, 0, null, 50);
    perform public.check_badges(v_author, 'likes');
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_likes on public.likes;
create trigger zz_progress_likes after insert on public.likes for each row execute function public.progress_on_like();

create or replace function public.progress_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award(new.following_id, 'follower', 3, 0, new.follower_id::text, 20);
  perform public.check_badges(new.following_id, 'followers');
  return null;
end $$;
drop trigger if exists zz_progress_follows on public.follows;
create trigger zz_progress_follows after insert on public.follows for each row execute function public.progress_on_follow();

-- თამაში: მონაწილეობა +5 XP, მოგება +10 XP და 3 ბროწეული (მინიმუმ 4 სვლა, დღიური ლიმიტით)
create or replace function public.progress_on_game()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; s text;
begin
  if new.status = 'finished' and old.status = 'active' and new.move_no >= 4 then
    foreach s in array array['a', 'b', 'c', 'd'] loop
      u := case s when 'a' then new.player_a when 'b' then new.player_b when 'c' then new.player_c else new.player_d end;
      continue when u is null or s = any (new.bots);
      perform public.award(u, 'game', 5, 0, new.id::text, 30);
      if new.winner = u then perform public.award(u, 'win', 10, 3, new.id::text, 10); end if;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_games on public.games;
create trigger zz_progress_games after update of status on public.games for each row execute function public.progress_on_game();
-- ბეჯები სტატისტიკის განახლების შემდეგ (რეიტინგი თამაშის დასრულების შემდეგ ითვლება)
create or replace function public.progress_on_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.check_badges(new.user_id, 'games');
  perform public.check_badges(new.user_id, 'wins');
  return null;
end $$;
drop trigger if exists zz_progress_stats on public.game_stats;
create trigger zz_progress_stats after update on public.game_stats for each row execute function public.progress_on_stats();

-- ტურნირის პრიზები: 50 / 30 / 20 ბროწეული
create or replace function public.progress_on_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.place between 1 and 3 and old.place is distinct from new.place and new.games > 0 then
    perform public.award(new.user_id, 'tournament', (4 - new.place) * 15, case new.place when 1 then 50 when 2 then 30 else 20 end, new.tournament_id::text);
    if new.place = 1 then perform public.check_badges(new.user_id, 'tourney'); end if;
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_places on public.tournament_players;
create trigger zz_progress_places after update of place on public.tournament_players for each row execute function public.progress_on_place();

create or replace function public.progress_on_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sold' and old.status <> 'sold' then
    perform public.award(new.seller_id, 'sale', 10, 5, new.id::text);
    perform public.check_badges(new.seller_id, 'sales');
  end if;
  return null;
end $$;
drop trigger if exists zz_progress_sales on public.listings;
create trigger zz_progress_sales after update of status on public.listings for each row execute function public.progress_on_sale();

-- საჩუქრები: ბროწეული და გული უფასოა (დღეში 5), დანარჩენი ბროწეულით
alter table public.gifts drop constraint if exists gifts_kind_check;
alter table public.gifts add constraint gifts_kind_check check (kind in ('pomegranate', 'churchkhela', 'khachapuri', 'wine', 'rose', 'heart', 'star', 'dice', 'qvevri', 'crown'));
create or replace function public.gift_price(p_kind text)
returns int language sql immutable as $$
  select case p_kind when 'churchkhela' then 10 when 'khachapuri' then 15 when 'rose' then 20 when 'wine' then 25
                     when 'dice' then 30 when 'star' then 40 when 'qvevri' then 60 when 'crown' then 100 else 0 end;
$$;
create or replace function public.before_gift()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_price int := public.gift_price(new.kind);
begin
  if v_price = 0 then
    if (select count(*) from gifts where from_id = new.from_id and created_at > now() - interval '1 day' and public.gift_price(kind) = 0) >= 5 then
      raise exception 'უფასო საჩუქარი დღეში 5-ჯერ შეიძლება — სხვები ბროწეულით იგზავნება';
    end if;
  else
    perform public.spend_coins(new.from_id, v_price, 'gift', new.kind);
  end if;
  return new;
end $$;
drop trigger if exists gifts_before_insert on public.gifts;
create trigger gifts_before_insert before insert on public.gifts for each row execute function public.before_gift();
create or replace function public.progress_on_gift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award(new.to_id, 'gift_received', 5, 0, null, 10);
  perform public.check_badges(new.from_id, 'gifts');
  return null;
end $$;
drop trigger if exists zz_progress_gifts on public.gifts;
create trigger zz_progress_gifts after insert on public.gifts for each row execute function public.progress_on_gift();

-- ---- RLS: ბალანსი და ისტორია მხოლოდ საკუთარი; ცვლილება მხოლოდ ფუნქციებით
alter table public.progress enable row level security;
alter table public.progress_events enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
drop policy if exists "progress own" on public.progress;
create policy "progress own" on public.progress for select to authenticated using (user_id = auth.uid());
drop policy if exists "progress events own" on public.progress_events;
create policy "progress events own" on public.progress_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "badges read" on public.badges;
create policy "badges read" on public.badges for select to authenticated using (true);
drop policy if exists "user badges read" on public.user_badges;
create policy "user badges read" on public.user_badges for select to authenticated using (not public.is_blocked(auth.uid(), user_id));

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
