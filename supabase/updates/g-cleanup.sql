-- ეზო — განახლება G: „გაღვიძება“ (უფასო Supabase აღარ ჩერდება) და წაშლილი ფოტოების დასუფთავება საცავიდან
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- საჭიროა წინა განახლებები (A–E). განმეორებით გაშვება უსაფრთხოა.

-- =====================================================================
-- ეტაპი G: „გაღვიძება“ და საცავის დასუფთავება
-- =====================================================================

-- ---- გაღვიძება: Supabase-ის უფასო პროექტი 7 დღის უმოქმედობის შემდეგ ჩერდება.
-- Vercel-ის ყოველდღიური cron (api/daily.js) ამას იძახებს — ერთი მარტივი მოთხოვნა ბაზაში საკმარისია.
create or replace function public.keep_alive()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.keep_alive() to anon, authenticated, service_role;

-- ---- წაშლილი ფოტოების, ვიდეოების და ხმოვანების დასუფთავება საცავიდან (bucket „media“).
-- 1) ტრიგერები: როცა ჩანაწერი იშლება ან ფოტო იცვლება, ძველი ფაილის გზა რიგში (media_trash) ჩადის;
-- 2) api/daily.js (service გასაღებით) დღეში ერთხელ იღებს რიგს — media_cleanup_take — და შლის მხოლოდ იმას,
--    რასაც აღარაფერი იყენებს (media_in_use: მაგ. სთორი ჰაილაითში ან ჩატში პასუხად რჩება);
-- 3) ატვირთული, მაგრამ არსად მიმაგრებული ფაილები (გაუქმებული პოსტი, შეუნახავი ავატარი) — დღე-ნახევრის შემდეგ.
-- ახალი სვეტი ფოტოთი? დაამატე media_collect ტრიგერში და media_in_use-ში.
create table if not exists public.media_trash (
  path text primary key,
  created_at timestamptz not null default now()
);
alter table public.media_trash enable row level security;
revoke all on public.media_trash from anon, authenticated;

-- რომელი ფაილებიდან დაიწყო ძებნა (მხოლოდ ამ განახლების შემდეგ ატვირთულები — ძველს არ ვეხებით)
create table if not exists public.media_sweep (
  id boolean primary key default true check (id),
  last_at timestamptz not null default now()
);
insert into public.media_sweep default values on conflict do nothing;
alter table public.media_sweep enable row level security;
revoke all on public.media_sweep from anon, authenticated;

-- ჩვენი საცავის გზები ნებისმიერი მნიშვნელობიდან (ტექსტი, jsonb, მთელი ჩანაწერი)
create or replace function public.media_paths(v jsonb)
returns setof text language sql immutable as $$
  select distinct m[1] from regexp_matches(coalesce(v::text, ''), '/storage/v1/object/public/media/([^"?#\s\\]+)', 'g') as m
$$;

create or replace function public.media_collect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into media_trash (path)
  select p from public.media_paths(to_jsonb(old)) p
  where tg_op = 'DELETE' or p not in (select public.media_paths(to_jsonb(new)))
  on conflict (path) do nothing;
  return null;
end $$;

do $$ declare t record; begin
  for t in select * from (values
    ('profiles', 'avatar_url'), ('posts', 'media'), ('stories', null), ('messages', 'media_url, meta'),
    ('dating_profiles', 'photos'), ('groups', 'cover_url'), ('events', 'cover_url'), ('highlights', 'cover_url'),
    ('highlight_items', null), ('listings', 'photos, thumb'), ('conversations', 'avatar_url')) as v(tbl, cols)
  loop
    execute format('drop trigger if exists media_collect on public.%I', t.tbl);
    execute format('create trigger media_collect after delete%s on public.%I for each row execute function public.media_collect()',
      case when t.cols is null then '' else ' or update of ' || t.cols end, t.tbl);
  end loop;
end $$;

-- ფაილს ჯერ კიდევ რამე იყენებს? გზის პირველი საქაღალდე ამტვირთავის id-ია — დიდ ცხრილებში მხოლოდ მის ჩანაწერებს ვამოწმებთ.
-- უცნობი ფორმის გზა — ყოველთვის „გამოიყენება“ (არასდროს წაიშლება).
create or replace function public.media_in_use(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare o uuid;
begin
  if p is null or split_part(p, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return true; end if;
  o := split_part(p, '/', 1)::uuid;
  return exists (select 1 from profiles where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from groups where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from events where strpos(coalesce(cover_url, ''), p) > 0)
    or exists (select 1 from conversations where strpos(coalesce(avatar_url, ''), p) > 0)
    or exists (select 1 from posts where author_id = o and strpos(media::text, p) > 0)
    or exists (select 1 from stories where author_id = o and strpos(media_url, p) > 0)
    or exists (select 1 from highlights h where h.owner_id = o and (strpos(coalesce(h.cover_url, ''), p) > 0
               or exists (select 1 from highlight_items i where i.highlight_id = h.id and strpos(i.media_url, p) > 0)))
    or exists (select 1 from listings where seller_id = o and (strpos(photos::text, p) > 0 or strpos(coalesce(thumb, ''), p) > 0))
    or exists (select 1 from dating_profiles where user_id = o and strpos(photos::text, p) > 0)
    or exists (select 1 from messages m join conversation_members c on c.conversation_id = m.conversation_id and c.user_id = o
               where strpos(coalesce(m.media_url, '') || coalesce(m.meta::text, ''), p) > 0);
end $$;

-- დღიური დასუფთავება: აბრუნებს წასაშლელ გზებს (მაქს. p_limit) და რიგიდან იღებს
create or replace function public.media_cleanup_take(p_limit int default 200)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  n int := least(greatest(coalesce(p_limit, 200), 1), 1000);
  out text[] := '{}';
  r record;
  cur timestamptz;
begin
  -- 1) წაშლილი შიგთავსის ფაილები — საათის შემდეგ (თუ ფოტო ისევ სადმე გამოიყენება, რჩება)
  for r in select path from media_trash where created_at < now() - interval '1 hour' order by created_at limit n for update skip locked loop
    delete from media_trash where path = r.path;
    if not public.media_in_use(r.path) then out := out || r.path; end if;
  end loop;
  -- 2) ატვირთული, მაგრამ არსად მიმაგრებული — ერთი დღის შემდეგ, თითოეული ერთხელ (media_sweep.last_at-დან)
  select last_at into cur from media_sweep where id for update;
  if cur is not null and cardinality(out) < n then
    for r in select o.name, o.created_at from storage.objects o
             where o.bucket_id = 'media' and o.created_at > cur and o.created_at < now() - interval '1 day'
             order by o.created_at limit n * 2 loop
      cur := r.created_at;
      if not (r.name = any(out)) and not public.media_in_use(r.name) then out := out || r.name; end if;
      exit when cardinality(out) >= n;
    end loop;
    update media_sweep set last_at = cur where id;
  end if;
  return out;
end $$;

-- საცავმა თუ ვერ წაშალა — რიგში ბრუნდება, შემდეგ ჯერზე ვცდით
create or replace function public.media_cleanup_return(p_paths text[])
returns void language sql security definer set search_path = public as $$
  insert into media_trash (path, created_at) select unnest(p_paths), now() - interval '2 hours' on conflict (path) do nothing
$$;

revoke execute on function public.media_in_use(text) from public, anon, authenticated;
revoke execute on function public.media_cleanup_take(int) from public, anon, authenticated;
revoke execute on function public.media_cleanup_return(text[]) from public, anon, authenticated;
grant execute on function public.media_cleanup_take(int) to service_role;
grant execute on function public.media_cleanup_return(text[]) to service_role;
