-- 一起听：聊天和表情（2026-10-22）
-- 房间里只有房主能广播（见 20261021000000_security.sql），所以聊天不走广播，
-- 而是写进 room_messages，再由 Realtime 推给房间里的人。每则消息记着是谁发的，没办法冒充别人。
-- 房主关房间（rooms 那一行删掉）时，这个房间的消息会跟着删掉。
--
-- 在 Supabase → SQL Editor 整份执行一次。

create table public.room_messages (
  id         bigint      generated always as identity primary key,
  room_code  text        not null references public.rooms (code) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- chat：文字；react：表情（只能是下面几个）
  kind       text        not null check (kind in ('chat', 'react')),
  body       text        not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now(),
  check (kind <> 'react' or body in ('❤️', '🔥', '😭', '😂', '👏', '🎶'))
);
create index room_messages_room_created on public.room_messages (room_code, created_at);
create index room_messages_user_created on public.room_messages (user_id, created_at);
alter table public.room_messages enable row level security;
grant select, insert on public.room_messages to authenticated;

create policy "members read room messages" on public.room_messages
  for select to authenticated
  using ((select public.is_member()));

-- 只能用自己的身份、发到存在的房间；一分钟最多 30 则（避免洗版）
create policy "members send as themselves" on public.room_messages
  for insert to authenticated
  with check (
    (select public.is_member())
    and user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.code = room_code)
    and (
      select count(*) from public.room_messages m
       where m.user_id = (select auth.uid())
         and m.created_at > now() - interval '1 minute'
    ) < 30
  );

-- 让 Realtime 推送新消息
alter publication supabase_realtime add table public.room_messages;
