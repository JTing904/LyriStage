// Supabase 冒烟测试：用真实的 src/lyristage 代码跑一遍注册、喜欢、歌单、听歌记录，
// 再用第二个用户验证 RLS（看不到、改不了别人的数据）。
// 运行：node scripts/smoke/run.js
import assert from 'assert';
import { signUp, signOut, getCurrentUser } from '@/lyristage/auth';
import {
  likeTrack,
  unlikeTrack,
  listLikedTrackIds,
  listLikedTracks,
  createPlaylist,
  addTracksToPlaylist,
  getPlaylist,
  listPlaylists,
  moveTrackInPlaylist,
  deletePlaylist,
} from '@/lyristage/library';
import {
  recordPlay,
  playRanking,
  dislikeTrack,
  listDislikedTrackIds,
  listRecentHistory,
  clearHistory,
} from '@/lyristage/history';
import { requireSupabase } from '@/lyristage/supabase';

const track = (id, name, artistId) => ({
  id,
  name,
  ar: [{ id: artistId, name: `歌手${artistId}` }],
  al: { id: 1, name: '专辑', picUrl: 'https://p1.music.126.net/x.jpg' },
  dt: 200000,
  privilege: { st: 0 }, // 快照里不应该保存
});
const t1 = track(3445595679, '有你爱就明媚', 33937543);
const t2 = track(186016, '晴天', 6452);
const t3 = track(1901371647, '孤勇者', 5781);

const domain = process.env.SMOKE_EMAIL_DOMAIN || 'example.com';
const stamp = Date.now();
const password = `Smoke-${stamp}-pw`;

async function newUser(tag) {
  const email = `lyristage.smoke.${stamp}.${tag}@${domain}`;
  const { session } = await signUp(email, password);
  if (!session) {
    throw new Error(
      '注册后没有拿到 session：请在 Supabase → Authentication → Sign In / Providers → Email 关闭 "Confirm email"'
    );
  }
  return email;
}

const step = msg => console.log(`✓ ${msg}`);

(async () => {
  // ---------- 用户 A ----------
  const emailA = await newUser('a');
  const userA = await getCurrentUser();
  step(`注册用户 A ${emailA}`);

  await likeTrack(t1);
  await likeTrack(t2);
  await likeTrack(t2); // 重复喜欢不报错
  assert.deepStrictEqual(await listLikedTrackIds(), [t2.id, t1.id]);
  const liked = await listLikedTracks();
  assert.strictEqual(liked[0].name, '晴天');
  assert.strictEqual(liked[0].privilege, undefined, '快照不保存 privilege');
  await unlikeTrack(t1.id);
  assert.deepStrictEqual(await listLikedTrackIds(), [t2.id]);
  step('喜欢 / 取消喜欢 / 快照');

  const pl = await createPlaylist({ name: '冒烟测试歌单' });
  await addTracksToPlaylist(pl.id, [t1, t2, t3]);
  await addTracksToPlaylist(pl.id, [t2]); // 已存在，跳过
  let detail = await getPlaylist(pl.id);
  assert.deepStrictEqual(
    detail.tracks.map(t => t.id),
    [t1.id, t2.id, t3.id]
  );
  await moveTrackInPlaylist(pl.id, t3.id, null, 1); // 移到最前
  detail = await getPlaylist(pl.id);
  assert.deepStrictEqual(
    detail.tracks.map(t => t.id),
    [t3.id, t1.id, t2.id]
  );
  const lists = await listPlaylists();
  assert.strictEqual(lists.length, 1);
  assert.strictEqual(lists[0].trackCount, 3);
  step('歌单：新建 / 加歌去重 / 拖动排序 / 数量统计');

  await recordPlay(t1, { listenedSeconds: 200, context: 'smoke' });
  await recordPlay(t1, { listenedSeconds: 150, context: 'smoke' });
  await recordPlay(t3, { listenedSeconds: 5, context: 'smoke' }); // 跳过
  const history = await listRecentHistory({ days: 1 });
  assert.strictEqual(history.length, 3);
  assert.strictEqual(
    history.find(h => h.track_id === String(t3.id)).skipped,
    true
  );
  const ranking = await playRanking('week');
  assert.strictEqual(ranking.length, 1, '跳过的不计入排行');
  assert.strictEqual(ranking[0].id, t1.id);
  assert.strictEqual(ranking[0].playCount, 2);
  step('听歌记录 / 跳过判定 / play_ranking');

  await dislikeTrack(t3.id);
  assert.deepStrictEqual(await listDislikedTrackIds(), [String(t3.id)]);
  step('不喜欢');

  await signOut();

  // ---------- 用户 B：验证 RLS ----------
  const emailB = await newUser('b');
  step(`注册用户 B ${emailB}`);
  assert.deepStrictEqual(await listLikedTrackIds(), [], 'B 看不到 A 的喜欢');
  assert.deepStrictEqual(await listPlaylists(), [], 'B 看不到 A 的歌单');
  assert.deepStrictEqual(await playRanking('all'), [], 'B 看不到 A 的排行');
  assert.deepStrictEqual(await listRecentHistory(), [], 'B 看不到 A 的记录');
  await assert.rejects(
    addTracksToPlaylist(pl.id, [t2]),
    'B 不能往 A 的歌单加歌'
  );
  const { data: hijack } = await requireSupabase()
    .from('playlists')
    .update({ name: '被改了' })
    .eq('id', pl.id)
    .select();
  assert.deepStrictEqual(hijack, [], 'B 改不了 A 的歌单');
  await assert.rejects(
    (async () => {
      const { error } = await requireSupabase()
        .from('liked_tracks')
        .insert({ user_id: userA.id, track_id: '1', track: {} });
      if (error) throw error;
    })(),
    'B 不能冒充 A 写数据'
  );
  step('RLS：B 读不到、改不了、冒充不了 A');
  await signOut();

  // ---------- 清理 A 的数据 ----------
  const { error } = await requireSupabase().auth.signInWithPassword({
    email: emailA,
    password,
  });
  if (error) throw error;
  await deletePlaylist(pl.id);
  await unlikeTrack(t2.id);
  await clearHistory();
  await requireSupabase().from('disliked_tracks').delete().neq('track_id', '');
  assert.deepStrictEqual(await listPlaylists(), []);
  await signOut();
  step('清理测试数据');

  console.log(
    `\n全部通过 🎉  两个测试账号仍在 Authentication → Users 里，可以手动删除：\n  ${emailA}\n  ${emailB}`
  );
})()
  .catch(err => {
    console.error('\n✗ 失败：', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Supabase 的自动刷新 token 定时器会让进程一直挂着；
    // 直接 process.exit() 在 Windows 上会因为还有连接在关闭而触发 libuv 断言，
    // 所以先停掉定时器，等连接关完再退出
    requireSupabase().auth.stopAutoRefresh();
    setTimeout(() => process.exit(), 200);
  });
