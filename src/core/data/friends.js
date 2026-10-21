// 好友和「朋友正在听」（supabase/migrations/20261025000000_friends_and_shared_playlists.sql）
// - 加好友：把自己的好友码传给朋友，朋友输入后送出邀请，你同意了才是好友
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

/** @returns {Promise<{ friendCode: string, shareListening: boolean, privateUntil: string | null } | null>} */
export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const row = unwrap(
    await requireSupabase()
      .from('member_profiles')
      .select('friend_code, share_listening, private_until')
      .eq('user_id', user.id)
      .maybeSingle()
  );
  return row && {
    friendCode: row.friend_code,
    shareListening: row.share_listening,
    privateUntil: row.private_until,
  };
}

/** 让好友看到我在听什么 / 私人模式（privateUntil：这个时间以前都隐藏，null = 不隐藏） */
export async function updateSharing({ shareListening, privateUntil }) {
  const user = await getCurrentUser();
  if (!user) return;
  const patch = { updated_at: new Date().toISOString() };
  if (shareListening !== undefined) patch.share_listening = shareListening;
  if (privateUntil !== undefined) patch.private_until = privateUntil;
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
 * 好友换歌、收到好友邀请时通知（Realtime；数据库照样按规则过滤）
 * @param {() => void} onChange
 * @returns {() => void} 取消订阅
 */
export function watchFriends(onChange) {
  const db = requireSupabase();
  const channel = db
    .channel(`friends:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'now_playing' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .subscribe();
  return () => db.removeChannel(channel);
}
