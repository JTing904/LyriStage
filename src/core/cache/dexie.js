// @ts-check
// 缓存存储：IndexedDB（通过 Dexie）。只能在浏览器 / Electron 页面里用。
// Dexie 约 95 KB：第一次读写缓存时才载入，打开 App 时不用等它

/**
 * @param {string} name 数据库名，例如 'lyristage-cache'
 * @returns {import('./index').Store}
 */
export function createDexieStore(name) {
  /** @type {Promise<any> | null} */
  let tablePromise = null;
  const table = () =>
    (tablePromise ??= import('dexie').then(({ default: Dexie }) => {
      const db = new Dexie(name);
      db.version(1).stores({ entries: 'key, savedAt' });
      return db.table('entries');
    }));

  return {
    get: async key => (await table()).get(key),
    put: async entry => {
      await (await table()).put(entry);
    },
    delete: async key => (await table()).delete(key),
    count: async () => (await table()).count(),
    deleteOldest: async n => {
      const t = await table();
      const keys = await t.orderBy('savedAt').limit(n).primaryKeys();
      await t.bulkDelete(keys);
    },
    clear: async () => (await table()).clear(),
  };
}
