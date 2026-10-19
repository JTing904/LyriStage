// @ts-check
// 请求网易云 API 的 HTTP 客户端。
// 和 v1 的 request.js 不同：配置全部从外面传进来（不依赖 Vue / store / router），
// 出错时一定抛出 ApiError，不会悄悄返回 undefined。

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: number, url: string, body?: any }} info
   */
  constructor(message, { status, code, url, body }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.url = url;
    this.body = body;
  }
}

/**
 * @typedef {Record<string, string | number | boolean | null | undefined>} Params
 * @typedef {{ get: (path: string, params?: Params) => Promise<any> }} Http
 */

/**
 * @param {object} options
 * @param {string} options.baseURL 例如 'http://127.0.0.1:10754' 或网页版的 '/api'
 * @param {typeof fetch} [options.fetch] 测试时可以换成假的 fetch
 * @param {number} [options.timeout] 毫秒
 * @param {Params} [options.defaultParams] 每个请求都带上的参数
 * @returns {Http}
 */
export function createHttp({
  baseURL,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  timeout = 15000,
  defaultParams = {},
}) {
  const base = baseURL.replace(/\/+$/, '');

  async function get(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({
      ...defaultParams,
      ...params,
    })) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const qs = query.toString();
    const url = `${base}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(url, { signal: controller.signal });
    } catch (err) {
      const reason = controller.signal.aborted
        ? `超时（${timeout}ms）`
        : String(err);
      throw new ApiError(`请求失败：${reason}`, { url });
    } finally {
      clearTimeout(timer);
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      // 不是 JSON（例如代理返回的错误页），下面按 HTTP 状态处理
    }

    const code = typeof body?.code === 'number' ? body.code : undefined;
    if (!res.ok || (code !== undefined && code >= 400)) {
      const message = body?.message || body?.msg || `HTTP ${res.status}`;
      throw new ApiError(message, { status: res.status, code, url, body });
    }
    return body;
  }

  return { get };
}
