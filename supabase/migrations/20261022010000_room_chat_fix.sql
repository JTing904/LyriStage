-- 修正 20261022000000_room_chat.sql：发消息的规则里直接查 room_messages 自己算"一分钟几则"，
-- Postgres 会报 42P17 infinite recursion detected in policy。
-- 改成用一个 security definer 函数来数（函数里查表不受 RLS 影响，就不会绕回规则本身）。
--
-- 在 Supabase → SQL Editor 整份执行一次。

create function public.can_send_room_message()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 30
    from public.room_messages
   where user_id = (select auth.uid())
     and created_at > now() - interval '1 minute';
$$;
revoke execute on function public.can_send_room_message() from public, anon;
grant execute on function public.can_send_room_message() to authenticated;

drop policy "members send as themselves" on public.room_messages;

-- 只能用自己的身份、发到存在的房间；一分钟最多 30 则（避免洗版）
create policy "members send as themselves" on public.room_messages
  for insert to authenticated
  with check (
    (select public.is_member())
    and user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.code = room_code)
    and (select public.can_send_room_message())
  );
