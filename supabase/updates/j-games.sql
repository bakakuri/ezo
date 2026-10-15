-- ეზო — განახლება J: ჭადრაკი 960, ხუთი რიგში, პარტიის ჩანაწერი (ყოველი სვლა ინახება 90 დღე)
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- საჭიროა წინა განახლებები (A–I). განმეორებით გაშვება უსაფრთხოა. შემდეგ განაახლე Edge Function „game“.

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
