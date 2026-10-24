-- 解灰：每首歌在 B 站挑好的视频（大家共用）
--
-- 网易云完全没有的歌（例如周杰伦）要去 B 站搜。搜索是 B 站最容易限制的接口，
-- 短时间搜太多次就要人机验证。挑好的视频记在这里，同一首歌全部会员只要搜一次。
--
-- 只存视频编号（bvid），不存播放链接（链接 2 小时就过期）。
-- 服务器拿到编号后会重新检查标题和时长（server/lib/bilibili.js），就算有人存了不对的编号也不会播错歌。

create table public.bilibili_picks (
  song_id bigint primary key,
  bvid text not null check (bvid ~ '^BV[0-9A-Za-z]{10}$'),
  updated_at timestamptz not null default now()
);

alter table public.bilibili_picks enable row level security;

-- 成员才能看、才能写（没有删除：挑错了会被下一次的结果覆盖）
create policy "members read picks" on public.bilibili_picks
  for select to authenticated
  using ((select public.is_member()));

create policy "members add picks" on public.bilibili_picks
  for insert to authenticated
  with check ((select public.is_member()));

create policy "members update picks" on public.bilibili_picks
  for update to authenticated
  using ((select public.is_member()))
  with check ((select public.is_member()));
