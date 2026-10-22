-- 歌词舞台自定义背景（2026-10-29）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 用自己的照片代替封面当歌词舞台的背景：
-- - 全部歌（track_key = '*'）：一张照片用在所有歌，enabled 关掉就换回封面（照片留着下次用）
-- - 只这首（track_key = 'netease:<歌曲 id>'）：这首歌专属，比全部歌的优先
-- 照片放在 Storage 的 stage-backgrounds 桶（私人：只有自己读得到），路径 <user id>/<…>.webp；
-- 这张表记哪首歌用哪张，电脑和手机同步。每人最多 200 张。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stage-backgrounds', 'stage-backgrounds', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "stage backgrounds: read own folder" on storage.objects;
drop policy if exists "stage backgrounds: upload own folder" on storage.objects;
drop policy if exists "stage backgrounds: delete own folder" on storage.objects;

create policy "stage backgrounds: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'stage-backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "stage backgrounds: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stage-backgrounds'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_member()
  );

create policy "stage backgrounds: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stage-backgrounds' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.stage_backgrounds (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  track_key  text        not null check (track_key = '*' or track_key ~ '^[a-z]+:[0-9A-Za-z_-]{1,64}$'),
  path       text        not null check (char_length(path) <= 200),
  enabled    boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_key)
);

grant select, insert, update, delete on public.stage_backgrounds to authenticated;
alter table public.stage_backgrounds enable row level security;

create policy "own stage backgrounds" on public.stage_backgrounds
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_member()));

-- 每人最多 200 张（一张约 300 KB，200 张约 60 MB）
create function public.stage_backgrounds_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.stage_backgrounds where user_id = new.user_id) >= 200 then
    raise exception '背景照片最多 200 张' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stage_backgrounds_limit
  before insert on public.stage_backgrounds
  for each row execute function public.stage_backgrounds_limit();
