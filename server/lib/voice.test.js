import { describe, it, expect } from 'vitest';
import { handleIce, FALLBACK } from './voice';

describe('handleIce', () => {
  it('没设置 Cloudflare：只给 STUN', async () => {
    const r = await handleIce({});
    expect(r.body).toMatchObject({ iceServers: FALLBACK, relay: false });
  });

  it('跟 Cloudflare 拿短期帐密，拿掉 53 端口', async () => {
    let call = null;
    const fetchImpl = async (url, init) => {
      call = { url, init };
      return {
        ok: true,
        json: async () => ({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
              username: 'u',
              credential: 'c',
            },
          ],
        }),
      };
    };
    const r = await handleIce({ keyId: 'KEY', apiToken: 'TOKEN', fetchImpl });
    expect(call.url).toContain('/turn/keys/KEY/credentials/generate-ice-servers');
    expect(call.init.headers.Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(call.init.body).ttl).toBeGreaterThan(3600);
    expect(r.body.relay).toBe(true);
    expect(r.body.iceServers[0].urls).toEqual(['stun:stun.cloudflare.com:3478']);
    expect(r.body.iceServers[1].urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
    expect(r.body.iceServers[1]).toMatchObject({ username: 'u', credential: 'c' });
  });

  it('Cloudflare 出错：退回只有 STUN，不让 App 卡住', async () => {
    const r = await handleIce({ keyId: 'K', apiToken: 'T', fetchImpl: async () => ({ ok: false, status: 401 }) });
    expect(r.body).toMatchObject({ iceServers: FALLBACK, relay: false });
  });
});
