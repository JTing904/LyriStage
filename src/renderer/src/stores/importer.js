// 导入其他 App 的歌单（音乐库 ＋ →「导入歌单」、或在别的 App 按分享 → LyriStage）：
// 1. 读歌单：贴上的是链接就请 LyriStage 服务器读（QQ 音乐、Spotify、Apple Music、YouTube Music），
//    是一行一首的歌名清单就自己拆
// 2. 每首在网易云找对应的歌（core/importPlaylist），找到一首就显示一首；离开导入页也继续在背景找
// 3. 用户确认「版本可能不同」的、自己搜找不到的，存成自己的歌单（找不到的不加）
import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { matchAll, parseTextList } from '@core/importPlaylist';
import { netease } from '../services';
import { useLibraryStore } from './library';
import { t } from '../i18n';
import { humanMessage } from '../friendlyError';

/** 服务器说读不到的原因 → 给用户看的话 */
const READ_ERRORS = {
  unsupported: '认不出这个链接。支持 QQ 音乐、Spotify、Apple Music、YouTube Music 的歌单链接',
  'not-found': '找不到这张歌单，链接可能不完整',
  empty: '读不到歌：歌单可能是私人的，或是空的',
  failed: '暂时读不到这张歌单，等一下再试',
};

export const SOURCE_NAMES = {
  qq: 'QQ 音乐',
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube Music',
  text: '歌名清单',
};

export const useImporterStore = defineStore('importer', () => {
  /** idle：还没开始；reading：在读歌单；matching：在网易云找；done：都找完了 */
  const phase = ref('idle');
  const error = ref('');
  /** 原本的歌单：{ source, name, cover, total } */
  const origin = ref(null);
  /**
   * 每首：src 原本的歌；status wait（还在找）/ ok / version / none；pick 要加进歌单的网易云的歌；
   * reason 为什么可能是别的版本；candidates 其他搜到的（「换一首」）；confirmed 用户自己选过
   * @type {import('vue').Ref<Array<{ src: object, status: string, pick: object | null, reason: string | null,
   *   diffSec: number, candidates: object[], confirmed?: boolean }>>}
   */
  const items = shallowRef([]);
  let run = 0;

  const counts = computed(() => {
    const c = { ok: 0, version: 0, none: 0, wait: 0 };
    for (const item of items.value) c[item.status]++;
    return c;
  });
  const done = computed(() => items.value.length - counts.value.wait);
  /** 会加进歌单的（同一首只加一次） */
  const picks = computed(() => {
    const seen = new Set();
    return items.value.map(item => item.pick).filter(song => song && !seen.has(song.id) && seen.add(song.id));
  });

  function setItem(i, patch) {
    const next = items.value.slice();
    next[i] = { ...next[i], ...patch };
    items.value = next;
  }

  function reset() {
    run++;
    phase.value = 'idle';
    error.value = '';
    origin.value = null;
    items.value = [];
  }

  /**
   * 开始导入
   * @param {string} input 歌单链接（或分享出来的整段文字），或一行一首的歌名清单
   * @returns {Promise<{ netease: string } | boolean>} 网易云的歌单回传 { netease: id }（直接打开那张）；读不到回传 false
   */
  async function start(input) {
    reset();
    const id = run;
    const text = String(input ?? '').trim();
    if (!text) return false;
    phase.value = 'reading';
    let tracks;
    // 有网址：交给服务器读；没有：当作歌名清单
    if (/https?:\/\//.test(text)) {
      try {
        const data = await netease.readOtherPlaylist(text);
        if (id !== run) return false;
        if (data.source === 'netease') {
          reset();
          return { netease: data.id };
        }
        origin.value = { source: data.source, name: data.name, cover: data.cover, total: data.total };
        tracks = data.tracks ?? [];
      } catch (err) {
        if (id !== run) return false;
        const reason = /** @type {any} */ (err)?.body?.reason;
        error.value = reason in READ_ERRORS ? t(READ_ERRORS[reason]) : humanMessage(err, t('读不到这张歌单'));
        phase.value = 'idle';
        return false;
      }
    } else {
      tracks = parseTextList(text);
      origin.value = { source: 'text', name: t('导入的歌单'), cover: '', total: tracks.length };
    }
    if (!tracks.length) {
      error.value = t('没有读到歌');
      phase.value = 'idle';
      return false;
    }
    items.value = tracks.map(src => ({ src, status: 'wait', pick: null, reason: null, diffSec: 0, candidates: [] }));
    phase.value = 'matching';
    // 在背景找，不等它（页面显示进度）
    matchAll(tracks, netease, (i, result) => setItem(i, result), { isCancelled: () => id !== run }).then(() => {
      if (id === run) phase.value = 'done';
    });
    return true;
  }

  /** 「换一首」：用户选了另一首（null = 不要这首） */
  function choose(i, song) {
    setItem(i, song ? { pick: song, status: 'ok', reason: null, confirmed: true } : { pick: null, status: 'none', confirmed: true });
  }

  /** 找不到、配错的：用户自己打字搜 */
  async function searchFor(i, keyword) {
    const item = items.value[i];
    const q = keyword.trim();
    if (!item || !q) return;
    // 照搜索结果的顺序（用户打的字才准，不要再拿原本那首去排）；被藏起来的原唱放最前面，跟搜索页一样
    const [songs, hidden] = await Promise.all([
      netease.searchSongs(q, { limit: 8 }).catch(() => []),
      netease.hiddenSongs(q, { limit: 3 }).catch(() => []),
    ]);
    const seen = new Set();
    const found = [...hidden, ...songs].filter(song => song?.id && !seen.has(song.id) && seen.add(song.id));
    // 不自动选，让用户自己按
    if (found.length) setItem(i, { candidates: found.slice(0, 8) });
  }

  /** 存成我的歌单，回传新的歌单（{ id }）；存好就清掉 */
  async function save(name) {
    const library = useLibraryStore();
    const row = await library.saveAsPlaylist(name || origin.value?.name || t('导入的歌单'), picks.value);
    if (row) reset();
    return row;
  }

  return { phase, error, origin, items, counts, done, picks, start, choose, searchFor, save, reset };
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useImporterStore, import.meta.hot));
