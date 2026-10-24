// 错误是哪一种（给画面决定怎么说）：没有网络 / 服务器忙 / 太多次 / 登录过期 / 用户取消 / 其他
/** @typedef {'offline' | 'busy' | 'limit' | 'auth' | 'cancel' | 'other'} ErrorKind */

const OFFLINE = /Failed to fetch|NetworkError|Load failed|network error|ERR_INTERNET|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ECONNREFUSED/i;
const AUTH = /JWT|refresh token|not authenticated|invalid claim|session (has )?expired/i;
const LIMIT = /rate limit|too many/i;
const BUSY = /Bad Gateway|Service Unavailable|Gateway Time-?out|timed? ?out|upstream|HTTP 50\d/i;

/**
 * @param {unknown} err
 * @returns {ErrorKind}
 */
export function errorKind(err) {
  const e = /** @type {any} */ (err);
  const message = String(e?.message ?? e ?? '');
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  if (e?.name === 'AbortError' || /\bcancel/i.test(message)) return 'cancel';
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || OFFLINE.test(message)) return 'offline';
  if (status === 401 || e?.code === 'PGRST301' || e?.code === 'PGRST303' || AUTH.test(message)) return 'auth';
  // 54000：数据库里自己写的次数限制（加入房间、送表情…）
  if (status === 429 || e?.code === '54000' || LIMIT.test(message)) return 'limit';
  if (status >= 500 || BUSY.test(message)) return 'busy';
  return 'other';
}
