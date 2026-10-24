-- App 关着也收得到通知（Android，经过 Google 的 Firebase Cloud Messaging）（2026-11-04）
-- 在 Supabase → SQL Editor 整份执行一次；部署好 Edge Function send-push 以后，再执行最下面那行设定网址。
--
-- 什么时候通知：
--   - 好友送表情回应你（便签、正在听的歌）
--   - 有人送好友邀请给你、对方同意了你的好友邀请
--   - 好友敲你一起听的房门
-- 怎么送：上面这些资料一写进数据库，就叫 Edge Function send-push（带一组只有数据库知道的密码），
-- 它再用 Firebase 的服务账号把通知送到对方手机。每台手机的推送代号（token）记在 push_tokens，
-- 只透过下面的函数登记、删除；谁都读不到别人的。通知送不出去也不会影响原本的动作。

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---- 1. 每台手机的推送代号 ----
create table if not exists public.push_tokens (
  token      text        primary key check (char_length(token) between 20 and 4096),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  platform   text        not null default 'android' check (platform in ('android')),
  -- 通知用哪个语言写
  locale     text        not null default 'zh-CN' check (locale in ('zh-CN', 'en')),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
-- 只有 Edge Function（service_role）读得到：查要送哪几台、删掉失效的
grant select, delete on public.push_tokens to service_role;

/** 这台手机要收通知（换了账号登录的话，代号改记到新账号） */
create or replace function public.register_push_token(token text, locale text default 'zh-CN')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if not (select public.is_member()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, user_id, locale, updated_at)
  values (token, me, case when locale = 'en' then 'en' else 'zh-CN' end, now())
  on conflict on constraint push_tokens_pkey do update
    set user_id = excluded.user_id, locale = excluded.locale, updated_at = now();
  -- 一个人最多留 5 台（旧手机的代号会自己失效，留太多没用）
  delete from public.push_tokens t
   where t.user_id = me
     and t.token not in (
       select k.token from public.push_tokens k where k.user_id = me order by k.updated_at desc limit 5
     );
end;
$$;
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

/** 这台手机不收了（关掉通知、退出登录） */
create or replace function public.unregister_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t where t.token = unregister_push_token.token and t.user_id = (select auth.uid());
$$;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ---- 2. 叫 Edge Function 的网址和密码（放在谁都读不到的 private，不放 Vault：Edge Function 那边读不到 Vault） ----
create table if not exists private.push_config (
  id     integer primary key default 1 check (id = 1),
  url    text,
  secret text    not null
);
revoke all on private.push_config from public, anon, authenticated;
insert into private.push_config (secret)
values (encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;

/** Edge Function 用来确认是数据库叫的 */
create or replace function public.push_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select length(secret) >= 32 and exists (select 1 from private.push_config c where c.secret = push_secret_ok.secret);
$$;
revoke execute on function public.push_secret_ok(text) from public, anon, authenticated;
grant execute on function public.push_secret_ok(text) to service_role;

/** 叫 Edge Function 送通知（对方没有登记手机、还没设定网址就不送）；出错也不影响原本的动作 */
create or replace function private.send_push(target uuid, kind text, params jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  select c.url, c.secret into cfg from private.push_config c where c.id = 1;
  if cfg.url is null or not exists (select 1 from public.push_tokens t where t.user_id = target) then
    return;
  end if;
  perform net.http_post(
    url := cfg.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
    body := jsonb_build_object('user_id', target, 'kind', kind, 'params', params),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'send_push failed: %', sqlerrm;
end;
$$;
revoke execute on function private.send_push(uuid, text, jsonb) from public, anon, authenticated;

/** 通知里显示的名字 */
create or replace function private.display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif((select p.display_name from public.member_profiles p where p.user_id = uid), ''), '?');
$$;
revoke execute on function private.display_name(uuid) from public, anon, authenticated;

/** 通知里的人：名字、头像（通知右边显示，像 WhatsApp）、账号 id（同一个人的新通知盖掉旧的） */
create or replace function private.sender(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', private.display_name(uid),
    'avatar', (select p.avatar_url from public.member_profiles p where p.user_id = uid),
    'from', uid
  );
$$;
revoke execute on function private.sender(uuid) from public, anon, authenticated;

-- ---- 3. 什么时候送 ----

-- 好友送表情回应
create or replace function private.push_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.send_push(new.to_user, 'reaction', private.sender(new.from_user) || jsonb_build_object(
    'emoji', new.emoji, 'target', new.target, 'context', new.context
  ));
  return null;
end;
$$;
drop trigger if exists friend_reactions_push on public.friend_reactions;
create trigger friend_reactions_push after insert on public.friend_reactions
  for each row execute function private.push_on_reaction();

-- 好友邀请：收到邀请、对方同意了
create or replace function private.push_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.send_push(new.addressee, 'friend_request', private.sender(new.requester));
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.send_push(new.requester, 'friend_accepted', private.sender(new.addressee));
  end if;
  return null;
end;
$$;
drop trigger if exists friendships_push on public.friendships;
create trigger friendships_push after insert or update of status on public.friendships
  for each row execute function private.push_on_friendship();

-- 好友敲门（再敲一次也会通知，数据库那边 30 秒内重复敲只算一次）
create or replace function private.push_on_knock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  host uuid;
begin
  if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending' and old.created_at = new.created_at) then
    return null;
  end if;
  select r.host_id into host from public.rooms r where r.code = new.room_code;
  if host is not null then
    perform private.send_push(host, 'knock', private.sender(new.user_id));
  end if;
  return null;
end;
$$;
drop trigger if exists room_knocks_push on public.room_knocks;
create trigger room_knocks_push after insert or update of status, created_at on public.room_knocks
  for each row execute function private.push_on_knock();

-- 应该看到：tokens_table 1、functions 3、triggers 3、secret_ready 1
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'push_tokens') as tokens_table,
  (select count(*) from pg_proc where proname in ('register_push_token', 'unregister_push_token', 'push_secret_ok')) as functions,
  (select count(*) from pg_trigger where tgname in ('friend_reactions_push', 'friendships_push', 'room_knocks_push')) as triggers,
  (select count(*) from private.push_config where length(secret) >= 32) as secret_ready;

-- 部署好 Edge Function send-push 以后，把 <project ref> 换成你的项目代号（Supabase 网址里那串）再执行这一行：
-- update private.push_config set url = 'https://<project ref>.supabase.co/functions/v1/send-push' where id = 1;
