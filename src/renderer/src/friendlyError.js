// 出错时说人话：把错误分成「没有网络 / 服务器忙 / 太多次 / 登录过期 / 其他」，
// 按种类说要怎么办，不把 "TypeError: Failed to fetch" 这种原文给用户看。
// 「其他」（看不懂的、App 自己的问题）原文照样放进错误回报，管理员页面看得到
import { errorKind } from '@core/http/errorKind';
import { t } from './i18n';
import { report } from './errorReporter';
import { useNoticeStore } from './stores/notice';
import { useAuthStore } from './stores/auth';

/**
 * 一句话说明（「其他」会顺便回报原文）
 * @param {unknown} err
 * @param {string} failed 做什么没成功（已翻译），例如 t('歌没加进歌单')
 * @returns {{ kind: import('@core/http/errorKind').ErrorKind, message: string }}
 */
export function explainError(err, failed) {
  const kind = errorKind(err);
  if (kind === 'other') {
    const e = /** @type {any} */ (err);
    report('crash', String(e?.message ?? e ?? ''), { detail: failed, context: { action: failed } });
  }
  const message = {
    offline: t('没有网络，{failed}', { failed }),
    busy: t('服务器有点忙，等一下再试'),
    limit: t('太多次了，等一分钟再试'),
    auth: t('登录过期了'),
    cancel: '',
    other: t('{failed}，已经自动回报', { failed }),
  }[kind];
  return { kind, message };
}

/**
 * App 自己丢出的中文错误（例如「没有麦克风权限…」、数据库函数的说明）本来就看得懂，照用（换成目前的语言）；
 * 其他的才换成「没有网络…」这种说法
 * @param {unknown} err
 * @param {string} failed
 */
export function humanMessage(err, failed) {
  const e = /** @type {any} */ (err);
  const message = String(e?.message ?? e ?? '');
  return /[\u4e00-\u9fff]/.test(message) ? t(message) : explainError(err, failed).message;
}

/** 登录过期：退出再去登录页 */
export async function loginAgain() {
  await useAuthStore().logout();
  location.hash = '#/login';
}

/**
 * 下方的提示：能补救的附一个按钮（重试 / 重新登录）；用户自己取消的不说
 * @param {unknown} err
 * @param {string} failed
 * @param {{ retry?: () => void }} [options]
 */
export function showError(err, failed, { retry } = {}) {
  const { kind, message } = explainError(err, failed);
  if (kind === 'cancel') return;
  let action;
  if (kind === 'auth') action = { label: t('重新登录'), run: loginAgain };
  else if (retry && kind !== 'limit') action = { label: t('重试'), run: retry };
  useNoticeStore().show(message, { action, duration: 5000 });
}
