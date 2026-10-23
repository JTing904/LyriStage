-- 好友页：便签、表情回应（2026-11-03）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 1. 便签（像 IG）：一句话（最多 60 字），可以附上正在听的歌；只有好友看得到，24 小时后消失。
--    每个人同时只有一则，再写一次就换掉。开着私人模式时好友看不到。
-- 2. 表情回应：对好友的便签、或他正在听的歌送一个表情，对方会收到通知（App 开着时马上跳出来）。
--    只能送给好友；十分钟最多 30 个（避免洗版）。
-- 3. 每天清一次：过期的便签、30 天以前的回应

-- ---- 共用：在不在私人模式 ----
create or replace function public.in_private_mode(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member_profiles p where p.user_id = uid and p.private_until > now()
  );
$$;
revoke execute on function public.in_private_mode(uuid) from public, anon;
grant execute on function public.in_private_mode(uuid) to authenticated;

-- ---- 1. 便签 ----
create table if not exists public.friend_notes (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  body       text        not null default '' check (char_length(body) <= 60),
  -- 附上的歌（歌曲资料的快照）
  track      jsonb       check (track is null or (track ? 'id' and track ? 'name' and octet_length(track::text) <= 1500)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  -- 不能是空的
  check (body <> '' or track is not null)
);
create index if not exists friend_notes_expires on public.friend_notes (expires_at);
alter table public.friend_notes enable row level security;
revoke all on public.friend_notes from anon, authenticated;
grant select, delete on public.friend_notes to authenticated;

drop policy if exists "see own and friends notes" on public.friend_notes;
create policy "see own and friends notes" on public.friend_notes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and public.are_friends(user_id, (select auth.uid()))
      and not public.in_private_mode(user_id)
    )
  );
drop policy if exists "delete own note" on public.friend_notes;
create policy "delete own note" on public.friend_notes
  for delete to authenticated
  using (user_id = (select auth.uid()));

/** 写便签（再写一次就换掉，重新算 24 小时） */
create or replace function public.set_friend_note(body text, track jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  clean text := btrim(coalesce(body, ''));
begin
  if not (select public.is_member()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.friend_notes (user_id, body, track, created_at, expires_at)
  values (me, clean, track, now(), now() + interval '24 hours')
  on conflict (user_id) do update
    set body = excluded.body, track = excluded.track,
        created_at = excluded.created_at, expires_at = excluded.expires_at;
end;
$$;
revoke execute on function public.set_friend_note(text, jsonb) from public, anon;
grant execute on function public.set_friend_note(text, jsonb) to authenticated;

-- ---- 2. 表情回应 ----
create table if not exists public.friend_reactions (
  id         bigint      generated always as identity primary key,
  from_user  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  to_user    uuid        not null references auth.users (id) on delete cascade,
  emoji      text        not null check (emoji in ('❤️', '🔥', '😭', '😂', '👏', '🎶')),
  -- 'note'：回应便签；'listening'：回应他正在听的歌
  target     text        not null check (target in ('note', 'listening')),
  -- 回应的是什么（便签那句话、或歌名），通知里显示
  context    text        not null default '' check (char_length(context) <= 120),
  seen       boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists friend_reactions_to on public.friend_reactions (to_user, created_at);
create index if not exists friend_reactions_from on public.friend_reactions (from_user, created_at);
alter table public.friend_reactions enable row level security;
revoke all on public.friend_reactions from anon, authenticated;
grant select on public.friend_reactions to authenticated;
-- 收到的人只能把「看过了」打勾
grant update (seen) on public.friend_reactions to authenticated;

drop policy if exists "see own reactions" on public.friend_reactions;
create policy "see own reactions" on public.friend_reactions
  for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
drop policy if exists "mark received reactions seen" on public.friend_reactions;
create policy "mark received reactions seen" on public.friend_reactions
  for update to authenticated
  using (to_user = (select auth.uid()))
  with check (to_user = (select auth.uid()));

/** 送表情给好友：回传这个回应的 id */
create or replace function public.react_to_friend(friend uuid, emoji text, target text, context text default '')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  new_id bigint;
begin
  if not (select public.is_member()) or friend = me or not public.are_friends(friend, me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.friend_reactions r
       where r.from_user = me and r.created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too many' using errcode = '54000';
  end if;
  insert into public.friend_reactions (from_user, to_user, emoji, target, context)
  values (me, friend, emoji, target, left(coalesce(context, ''), 120))
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.react_to_friend(uuid, text, text, text) from public, anon;
grant execute on function public.react_to_friend(uuid, text, text, text) to authenticated;

-- 便签、回应有变化就推过来（照样按上面的规则过滤）
do $$
begin
  alter publication supabase_realtime add table public.friend_notes;
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.friend_reactions;
exception when duplicate_object then null;
end;
$$;

-- ---- 3. 每天清一次 ----
select cron.unschedule('friend-notes-cleanup')
 where exists (select 1 from cron.job where jobname = 'friend-notes-cleanup');
select cron.schedule(
  'friend-notes-cleanup',
  '23 4 * * *',
  $$ delete from public.friend_notes where expires_at < now();
     delete from public.friend_reactions where created_at < now() - interval '30 days' $$
);

-- 应该看到：notes_table 1、reactions_table 1、functions 3、cleanup_job 1
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'friend_notes') as notes_table,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'friend_reactions') as reactions_table,
  (select count(*) from pg_proc where proname in ('set_friend_note', 'react_to_friend', 'in_private_mode')) as functions,
  (select count(*) from cron.job where jobname = 'friend-notes-cleanup') as cleanup_job;
