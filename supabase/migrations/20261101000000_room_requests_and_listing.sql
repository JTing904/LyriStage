-- 一起听：点歌、好友看得到你在房间（要你同意才能进）、自动清理没人的房间（2026-11-01）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 1. 点歌：成员在房间里点歌，写进 room_messages（kind = 'request'，body 是歌曲资料的 JSON）；
--    房主按「加入队列」后发一则 kind = 'accept'（body 是那则点歌的 id），只有房主能发
-- 2. 房主每分钟更新一次 rooms.last_seen_at
-- 3. 好友的首页看得到「XX 在一起听」（friends_rooms，不会给房间码）；按「请求加入」= 敲门（knock_room），
--    房主同意（answer_knock）后，敲门的人才拿得到房间码（knock_room_code）。
--    房主开着私人模式、或关掉「让好友看到我在听什么」时，好友看不到、也敲不了门。
--    直接拿到房间码、邀请链接的人照旧直接进（那是房主自己给的）
-- 4. 房主没按「关闭房间」就不见了（App 被关掉）：每小时清一次，超过一小时没更新的房间删掉，
--    聊天、点歌、敲门会跟着删（都是 on delete cascade）

-- ---- 1. 点歌 ----
alter table public.room_messages drop constraint if exists room_messages_kind_check;
alter table public.room_messages drop constraint if exists room_messages_body_check;
alter table public.room_messages drop constraint if exists room_messages_check;
alter table public.room_messages drop constraint if exists room_messages_react_check;
alter table public.room_messages drop constraint if exists room_messages_request_check;
alter table public.room_messages drop constraint if exists room_messages_accept_check;

alter table public.room_messages
  add constraint room_messages_kind_check check (kind in ('chat', 'react', 'request', 'accept')),
  -- 文字、表情最多 200 字；点歌是一首歌的 JSON，放宽到 1500 字
  add constraint room_messages_body_check check (
    char_length(body) between 1 and (case when kind = 'request' then 1500 else 200 end)
  ),
  add constraint room_messages_react_check check (kind <> 'react' or body in ('❤️', '🔥', '😭', '😂', '👏', '🎶')),
  add constraint room_messages_request_check check (kind <> 'request' or (body::jsonb ? 'id' and body::jsonb ? 'name')),
  add constraint room_messages_accept_check check (kind <> 'accept' or body ~ '^[0-9]{1,18}$');

drop policy if exists "members send as themselves" on public.room_messages;
create policy "members send as themselves" on public.room_messages
  for insert to authenticated
  with check (
    (select public.is_member())
    and user_id = (select auth.uid())
    and exists (select 1 from public.rooms r where r.code = room_code)
    and (select public.can_send_room_message())
    -- 「已加入队列」只有这个房间的房主能发
    and (
      kind <> 'accept'
      or exists (select 1 from public.rooms r where r.code = room_code and r.host_id = (select auth.uid()))
    )
  );

-- ---- 2. 房主最后在线时间 ----
alter table public.rooms add column if not exists last_seen_at timestamptz not null default now();
-- 房主可以更新（用的是原本「房主才能改自己的房间」那条规则）
grant update (last_seen_at) on public.rooms to authenticated;
create index if not exists rooms_host_seen on public.rooms (host_id, last_seen_at);

-- ---- 3. 好友在哪个房间、敲门 ----
create table if not exists public.room_knocks (
  id         bigint      generated always as identity primary key,
  room_code  text        not null references public.rooms (code) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  status     text        not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (room_code, user_id)
);
alter table public.room_knocks enable row level security;
revoke all on public.room_knocks from anon, authenticated;
grant select on public.room_knocks to authenticated;
-- 看得到：自己敲的门、敲自己房间的门（新增、修改都只能透过下面的函数）
drop policy if exists "knocker and host see knocks" on public.room_knocks;
create policy "knocker and host see knocks" on public.room_knocks
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.rooms r where r.code = room_code and r.host_id = (select auth.uid()))
  );
-- 有人敲门、房主回答了：推给房主和敲门的人
do $$
begin
  alter publication supabase_realtime add table public.room_knocks;
exception when duplicate_object then null;
end;
$$;

/** 好友现在开着的房间（两分钟内房主还在、愿意让好友看到）；只给谁、什么时候开的，不给房间码 */
create or replace function public.friends_rooms()
returns table (host_id uuid, started_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.host_id, r.created_at
    from public.rooms r
   where (select public.is_member())
     and r.host_id <> (select auth.uid())
     and r.last_seen_at > now() - interval '2 minutes'
     and public.are_friends(r.host_id, (select auth.uid()))
     and public.shares_listening(r.host_id);
$$;
revoke execute on function public.friends_rooms() from public, anon;
grant execute on function public.friends_rooms() to authenticated;

/** 敲好友的房门；回传这次敲门的 id（之后等房主回答）。30 秒内重复敲只算一次 */
create or replace function public.knock_room(host uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  room text;
  knock_id bigint;
begin
  if not (select public.is_member()) or not public.are_friends(host, me) or not public.shares_listening(host) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select r.code into room
    from public.rooms r
   where r.host_id = host and r.last_seen_at > now() - interval '2 minutes'
   order by r.created_at desc
   limit 1;
  if room is null then
    raise exception 'no room' using errcode = 'P0002';
  end if;
  insert into public.room_knocks (room_code, user_id)
  values (room, me)
  on conflict (room_code, user_id) do update
    set status = 'pending', created_at = now()
    where public.room_knocks.created_at < now() - interval '30 seconds'
       or public.room_knocks.status <> 'pending'
  returning id into knock_id;
  if knock_id is null then
    select k.id into knock_id from public.room_knocks k where k.room_code = room and k.user_id = me;
  end if;
  return knock_id;
end;
$$;
revoke execute on function public.knock_room(uuid) from public, anon;
grant execute on function public.knock_room(uuid) to authenticated;

/** 房主回答敲门 */
create or replace function public.answer_knock(knock_id bigint, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_knocks k
     set status = case when accept then 'accepted' else 'declined' end
   where k.id = knock_id
     and k.status = 'pending'
     and exists (select 1 from public.rooms r where r.code = k.room_code and r.host_id = (select auth.uid()));
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.answer_knock(bigint, boolean) from public, anon;
grant execute on function public.answer_knock(bigint, boolean) to authenticated;

/** 房主同意了：敲门的人拿房间码（没同意就是 null） */
create or replace function public.knock_room_code(knock_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select k.room_code from public.room_knocks k
   where k.id = knock_id and k.user_id = (select auth.uid()) and k.status = 'accepted';
$$;
revoke execute on function public.knock_room_code(bigint) from public, anon;
grant execute on function public.knock_room_code(bigint) to authenticated;

-- ---- 4. 每小时清掉没人的房间 ----
select cron.unschedule('stale-rooms-cleanup')
 where exists (select 1 from cron.job where jobname = 'stale-rooms-cleanup');
select cron.schedule(
  'stale-rooms-cleanup',
  '17 * * * *',
  $$ delete from public.rooms where last_seen_at < now() - interval '1 hour' $$
);

-- 应该看到：message_checks 5、room_column 1、knock_functions 4、cleanup_job 1
select
  (select count(*) from pg_constraint where conrelid = 'public.room_messages'::regclass and contype = 'c') as message_checks,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rooms' and column_name = 'last_seen_at') as room_column,
  (select count(*) from pg_proc where proname in ('friends_rooms', 'knock_room', 'answer_knock', 'knock_room_code')) as knock_functions,
  (select count(*) from cron.job where jobname = 'stale-rooms-cleanup') as cleanup_job;
