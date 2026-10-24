-- 旧记录搬家：密码检查改用指纹（2026-10-28）
-- 在 Supabase → SQL Editor 整份执行一次（接在 20261028020000_archive_old_history.sql 后面）。
--
-- 原本 archive_secret_ok 在函数里读 Vault 解密后的密码来比对，但 Edge Function 叫它时读不到
-- （SQL Editor 里读得到），所以对的密码也被当成错的。
-- 改成：执行这份 SQL 时算好密码的 SHA-256 指纹，存进一张谁都读不到的表；检查时只比对指纹，不再碰 Vault。
-- 排程照样从 Vault 拿密码送出去（那一段本来就正常）。

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.archive_secret (
  id   integer primary key default 1 check (id = 1),
  hash text not null
);
revoke all on private.archive_secret from public, anon, authenticated;

insert into private.archive_secret (hash)
select encode(extensions.digest(s.decrypted_secret, 'sha256'), 'hex')
from vault.decrypted_secrets s
where s.name = 'archive_secret'
on conflict (id) do update set hash = excluded.hash;

create or replace function public.archive_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select length(secret) >= 32 and exists (
    select 1 from private.archive_secret a
    where a.hash = encode(extensions.digest(secret, 'sha256'), 'hex')
  );
$$;
revoke execute on function public.archive_secret_ok(text) from public, anon, authenticated;
grant execute on function public.archive_secret_ok(text) to service_role;

-- 应该是 1（指纹存好了）
select count(*) as fingerprint_saved from private.archive_secret;
