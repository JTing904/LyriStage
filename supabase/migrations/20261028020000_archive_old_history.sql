-- 旧听歌记录自动搬去 File storage（2026-10-28）
-- 在 Supabase → SQL Editor 整份执行一次（要先执行过 20261026000000_history_compaction.sql）。
-- 执行完还要：部署 supabase/functions/archive-history（Edge Function），再执行最下面那一行登记它的网址。
--
-- 每个月 3 号（马来西亚时间凌晨 4 点，每月整理的隔天）自动：
-- - 两年以前的每月小结（play_history_monthly、play_hours_monthly）按「每个人每一年」压缩成一个文件，
--   放进 File storage 的 history-archive 桶（私人：只有自己读得到），路径 <user id>/<年>.json.gz
-- - 确认文件存好了，才从数据库删掉那些小结
-- - 每首歌的播放次数加进 play_archive_totals（每人每首歌一行），「所有时间」的听歌排行照样算得到
-- 做事的是 Edge Function（数据库自己不能写文件）；这份 SQL 准备好它要用的表、桶、函数和排程。

-- ============================================================================
-- 1. 搬走的歌的累计次数（「所有时间」排行用）
-- ============================================================================

create table public.play_archive_totals (
  user_id          uuid    not null references auth.users on delete cascade,
  source           text    not null default 'netease',
  track_id         text    not null,
  track            jsonb   not null,
  plays            bigint  not null default 0,
  skips            bigint  not null default 0,
  listened_seconds bigint  not null default 0,
  primary key (user_id, source, track_id)
);

grant select, delete on public.play_archive_totals to authenticated;
alter table public.play_archive_totals enable row level security;
-- 只看得到、删得了自己的（「清除听歌记录」要一起删）
create policy "own archive totals" on public.play_archive_totals
  for select to authenticated using (user_id = (select auth.uid()));
create policy "delete own archive totals" on public.play_archive_totals
  for delete to authenticated using (user_id = (select auth.uid()));

-- 「所有时间」的听歌排行：再加上搬走的
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
    union all
    select a.source, a.track_id, a.track, '1970-01-01'::timestamptz as at, a.plays
    from public.play_archive_totals a
    where a.user_id = (select auth.uid())
      and a.plays > 0
      and since is null
  ) r
  group by r.source, r.track_id
  order by sum(r.plays) desc, max(r.at) desc
  limit max_rows;
$$;

-- ============================================================================
-- 2. 放文件的桶（私人）
-- ============================================================================
-- 只有 Edge Function（service role）能写；自己能读（导出资料）、能删（清除记录、删账号）

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('history-archive', 'history-archive', false, 20971520, array['application/gzip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "history archive: read own folder" on storage.objects;
drop policy if exists "history archive: delete own folder" on storage.objects;

create policy "history archive: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'history-archive' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "history archive: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'history-archive' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ============================================================================
-- 3. Edge Function 用的函数（只有 service role 能叫）
-- ============================================================================

/** 要搬的：每个人每一年，到哪一天以前（不含）、各几行 */
create function public.archive_candidates(keep_months integer default 24)
returns table (user_id uuid, year integer, until date, months bigint, hours bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with cutoff as (
    select (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur')
            - make_interval(months => keep_months))::date as d
  ),
  m as (
    select pm.user_id, extract(year from pm.month)::integer as year, count(*) as n
    from public.play_history_monthly pm, cutoff
    where pm.month < cutoff.d
    group by 1, 2
  ),
  h as (
    select ph.user_id, extract(year from ph.month)::integer as year, count(*) as n
    from public.play_hours_monthly ph, cutoff
    where ph.month < cutoff.d
    group by 1, 2
  )
  select coalesce(m.user_id, h.user_id),
         coalesce(m.year, h.year),
         least(make_date(coalesce(m.year, h.year) + 1, 1, 1), (select d from cutoff)),
         coalesce(m.n, 0),
         coalesce(h.n, 0)
  from m full join h on h.user_id = m.user_id and h.year = m.year
  order by 1, 2;
$$;

/**
 * 文件存好了以后：把那些小结加进累计次数、从数据库删掉。
 * 删掉的行数要和存进文件的一样，不一样就整个取消（数据库不动，下个月再试）
 */
create function public.finish_archive(
  uid uuid, year integer, until date, expected_months bigint, expected_hours bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_at date := make_date(year, 1, 1);
  moved_months bigint;
  moved_hours bigint;
begin
  with moved as (
    delete from public.play_history_monthly pm
    where pm.user_id = uid and pm.month >= start_at and pm.month < until
    returning *
  ),
  totals as (
    insert into public.play_archive_totals as t
      (user_id, source, track_id, track, plays, skips, listened_seconds)
    select uid, source, track_id, (array_agg(track order by month desc))[1],
           sum(plays), sum(skips), sum(listened_seconds)
    from moved
    group by source, track_id
    on conflict (user_id, source, track_id) do update
      set plays = t.plays + excluded.plays,
          skips = t.skips + excluded.skips,
          listened_seconds = t.listened_seconds + excluded.listened_seconds,
          track = excluded.track
  )
  select count(*) into moved_months from moved;

  delete from public.play_hours_monthly ph
  where ph.user_id = uid and ph.month >= start_at and ph.month < until;
  get diagnostics moved_hours = row_count;

  if moved_months <> expected_months or moved_hours <> expected_hours then
    raise exception '行数不对，已取消：小结 % → %，时段 % → %',
      expected_months, moved_months, expected_hours, moved_hours;
  end if;
  return moved_months + moved_hours;
end;
$$;

revoke execute on function public.archive_candidates(integer) from public, anon, authenticated;
revoke execute on function public.finish_archive(uuid, integer, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.archive_candidates(integer) to service_role;
grant execute on function public.finish_archive(uuid, integer, date, bigint, bigint) to service_role;

-- -- 4. 排程 --------------------------------------------------------------------
-- 排程用一组密码叫 Edge Function，防止别人乱叫：密码自动产生、存在 Vault（不会出现在任何文件里）

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'archive_secret', '旧听歌记录搬家：排程叫 Edge Function 用的密码')
where not exists (select 1 from vault.secrets where name = 'archive_secret');

/** Edge Function 用来确认是排程叫的 */
create function public.archive_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'archive_secret' and s.decrypted_secret = secret and length(secret) >= 32
  );
$$;
revoke execute on function public.archive_secret_ok(text) from public, anon, authenticated;
grant execute on function public.archive_secret_ok(text) to service_role;

create extension if not exists pg_net with schema extensions;

-- 每个月 2 号 UTC 20:00（= 马来西亚时间 3 号凌晨 4 点，在每月整理的隔天）
select cron.schedule(
  'archive-old-history',
  '0 20 2 * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'archive_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-archive-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'archive_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- 部署好 Edge Function 以后，把下面这行的 <project ref> 换成你的项目代号（Supabase 网址里那串）再执行一次：
-- select vault.create_secret('https://<project ref>.supabase.co/functions/v1/archive-history', 'archive_function_url');
