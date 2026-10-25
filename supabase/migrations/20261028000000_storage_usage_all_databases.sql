-- 存储空间和 Supabase 后台一致（2026-10-28）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- Supabase 后台的 "Database size" 是所有数据库加起来：放资料的 postgres，
-- 加上 Postgres 自带、大小固定的 template0、template1（各约 7 MB）。
-- 原本设置页只算 postgres，所以比后台少约 15 MB。另外多回传 File storage 用了多少（头像、歌单封面、旧听歌记录）。

create or replace function public.admin_storage_usage()
returns table (name text, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员能看' using errcode = '42501';
  end if;
  return query
    select 'database'::text, (select sum(pg_database_size(d.oid))::bigint from pg_catalog.pg_database d)
    union all
    select 'files'::text, coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o), 0)::bigint
    union all
    (select c.relname::text, pg_total_relation_size(c.oid)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 2 desc limit 8);
end;
$$;
