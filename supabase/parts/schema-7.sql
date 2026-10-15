-- ეზო — სქემის ნაწილი 7/8. გაუშვი 6-ის შემდეგ. (მთლიანი ფაილი: supabase/schema.sql)

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

-- ---------------------------------------------------------------------
-- საძიებო სისტემები: sitemap.xml-ის სია (api/sitemap.js). მხოლოდ საჯარო:
-- ღია პროფილები, აქტიური განცხადებები და მომავალი ღია შეხვედრები.
-- ---------------------------------------------------------------------
create or replace function public.sitemap_entries()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'u', coalesce((select jsonb_agg(a.username) from (
           select p.username from profiles p
            where p.onboarded and not p.is_private and p.username is not null
              and (p.banned_until is null or p.banned_until < now())
            order by p.followers_count desc, p.created_at desc limit 5000) a), '[]'),
    'm', coalesce((select jsonb_agg(jsonb_build_array(b.id, b.changed)) from (
           select l.id, greatest(l.updated_at, coalesce(l.bumped_at, l.updated_at)) changed
             from listings l join profiles s on s.id = l.seller_id
            where l.status = 'active' and not l.hidden and (s.banned_until is null or s.banned_until < now())
            order by coalesce(l.bumped_at, l.created_at) desc limit 3000) b), '[]'),
    'e', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.created_at)) from (
           select e.id, e.created_at from events e left join groups g on g.id = e.group_id
            where coalesce(e.ends_at, e.starts_at) > now() and (e.group_id is null or g.privacy = 'public')
            order by e.starts_at limit 1000) c), '[]'));
$$;
grant execute on function public.sitemap_entries() to anon, authenticated;

-- =====================================================================
-- ეტაპი C: ვის გამოიწერო, მიმაგრებული პოსტი, მონახაზები, დადასტურებული ნიშანი, ქართული ძებნა
-- =====================================================================
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists pinned_post_id uuid references public.posts on delete set null;

-- მომხმარებელი პირდაპირ ვერ შეცვლის: მთვლელებს, როლს, შეზღუდვას, მომწვევს, ნიშანს და მიმაგრებულ პოსტს
-- (ამათ მხოლოდ შესაბამისი ფუნქციები ცვლიან)
create or replace function public.protect_profile_counters()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.posts_count := old.posts_count;
    new.role := old.role;
    new.banned_until := old.banned_until;
    new.ban_reason := old.ban_reason;
    new.invited_by := old.invited_by;
    new.verified := old.verified;
    new.pinned_post_id := old.pinned_post_id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_counters();

-- ---- დადასტურებული ნიშანი: მხოლოდ ადმინი ანიჭებს
create or replace function public.admin_set_verified(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'forbidden'; end if;
  update profiles set verified = coalesce(p_on, false) where id = p_user;
end $$;

-- ---- მიმაგრებული პოსტი: საკუთარი, მთავარი (არა პასუხი), ჯგუფის გარეთ. p_post = null — მოხსნა
create or replace function public.pin_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_post is not null and not exists (
    select 1 from posts where id = p_post and author_id = auth.uid() and parent_id is null and group_id is null and not hidden
  ) then raise exception 'ამ პოსტს პროფილზე ვერ მიამაგრებ'; end if;
  update profiles set pinned_post_id = p_post where id = auth.uid();
end $$;

-- ---- მონახაზები: ტექსტი და გამოკითხვა, ყველა მოწყობილობაზე. მაქსიმუმ 50
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  poll jsonb,
  group_id uuid references public.groups on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_user_idx on public.drafts (user_id, updated_at desc);
alter table public.drafts enable row level security;
drop policy if exists "own drafts" on public.drafts;
create policy "own drafts" on public.drafts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.drafts to authenticated;

create or replace function public.drafts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (select count(*) from drafts where user_id = new.user_id) >= 50 then
    raise exception 'მონახაზი მაქსიმუმ 50 შეიძლება — ძველები წაშალე';
  end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists drafts_guard on public.drafts;
create trigger drafts_guard before insert or update on public.drafts
  for each row execute function public.drafts_guard();

-- ---- ვის გამოიწერო: მიზეზით (გამოგიწერა, კლასელი, საერთო მეგობრები, სკოლა, ქალაქი…). „არ მაინტერესებს“ ინახება
create table if not exists public.suggestion_dismissals (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  dismissed_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dismissed_id)
);
alter table public.suggestion_dismissals enable row level security;
drop policy if exists "own dismissals" on public.suggestion_dismissals;
create policy "own dismissals" on public.suggestion_dismissals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.suggestion_dismissals to authenticated;

