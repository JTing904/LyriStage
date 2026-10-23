// 好友和「朋友正在听」（supabase/migrations/20261025000000_friends_and_shared_playlists.sql）
// - 加好友：搜名字（对方开着搜索）或输入好友码送出邀请，你同意了才是好友
//   （搜名字：supabase/migrations/20261105000000_friend_search.sql）
// - 只有互相是好友、而且对方开着分享（不在私人模式）才看得到对方在听什么
import { getCurrentUser } from './auth';
import { requireSupabase, unwrap } from './supabase';
import { toSnapshot } from './track';

/** 私人模式隐藏多久 */
export const PRIVATE_MODE_MS = 6 * 60 * 60 * 1000;

// ---- 自己的公开资料 ----------------------------------------------------------------

/**
 * 更新自己的名字和头像（好友看到的那份）；第一次会建立资料并产生好友码
 * @param {{ displayName: string, avatarUrl?: string | null }} profile
 */
export async function syncMyProfile({ displayName, avatarUrl }) {
  const user = await getCurrentUser();
  if (!user) return;
  const db = requireSupabase();
  const fields = {
    display_name: displayName.slice(0, 60),
    avatar_url: avatarUrl?.startsWith('https://') ? avatarUrl : null,
    updated_at: new Date().toISOString(),
  };
  // 先改自己那一行；还没有（第一次用）才新增。
  // 不用 upsert：它会连 user_id 一起更新，而数据库只开放名字、头像这几栏可以改
  const updated = unwrap(await db.from('member_profiles').update(fields).eq('user_id', user.id).select('user_id'));
  if (!updated.length) {
    unwrap(await db.from('member_profiles').insert({ user_id: user.id, ...fields }));
  }
}

/**
 * searchable：别人能不能用名字搜到我（null = 数据库还没加这个功能）
 * @returns {Promise<{ friendCode: string, shareListening: boolean, privateUntil: string | null, searchable: boolean | null } | null>}
 */
export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const read = columns =>
    requireSupabase().from('member_profiles').select(columns).eq('user_id', user.id).maybeSingle();
  let result = await read('friend_code, share_listening, private_until, searchable');
  // 还没执行搜名字那份 SQL：读不到 searchable，退回旧的读法
  if (result.error && /searchable/.test(result.error.message ?? '')) {
    result = await read('friend_code, share_listening, private_until');
  }
  const row = unwrap(result);
  return row && {
    friendCode: row.friend_code,
    shareListening: row.share_listening,
    privateUntil: row.private_until,
    searchable: row.searchable ?? null,
  };
}

/**
 * 让好友看到我在听什么 / 私人模式（privateUntil：这个时间以前都隐藏，null = 不隐藏）/
 * 让别人用名字搜到我（searchable）
 */
export async function updateSharing({ shareListening, privateUntil, searchable }) {
  const user = await getCurrentUser();
  if (!user) return;
  const patch = { updated_at: new Date().toISOString() };
  if (shareListening !== undefined) patch.share_listening = shareListening;
  if (privateUntil !== undefined) patch.private_until = privateUntil;
  if (searchable !== undefined) patch.searchable = searchable;
  unwrap(await requireSupabase().from('member_profiles').update(patch).eq('user_id', user.id));
}

// ---- 好友 -----------------------------------------------------------------------

/**
 * 用好友码送出邀请
 * @returns {Promise<'sent' | 'accepted' | 'friends' | 'not_found' | 'self'>}
 */
export async function sendFriendRequest(code) {
  return unwrap(await requireSupabase().rpc('send_friend_request', { code }));
}

/**
 * 搜名字或好友码（2 个字以上），最多 10 个
 * @returns {Promise<Array<{ id: string, name: string, avatar: string | null, relation: 'friends' | 'sent' | 'incoming' | null, mutual: number, byCode: boolean }>>}
 */
export async function searchMembers(text) {
  const rows = unwrap(await requireSupabase().rpc('search_members', { q: text }));
  return rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar, relation: r.relation, mutual: r.mutual, byCode: r.by_code }));
}

/** 对搜到的人送邀请（对方要开着搜索）；回传跟 sendFriendRequest 一样 */
export async function sendFriendRequestTo(id) {
  return unwrap(await requireSupabase().rpc('send_friend_request_to', { target: id }));
}

/**
 * 好友、收到的邀请、送出去的邀请（附上对方的名字和头像）
 * @returns {Promise<{ friends: Person[], incoming: Person[], outgoing: Person[] }>}
 * @typedef {{ id: string, name: string, avatar: string | null, since: string }} Person
 */
