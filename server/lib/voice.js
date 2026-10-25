// 一起听的语音：/voice/ice（只有成员能用）
//
// 手机网络常常两边都在 NAT 后面、直接连不上，要经过中转（TURN）。中转用 Cloudflare Realtime TURN
// （每月 1,000 GB 免费；语音一路大约 50 kbps，用不完）。Cloudflare 的 key 只放在 Vercel 的环境变量，
// 这里每次拿一组短期的帐密（6 小时）交给 App，App 拿去给 RTCPeerConnection 用。

const CLOUDFLARE_URL = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const TTL_SECONDS = 6 * 60 * 60;
// 只有 STUN 的备用：Cloudflare 没设置好、或暂时拿不到时，同一个 Wi-Fi / 一般网络还是连得上
const FALLBACK = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

/**
 * @param {{ keyId?: string, apiToken?: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ status: number, body: any }>}
 */
async function handleIce({ keyId, apiToken, fetchImpl = fetch }) {
  if (!keyId || !apiToken) return { status: 200, body: { code: 200, iceServers: FALLBACK, relay: false } };
  try {
    const res = await fetchImpl(`${CLOUDFLARE_URL}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!res.ok) throw new Error(`Cloudflare 回应 ${res.status}`);
    const data = await res.json();
    // 53 端口在浏览器里常常等到逾时（Cloudflare 文件建议拿掉）
    const iceServers = (data.iceServers ?? []).map(server => ({
      ...server,
      urls: [].concat(server.urls ?? []).filter(url => !/:53(\?|$)/.test(url)),
    }));
    return { status: 200, body: { code: 200, iceServers, relay: true } };
  } catch (err) {
    return { status: 200, body: { code: 200, iceServers: FALLBACK, relay: false, msg: err.message } };
  }
}

module.exports = { handleIce, FALLBACK };
