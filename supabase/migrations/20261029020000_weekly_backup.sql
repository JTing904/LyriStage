-- 每周自动备份（2026-10-29）
-- 在 Supabase → SQL Editor 整份执行一次（要先设好 20261028020000_archive_old_history.sql 的 Edge Function 和密码）。
-- 执行完还要把 supabase/functions/archive-history/index.ts 的新版本贴到 Edge Function 重新部署。
--
-- Supabase 免费方案没有自动备份。每个星期一凌晨 3 点（马来西亚时间）自动把重要的资料
-- （成员、好友、我喜欢、歌单、听歌记录……，加上账号的邮箱和注册时间）压缩成一个文件，
-- 放进 File storage 的 backups 桶，留最近 8 份（两个月）。
-- 桶是私人的：App 里谁都读不到，只有你在 Supabase 后台 Storage 里看得到、下载得到。
-- 每日推荐、一起听的房间、正在听、错误回报这些会自己重新产生，不备份。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/gzip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 每个星期日 UTC 19:00（= 马来西亚时间星期一凌晨 3 点）
select cron.schedule(
  'weekly-backup',
  '0 19 * * 0',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'archive_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-archive-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'archive_secret')
    ),
    body := '{"task": "backup"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
