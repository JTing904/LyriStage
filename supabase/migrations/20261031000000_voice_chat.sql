-- 一起听：语音（2026-10-31）
-- 在 Supabase → SQL Editor 整份执行一次。
--
-- 语音是每个人直接连每个人（WebRTC），连线前要先交换"怎么连我"的资料（offer / answer / ICE）。
-- 这些资料走 Realtime 的私有频道 voice:房间码。房间频道 room:房间码 只让房主广播（播放指令），
-- 所以语音另外开一个频道：LyriStage 成员、而且这个房间真的存在，才能在里面广播和显示自己在语音里。
-- 声音本身不经过 Supabase（直接连，连不上才经过 Cloudflare 的中转）。

drop policy if exists "members voice chat (receive)" on realtime.messages;
drop policy if exists "members voice chat (send)" on realtime.messages;

create policy "members voice chat (receive)" on realtime.messages
  for select to authenticated
  using (
    (select public.is_member())
    and (select realtime.topic()) like 'voice:%'
  );

create policy "members voice chat (send)" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select public.is_member())
    and (select realtime.topic()) like 'voice:%'
    and exists (
      select 1 from public.rooms r
       where r.code = split_part((select realtime.topic()), ':', 2)
    )
  );

-- 应该是 2
select count(*) as voice_policies
  from pg_policies
 where schemaname = 'realtime' and tablename = 'messages' and policyname like 'members voice chat%';