export async function listFriends() {
  const user = await getCurrentUser();
  if (!user) return { friends: [], incoming: [], outgoing: [] };
  const db = requireSupabase();
  const rows = unwrap(await db.from('friendships').select('requester, addressee, status, created_at'));
  const otherOf = row => (row.requester === user.id ? row.addressee : row.requester);
  const ids = [...new Set(rows.map(otherOf))];
  const profiles = ids.length
    ? unwrap(await db.from('member_profiles').select('user_id, display_name, avatar_url').in('user_id', ids))
    : [];
  const byId = new Map(profiles.map(p => [p.user_id, p]));
  const person = row => {
    const id = otherOf(row);
    const p = byId.get(id);
    return { id, name: p?.display_name || '?', avatar: p?.avatar_url ?? null, since: row.created_at };
  };
  return {
    friends: rows.filter(r => r.status === 'accepted').map(person),
    incoming: rows.filter(r => r.status === 'pending' && r.addressee === user.id).map(person),
    // 被拒绝的也当作"已送出"（不告诉送的人被拒绝了）
    outgoing: rows.filter(r => r.status !== 'accepted' && r.requester === user.id).map(person),
  };
}

/** 回应收到的邀请 */
export async function answerFriendRequest(requesterId, accept) {
  const user = await getCurrentUser();
  unwrap(
    await requireSupabase()
      .from('friendships')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('requester', requesterId)
      .eq('addressee', user.id)
  );
}

/** 解除好友、取消送出的邀请 */
export async function removeFriend(otherId) {
  const user = await getCurrentUser();
  const db = requireSupabase();
  unwrap(await db.from('friendships').delete().eq('requester', user.id).eq('addressee', otherId));
  unwrap(await db.from('friendships').delete().eq('requester', otherId).eq('addressee', user.id));
}

// ---- 正在听 ---------------------------------------------------------------------

