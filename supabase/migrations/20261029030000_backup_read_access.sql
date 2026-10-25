-- 每周备份：让 Edge Function 读得到要备份的表（2026-10-29）
-- 在 Supabase → SQL Editor 整份执行一次（接在 20261029020000_weekly_backup.sql 后面）。
--
-- Edge Function 用 service_role 读资料。有几张表（例如 members）当初为了安全收回了所有人的权限、
-- 只开放给需要的身份，service_role 不在里面，备份时就读不到（permission denied）。
-- 这里只给「读」，而且只给要备份的表。

do $$
declare
  t text;
begin
  foreach t in array array[
    'members', 'invite_codes', 'member_profiles', 'friendships',
    'liked_tracks', 'disliked_tracks', 'playlists', 'playlist_tracks', 'playlist_editors',
    'tracks', 'plays', 'play_history_monthly', 'play_hours_monthly', 'play_archive_totals',
    'bilibili_picks'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to service_role', t);
    end if;
  end loop;
end;
$$;
