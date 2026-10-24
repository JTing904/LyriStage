-- 一起听：只有房间里的人看得到这个房间（2026-11-02）
-- 在 Supabase → SQL Editor 整份执行一次。⚠️ 要跟 2.1.6 同一时间执行：旧版 App 不会「登记加入」，执行后就进不了房间。
--
-- 以前任何 LyriStage 成员都读得到所有房间码（rooms、room_messages 的规则只看是不是成员），
-- 懂技术的人可以绕过「请求加入」直接进好友的房间。现在改成：
--   - 房间成员记在 room_members：开房间的人自动加入；其他人要拿房间码呼叫 join_room 才加入
--     （房间码、邀请链接是房主给的；敲门要房主同意后才拿得到房间码）
--   - 房间、聊天、点歌、Realtime 的 room: / voice: 频道，都只有房间成员看得到、用得了
--   - 猜房间码：一小时最多猜错 20 次
-- 房间删掉时成员名单跟着删（on delete cascade）

-- ---- 1. 房间成员 ----
create table if not exists public.room_members (
  room_code text        not null references public.rooms (code) on delete cascade,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_code, user_id)
);
alter table public.room_members enable row level security;
-- 只透过下面的函数读写
revoke all on public.room_members from anon, authenticated;

-- 现在开着的房间：房主先补进去（成员要用新版 App 重新加入）
insert into public.room_members (room_code, user_id)
select code, host_id from public.rooms
on conflict do nothing;

/** 我在不在这个房间里（规则里用；security definer 才查得到 room_members） */
create or replace function public.in_room(room text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- 被取消成员资格的人也不行
  select (select public.is_member()) and exists (
    select 1 from public.room_members m
     where m.room_code = room and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.in_room(text) from public, anon;
grant execute on function public.in_room(text) to authenticated;

/** 某个账号在不在这个房间里（换房主时检查：只能交给房间里的人） */
create or replace function public.in_room_user(room text, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_members m where m.room_code = room and m.user_id = uid);
$$;
revoke execute on function public.in_room_user(text, uuid) from public, anon;
grant execute on function public.in_room_user(text, uuid) to authenticated;

-- 开房间的人自动成为房间成员
create or replace function public.add_room_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.room_members (room_code, user_id) values (new.code, new.host_id)
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.add_room_host() from public, anon, authenticated;
drop trigger if exists rooms_add_host on public.rooms;
create trigger rooms_add_host after insert on public.rooms
  for each row execute function public.add_room_host();

-- ---- 2. 用房间码加入 ----
-- 猜错的记录（只留一小时）
create table if not exists public.room_join_failures (
  user_id uuid        not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists room_join_failures_user_at on public.room_join_failures (user_id, at);
alter table public.room_join_failures enable row level security;
revoke all on public.room_join_failures from anon, authenticated;

/** 用房间码加入：成功回传房主的账号 id；没有这个房间回传 null（算猜错一次）；一小时猜错 20 次就先不给试 */
create or replace function public.join_room(room text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  host uuid;
begin
  if not (select public.is_member()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.room_join_failures f where f.at < now() - interval '1 hour';
  if (select count(*) from public.room_join_failures f where f.user_id = me) >= 20 then
    raise exception 'too many tries' using errcode = '54000';
  end if;
  select r.host_id into host from public.rooms r where r.code = upper(room);
  if host is null then
    insert into public.room_join_failures (user_id) values (me);
    return null;
  end if;
  insert into public.room_members (room_code, user_id) values (upper(room), me)
  on conflict do nothing;
  return host;
end;
$$;
revoke execute on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;

-- ---- 3. 房间：只有房间里的人看得到 ----
drop policy if exists "members see rooms" on public.rooms;
drop policy if exists "room members see rooms" on public.rooms;
create policy "room members see rooms" on public.rooms
  for select to authenticated
  using (host_id = (select auth.uid()) or (select public.in_room(code)));

-- 换房主：只能交给这个房间里的人
drop policy if exists "hosts hand over their rooms" on public.rooms;
create policy "hosts hand over their rooms" on public.rooms
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check ((select public.is_member_user(host_id)) and (select public.in_room_user(code, host_id)));

-- ---- 4. 聊天、点歌：只有房间里的人看得到、发得出 ----
drop policy if exists "members read room messages" on public.room_messages;
drop policy if exists "room members read messages" on public.room_messages;
create policy "room members read messages" on public.room_messages
  for select to authenticated
  using ((select public.in_room(room_code)));

drop policy if exists "members send as themselves" on public.room_messages;
create policy "members send as themselves" on public.room_messages
  for insert to authenticated
  with check (
    (select public.is_member())
    and user_id = (select auth.uid())
    and (select public.in_room(room_code))
    and (select public.can_send_room_message())
    -- 「已加入队列」只有这个房间的房主能发
    and (
      kind <> 'accept'
      or exists (select 1 from public.rooms r where r.code = room_code and r.host_id = (select auth.uid()))
    )
  );

-- ---- 5. Realtime 频道：room:房间码、voice:房间码 只有房间里的人能进 ----
drop policy if exists "members listen together (receive)" on realtime.messages;
create policy "members listen together (receive)" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) like 'room:%'
    and (select public.in_room(split_part((select realtime.topic()), ':', 2)))
  );

drop policy if exists "members listen together (presence)" on realtime.messages;
create policy "members listen together (presence)" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) like 'room:%'
    and (select public.in_room(split_part((select realtime.topic()), ':', 2)))
  );

drop policy if exists "members voice chat (receive)" on realtime.messages;
create policy "members voice chat (receive)" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) like 'voice:%'
    and (select public.in_room(split_part((select realtime.topic()), ':', 2)))
  );

drop policy if exists "members voice chat (send)" on realtime.messages;
create policy "members voice chat (send)" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'voice:%'
    and (select public.in_room(split_part((select realtime.topic()), ':', 2)))
  );

-- 应该看到：room_members 1、join_room 1、room_policies 2、message_policies 2、realtime_policies 4
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'room_members') as room_members,
  (select count(*) from pg_proc where proname = 'join_room') as join_room,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'rooms'
     and policyname in ('room members see rooms', 'hosts hand over their rooms')) as room_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'room_messages'
     and policyname in ('room members read messages', 'members send as themselves')) as message_policies,
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
     and policyname in ('members listen together (receive)', 'members listen together (presence)',
                        'members voice chat (receive)', 'members voice chat (send)')) as realtime_policies;
