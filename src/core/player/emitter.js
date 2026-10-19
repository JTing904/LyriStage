// @ts-check
// 最小的事件发射器（浏览器和 Node 都能用）

export class Emitter {
  /** @type {Map<string, Set<(payload: any) => void>>} */
  #listeners = new Map();

  /**
   * @param {string} event
   * @param {(payload: any) => void} fn
   * @returns {() => void} 取消监听
   */
  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event)?.add(fn);
    return () => this.#listeners.get(event)?.delete(fn);
  }

  /**
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    for (const fn of this.#listeners.get(event) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[Emitter] ${event} 监听器出错`, err);
      }
    }
  }
}
