-- ეზო — განახლება B: საძიებო სისტემების სია (sitemap.xml)
-- მათთვის, ვისაც სქემა უკვე გაშვებული აქვს: Supabase → SQL Editor → ჩასვი მთლიანად → Run.
-- ახალ პროექტზე ეს საჭირო არ არის — უკვე შედის schema.sql-ში (და 8 ნაწილში). განმეორებით გაშვება უსაფრთხოა.

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
