-- ეზო — სქემის ნაწილი 6/8. გაუშვი 5-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

-- ხმის მიცემა (ძველი ხმა იცვლება). ხმები ანონიმურია: სხვისი ხმები არავის უჩანს.
create or replace function public.vote_poll(p_post uuid, p_options int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_poll polls; v_n int; v_author uuid; v_group uuid;
begin
  select * into v_poll from polls where post_id = p_post;
  if not found then raise exception 'გამოკითხვა ვერ მოიძებნა'; end if;
  select author_id, group_id into v_author, v_group from posts where id = p_post;
  if public.is_blocked(auth.uid(), v_author) or not public.can_see_group(v_group)
     or (v_group is null and not public.can_see_author(v_author)) then raise exception 'გამოკითხვა ვერ მოიძებნა'; end if;
  if v_poll.closes_at <= now() then raise exception 'გამოკითხვა დასრულებულია'; end if;
  v_n := jsonb_array_length(v_poll.options);
  if coalesce(array_length(p_options, 1), 0) = 0 then raise exception 'აირჩიე პასუხი'; end if;
  if not v_poll.multi and array_length(p_options, 1) > 1 then raise exception 'მხოლოდ ერთი პასუხი'; end if;
  if exists (select 1 from unnest(p_options) o where o < 0 or o >= v_n) then raise exception 'ასეთი პასუხი არ არის'; end if;
  delete from poll_votes where post_id = p_post and user_id = auth.uid();
  insert into poll_votes (post_id, user_id, option) select p_post, auth.uid(), o from (select distinct unnest(p_options) o) x;
end $$;

create or replace function public.poll_results(p_posts uuid[])
returns table (post_id uuid, option int, votes bigint, mine boolean)
language sql stable security definer set search_path = public as $$
  select v.post_id, v.option, count(*) as votes, bool_or(v.user_id = auth.uid()) as mine
    from poll_votes v join posts p on p.id = v.post_id
   where v.post_id = any (p_posts)
     and not public.is_blocked(auth.uid(), p.author_id) and public.can_see_group(p.group_id)
     and (p.group_id is not null or public.can_see_author(p.author_id))
   group by v.post_id, v.option;
$$;

-- ---- შენახული პოსტები და კოლექციები
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create table if not exists public.saves (
  user_id uuid references public.profiles on delete cascade,
  post_id uuid references public.posts on delete cascade,
  collection_id uuid references public.collections on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists saves_user_idx on public.saves (user_id, created_at desc);

-- ---- სთორის ჰაილაითები (სთორის ასლი, ამიტომ ორიგინალის წაშლა მათ არ შლის)
create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 30),
  cover_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.highlight_items (
  id uuid primary key default gen_random_uuid(),
  highlight_id uuid not null references public.highlights on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists highlight_items_idx on public.highlight_items (highlight_id, created_at);

-- ჰაილაითი მხოლოდ საკუთარი სთორიებიდან (ახლო მეგობრების სთორი ჰაილაითში არ გადადის)
create or replace function public.create_highlight(p_title text, p_stories uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cover text;
begin
  if not public.can_act() then raise exception 'ანგარიში დროებით შეზღუდულია'; end if;
  if coalesce(array_length(p_stories, 1), 0) = 0 then raise exception 'აირჩიე სთორი'; end if;
  select media_url into v_cover from stories where id = p_stories[1] and author_id = auth.uid();
  insert into highlights (owner_id, title, cover_url) values (auth.uid(), btrim(p_title), v_cover) returning id into v_id;
  insert into highlight_items (highlight_id, media_url, media_type, caption, created_at)
  select v_id, s.media_url, s.media_type, s.caption, s.created_at
    from stories s where s.id = any (p_stories) and s.author_id = auth.uid() and s.audience = 'all'
   order by s.created_at;
  if not exists (select 1 from highlight_items where highlight_id = v_id) then
    delete from highlights where id = v_id;
    raise exception 'აირჩიე საჯარო სთორი';
  end if;
  return v_id;
end $$;

-- ---- RLS
alter table public.follow_requests enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.collections enable row level security;
alter table public.saves enable row level security;
alter table public.highlights enable row level security;
alter table public.highlight_items enable row level security;
alter table public.close_friends enable row level security;

drop policy if exists "requests read" on public.follow_requests;
create policy "requests read" on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());
drop policy if exists "polls read" on public.polls;
drop policy if exists "polls create" on public.polls;
create policy "polls read" on public.polls for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "polls create" on public.polls for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists "votes own" on public.poll_votes;
create policy "votes own" on public.poll_votes for select to authenticated using (user_id = auth.uid());
drop policy if exists "collections own" on public.collections;
create policy "collections own" on public.collections for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "saves own" on public.saves;
create policy "saves own" on public.saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (collection_id is null
    or exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())));
