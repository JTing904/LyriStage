-- 听歌记录自动整理（2026-10-26）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 每一首播放都是 play_history 的一行（约 1 KB）。免费方案的数据库是 500 MB，
-- 人多了几年后会满，所以每个月自动整理一次：
-- - 最近 13 个月：保留每一笔（这个月 / 今年的听歌报告、年度回顾、每日推荐、排行都用这些）
-- - 更早的：合并成「每月小结」（每首歌每个月一行：听了几次、几秒、跳过几次），
--   加上每个月每个小时听了多久（报告的"最常在几点听歌"），然后删掉原本的每一笔。
--   一首歌一个月听 30 次，原本 30 行，合并后 1 行。
-- 唯一少掉的是一年多以前每次播放的精确时间（只剩月份），App 里没有地方用到。

-- ============================================================================
-- 1. 每月小结
-- ============================================================================

create table public.play_history_monthly (
  user_id          uuid   not null references auth.users on delete cascade,
  month            date   not null, -- 那个月的 1 号
  source           text   not null default 'netease',
  track_id         text   not null,
  track            jsonb  not null,  -- 那个月最后一次播放时的歌曲资料
  plays            integer not null default 0, -- 不算跳过的
  skips            integer not null default 0,
  listened_seconds bigint  not null default 0,
  primary key (user_id, month, source, track_id)
);

create table public.play_hours_monthly (
  user_id uuid     not null references auth.users on delete cascade,
  month   date     not null,
  hour    smallint not null check (hour between 0 and 23), -- 马来西亚时间（UTC+8）
  seconds bigint   not null default 0,
  primary key (user_id, month, hour)
);

grant select, delete on public.play_history_monthly, public.play_hours_monthly to authenticated;
alter table public.play_history_monthly enable row level security;
alter table public.play_hours_monthly   enable row level security;

-- 只看得到、删得了自己的（「清除听歌记录」要连小结一起删）
create policy "own monthly" on public.play_history_monthly
  for select to authenticated using (user_id = (select auth.uid()));
create policy "delete own monthly" on public.play_history_monthly
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "own hours" on public.play_hours_monthly
  for select to authenticated using (user_id = (select auth.uid()));
create policy "delete own hours" on public.play_hours_monthly
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- 2. 整理（排程每个月叫一次；回传整理了几笔）
-- ============================================================================

create function public.compact_play_history(keep interval default interval '13 months')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := date_trunc('month', now() - keep);
  moved bigint;
begin
  with old as (
    delete from public.play_history where played_at < cutoff returning *
  ),
  tracks as (
    insert into public.play_history_monthly as m
      (user_id, month, source, track_id, track, plays, skips, listened_seconds)
    select user_id,
           date_trunc('month', played_at at time zone 'Asia/Kuala_Lumpur')::date,
           source,
           track_id,
           (array_agg(track order by played_at desc))[1],
           count(*) filter (where not skipped),
           count(*) filter (where skipped),
           sum(listened_seconds)
    from old
    group by 1, 2, 3, 4
    on conflict (user_id, month, source, track_id) do update
      set plays = m.plays + excluded.plays,
          skips = m.skips + excluded.skips,
          listened_seconds = m.listened_seconds + excluded.listened_seconds,
          track = excluded.track
  ),
  hours as (
    insert into public.play_hours_monthly as h (user_id, month, hour, seconds)
    select user_id,
           date_trunc('month', played_at at time zone 'Asia/Kuala_Lumpur')::date,
           extract(hour from played_at at time zone 'Asia/Kuala_Lumpur')::smallint,
           sum(listened_seconds)
    from old
    group by 1, 2, 3
    on conflict (user_id, month, hour) do update
      set seconds = h.seconds + excluded.seconds
  )
  select count(*) into moved from old;
  return moved;
end;
$$;
-- 只有排程（数据库管理员）能叫，App 里的人叫不了
revoke execute on function public.compact_play_history(interval) from public, anon, authenticated;

-- ============================================================================
-- 3. 「所有时间」的听歌排行要把小结也算进去
-- ============================================================================

create or replace function public.play_ranking(since timestamptz default null, max_rows integer default 100)
returns table (source text, track_id text, track jsonb, play_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.source,
         r.track_id,
         (array_agg(r.track order by r.at desc))[1] as track,
         sum(r.plays)::bigint as play_count
  from (
    select h.source, h.track_id, h.track, h.played_at as at, 1 as plays
    from public.play_history h
    where h.user_id = (select auth.uid())
      and not h.skipped
      and (since is null or h.played_at >= since)
    union all
    select m.source, m.track_id, m.track, m.month::timestamptz as at, m.plays
    from public.play_history_monthly m
    where m.user_id = (select auth.uid())
      and m.plays > 0
      and (since is null or m.month >= since)
  ) r
  group by r.source, r.track_id
  order by sum(r.plays) desc, max(r.at) desc
  limit max_rows;
$$;

-- ============================================================================
-- 4. 排程：每个月 1 号 UTC 19:00（= 马来西亚时间 2 号凌晨 3 点，没什么人在听）
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule(
  'compact-play-history',
  '0 19 1 * *',
  $$select public.compact_play_history()$$
);
