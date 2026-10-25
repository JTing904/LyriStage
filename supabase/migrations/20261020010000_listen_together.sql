-- 和朋友一起听歌：用 Supabase Realtime 的私有频道（room:房间码）
-- 房主广播播放状态（歌、播放 / 暂停、进度），大家用 presence 显示谁在房间里。
-- 只让 LyriStage 成员收发（不是成员的人就算知道房间码也进不来）
--
-- 另外要在 Supabase → Project Settings → Realtime 关掉 "Allow public access"，
-- 只让私有频道（有这里的规则保护）可以用。

create policy "members listen together (receive)"
  on realtime.messages
  for select
  to authenticated
  using (
    (select public.is_member())
    and (select realtime.topic()) like 'room:%'
  );

create policy "members listen together (send)"
  on realtime.messages
  for insert
  to authenticated
  with check (
    (select public.is_member())
    and (select realtime.topic()) like 'room:%'
  );