drop policy if exists "highlights read" on public.highlights;
drop policy if exists "highlights own" on public.highlights;
drop policy if exists "highlights delete" on public.highlights;
create policy "highlights read" on public.highlights for select to authenticated
  using (not public.is_blocked(auth.uid(), owner_id) and public.can_see_author(owner_id));
create policy "highlights own" on public.highlights for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "highlights delete" on public.highlights for delete to authenticated using (owner_id = auth.uid());
drop policy if exists "highlight items read" on public.highlight_items;
drop policy if exists "highlight items delete" on public.highlight_items;
create policy "highlight items read" on public.highlight_items for select to authenticated
  using (exists (select 1 from public.highlights h where h.id = highlight_id));
create policy "highlight items delete" on public.highlight_items for delete to authenticated
  using (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid()));
drop policy if exists "close friends own" on public.close_friends;
create policy "close friends own" on public.close_friends for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke execute on function public.on_profile_privacy() from public, anon, authenticated;

-- =====================================================================
--  v7: ბაზარი — განცხადებები, შენახვა, ნახვები, აწევა, ფასის კლების შეტყობინება
-- =====================================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 3000),
  price numeric(12, 2) check (price is null or (price >= 0 and price <= 99999999)), -- null = შეთანხმებით, 0 = უფასოდ
  currency text not null default 'GEL' check (currency in ('GEL', 'USD')),
  category text not null check (category in ('electronics', 'vehicles', 'realty', 'home', 'fashion', 'kids', 'hobby', 'animals', 'services', 'other')),
  condition text check (condition in ('new', 'used')),
  city text not null default '' check (char_length(city) <= 40),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 8),
  status text not null default 'active' check (status in ('active', 'reserved', 'sold')),
  hidden boolean not null default false,
  views_count int not null default 0,
  saves_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bumped_at timestamptz not null default now()
);
create index if not exists listings_feed_idx on public.listings (status, bumped_at desc);
create index if not exists listings_cat_idx on public.listings (category, status, bumped_at desc);
create index if not exists listings_seller_idx on public.listings (seller_id, created_at desc);

create table if not exists public.listing_saves (
  user_id uuid references public.profiles on delete cascade,
  listing_id uuid references public.listings on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists listing_saves_listing_idx on public.listing_saves (listing_id);

create table if not exists public.listing_views (
  listing_id uuid references public.listings on delete cascade,
  viewer_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_id)
);

create or replace function public.price_text(p_price numeric, p_currency text)
returns text language sql immutable as $$
  select case when p_price is null then 'ფასი შეთანხმებით'
              when p_price = 0 then 'უფასოდ'
              else (case when p_currency = 'USD' then '$' else '' end)
                || replace(to_char(p_price, case when p_price = trunc(p_price) then 'FM999,999,999' else 'FM999,999,990.00' end), ',', ' ')
                || (case when p_currency = 'USD' then '' else ' ₾' end) end;
$$;

