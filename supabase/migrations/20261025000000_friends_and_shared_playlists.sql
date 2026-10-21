-- 好友、朋友正在听、共同歌单、管理员看存储空间（2026-10-25）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 参考 Apple Music / Spotify 的做法：
-- - 加好友要对方同意；只有互相是好友才看得到对方在听什么
-- - 「让好友看到我在听什么」可以关；「私人模式」暂时隐藏 6 小时
-- - 共同歌单用邀请码加入，每首歌记下是谁加的；改名、删歌单只有主人能做

-- ============================================================================
-- 1. 会员的公开资料（只有好友和正在加好友的人看得到）
-- ============================================================================
-- 名字、头像原本只存在登录账号自己的资料里，别人读不到，所以另外放一份。
-- App 每次登录、改资料时更新这里。

create table public.member_profiles (
  user_id         uuid        primary key default auth.uid() references auth.users on delete cascade,
  display_name    text        not null default '' check (char_length(display_name) <= 60),
  avatar_url      text        check (avatar_url is null or avatar_url ~ '^https://'),
  -- 好友码：传给朋友，朋友输入后送出好友邀请。不能用搜索找人（会把会员名单露出来）
  friend_code     text        not null unique
                  default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  -- 让好友看到我在听什么（默认开）
  share_listening boolean     not null default true,
  -- 私人模式：这个时间以前都不让好友看到
  private_until   timestamptz,
  updated_at      timestamptz not null default now()
);

-- ============================================================================
-- 2. 好友关系
-- ============================================================================
-- requester 送邀请给 addressee；addressee 同意 → accepted。
-- 拒绝的不删掉，改成 declined：对方就不能一直重送（对方看到的还是"已送出"）

create table public.friendships (
  requester  uuid        not null references auth.users on delete cascade,
  addressee  uuid        not null references auth.users on delete cascade,
  status     text        not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index friendships_addressee on public.friendships (addressee);

/** 两个人是好友 */
create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
  );
$$;

/** 我和这个人之间有好友关系或邀请（看得到对方的名字和头像） */
create function public.knows_member(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where (f.requester = (select auth.uid()) and f.addressee = other)
       or (f.addressee = (select auth.uid()) and f.requester = other)
  );
$$;

/**
 * 用好友码送出好友邀请。回传：'sent' 已送出 / 'accepted' 对方也邀请过你，直接变好友 /
 * 'friends' 本来就是好友 / 'not_found' 没有这个码 / 'self' 是你自己的码
 */
create function public.send_friend_request(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
  existing public.friendships;
begin
  if me is null or not public.is_member() then
    raise exception '只有 LyriStage 成员才能加好友' using errcode = '42501';
  end if;
  select user_id into them from public.member_profiles
  where friend_code = upper(trim(code));
  if them is null then return 'not_found'; end if;
  if them = me then return 'self'; end if;

  -- 对方已经邀请过我：直接变好友
  select * into existing from public.friendships where requester = them and addressee = me;
  if found then
    if existing.status = 'accepted' then return 'friends'; end if;
    update public.friendships set status = 'accepted' where requester = them and addressee = me;
    return 'accepted';
  end if;

  select * into existing from public.friendships where requester = me and addressee = them;
  if found then
    if existing.status = 'accepted' then return 'friends'; end if;
    return 'sent'; -- 还在等、或被拒绝了：都只说"已送出"
  end if;

  -- 一个人最多同时有 50 个还没回应的邀请（避免乱送）
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50 then
    raise exception '送出的邀请太多了，等对方回应后再送' using errcode = '54000';
  end if;
  insert into public.friendships (requester, addressee) values (me, them);
  return 'sent';
end;
$$;

-- ============================================================================
-- 3. 朋友正在听
-- ============================================================================
-- 每人一行，换歌、播放 / 暂停时覆盖（不会越存越多）

create table public.now_playing (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  track      jsonb       not null,
  playing    boolean     not null default true,
  updated_at timestamptz not null default now()
);

/** 这个人现在愿意让好友看到在听什么（开着分享、不在私人模式） */
create function public.shares_listening(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.share_listening and (p.private_until is null or p.private_until < now())
    from public.member_profiles p where p.user_id = uid
  ), true);
$$;

-- ============================================================================
-- 4. 共同歌单
-- ============================================================================

alter table public.playlists add column share_code text unique;
-- 每首歌是谁加的（主人自己加的也记）
alter table public.playlist_tracks add column added_by uuid default auth.uid() references auth.users on delete set null;

create table public.playlist_editors (
  playlist_id uuid        not null references public.playlists on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (playlist_id, user_id)
);
create index playlist_editors_user on public.playlist_editors (user_id);

/** 我能编辑这张歌单（主人或加入的人） */
create function public.can_edit_playlist(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.playlists p where p.id = pid and p.user_id = (select auth.uid()))
      or exists (select 1 from public.playlist_editors e where e.playlist_id = pid and e.user_id = (select auth.uid()));
$$;

