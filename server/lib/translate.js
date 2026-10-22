// 歌词英文翻译：/lyric/translate?id=歌曲ID&to=en
//
// 网易云只有中文翻译，英文用微软翻译（Azure Translator，免费方案每月 200 万字）。
// 同一首歌只翻一次：翻好的存进 Supabase 的 lyric_translations，之后谁听都直接拿。
// 只有服务器写得进去（要带 LYRIC_CACHE_SECRET，见 supabase/migrations/20261030000000_lyric_translations.sql），
// 成员只能读，免得有人塞假的翻译给大家看。
//
// 回传 { lyric: '[00:12.34]English line\n…' }（LRC，跟网易云的翻译同样格式，App 照时间挂到原文下面）；
// 本来就是英文、或没有歌词的回传 { lyric: '' }

const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate';
const LANGS = new Set(['en']);
// Azure 一次最多 1000 段、5 万字
const MAX_ITEMS = 1000;
const MAX_CHARS = 50000;

// 中日韩文字（汉字、假名、韩文）：一句都没有就不用翻
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
const TIME_TAG = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/;

/**
 * LRC → 要翻的行：[{ tags: '[00:12.34]', text }]（空行、只有时间的行跳过）
 * @param {string} lrc
 */
function lrcLines(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const m = raw.trim().match(TIME_TAG);
    if (!m) continue;
    const text = m[2].trim();
    if (text) lines.push({ tags: m[1], text });
  }
  return lines;
}

/** 需不需要翻成英文：至少有一句是中日韩文字 */
function needsTranslation(lines) {
  return lines.some(l => CJK.test(l.text));
}

/**
 * 叫 Azure 翻译；重复的句子（副歌）只送一次
 * @param {string[]} texts
 * @param {{ key: string, region?: string, to: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<Map<string, string>>} 原文 → 译文
 */
async function azureTranslate(texts, { key, region, to, fetchImpl = fetch }) {
  const unique = [...new Set(texts)];
  const result = new Map();
  for (let i = 0; i < unique.length; ) {
    // 每批不超过 1000 段、5 万字
    const batch = [];
    let chars = 0;
    while (i < unique.length && batch.length < MAX_ITEMS && chars + unique[i].length <= MAX_CHARS) {
      chars += unique[i].length;
      batch.push(unique[i++]);
    }
    if (!batch.length) batch.push(unique[i++].slice(0, MAX_CHARS));
    const headers = { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' };
    if (region) headers['Ocp-Apim-Subscription-Region'] = region;
    const res = await fetchImpl(`${AZURE_ENDPOINT}?api-version=3.0&to=${encodeURIComponent(to)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch.map(Text => ({ Text }))),
    });
    if (!res.ok) {
      const err = new Error(`翻译服务回应 ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    batch.forEach((text, k) => result.set(text, data[k]?.translations?.[0]?.text ?? ''));
  }
  return result;
}

/**
 * 把一首歌的 LRC 翻成英文 LRC（时间标签照旧）
 * @param {string} lrc
 * @param {Parameters<typeof azureTranslate>[1]} options
 */
async function translateLrc(lrc, options) {
  const lines = lrcLines(lrc);
  if (!needsTranslation(lines)) return '';
  // 本来就是英文的句子（中文歌里夹的英文）不送去翻，原样也不重复显示
  const toSend = lines.filter(l => CJK.test(l.text)).map(l => l.text);
  const translated = await azureTranslate(toSend, options);
  return lines
    .filter(l => CJK.test(l.text))
    .map(l => `${l.tags}${(translated.get(l.text) || '').trim()}`)
    .filter(line => !/\]$/.test(line))
    .join('\n');
}

/**
 * 处理 /lyric/translate
 * @param {import('http').IncomingMessage} req
 * @param {URL} url
 * @param {{
 *   supabaseUrl?: string, anonKey?: string, azureKey?: string, azureRegion?: string, cacheSecret?: string,
 *   fetchLyric: (id: string) => Promise<string>, fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<{ status: number, body: any }>}
 */
async function handleTranslate(req, url, options) {
  const { supabaseUrl, anonKey, azureKey, azureRegion, cacheSecret, fetchLyric, fetchImpl = fetch } = options;
  const id = url.searchParams.get('id') ?? '';
  const to = url.searchParams.get('to') ?? 'en';
  if (!/^\d{1,15}$/.test(id) || !LANGS.has(to)) return { status: 400, body: { code: 400, msg: '参数不对' } };
  if (!azureKey || !supabaseUrl || !anonKey) return { status: 503, body: { code: 503, msg: '翻译还没设置好' } };

  const auth = req.headers.authorization || '';
  const supabaseHeaders = { apikey: anonKey, Authorization: auth, 'Content-Type': 'application/json' };

  // 1. 翻过了：直接拿（成员才读得到）
  try {
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/lyric_translations?song_id=eq.${id}&lang=eq.${to}&select=lyric`,
      { headers: supabaseHeaders }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows.length) return { status: 200, body: { code: 200, lyric: rows[0].lyric, cached: true } };
    }
  } catch {
    // 读不到缓存就重新翻
  }

  // 2. 拿歌词、翻译
  const lrc = await fetchLyric(id);
  let lyric;
  try {
    lyric = await translateLrc(lrc, { key: azureKey, region: azureRegion, to, fetchImpl });
  } catch (err) {
    // 403：这个月的免费额度用完了（Azure 免费方案不会扣钱，只会停到下个月）
    const status = err.status === 403 || err.status === 429 ? 503 : 502;
    return { status, body: { code: status, msg: err.message } };
  }

  // 3. 存起来给大家用（存不进去也照样回传）
  if (cacheSecret && lrc) {
    try {
      await fetchImpl(`${supabaseUrl}/rest/v1/rpc/save_lyric_translation`, {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({ secret: cacheSecret, p_song_id: Number(id), p_lang: to, p_lyric: lyric }),
      });
    } catch {
      // 下次再存
    }
  }
  return { status: 200, body: { code: 200, lyric, cached: false } };
}

module.exports = { handleTranslate, translateLrc, lrcLines, needsTranslation, azureTranslate };
