-- ლოკალური Supabase-ის როლები და საწყისი სქემები (რეალური Auth-ის მიგრაციების და schema.sql-ის წინ)
do $$ begin
  begin create role anon nologin noinherit; exception when duplicate_object then null; end;
  begin create role authenticated nologin noinherit; exception when duplicate_object then null; end;
  begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end;
  begin create role authenticator login noinherit password 'authenticator'; exception when duplicate_object then null; end;
  begin create role supabase_auth_admin login createrole noinherit password 'authadmin'; exception when duplicate_object then null; end;
  begin create role supabase_storage_admin nologin noinherit; exception when duplicate_object then null; end;
  begin create role dashboard_user nologin; exception when duplicate_object then null; end;
  begin create role supabase_admin nologin; exception when duplicate_object then null; end;
end $$;
-- პაროლები მხოლოდ ლოკალური ტესტებისთვისაა
alter role authenticator with login password 'authenticator';
alter role supabase_auth_admin with login password 'authadmin';
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to current_user;
alter role supabase_auth_admin set search_path = auth;
