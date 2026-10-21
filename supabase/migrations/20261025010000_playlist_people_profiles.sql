-- 共同歌单：同一张歌单的人看得到彼此的名字和头像（还不是好友也可以）
-- 接在 20261025000000_friends_and_shared_playlists.sql 后面执行

/** 我和这个人在同一张共同歌单里（我或他是主人、或都是加入的人） */
create function public.shares_playlist_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select id from public.playlists where user_id = (select auth.uid())
    union
    select playlist_id from public.playlist_editors where user_id = (select auth.uid())
  )
  select exists (
    select 1 from public.playlists p join mine on mine.id = p.id where p.user_id = other
    union all
    select 1 from public.playlist_editors e join mine on mine.id = e.playlist_id where e.user_id = other
  );
$$;
revoke execute on function public.shares_playlist_with(uuid) from public, anon;
grant execute on function public.shares_playlist_with(uuid) to authenticated;

drop policy if exists "see own and known profiles" on public.member_profiles;
create policy "see own and known profiles" on public.member_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.knows_member(user_id)
    or public.shares_playlist_with(user_id)
  );
