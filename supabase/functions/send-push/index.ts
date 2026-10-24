// 送通知到手机（Supabase Edge Function send-push；Firebase Cloud Messaging HTTP v1）
// 数据库有新的表情回应、好友邀请、敲门时叫这里（见 supabase/migrations/20261104000000_push_notifications.sql）：
//   POST { user_id, kind, params }，header x-push-secret 是数据库自动产生的密码
// 这里查出那个人登记过的手机，用他的语言写好通知，一台一台送；手机已经不收了（App 删掉）的代号顺便删掉。
// 送的是资料（标题、内容、要打开哪一页、谁送的、他的头像），通知由 App 自己显示，右边才放得了头像。
//
// 部署：Supabase → Edge Functions → 新增 send-push，贴上这整个文件；「Verify JWT」要关掉（靠 x-push-secret 确认）。
// Secrets 加一个 FCM_SERVICE_ACCOUNT：Firebase → 项目设置 → 服务账号 → 生成新的私钥，
// 下载的那个 JSON 整个贴进去（这把钥匙只放在 Supabase，不放进任何文件）。

// Supabase 的服务器只认得开头写死的 import（单元测试里 vitest.config.mjs 把它换成项目装好的 supabase-js）
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---- 通知的字（纯函数，单元测试用） --------------------------------------------------

const TEXT = {
  'zh-CN': {
    reactionTitle: '{name} 回应了你 {emoji}',
    reactionNote: '你的便签「{context}」',
    reactionListening: '你在听的《{context}》',
    friendRequestTitle: '新的好友邀请',
    friendRequestBody: '{name} 想加你为好友',
    friendAcceptedTitle: '{name} 同意了你的好友邀请',
    friendAcceptedBody: '现在你们看得到彼此在听什么了',
    knockTitle: '{name} 想加入你的房间',
    knockBody: '打开 LyriStage 按「同意」',
  },
  en: {
    reactionTitle: '{name} reacted {emoji}',
    reactionNote: 'Your note: "{context}"',
    reactionListening: '"{context}", which you were playing',
    friendRequestTitle: 'New friend request',
    friendRequestBody: '{name} wants to be friends',
    friendAcceptedTitle: '{name} accepted your friend request',
    friendAcceptedBody: 'Now you can see what each other is listening to',
    knockTitle: '{name} wants to join your room',
    knockBody: 'Open LyriStage and tap Accept',
  },
};

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '').slice(0, 80));

/**
 * 一则通知的标题、内容、点了打开哪一页
 * @param {string} kind 'reaction' | 'friend_request' | 'friend_accepted' | 'knock'
 * @param {Record<string, string>} params
 * @param {string} locale 'zh-CN' | 'en'
 * @returns {{ title: string, body: string, url: string } | null} 不认识的种类回传 null
 */
export function buildMessage(kind, params, locale) {
  const t = TEXT[locale] ?? TEXT['zh-CN'];
  switch (kind) {
    case 'reaction':
      return {
        title: fill(t.reactionTitle, params),
        body: params?.context ? fill(params.target === 'note' ? t.reactionNote : t.reactionListening, params) : '',
        url: '#/friends',
      };
    case 'friend_request':
      return { title: t.friendRequestTitle, body: fill(t.friendRequestBody, params), url: '#/friends' };
    case 'friend_accepted':
      return { title: fill(t.friendAcceptedTitle, params), body: t.friendAcceptedBody, url: '#/friends' };
    case 'knock':
      return { title: fill(t.knockTitle, params), body: t.knockBody, url: '#/room' };
    default:
      return null;
  }
}

/**
 * 通知右边放的头像：只放 Supabase 上传的、GitHub、Google 的头像
 * （头像网址是用户自己填的资料，随便一个网址会让收通知的手机去连那个网站，对方就知道你的 IP）
 */
export function safeAvatar(url, supabaseUrl) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return '';
    if (u.host === new URL(supabaseUrl).host && u.pathname.startsWith('/storage/v1/object/public/avatars/')) return url;
    if (u.host === 'avatars.githubusercontent.com') return url;
    if (/^lh\d\.googleusercontent\.com$/.test(u.host)) return url;
  } catch {
    // 不是网址
  }
  return '';
}

/**
 * 送给 FCM 的一则：只放资料，由 App 自己显示通知（PushMessagingService.java），右边才放得了头像
 * @returns {object} FCM HTTP v1 的 message
 */
export function fcmMessage(token, kind, params, message, supabaseUrl) {
  return {
    token,
    data: {
      title: message.title,
      body: message.body,
      url: message.url,
      kind,
      // 注意：from 是 FCM 保留的名字，不能当资料的 key
      sender: String(params?.from ?? ''),
      avatar: safeAvatar(params?.avatar, supabaseUrl),
    },
    // 高优先：App 整个关掉、手机待机也会马上收到
    android: { priority: 'high' },
  };
}

/**
 * FCM 说这个代号已经没用了（App 删掉、换手机）：从数据库删掉。
 * INVALID_ARGUMENT 也可能是我们送的内容格式不对，只有错误讯息讲明是代号的问题才删
 */
export function isDeadToken(status, body) {
  const code = body?.error?.details?.find(d => d.errorCode)?.errorCode ?? body?.error?.status;
  if (status === 404 || code === 'UNREGISTERED') return true;
  return code === 'INVALID_ARGUMENT' && /registration token/i.test(body?.error?.message ?? '');
}

// ---- Firebase 的登入（服务账号签一张 JWT 换 access token，一小时有效） ---------------------

const base64url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const encodeJson = obj => base64url(new TextEncoder().encode(JSON.stringify(obj)));

let cachedToken = { value: '', expires: 0 };
async function accessToken(account) {
  if (cachedToken.value && Date.now() < cachedToken.expires - 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const claims = encodeJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const pem = account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`google token: ${body.error ?? res.status}`);
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

// ---- 收到数据库叫 ---------------------------------------------------------------------

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(req) {
  // @ts-ignore Deno
  const env = name => Deno.env.get(name);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const secret = req.headers.get('x-push-secret') ?? '';
  const { data: ok } = secret ? await db.rpc('push_secret_ok', { secret }) : { data: false };
  if (!ok) return json({ error: 'forbidden' }, 403);

  let account;
  try {
    account = JSON.parse(env('FCM_SERVICE_ACCOUNT') ?? '');
  } catch {
    return json({ error: 'FCM_SERVICE_ACCOUNT is missing or not JSON' }, 500);
  }

  const { user_id: userId, kind, params } = await req.json().catch(() => ({}));
  const { data: tokens, error } = await db.from('push_tokens').select('token, locale').eq('user_id', userId);
  if (error) return json({ error: error.message }, 500);

  const auth = await accessToken(account);
  let sent = 0;
  const dead = [];
  for (const { token, locale } of tokens ?? []) {
    const message = buildMessage(kind, params, locale);
    if (!message) return json({ error: `unknown kind ${kind}` }, 400);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fcmMessage(token, kind, params, message, env('SUPABASE_URL')) }),
    });
    if (res.ok) sent++;
    else if (isDeadToken(res.status, await res.json().catch(() => null))) dead.push(token);
  }
  if (dead.length) await db.from('push_tokens').delete().in('token', dead);
  return json({ sent, removed: dead.length });
}

// @ts-ignore Deno（单元测试在 Node 里跑，没有 Deno）
if (typeof Deno !== 'undefined') Deno.serve(handle);
