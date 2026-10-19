// @ts-check
// 缓存：歌词、歌曲信息这类很少变的数据，避免每次都请求网易云。
// 缓存逻辑（过期、数量上限、同时请求合并）和存储分开：
// - 测试用 createMemoryStore()
// - 界面用 ./dexie.js 的 createDexieStore()（存在 IndexedDB，重开 App 还在）

/**
 * @typedef {{ key: string, value: any, savedAt: number }} Entry
 * @typedef {object} Store
 * @property {(key: string) => Promise<Entry | undefined>} get
 * @property {(entry: Entry) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<number>} count
 * @property {(n: number) => Promise<void>} deleteOldest 删掉最久没更新的 n 条
 * @property {() => Promise<void>} clear
 */

/** @returns {Store} */
export function createMemoryStore() {
  /** @type {Map<string, Entry>} */
  const map = new Map();
  return {
    get: async key => map.get(key),
    put: async entry => {
      map.set(entry.key, entry);
    },
    delete: async key => {
      map.delete(key);
    },
    count: async () => map.size,
    deleteOldest: async n => {
      [...map.values()]
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(0, n)
        .forEach(e => map.delete(e.key));
    },
    clear: async () => map.clear(),
  };
}

/**
 * @param {Store} store
 * @param {object} [options]
 * @param {number} [options.ttlMs] 多久后过期，不传就不过期
 * @param {number} [options.maxEntries] 最多存几条，超过时删掉最旧的
 * @param {() => number} [options.now]
 */
export function createCache(store, { ttlMs, maxEntries, now = Date.now } = {}) {
  /** @type {Map<string, Promise<any>>} 同一个 key 正在加载时，后来的请求等同一个结果 */
  const inflight = new Map();

  async function get(key) {
    const entry = await store.get(key);
    if (!entry) return undefined;
    if (ttlMs !== undefined && now() - entry.savedAt > ttlMs) {
      await store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async function set(key, value) {
    await store.put({ key, value, savedAt: now() });
    if (maxEntries !== undefined) {
      const extra = (await store.count()) - maxEntries;
      if (extra > 0) await store.deleteOldest(extra);
    }
  }

  /**
   * 有缓存就用缓存，没有就调用 loader 并存起来。loader 出错时不缓存。
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} loader
   * @returns {Promise<T>}
   */
  async function getOrLoad(key, loader) {
    const cached = await get(key);
    if (cached !== undefined) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const promise = loader()
      .then(async value => {
        await set(key, value);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return { get, set, getOrLoad, clear: () => store.clear() };
}
