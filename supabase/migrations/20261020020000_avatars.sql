-- 自定义头像：Supabase Storage 的 avatars 桶（公开读取，头像网址直接给 <img> 用）。
-- 每个人只能在自己的资料夹（<user id>/…）里上传、替换、删除，而且要是成员。
-- 名字不用表：存在账号的 user_metadata.custom_name（第三方登录不会覆盖这个键）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: read own folder" on storage.objects;
drop policy if exists "avatars: upload own folder" on storage.objects;
drop policy if exists "avatars: update own folder" on storage.objects;
drop policy if exists "avatars: delete own folder" on storage.objects;

-- 公开桶用网址读取不需要这条；这条是给"列出自己的旧头像、删掉"用的
create policy "avatars: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_member()
  );

create policy "avatars: update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