/** 告诉好友我在听什么（换歌、播放 / 暂停时） */
export async function setNowPlaying(track, playing) {
  const user = await getCurrentUser();
  if (!user) return;
  unwrap(
    await requireSupabase()
      .from('now_playing')
      .upsert(
        { user_id: user.id, track: toSnapshot(track), playing, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
  );
}

/** 不让好友看到（关掉分享时） */
export async function clearNowPlaying() {
  const user = await getCurrentUser();
  if (!user) return;
  unwrap(await requireSupabase().from('now_playing').delete().eq('user_id', user.id));
}

/**
 * 好友在听什么（数据库按规则只给看得到的）
 * @returns {Promise<Array<{ userId: string, track: object, playing: boolean, updatedAt: string }>>}
 */
export async function listFriendsNowPlaying() {
  const user = await getCurrentUser();
  if (!user) return [];
  const rows = unwrap(
    await requireSupabase()
      .from('now_playing')
      .select('user_id, track, playing, updated_at')
      .neq('user_id', user.id)
  );
  return rows.map(r => ({ userId: r.user_id, track: r.track, playing: r.playing, updatedAt: r.updated_at }));
}

/**
 * 好友换歌、收到好友邀请、便签和表情回应有变化时通知（Realtime；数据库照样按规则过滤）
 * @param {(change: { table: string, eventType: string, new: any, old: any }) => void} onChange
 * @returns {() => void} 取消订阅
 */
export function watchFriends(onChange) {
  const db = requireSupabase();
  const channel = db.channel(`friends:${Math.random().toString(36).slice(2)}`);
  for (const table of ['now_playing', 'friendships', 'friend_notes', 'friend_reactions']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
  }
  channel.subscribe();
  return () => db.removeChannel(channel);
}

// ---- 便签、表情回应（supabase/migrations/20261103000000_friend_notes.sql）----------------

/** 便签最多几个字（数据库也只接受这么多） */
export const NOTE_MAX = 60;
/** 回应时直接按的几个常用表情（其他的按「＋」用键盘选，什么表情都可以） */
export const NOTE_REACTIONS = ['❤️', '🔥', '😭', '😂', '👏', '🎶'];

/** 是不是一个表情（跟数据库的检查一样：只收表情用到的那几段 Unicode，含肤色、组合表情、国旗） */
const EMOJI = /^[←-⯿〰〽㊗㊙\u{1F000}-\u{1FAFF}️‍⃣\u{E0020}-\u{E007F}]{1,16}$/u;
export const isEmoji = text => EMOJI.test(String(text ?? ''));

/** 从键盘打的字里拿出第一个表情（一个表情可能由好几个字元组成，例如 ❤️‍🔥、👍🏽）；没有就是 '' */
export function firstEmoji(text) {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(text ?? ''));
  for (const { segment } of segments) if (isEmoji(segment)) return segment;
  return '';
}

/** 数据库还没执行那份 SQL（表或函数不存在） */
export const isMissingTable = error =>
  ['42P01', 'PGRST202', 'PGRST205', '42883'].includes(error?.code) || /does not exist|schema cache/.test(error?.message ?? '');

/**
 * 自己和好友的便签（过期的、私人模式的数据库不会给）
 * @returns {Promise<Array<{ userId: string, body: string, track: object | null, createdAt: string, expiresAt: string }>>}
 */
export async function listFriendNotes() {
  const rows = unwrap(
    await requireSupabase().from('friend_notes').select('user_id, body, track, created_at, expires_at')
  );
  const now = Date.now();
  return rows
    .filter(r => new Date(r.expires_at).getTime() > now)
    .map(r => ({ userId: r.user_id, body: r.body, track: r.track, createdAt: r.created_at, expiresAt: r.expires_at }));
}

/** 写便签（再写一次就换掉，重新算 24 小时）；track 可以不附 */
export async function setMyNote(body, track = null) {
  unwrap(
    await requireSupabase().rpc('set_friend_note', {
      body: String(body ?? '').trim().slice(0, NOTE_MAX),
      track: track ? toSnapshot(track) : null,
    })
  );
}

/** 删掉自己的便签 */
export async function clearMyNote() {
  const user = await getCurrentUser();
  if (!user) return;
  unwrap(await requireSupabase().from('friend_notes').delete().eq('user_id', user.id));
}

/**
 * 送表情给好友（回应他的便签 'note'，或他正在听的歌 'listening'）
 * @param {{ friendId: string, emoji: string, target: 'note' | 'listening', context: string }} reaction
 */
export async function reactToFriend({ friendId, emoji, target, context }) {
  return unwrap(
    await requireSupabase().rpc('react_to_friend', {
      friend: friendId,
      emoji,
      target,
      context: String(context ?? '').slice(0, 120),
    })
  );
}

/**
 * 别人送给我的表情（最近 30 天，新的在前）
 * @returns {Promise<Array<{ id: number, from: string, emoji: string, target: string, context: string, seen: boolean, at: string }>>}
 */
export async function listReactionsToMe() {
  const user = await getCurrentUser();
  if (!user) return [];
  const rows = unwrap(
    await requireSupabase()
      .from('friend_reactions')
      .select('id, from_user, emoji, target, context, seen, created_at')
      .eq('to_user', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
  );
  return rows.map(toReaction);
}

/** 数据库的一行回应 → 画面用的 */
export const toReaction = r => ({
  id: r.id,
  from: r.from_user,
  emoji: r.emoji,
  target: r.target,
  context: r.context,
  seen: r.seen,
  at: r.created_at,
});

/** 收到的回应都标成看过了 */
export async function markReactionsSeen() {
  const user = await getCurrentUser();
  if (!user) return;
  unwrap(
    await requireSupabase().from('friend_reactions').update({ seen: true }).eq('to_user', user.id).eq('seen', false)
  );
}

// ---- 好友周榜（supabase/migrations/20261027000000_friends_weekly_board.sql） ----------

/**
 * 我和好友这一周（马来西亚时间星期一起）听了多久、几首、最常听的歌手和歌，听最久的排前面。
 * 关掉分享的好友不会出现。数据库还没执行那份 SQL 时回传 null（界面就不显示周榜）
 * @param {{ weeksAgo?: number }} [options] 0 = 这周，1 = 上周
 * @returns {Promise<Array<{ id: string, name: string, avatar: string | null, isMe: boolean, minutes: number, plays: number, topArtist: string | null, topTrack: object | null }> | null>}
 */
export async function friendsWeeklyBoard({ weeksAgo = 0 } = {}) {
  const { data, error } = await requireSupabase().rpc('friends_weekly_board', { weeks_ago: weeksAgo });
  if (error) {
    // PGRST202 / 42883：函数不存在（还没执行 SQL）
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw error;
  }
  return data.map(r => ({
    id: r.user_id,
    name: r.display_name || '',
    avatar: r.avatar_url,
    isMe: r.is_me,
    minutes: r.minutes,
    plays: r.plays,
    topArtist: r.top_artist,
    topTrack: r.top_track,
  }));
}
