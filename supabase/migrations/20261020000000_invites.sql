-- LyriStage 邀请制：要有邀请码才能使用
--
-- 任何人都能注册 / 用 GitHub 登录 Supabase 账号（这一步挡不住），
-- 但只有兑换过邀请码、进了 members 表的人才算"成员"：
-- - App 里非成员只会看到"输入邀请码"的页面
-- - 数据库：所有用户数据表都加了"只有成员能读写"的限制（restrictive policy）
-- - Vercel 上的网易云 API：只接受成员的请求（server/lib/handler.js 调 is_member()）
--
-- 生成邀请码：管理员（is_admin）在 App 的设置页一键生成；也可以在 Supabase SQL Editor 执行
--   select public.create_invite();                -- 一次性邀请码
--   select public.create_invite(5, '给大学同学');   -- 可以用 5 次，加个备注
-- 查看：select * from public.invite_codes order by created_at desc;
-- 把自己（或别人）直接加成成员，不用邀请码：
--   insert into public.members (user_id) select id from auth.users where email = '你的邮箱';

create table public.invite_codes (
  code text primary key,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0,
  note text,
  -- 用这个码注册的人同时成为管理员（只在第一次设置时生成一个给自己）
  grants_admin boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invite_code text references public.invite_codes (code) on delete set null,
  -- 管理员：可以在 App 里生成邀请码。只能在 SQL Editor 里改（App 用户没有 update 权限）
  is_admin boolean not null default false,
  joined_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
alter table public.members      enable row level security;

-- 邀请码表不开放给任何 App 用户（只能通过下面的函数兑换，不能列出所有邀请码）
-- 成员表：只能看到自己那一行
grant select on public.members to authenticated;
create policy "read own" on public.members
  for select to authenticated using (user_id = (select auth.uid()));

-- 当前用户是不是成员 ------------------------------------------------------------
-- security definer：用建函数的人的权限查 members，不受 RLS 影响
create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members where user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- 兑换邀请码 --------------------------------------------------------------------
-- 已经是成员就直接返回 true；邀请码不存在、过期或用完就报错
create function public.redeem_invite(invite text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  normalized text := upper(btrim(invite));
begin
  if uid is null then
    raise exception '请先登录' using errcode = '28000';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    return true;
  end if;

  update public.invite_codes
     set used_count = used_count + 1
   where code = normalized
     and used_count < max_uses
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception '邀请码无效、已过期或已经用完' using errcode = 'P0001';
  end if;

  insert into public.members (user_id, invite_code, is_admin)
  select uid, normalized, grants_admin
    from public.invite_codes where code = normalized;
  return true;
end;
$$;
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- 生成邀请码（只在 SQL Editor 里用，App 用户不能调用）----------------------------
-- 10 位，去掉了容易看错的 0 O 1 I L
create function public.create_invite(
  max_uses integer default 1,
  note text default null,
  grants_admin boolean default false
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  new_code text;
begin
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      into new_code
      from generate_series(1, 10);
    exit when not exists (select 1 from public.invite_codes where code = new_code);
  end loop;
  insert into public.invite_codes (code, max_uses, note, grants_admin)
  values (new_code, create_invite.max_uses, create_invite.note, create_invite.grants_admin);
  return new_code;
end;
$$;
revoke execute on function public.create_invite(integer, text, boolean) from public, anon, authenticated;

-- 管理员在 App 里生成 / 查看邀请码 -------------------------------------------------
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select is_admin from public.members where user_id = (select auth.uid())),
    false
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.admin_create_invite(max_uses integer default 1, note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员可以生成邀请码' using errcode = '42501';
  end if;
  return public.create_invite(admin_create_invite.max_uses, admin_create_invite.note);
end;
$$;
revoke execute on function public.admin_create_invite(integer, text) from public, anon;
grant execute on function public.admin_create_invite(integer, text) to authenticated;

create function public.admin_list_invites(max_rows integer default 30)
returns setof public.invite_codes
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员可以查看邀请码' using errcode = '42501';
  end if;
  return query
    select * from public.invite_codes order by created_at desc limit max_rows;
end;
$$;
revoke execute on function public.admin_list_invites(integer) from public, anon;
grant execute on function public.admin_list_invites(integer) to authenticated;

-- 所有用户数据表：只有成员能读写 -------------------------------------------------
-- restrictive 会和原来的 "own rows" 等规则同时生效（两个都满足才行）
create policy "members only" on public.liked_tracks
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members only" on public.playlists
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members only" on public.playlist_tracks
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members only" on public.play_history
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members only" on public.disliked_tracks
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members only" on public.daily_recommendations
  as restrictive to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- 已经注册过的账号（迁移之前就有的）直接成为成员，不用再输入邀请码。
-- 冒烟测试建的账号除外（它们的密码可以从邮箱推出来）
insert into public.members (user_id)
select id from auth.users where email not like 'lyristage.smoke.%';

-- 管理员：按执行这个迁移时已经存在的账号 id 设定（不是按邮箱判断，
-- 因为注册不用验证邮箱，按邮箱的话别人可以用这个邮箱注册来冒充）
update public.members set is_admin = true
where user_id in (select id from auth.users where lower(email) = 'kengtingtan@gmail.com');

-- 第一次设置：生成一个"管理员邀请码"给自己注册用（SQL Editor 下方会显示出来）。
-- 用它注册的账号会同时成为成员和管理员，之后就能在 App 的设置页一键生成邀请码给朋友
select public.create_invite(1, '管理员注册用', true) as "你的管理员邀请码";
