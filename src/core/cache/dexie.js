// @ts-check
// 缓存存储：IndexedDB（通过 Dexie）。只能在浏览器 / Electron 页面里用。
import Dexie from 'dexie';

/**
 * @param {string} name 数据库名，例如 'lyristage-cache'
 * @returns {import('./index').Store}
 */
export function createDexieStore(name) {
  const db = new Dexie(name);
  db.version(1).stores({ entries: 'key, savedAt' });
  const table = db.table('entries');

  return {
    get: key => table.get(key),
    put: async entry => {
      await table.put(entry);
    },
    delete: key => table.delete(key),
    count: () => table.count(),
    deleteOldest: async n => {
      const keys = await table.orderBy('savedAt').limit(n).primaryKeys();
      await table.bulkDelete(keys);
    },
    clear: () => table.clear(),
  };
}
