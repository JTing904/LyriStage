-- 在 App 里删除自己的账号（2026-10-23）
-- 账号删掉后，所有用户资料都会跟着删（各个表的外键都是 on delete cascade）：
-- 我喜欢、歌单、听歌记录、不喜欢、每日推荐、成员身份、开的房间、聊天消息。
-- 头像图片由 App 在呼叫这个函数之前先删掉（Storage 的档案要用 Storage API 删）。
--
-- 在 Supabase → SQL Editor 整份执行一次（只执行一次）。

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '请先登录' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
