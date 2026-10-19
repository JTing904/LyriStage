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
 * 值得重试的错误：网络断开、超时、服务器 5xx。
 * 网易云 API 刚启动时（冷启动）前几个请求常常 502 / 连接失败，过一会儿就好。
 * 4xx（参数错、需要登录、版权限制）重试也没用。
 * @param {unknown} err
 */
export function isRetryable(err) {
  if (!(err instanceof ApiError)) return false;
  if (err.status === undefined) return true; // 网络错误 / 超时
  return err.status >= 500;
}

const sleep = (/** @type {number} */ ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {object} options
 * @param {string} options.baseURL 例如 'http://127.0.0.1:10754' 或网页版的 '/api'
 * @param {typeof fetch} [options.fetch] 测试时可以换成假的 fetch
 * @param {number} [options.timeout] 毫秒
 * @param {Params} [options.defaultParams] 每个请求都带上的参数
 * @param {number[]} [options.retryDelays] 每次重试前等多久（毫秒），长度就是最多重试几次
 * @param {() => Promise<Record<string, string>> | Record<string, string>} [options.getHeaders]
 *   每个请求要带的 header（例如登录 token，会过期所以每次现取）
 * @returns {Http}
 */
export function createHttp({
  baseURL,
  fetch: fetchImpl = globalThis.fetch.bind(globalThis),
  timeout = 15000,
  defaultParams = {},
  retryDelays = [300, 900],
  getHeaders,
}) {
  const base = baseURL.replace(/\/+$/, '');

  async function get(path, params = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getOnce(path, params);
      } catch (err) {
        if (attempt >= retryDelays.length || !isRetryable(err)) throw err;
        await sleep(retryDelays[attempt]);
      }
    }
  }

  async function getOnce(path, params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({
      ...defaultParams,
      ...params,
    })) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const qs = query.toString();
    const url = `${base}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;

    const headers = getHeaders ? await getHeaders() : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(url, { signal: controller.signal, headers });
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
