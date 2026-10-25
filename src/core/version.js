// 版本号比较（"2.1.10" 比 "2.1.9" 新），给手机 App 检查有没有新版本用

/** "v2.1.0" / "2.1.0" → [2, 1, 0]；不是版本号的部分当 0 */
const parts = version =>
  String(version ?? '')
    .replace(/^v/i, '')
    .split('.')
    .map(n => Number.parseInt(n, 10) || 0);

/** a 比 b 新 */
export function isNewerVersion(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
