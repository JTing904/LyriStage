-- 一起听：房主转让（2026-10-23）
-- 房主可以把房间交给房间里的另一个成员；rooms 的变动会由 Realtime 推给房间里的人，
-- 新房主的 App 收到后重新连线成房主（Realtime 只在连线时检查"能不能广播"）。
--
-- 在 Supabase → SQL Editor 整份执行一次（只执行一次）。

-- 某个账号是不是成员（members 表只看得到自己那一行，所以用 security definer）
create function public.is_member_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = uid);
$$;
revoke execute on function public.is_member_user(uuid) from public, anon;
grant execute on function public.is_member_user(uuid) to authenticated;

-- 房主只能改 host_id，而且只能交给成员
grant update (host_id) on public.rooms to authenticated;
create policy "hosts hand over their rooms" on public.rooms
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check ((select public.is_member_user(host_id)));

-- 让 Realtime 推送"房主换人了"
alter publication supabase_realtime add table public.rooms;
