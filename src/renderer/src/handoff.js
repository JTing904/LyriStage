// 换设备接着听：播放时记下现在播到哪（每个账号只有一笔，core/data/playbackState.js）；
// 打开另一台设备（或切回来）时，上次是在别的设备听、而且是 12 小时内，就跳一条「在手机听到《X》2:31」，按「接着听」从那里播。
// 只有成员；一起听的房间里不做（跟着房主）；这台正在播就不打扰
import { getPlaybackState, savePlaybackState } from '@core/data';
import { controls, player } from './services';
import { isElectron, isNativeApp } from './platform';
import { useNoticeStore } from './stores/notice';
import { clock } from './utils/format';
import { t } from './i18n';

const DEVICE_KEY = 'lyristage:device-id';
/** 存进数据库的是代号，显示时才翻译 */
const DEVICE = isNativeApp ? 'phone' : isElectron ? 'pc' : 'web';
const DEVICE_LABELS = { phone: '手机', pc: '电脑', web: '网页版' };
/** 播放时多久记一次 */
const SAVE_EVERY_MS = 30_000;
/** 多久以前的就不问了 */
const RECENT_MS = 12 * 3600_000;
/** 回到 App 时最多多久问一次数据库 */
const CHECK_EVERY_MS = 60_000;

/** 这台设备的代号（第一次打开时产生，之后一直用同一个） */
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

/**
 * @param {{ isMember: () => boolean, inRoom: () => boolean }} options
 * @returns {{ check: () => Promise<void> }} 登录好、回到 App 时叫 check
 */
export function connectHandoff({ isMember, inRoom }) {
  const id = deviceId();

  // ---- 记下现在播到哪 ----
  let savedAt = 0;
  function save() {
    const { track } = player.getState();
    if (!track || !isMember() || inRoom()) return;
    savedAt = Date.now();
    savePlaybackState({ track, position: player.currentTime() || 0, deviceId: id, deviceName: DEVICE }).catch(() => {});
  }
  let lastTrackId = null;
  let lastPlaying = false;
  player.on('change', state => {
    // 换歌（在播的时候）、按播放 / 暂停：马上记
    const trackChanged = (state.track?.id ?? null) !== lastTrackId;
    const playingChanged = state.playing !== lastPlaying;
    lastTrackId = state.track?.id ?? null;
    lastPlaying = state.playing;
    if ((trackChanged && state.playing) || playingChanged) save();
  });
  // 播放中：每 30 秒记一次；收到背景时也记一次
  player.on('time', () => player.getState().playing && Date.now() - savedAt > SAVE_EVERY_MS && save());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && player.getState().playing) save();
  });

  // ---- 打开、切回来：问要不要接着听 ----
  let checkedAt = 0;
  /** 同一笔只问一次 */
  let offered = '';
  async function check() {
    if (!isMember() || inRoom() || Date.now() - checkedAt < CHECK_EVERY_MS) return;
    checkedAt = Date.now();
    const remote = await getPlaybackState().catch(() => null);
    if (!remote || remote.deviceId === id || remote.updatedAt === offered) return;
    if (Date.now() - Date.parse(remote.updatedAt) > RECENT_MS) return;
    const local = player.getState();
    if (local.playing) return;
    // 这台已经停在差不多的地方：不用问
    if (String(local.track?.id) === String(remote.track.id) && Math.abs((player.currentTime() || 0) - remote.position) < 10) return;
    offered = remote.updatedAt;
    const device = t(DEVICE_LABELS[remote.deviceName] ?? '别的设备');
    useNoticeStore().show(
      t('在{device}听到《{name}》{time}', { device, name: remote.track.name, time: clock(remote.position * 1000) }),
      { action: { label: t('接着听'), run: () => resume(remote) }, duration: 12000 }
    );
  }
  async function resume(remote) {
    await controls.playList([remote.track], 0, 'handoff');
    if (remote.position > 3) player.seek(remote.position);
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('focus', () => check());

  return { check };
}
