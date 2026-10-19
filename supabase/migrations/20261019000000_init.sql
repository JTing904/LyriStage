-- LyriStage 用户数据（不依赖网易云账号）
--
-- 约定：
--   source   音源，目前只有 'netease'，以后接 YouTube Music 等再加
--   track_id 音源里的歌曲 ID（统一存成 text，不同音源的 ID 格式不一样）
--   track    歌曲快照，沿用网易云的字段名 {id, name, alia, ar[], al{}, dt, fee, mv}
--            这样现有的列表组件可以直接渲染，不用每次再请求网易云
--
-- 所有表都开启 RLS（行级权限）：每个用户只能读写自己的数据。

-- 我喜欢的音乐 ---------------------------------------------------------------
create table public.liked_tracks (
  user_id  uuid        not null default auth.uid() references auth.users on delete cascade,
  source   text        not null default 'netease',
  track_id text        not null,
  track    jsonb       not null,
  liked_at timestamptz not null default now(),
  primary key (user_id, source, track_id)
);
create index liked_tracks_user_liked_at on public.liked_tracks (user_id, liked_at desc);

-- 自己的歌单 -----------------------------------------------------------------
create table public.playlists (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  name        text        not null check (char_length(name) between 1 and 100),
  description text,
  cover_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index playlists_user on public.playlists (user_id, created_at desc);

create table public.playlist_tracks (
  playlist_id uuid             not null references public.playlists on delete cascade,
  source      text             not null default 'netease',
  track_id    text             not null,
  track       jsonb            not null,
  -- 用小数排序：拖动排序时只要取前后两首的中间值，不用改整张表
  position    double precision not null,
  added_at    timestamptz      not null default now(),
  primary key (playlist_id, source, track_id)
);
create index playlist_tracks_order on public.playlist_tracks (playlist_id, position);

-- 听歌记录：每播放一次记一行，推荐算法的主要输入 -----------------------------------
create table public.play_history (
  id               bigint      generated always as identity primary key,
  user_id          uuid        not null default auth.uid() references auth.users on delete cascade,
  source           text        not null default 'netease',
  track_id         text        not null,
  track            jsonb       not null,
  played_at        timestamptz not null default now(),
  listened_seconds integer     not null check (listened_seconds >= 0),
  duration_seconds integer     check (duration_seconds >= 0),
  -- 听了不到 30 秒且不到一半就切走，算跳过
  skipped          boolean     not null default false,
  -- 从哪里播放的：'fm' / 'daily' / 'playlist:<id>' / 'album:<id>' …
  context          text
);
create index play_history_user_played_at on public.play_history (user_id, played_at desc);

-- 不喜欢（私人 FM 的"垃圾桶"），推荐时排除 ---------------------------------------
create table public.disliked_tracks (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  source     text        not null default 'netease',
  track_id   text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, source, track_id)
);

-- 每日推荐缓存：同一天打开多次结果不变 ---------------------------------------------
create table public.daily_recommendations (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  day        date        not null, -- 用户本地日期
  tracks     jsonb       not null, -- 歌曲快照数组
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- RLS -------------------------------------------------------------------------
alter table public.liked_tracks          enable row level security;
alter table public.playlists             enable row level security;
alter table public.playlist_tracks       enable row level security;
alter table public.play_history          enable row level security;
alter table public.disliked_tracks       enable row level security;
alter table public.daily_recommendations enable row level security;

-- (select auth.uid()) 写成子查询，Postgres 每条语句只算一次，比每行都调用快
create policy "own rows" on public.liked_tracks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.playlists
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own playlists" on public.playlist_tracks
  for all to authenticated
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.playlists p
    where p.id = playlist_id and p.user_id = (select auth.uid())
  ));

-- 听歌记录只允许新增和读取，不允许改写历史
create policy "read own" on public.play_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own" on public.play_history
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "delete own" on public.play_history
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "own rows" on public.disliked_tracks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.daily_recommendations
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 歌单更新时间 -------------------------------------------------------------------
create function public.touch_playlist()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.playlists set updated_at = now()
  where id = coalesce(new.playlist_id, old.playlist_id);
  return null;
end;
$$;

create trigger playlist_tracks_touch
  after insert or update or delete on public.playlist_tracks
  for each row execute function public.touch_playlist();

-- 听歌排行（对应网易云的"最近一周 / 所有时间"）-----------------------------------
-- security invoker：用调用者的权限执行，RLS 照样生效
create function public.play_ranking(since timestamptz default null, max_rows integer default 100)
returns table (source text, track_id text, track jsonb, play_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.source,
         h.track_id,
         (array_agg(h.track order by h.played_at desc))[1] as track,
         count(*) as play_count
  from public.play_history h
  where h.user_id = (select auth.uid())
    and not h.skipped
    and (since is null or h.played_at >= since)
  group by h.source, h.track_id
  order by count(*) desc, max(h.played_at) desc
  limit max_rows;
$$;
