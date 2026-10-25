// 错误自动回报：App 出错、播不了、歌词载不出来时记一笔给管理员（core/data/errors.js）。
// - 只有成员会回报（数据库也会挡）
// - 同一个错误这次打开 App 只报一次，最多报 20 笔
// - 不是 App 的问题的不报：断网、浏览器还不让出声、切歌时被打断……
import { reportError } from '@core/data';
import { version } from '../../../package.json';
import { isElectron, isNativeApp } from './platform';

const MAX_PER_SESSION = 20;
const platform = isElectron
  ? 'windows'
  : isNativeApp
    ? 'android'
    : /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? 'iphone'
      : 'web';

/** 不是 App 本身的问题（或修不了的）就不报 */
const NOISE = [
  /ResizeObserver loop/i,
  /AbortError|The play\(\) request was interrupted|NotAllowedError/i,
  /Failed to fetch|NetworkError|Load failed|network error/i,
  /^Script error\.?$/i,
];

let allowed = () => false;
const sent = new Set();

/**
 * @param {'crash' | 'playback' | 'unplayable' | 'lyrics'} kind
 * @param {string} message
 * @param {{ detail?: string | null, context?: object | null }} [extra]
 */
export function report(kind, message, { detail = null, context = null } = {}) {
  if (!allowed() || !navigator.onLine) return;
  const text = String(message || '');
  if (NOISE.some(re => re.test(text))) return;
  const key = `${kind}|${text}|${context?.trackId ?? ''}`;
  if (sent.has(key) || sent.size >= MAX_PER_SESSION) return;
  sent.add(key);
  reportError({
    kind,
    message: text,
    detail,
    platform,
    appVersion: version,
    context: { ...context, route: location.hash.slice(1, 120) || '/' },
  });
}

/** 歌曲的简短资料（错误里只放这些） */
export const trackContext = track =>
  track
    ? {
        trackId: track.id,
        song: track.name,
        artist: (track.ar ?? []).map(a => a.name).join(' / '),
      }
    : null;

/**
 * App 启动时装上：没接住的错误、Vue 画面出错
 * @param {import('vue').App} app
 * @param {() => boolean} isMember 现在是不是成员
 */
export function installErrorReporting(app, isMember) {
  allowed = isMember;
  window.addEventListener('error', event => {
    report('crash', event.message, {
      detail: event.error?.stack ?? null,
      context: { where: `${event.filename?.split('/').pop() ?? ''}:${event.lineno ?? ''}` },
    });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    report('crash', reason?.message ?? String(reason), { detail: reason?.stack ?? null });
  });
  app.config.errorHandler = (err, _instance, info) => {
    console.error(err);
    report('crash', err?.message ?? String(err), { detail: err?.stack ?? null, context: { vue: info } });
  };
}
