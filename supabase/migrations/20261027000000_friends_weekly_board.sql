-- 好友周榜（2026-10-27）
-- 在 Supabase → SQL Editor 整份执行一次（接在 20261026010000_slim_play_history.sql 后面）。
--
-- 每周比一比：我和好友这一周（马来西亚时间星期一 00:00 起）听了多久、听了几首、
-- 最常听的歌手和歌。听歌记录只有自己读得到，所以用一个函数只算出这几个数字给好友看，
-- 不会露出每一笔记录。
-- 好友关掉「让好友看到我在听什么」就不出现在别人的榜上（自己的榜上一定有自己）。

create function public.friends_weekly_board(weeks_ago integer default 0)
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  is_me        boolean,
  minutes      integer,
  plays        integer,
  top_artist   text,
  top_track    jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
    where (select public.is_member())
  ),
  week as (
    select start_at, start_at + interval '7 days' as end_at
    from (
      select (date_trunc('week', now() at time zone 'Asia/Kuala_Lumpur')
              - make_interval(weeks => greatest(weeks_ago, 0))) at time zone 'Asia/Kuala_Lumpur' as start_at
    ) w
  ),
  people as (
    select uid from me
    union
    select case when f.requester = me.uid then f.addressee else f.requester end
    from public.friendships f, me
    where f.status = 'accepted' and me.uid in (f.requester, f.addressee)
  ),
  visible as (
    select p.uid
    from people p
    left join public.member_profiles m on m.user_id = p.uid
    where p.uid = (select uid from me) or coalesce(m.share_listening, true)
  ),
  week_plays as (
    select pl.user_id, pl.source, pl.track_id, pl.listened_seconds, pl.skipped, t.track
    from public.plays pl
    join visible v on v.uid = pl.user_id
    cross join week w
    left join public.tracks t on t.source = pl.source and t.track_id = pl.track_id
    where pl.played_at >= w.start_at and pl.played_at < w.end_at
  ),
  totals as (
    select user_id,
           sum(listened_seconds) as seconds,
           count(*) filter (where not skipped) as plays
    from week_plays
    group by user_id
  ),
  top_artists as (
    select distinct on (user_id) user_id, artist
    from (
      select user_id, track -> 'ar' -> 0 ->> 'name' as artist, count(*) as n
      from week_plays
      where not skipped and track is not null
      group by user_id, artist
    ) a
    where artist is not null
    order by user_id, n desc, artist
  ),
  top_tracks as (
    select distinct on (user_id) user_id, track
    from (
      select user_id, track_id, (array_agg(track))[1] as track, count(*) as n
      from week_plays
      where not skipped and track is not null
      group by user_id, track_id
    ) t
    order by user_id, n desc, track_id
  )
  select v.uid,
         m.display_name,
         m.avatar_url,
         v.uid = (select uid from me),
         coalesce(round(t.seconds / 60.0), 0)::integer,
         coalesce(t.plays, 0)::integer,
         a.artist,
         tt.track
  from visible v
  left join public.member_profiles m on m.user_id = v.uid
  left join totals t on t.user_id = v.uid
  left join top_artists a on a.user_id = v.uid
  left join top_tracks tt on tt.user_id = v.uid
  order by coalesce(t.seconds, 0) desc, m.display_name;
$$;

revoke execute on function public.friends_weekly_board(integer) from public, anon;
grant execute on function public.friends_weekly_board(integer) to authenticated;