/** 主人：开始共享，回传邀请码（已经有就回传原本的） */
create function public.share_playlist(pid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  select share_code into code from public.playlists where id = pid and user_id = auth.uid();
  if not found then raise exception '只有歌单主人能共享' using errcode = '42501'; end if;
  if code is null then
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    update public.playlists set share_code = code where id = pid;
  end if;
  return code;
end;
$$;

/** 主人：停止共享（邀请码作废，已经加入的人也移除） */
create function public.unshare_playlist(pid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.playlists set share_code = null where id = pid and user_id = auth.uid();
  if not found then raise exception '只有歌单主人能停止共享' using errcode = '42501'; end if;
  delete from public.playlist_editors where playlist_id = pid;
end;
$$;

/** 用邀请码加入共同歌单，回传歌单 ID（码不对回传 null） */
create function public.join_shared_playlist(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
  owner uuid;
begin
  if auth.uid() is null or not public.is_member() then
    raise exception '只有 LyriStage 成员才能加入' using errcode = '42501';
  end if;
  select id, user_id into pid, owner from public.playlists where share_code = upper(trim(code));
  if pid is null then return null; end if;
  if owner <> auth.uid() then
    insert into public.playlist_editors (playlist_id, user_id) values (pid, auth.uid())
    on conflict do nothing;
  end if;
  return pid;
end;
$$;

-- 合作者加歌时也要更新歌单的更新时间（原本用加歌的人的权限执行，合作者改不到）
alter function public.touch_playlist() security definer;

-- ============================================================================
-- 5. 管理员：存储空间（设置页的「存储空间」）
-- ============================================================================

create function public.admin_storage_usage()
returns table (name text, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员能看' using errcode = '42501';
  end if;
  return query
    select 'database'::text, pg_database_size(current_database())
    union all
    (select c.relname::text, pg_total_relation_size(c.oid)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 2 desc limit 8);
end;
$$;

-- ============================================================================
-- 权限
-- ============================================================================

-- 好友码不能自己指定或改（只能用默认产生的）
grant select on public.member_profiles to authenticated;
grant insert (user_id, display_name, avatar_url, share_listening, private_until, updated_at)
  on public.member_profiles to authenticated;
grant update (display_name, avatar_url, share_listening, private_until, updated_at)
  on public.member_profiles to authenticated;
grant select, update, delete on public.friendships to authenticated;
grant select, insert, update, delete on public.now_playing to authenticated;
grant select, delete on public.playlist_editors to authenticated;

alter table public.member_profiles  enable row level security;
alter table public.friendships      enable row level security;
alter table public.now_playing      enable row level security;
alter table public.playlist_editors enable row level security;

-- 资料：自己的、和有好友关系 / 邀请的人的
create policy "see own and known profiles" on public.member_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.knows_member(user_id));
create policy "members create own profile" on public.member_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "edit own profile" on public.member_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 好友关系：只看得到跟自己有关的；邀请只能用 send_friend_request 送
create policy "see own friendships" on public.friendships
  for select to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));
-- 收到的邀请：同意或拒绝
create policy "answer requests" on public.friendships
  for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status in ('accepted', 'declined'));
-- 删掉：取消自己送的邀请、解除好友。
-- 被拒绝的邀请，送的人删不掉（不然删掉再送，就能一直骚扰对方）
create policy "remove own friendships" on public.friendships
  for delete to authenticated
  using ((requester = (select auth.uid()) and status <> 'declined')
         or (addressee = (select auth.uid()) and status = 'accepted'));

-- 正在听：自己写自己的；好友在分享时看得到
create policy "write own now playing" on public.now_playing
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "friends see now playing" on public.now_playing
  for select to authenticated
  using (public.are_friends((select auth.uid()), user_id) and public.shares_listening(user_id));

-- 共同歌单：加入的人看得到歌单、能加歌删歌；改名、删歌单还是只有主人（原本的 "own rows"）
create policy "editors see shared playlists" on public.playlists
  for select to authenticated
  using (exists (select 1 from public.playlist_editors e
                 where e.playlist_id = playlists.id and e.user_id = (select auth.uid())));
create policy "editors edit shared tracks" on public.playlist_tracks
  for all to authenticated
  using (public.can_edit_playlist(playlist_id))
  with check (public.can_edit_playlist(playlist_id));
create policy "see editors" on public.playlist_editors
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_edit_playlist(playlist_id));
-- 自己退出，或主人移除
create policy "leave or remove editors" on public.playlist_editors
  for delete to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid())));

-- 函数只给登录的人用
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
revoke execute on function public.knows_member(uuid) from public, anon;
revoke execute on function public.send_friend_request(text) from public, anon;
revoke execute on function public.shares_listening(uuid) from public, anon;
revoke execute on function public.can_edit_playlist(uuid) from public, anon;
revoke execute on function public.share_playlist(uuid) from public, anon;
revoke execute on function public.unshare_playlist(uuid) from public, anon;
revoke execute on function public.join_shared_playlist(text) from public, anon;
revoke execute on function public.admin_storage_usage() from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.knows_member(uuid) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.shares_listening(uuid) to authenticated;
grant execute on function public.can_edit_playlist(uuid) to authenticated;
grant execute on function public.share_playlist(uuid) to authenticated;
grant execute on function public.unshare_playlist(uuid) to authenticated;
grant execute on function public.join_shared_playlist(text) to authenticated;
grant execute on function public.admin_storage_usage() to authenticated;

-- 好友在听什么、收到好友邀请：用 Realtime 即时推送（照样按上面的规则过滤）
alter publication supabase_realtime add table public.now_playing, public.friendships;