create or replace function public.dismiss_suggestion(p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into suggestion_dismissals (user_id, dismissed_id) select auth.uid(), p_user where auth.uid() is not null
  on conflict do nothing;
$$;

create or replace function public.who_to_follow(p_limit int default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  fof as (
    select f2.following_id as id, count(*) as n, min(f1.following_id::text)::uuid as via
      from follows f1 join follows f2 on f2.follower_id = f1.following_id
     where f1.follower_id = auth.uid()
     group by f2.following_id
  ),
  cand as (
    select p.*, coalesce(fof.n, 0) as mutual, fof.via,
      exists (select 1 from follows x where x.follower_id = p.id and x.following_id = me.id) as follows_me,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school)) as same_school,
      (coalesce(me.school, '') <> '' and lower(p.school) = lower(me.school) and p.grad_year = me.grad_year) as classmate,
      (coalesce(me.city, '') <> '' and lower(p.city) = lower(me.city)) as same_city,
      (p.id = me.invited_by or p.invited_by = me.id) as invite
    from profiles p cross join me left join fof on fof.id = p.id
    where p.id <> me.id and p.onboarded and (p.banned_until is null or p.banned_until < now())
      and not exists (select 1 from follows f where f.follower_id = me.id and f.following_id = p.id)
      and not exists (select 1 from follow_requests r where r.requester_id = me.id and r.target_id = p.id)
      and not exists (select 1 from suggestion_dismissals d where d.user_id = me.id and d.dismissed_id = p.id)
      and not public.is_blocked(me.id, p.id)
  ),
  ranked as (
    select c.*,
      (case when c.follows_me then 100 else 0 end) + (case when c.invite then 60 else 0 end)
      + (case when c.classmate then 40 when c.same_school then 25 else 0 end)
      + least(c.mutual, 10) * 8 + (case when c.same_city then 8 else 0 end)
      + ln(1 + c.followers_count) + (case when c.created_at > now() - interval '14 days' then 3 else 0 end) as score
    from cand c
    order by score desc, c.followers_count desc
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'username', r.username, 'full_name', r.full_name, 'avatar_url', r.avatar_url, 'last_seen', r.last_seen,
      'verified', r.verified, 'city', r.city, 'school', r.school, 'grad_year', r.grad_year, 'followers_count', r.followers_count,
      'reason', case when r.follows_me then 'follows_you' when r.invite then 'invite' when r.classmate then 'classmate'
                     when r.mutual > 0 then 'mutual' when r.same_school then 'school' when r.same_city then 'city'
                     when r.created_at > now() - interval '14 days' then 'new' else 'popular' end,
      'mutual', r.mutual,
      'via', (select coalesce(nullif(v.full_name, ''), v.username) from profiles v where v.id = r.via))
    order by r.score desc, r.followers_count desc), '[]'::jsonb)
  from ranked r;
$$;

-- ---- ქართული ძებნა: „გიორგი“ = „giorgi“, „beridze“ = „ბერიძე“, „ჭავჭავაძე“ = „chavchavadze“, უმნიშვნელო შეცდომებიც
-- ორივე დამწერლობა ერთ ფორმაზე მიდის; მსგავსი ბგერები ერთდება (თ/ტ, კ/ქ/ყ, პ/ფ, ჩ/ჭ, ც/წ).
-- იგივე წესი აპშია: src/lib/translit.js (ტესტები ამოწმებს, რომ ერთნაირად მუშაობს)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create or replace function public.ka_skeleton(p text)
returns text language sql immutable parallel safe as $$
  select translate(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(coalesce(p, '')),
      'ch''', 'č'), 'chh', 'č'), 'ch', 'č'), 'sh', 'š'), 'zh', 'ž'), 'kh', 'x'), 'gh', 'ğ'), 'dz', 'đ'),
      'ts''', 'c'), 'tz', 'c'), 'ts', 'c'), 'th', 't'), 'ph', 'p'), '''', ''),
    'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰqywf',
    'abgdevztiklmnopžrstupkğkščcđcčxjhkkcp');
$$;

-- ინდექსები (pg_trgm-ის სქემა შეიძლება განსხვავდებოდეს — ვპოულობთ)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists profiles_search_trgm on public.profiles using gin (public.ka_skeleton(coalesce(full_name, '''') || '' '' || coalesce(username, '''')) %I.gin_trgm_ops)', s);
  execute format('create index if not exists posts_search_trgm on public.posts using gin (public.ka_skeleton(body) %I.gin_trgm_ops) where parent_id is null', s);
  execute format('create index if not exists groups_search_trgm on public.groups using gin (public.ka_skeleton(name) %I.gin_trgm_ops)', s);
  execute format('create index if not exists listings_search_trgm on public.listings using gin (public.ka_skeleton(title) %I.gin_trgm_ops)', s);
end $$;
