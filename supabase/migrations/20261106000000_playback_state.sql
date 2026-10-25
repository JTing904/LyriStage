-- 换设备接着听（2026-11-06）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 每个账号只存一笔「现在播到哪」：哪首歌、播到第几秒、在哪台设备。
-- 播放时每 30 秒、暂停、换歌时更新同一笔（upsert），不会越存越多。
-- 打开另一台设备时读这笔：是别的设备、而且是最近的，就问要不要接着听。
-- 删除账号时跟着删（references auth.users on delete cascade）。

create table if not exists public.playback_state (
  user_id     uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  -- 歌曲资料的快照（跟 play_history 的 track 一样）
  track       jsonb       not null check (track ? 'id' and track ? 'name' and octet_length(track::text) <= 1500),
  position    real        not null default 0 check (position >= 0),
  -- 每台设备第一次打开时自己产生的代号，用来分辨「是不是别的设备」
  device_id   text        not null check (char_length(device_id) <= 64),
  -- 显示用：手机 / 电脑 / 网页
  device_name text        not null default '' check (char_length(device_name) <= 20),
  updated_at  timestamptz not null default now()
);
alter table public.playback_state enable row level security;
revoke all on public.playback_state from anon, authenticated;
grant select, insert, update, delete on public.playback_state to authenticated;

drop policy if exists "own playback state" on public.playback_state;
create policy "own playback state" on public.playback_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "members only" on public.playback_state;
create policy "members only" on public.playback_state
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
