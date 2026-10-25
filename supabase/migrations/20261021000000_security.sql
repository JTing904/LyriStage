-- 安全加强（2026-10-21）：
-- 1. 一起听：只有房主能在房间里广播播放指令（以前房间里任何成员都能发）
-- 2. 邀请码：用密码学安全的随机数产生；兑换失败一小时最多 10 次
--
-- 在 Supabase → SQL Editor 整份执行一次。

-- ==== 1. 一起听 ===================================================================

-- 房间：房间码 → 房主。开房间时 App 先写一行，离开时删掉
create table public.rooms (
  -- 6 个字，和 App 一样去掉了容易看错的 0 O 1 I L
  code       text        primary key check (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  host_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
grant select, insert, delete on public.rooms to authenticated;

create policy "members see rooms" on public.rooms
  for select to authenticated
  using ((select public.is_member()));
-- 只能用自己的身份开房间；房间码已经有人用就会失败（App 换一个码重试）
create policy "members open their own rooms" on public.rooms
  for insert to authenticated
  with check ((select public.is_member()) and host_id = (select auth.uid()));
create policy "hosts close their rooms" on public.rooms
  for delete to authenticated
  using (host_id = (select auth.uid()));

-- Realtime 权限：收消息、显示自己在房间里（presence）成员都可以；
-- 广播（播放指令）只有这个房间的房主可以
drop policy if exists "members listen together (receive)" on realtime.messages;
drop policy if exists "members listen together (send)" on realtime.messages;

create policy "members listen together (receive)" on realtime.messages
  for select to authenticated
  using (
    (select public.is_member())
    and (select realtime.topic()) like 'room:%'
  );

create policy "members listen together (presence)" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select public.is_member())
    and (select realtime.topic()) like 'room:%'
  );

create policy "hosts broadcast in their rooms" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.rooms r
       where r.code = split_part((select realtime.topic()), ':', 2)
         and r.host_id = (select auth.uid())
    )
  );

-- ==== 2. 邀请码 ====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 产生邀请码：改用 gen_random_bytes（random() 不是密码学安全的，可能被推算出来）
create or replace function public.create_invite(
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
  -- 31 个字：只用 0–247 的随机字节（248 = 31 × 8），每个字出现的机率才一样
  limit_byte constant integer := 248;
  bytes bytea;
  b integer;
  new_code text;
begin
  loop
    new_code := '';
    while length(new_code) < 10 loop
      bytes := extensions.gen_random_bytes(16);
      for i in 0..15 loop
        b := get_byte(bytes, i);
        if b < limit_byte and length(new_code) < 10 then
          new_code := new_code || substr(alphabet, 1 + b % 31, 1);
        end if;
      end loop;
    end loop;
    exit when not exists (select 1 from public.invite_codes where code = new_code);
  end loop;
  insert into public.invite_codes (code, max_uses, note, grants_admin)
  values (new_code, create_invite.max_uses, create_invite.note, create_invite.grants_admin);
  return new_code;
end;
$$;
revoke execute on function public.create_invite(integer, text, boolean) from public, anon, authenticated;

-- 兑换失败的记录（只有下面的函数会读写，App 碰不到）
create table public.invite_attempts (
  user_id uuid        not null,
  at      timestamptz not null default now()
);
create index invite_attempts_user_at on public.invite_attempts (user_id, at);
alter table public.invite_attempts enable row level security;

-- 兑换邀请码：
-- - 成功：返回 true
-- - 邀请码无效、过期、用完：记一次失败，返回 false（不用 raise，不然失败记录会跟着被撤销）
-- - 一小时内失败 10 次：报错，先不让试
create or replace function public.redeem_invite(invite text)
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

  if (select count(*) from public.invite_attempts
       where user_id = uid and at > now() - interval '1 hour') >= 10 then
    raise exception '试太多次了，请一小时后再试' using errcode = 'P0001';
  end if;

  update public.invite_codes
     set used_count = used_count + 1
   where code = normalized
     and used_count < max_uses
     and (expires_at is null or expires_at > now());
  if not found then
    insert into public.invite_attempts (user_id) values (uid);
    -- 顺便清掉一天前的记录，表不会一直变大
    delete from public.invite_attempts where at < now() - interval '1 day';
    return false;
  end if;

  insert into public.members (user_id, invite_code, is_admin)
  select uid, normalized, grants_admin
    from public.invite_codes where code = normalized;
  return true;
end;
$$;
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;