-- მომხმარებელი ვერ შეცვლის მთვლელებს, თარიღებს და დამალვას; ლიმიტები სპამის წინააღმდეგ
create or replace function public.listings_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.views_count := 0; new.saves_count := 0; new.hidden := false; new.status := 'active';
      new.created_at := now(); new.bumped_at := now();
      if (select count(*) from listings where seller_id = new.seller_id and created_at > now() - interval '1 day') >= 10 then
        raise exception 'დღეში მაქსიმუმ 10 განცხადების დამატება შეიძლება';
      end if;
      if (select count(*) from listings where seller_id = new.seller_id and status <> 'sold') >= 60 then
        raise exception 'აქტიური განცხადებების ლიმიტი ამოიწურა — ძველები გაყიდულად მონიშნე ან წაშალე';
      end if;
    else
      new.seller_id := old.seller_id; new.views_count := old.views_count; new.saves_count := old.saves_count;
      new.hidden := old.hidden; new.created_at := old.created_at; new.bumped_at := old.bumped_at;
    end if;
  end if;
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.city := btrim(new.city);
  if exists (select 1 from jsonb_array_elements(new.photos) e
              where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 600 or (e #>> '{}') !~ '^https?://') then
    raise exception 'ფოტოს ბმული არასწორია';
  end if;
  if tg_op = 'INSERT' or new is distinct from old then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists listings_guard on public.listings;
create trigger listings_guard before insert or update on public.listings
  for each row execute function public.listings_guard();

-- ფასი დაიკლო → ვინც შეინახა, იმას შეტყობინება (თითო განცხადებაზე 12 საათში ერთხელ)
create or replace function public.on_listing_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and not new.hidden and old.price is not null and new.price is not null
     and new.price < old.price and new.currency = old.currency then
    insert into notifications (user_id, actor_id, type, data)
    select s.user_id, new.seller_id, 'listing_price',
           jsonb_build_object('listing_id', new.id, 'title', new.title, 'price', new.price, 'old_price', old.price,
                              'currency', new.currency, 'photo', new.photos ->> 0)
      from listing_saves s
     where s.listing_id = new.id and s.user_id <> new.seller_id
       and not public.is_blocked(s.user_id, new.seller_id)
       and not exists (select 1 from notifications n where n.user_id = s.user_id and n.type = 'listing_price'
                         and n.data ->> 'listing_id' = new.id::text and n.created_at > now() - interval '12 hours');
  end if;
  return new;
end $$;
drop trigger if exists listings_after_update on public.listings;
create trigger listings_after_update after update of price on public.listings
  for each row execute function public.on_listing_change();

create or replace function public.on_listing_save()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update listings set saves_count = saves_count + 1 where id = new.listing_id;
  else update listings set saves_count = greatest(saves_count - 1, 0) where id = old.listing_id; end if;
  return null;
end $$;
drop trigger if exists listing_saves_count on public.listing_saves;
create trigger listing_saves_count after insert or delete on public.listing_saves
  for each row execute function public.on_listing_save();

-- ნახვა: ერთი ადამიანი = ერთი ნახვა, საკუთარი არ ითვლება
create or replace function public.view_listing(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into listing_views (listing_id, viewer_id)
  select l.id, auth.uid() from listings l
   where l.id = p_id and l.seller_id <> auth.uid() and not l.hidden and not public.is_blocked(auth.uid(), l.seller_id)
  on conflict do nothing;
  if found then update listings set views_count = views_count + 1 where id = p_id; end if;
end $$;

-- აწევა სიის თავში: დღეში ერთხელ
create or replace function public.bump_listing(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v listings;
begin
  if not public.can_act() then raise exception 'ანგარიში შეზღუდულია'; end if;
  select * into v from listings where id = p_id and seller_id = auth.uid();
  if not found then raise exception 'განცხადება ვერ მოიძებნა'; end if;
  if v.status <> 'active' or v.hidden then raise exception 'მხოლოდ აქტიურ განცხადებას აწევ'; end if;
  if v.bumped_at > now() - interval '24 hours' then raise exception 'აწევა დღეში ერთხელ შეიძლება'; end if;
  update listings set bumped_at = now() where id = p_id;
  return now();
end $$;

-- გამყიდველის სანდოობა: აქტიური და გაყიდული განცხადებები, ეზოზე რამდენი ხანია
create or replace function public.seller_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active', (select count(*) from listings where seller_id = p_user and status <> 'sold' and not hidden),
    'sold', (select count(*) from listings where seller_id = p_user and status = 'sold'),
    'since', (select created_at from profiles where id = p_user));
$$;

-- ---- RLS
alter table public.listings enable row level security;
alter table public.listing_saves enable row level security;
alter table public.listing_views enable row level security;

drop policy if exists "listings read" on public.listings;
drop policy if exists "listings create" on public.listings;
drop policy if exists "listings update own" on public.listings;
drop policy if exists "listings delete" on public.listings;
-- დამალული და დაბლოკილი გამყიდველის განცხადებებს მხოლოდ თვითონ და მოდერატორი ხედავს
create policy "listings read" on public.listings for select to authenticated using (
  seller_id = auth.uid() or public.is_staff()
  or (not hidden and not public.is_blocked(auth.uid(), seller_id)
      and not exists (select 1 from public.profiles p where p.id = seller_id and p.banned_until > now())));
create policy "listings create" on public.listings for insert to authenticated
  with check (seller_id = auth.uid() and public.can_act());
create policy "listings update own" on public.listings for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid() and public.can_act());
create policy "listings delete" on public.listings for delete to authenticated
  using (seller_id = auth.uid() or public.is_staff());

drop policy if exists "listing saves own" on public.listing_saves;
create policy "listing saves own" on public.listing_saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.listings l where l.id = listing_id and l.seller_id <> auth.uid()));
-- listing_views: პოლიტიკა არ აქვს — მხოლოდ view_listing()-ით

revoke execute on function public.listings_guard() from public, anon, authenticated;
revoke execute on function public.on_listing_change() from public, anon, authenticated;
revoke execute on function public.on_listing_save() from public, anon, authenticated;

-- =====================================================================
--  v8: ქულები და მიღწევები — XP, დონეები, დღიური სერია, „ბროწეული“ (შიდა ვალუტა, ფულით არ იყიდება), ბეჯები
-- =====================================================================
create table if not exists public.progress (
  user_id uuid primary key references public.profiles on delete cascade,
  xp int not null default 0 check (xp >= 0),
  coins int not null default 0 check (coins >= 0),
  streak int not null default 0,
  best_streak int not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);

create table if not exists public.progress_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  xp int not null default 0,
  coins int not null default 0,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists progress_events_user_idx on public.progress_events (user_id, kind, created_at desc);
create index if not exists progress_events_week_idx on public.progress_events (created_at, user_id) where xp > 0;
