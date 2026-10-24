-- 用名字搜好友（2026-10-24）
-- - 好友页的搜索框：打名字（2 个字以上）列出相符的成员，也可以直接打好友码
-- - 设置里可以关掉「让别人用名字搜到我」：关掉后只有打出你好友码的人才找得到你（跟以前一样）
-- - 不管怎么找到，都要对方同意才是好友；在听什么也一样只有好友看得到
-- - 送邀请：每人一小时最多 20 个（搜名字以后比较容易乱送）
-- 在 Supabase 的 SQL Editor 整份执行一次

create schema if not exists private;

-- ============================================================================
-- 1. 让别人用名字搜到我（默认开）
-- ============================================================================
alter table public.member_profiles add column if not exists searchable boolean not null default true;
grant insert (searchable), update (searchable) on public.member_profiles to authenticated;

-- ============================================================================
-- 2. 送邀请（好友码、搜到的人共用）
-- ============================================================================
-- 原本 send_friend_request 里的规则搬到这里，多一个「一小时最多 20 个」

create or replace function private.request_friend(me uuid, them uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.friendships;
begin
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

  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50 then
    raise exception '送出的邀请太多了，等对方回应后再送' using errcode = '54000';
  end if;
  if (select count(*) from public.friendships where requester = me and created_at > now() - interval '1 hour') >= 20 then
    raise exception '一小时内送太多邀请了，等一下再送' using errcode = '54000';
  end if;
  insert into public.friendships (requester, addressee) values (me, them);
  return 'sent';
end;
$$;
revoke execute on function private.request_friend(uuid, uuid) from public, anon, authenticated;

/** 用好友码送出邀请（不管对方开不开搜索都可以） */
create or replace function public.send_friend_request(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
begin
  if me is null or not public.is_member() then
    raise exception '只有 LyriStage 成员才能加好友' using errcode = '42501';
  end if;
  select user_id into them from public.member_profiles where friend_code = upper(trim(code));
  if them is null then return 'not_found'; end if;
  return private.request_friend(me, them);
end;
$$;

/**
 * 对搜到的人送邀请：对方要开着「让别人用名字搜到我」（关掉的话只能用好友码加）。
 * 回传跟 send_friend_request 一样
 */
create or replace function public.send_friend_request_to(target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.is_member() then
    raise exception '只有 LyriStage 成员才能加好友' using errcode = '42501';
  end if;
  if not exists (select 1 from public.member_profiles where user_id = target and searchable) then
    return 'not_found';
  end if;
  return private.request_friend(me, target);
end;
$$;

-- ============================================================================
-- 3. 搜索
-- ============================================================================
/**
 * 打名字（2 个字以上）或好友码。最多 10 个，不包括自己。
 * - 名字：只找开着搜索的人；完全一样的排最前面，再来是开头一样的，再来是名字里有的
 * - 好友码：打的刚好是某人的好友码就列出那个人（不管他开不开搜索），by_code = true
 * relation：'friends' 已经是好友 / 'sent' 我送过邀请（被拒绝也一样说已送出）/
 *           'incoming' 对方邀请了我 / null 还没有关系
 * mutual：共同好友有几个（只有数字，看不到是谁）
 */
create or replace function public.search_members(q text)
returns table (id uuid, name text, avatar text, relation text, mutual int, by_code boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  needle text := lower(trim(coalesce(q, '')));
  pattern text;
begin
  if me is null or not public.is_member() then
    raise exception '只有 LyriStage 成员才能搜好友' using errcode = '42501';
  end if;
  if char_length(needle) < 2 then return; end if;
  needle := left(needle, 60);
  -- like 的特殊字（% _ \）当成一般的字
  pattern := '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with my_friends as (
    select case when f.requester = me then f.addressee else f.requester end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester = me or f.addressee = me)
  ),
  found as (
    select p.user_id, p.display_name, p.avatar_url,
           (p.friend_code = upper(trim(q))) as code_hit
    from public.member_profiles p
    where p.user_id <> me
      and (
        p.friend_code = upper(trim(q))
        or (p.searchable and lower(p.display_name) like pattern)
      )
  )
  select f.user_id,
         f.display_name,
         f.avatar_url,
         (select case
                   when fr.status = 'accepted' then 'friends'
                   when fr.requester = me then 'sent'
                   else 'incoming'
                 end
          from public.friendships fr
          where (fr.requester = me and fr.addressee = f.user_id)
             or (fr.requester = f.user_id and fr.addressee = me and fr.status <> 'declined')
          order by (fr.status = 'accepted') desc
          limit 1),
         (select count(*)::int
          from public.friendships g
          where g.status = 'accepted'
            and ((g.requester = f.user_id and g.addressee in (select uid from my_friends))
              or (g.addressee = f.user_id and g.requester in (select uid from my_friends)))),
         f.code_hit
  from found f
  order by f.code_hit desc,
           (lower(f.display_name) = needle) desc,
           (left(lower(f.display_name), char_length(needle)) = needle) desc,
           f.display_name
  limit 10;
end;
$$;

revoke execute on function public.search_members(text), public.send_friend_request_to(uuid) from public, anon;
grant execute on function public.search_members(text), public.send_friend_request_to(uuid) to authenticated;
