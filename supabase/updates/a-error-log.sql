-- ეზო — განახლება A: შეცდომების ჟურნალი (ადმინ პანელი → „შეცდომები“)
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- ახალ პროექტზე ეს საჭირო არ არის — უკვე შედის schema.sql-ში (და 8 ნაწილში). განმეორებით გაშვება უსაფრთხოა.

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

-- ერთნაირი შეცდომები ერთად: რამდენჯერ, რამდენ ადამიანთან, ბოლო მისამართი და დეტალები
create or replace function public.admin_errors(p_days int default 7)
returns table (message text, source text, events bigint, users bigint, first_at timestamptz, last_at timestamptz,
               path text, stack text, release text, user_agent text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select e.message,
    (array_agg(e.source order by e.created_at desc))[1],
    count(*), count(distinct e.user_id), min(e.created_at), max(e.created_at),
    (array_agg(e.path order by e.created_at desc))[1],
    (array_agg(e.stack order by e.created_at desc) filter (where e.stack is not null))[1],
    (array_agg(e.release order by e.created_at desc))[1],
    (array_agg(e.user_agent order by e.created_at desc))[1]
  from client_errors e
  where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
  group by e.message
  order by max(e.created_at) desc
  limit 100;
end $$;

-- „მოგვარებულია“: ამ შეცდომის ყველა ჩანაწერი იშლება
create or replace function public.admin_clear_errors(p_message text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  delete from client_errors where message = p_message;
  get diagnostics n = row_count;
  return n;
end $$;
