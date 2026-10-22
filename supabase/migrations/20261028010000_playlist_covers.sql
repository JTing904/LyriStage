-- 歌单自定义封面（2026-10-28）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 自己的歌单可以换成自己的照片（App 先裁成正方形、压缩到约 100 KB 再上传）。
-- 图片放在 Storage 的 playlist-covers 桶（公开读取，共同歌单的朋友也看得到），
-- 路径 <user id>/<歌单 id>-<时间>.webp；每个人只能在自己的资料夹里上传、删除，而且要是成员。
-- 网址存在 playlists.cover_url（原本就有这一栏）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('playlist-covers', 'playlist-covers', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "playlist covers: read own folder" on storage.objects;
drop policy if exists "playlist covers: upload own folder" on storage.objects;
drop policy if exists "playlist covers: delete own folder" on storage.objects;

-- 公开桶用网址读取不需要这条；这条是给"列出自己的旧封面、删掉"用的
create policy "playlist covers: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "playlist covers: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'playlist-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_member()
  );

create policy "playlist covers: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 封面网址只能是 https（共同歌单的朋友会载入这张图）
alter table public.playlists
  add constraint playlists_cover_https check (cover_url is null or cover_url ~ '^https://') not valid;
