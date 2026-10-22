// 两件排程的工作（Supabase Edge Function；Supabase 上部署的名字是 smart-responder）：
// - 每月：旧听歌记录搬去 File storage（见 supabase/migrations/20261028020000_archive_old_history.sql）
// - 每周：备份重要资料（body 是 {"task": "backup"}，见 20261029020000_weekly_backup.sql）
//
// 每个人每一年：把两年以前的每月小结压缩成 <user id>/<年>.json.gz 放进 history-archive 桶，
// 下载回来确认内容齐全了，才叫 finish_archive 从数据库删掉（行数对不上就整个取消）。
// 同一年分好几个月搬时会合并进同一个文件（同一首歌同一个月以数据库的为准，重跑也不会重复算）。
//
// 部署：Supabase → Edge Functions → 新增 archive-history，贴上这整个文件；
// 「Verify JWT」要关掉（排程不带登录，靠 x-archive-secret 这组密码确认）。
// 手动测试（不会删任何东西）：POST {"dryRun": true, "keepMonths": 0}，会把文件存到 dry-run-<年>.json.gz、确认后删掉

// Supabase 的服务器只认得开头写死的 import（单元测试里 vitest.config.mjs 把它换成项目装好的 supabase-js）
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'history-archive';
const BACKUP_BUCKET = 'backups';
const KEEP_BACKUPS = 8; // 留最近 8 份（每周一份 = 两个月）
/** 要备份的表：会自己重新产生的（每日推荐、一起听、正在听、错误回报）不备份 */
const BACKUP_TABLES = [
  'members',
  'invite_codes',
  'member_profiles',
  'friendships',
  'liked_tracks',
  'disliked_tracks',
  'playlists',
  'playlist_tracks',
  'playlist_editors',
  'tracks',
  'plays',
  'play_history_monthly',
  'play_hours_monthly',
  'play_archive_totals',
  'bilibili_picks',
];
const MIN_KEEP_MONTHS = 24; // 真的搬时至少留两年
const PAGE = 1000;

// ---- 文件内容（纯函数，单元测试用） ----------------------------------------------

/**
 * 合并文件：同一首歌同一个月、同一个月同一个小时，新的取代旧的
 * @param {object | null} existing 原本的文件内容
 * @param {Array<object>} months play_history_monthly 的行
 * @param {Array<object>} hours play_hours_monthly 的行
 * @param {{ userId: string, year: number }} who
 */
export function buildArchive(existing, months, hours, { userId, year }) {
  const monthKey = r => `${r.month}|${r.source}|${r.track_id}`;
  const hourKey = r => `${r.month}|${r.hour}`;
  const strip = r => {
    const { user_id: _drop, ...rest } = r;
    return rest;
  };
  const byMonth = new Map((existing?.months ?? []).map(r => [monthKey(r), r]));
  for (const r of months) byMonth.set(monthKey(r), strip(r));
  const byHour = new Map((existing?.hours ?? []).map(r => [hourKey(r), r]));
  for (const r of hours) byHour.set(hourKey(r), strip(r));
  const sort = (a, b) => String(a.month).localeCompare(String(b.month));
  return {
    app: 'LyriStage',
    kind: 'listening-history-archive',
    version: 1,
    userId,
    year,
    updatedAt: new Date().toISOString(),
    months: [...byMonth.values()].sort(sort),
    hours: [...byHour.values()].sort(sort),
  };
}

/** 文件里是不是都有这些行（存好以后下载回来核对） */
export function containsAll(archive, months, hours) {
  const monthKeys = new Set(archive.months.map(r => `${r.month}|${r.source}|${r.track_id}|${r.plays}|${r.listened_seconds}`));
  const hourKeys = new Set(archive.hours.map(r => `${r.month}|${r.hour}|${r.seconds}`));
  return (
    months.every(r => monthKeys.has(`${r.month}|${r.source}|${r.track_id}|${r.plays}|${r.listened_seconds}`)) &&
    hours.every(r => hourKeys.has(`${r.month}|${r.hour}|${r.seconds}`))
  );
}

/** @param {unknown} value */
export async function gzipJson(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Blob} blob */
export async function gunzipJson(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/**
 * 留最近 keep 份备份，回传要删掉的（文件名是 YYYY-MM-DD.json.gz，照名字排就是照日期排）
 * @param {string[]} names
 * @param {number} keep
 */
export function backupsToRemove(names, keep = KEEP_BACKUPS) {
  const backups = names.filter(n => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

// ---- 每周备份 --------------------------------------------------------------------

async function fetchTable(db, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.from(table).select('*').range(offset, offset + PAGE - 1);
    if (error) {
      // 这个数据库没有这张表（还没执行那份 SQL）：跳过
      if (error.code === '42P01' || error.code === 'PGRST205') return null;
      throw error;
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** 账号：只留邮箱、注册时间、登录方式、自定义名字和头像（没有密码） */
async function fetchUsers(db) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        provider: u.app_metadata?.provider ?? null,
        custom_name: u.user_metadata?.custom_name ?? null,
        custom_avatar: u.user_metadata?.custom_avatar ?? null,
      });
    }
    if (data.users.length < 1000) return users;
  }
}

async function backup(db) {
  const tables = {};
  const counts = {};
  for (const table of BACKUP_TABLES) {
    const rows = await fetchTable(db, table);
    if (rows === null) continue;
    tables[table] = rows;
    counts[table] = rows.length;
  }
  const users = await fetchUsers(db);
  counts.users = users.length;
  const now = new Date();
  const name = `${now.toISOString().slice(0, 10)}.json.gz`;
  const bytes = await gzipJson({ app: 'LyriStage', kind: 'backup', version: 1, createdAt: now.toISOString(), users, tables });
  const { error: uploadError } = await db.storage
    .from(BACKUP_BUCKET)
    .upload(name, bytes, { contentType: 'application/gzip', upsert: true });
  if (uploadError) throw uploadError;

  // 下载回来核对每张表的行数
  const { data: blob, error: downloadError } = await db.storage.from(BACKUP_BUCKET).download(name);
  if (downloadError) throw downloadError;
  const saved = await gunzipJson(blob);
  const ok =
    saved.users.length === users.length &&
    Object.entries(tables).every(([t, rows]) => saved.tables[t]?.length === rows.length);
  if (!ok) throw new Error(`${name} 存好后内容不齐`);

  // 只留最近几份
  const { data: files } = await db.storage.from(BACKUP_BUCKET).list('', { limit: 1000 });
  const remove = backupsToRemove((files ?? []).map(f => f.name));
  if (remove.length) await db.storage.from(BACKUP_BUCKET).remove(remove);
  return { ok: true, task: 'backup', file: name, kb: Math.round(bytes.length / 1024), counts, removed: remove };
}

// ---- 搬家 ------------------------------------------------------------------------

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchAll(db, table, uid, from, until) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .eq('user_id', uid)
      .gte('month', from)
      .lt('month', until)
      .order('month')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function download(db, path) {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) return null; // 还没有这个文件
  return gunzipJson(data);
}

async function archiveOne(db, group, dryRun) {
  const { user_id: uid, year, until } = group;
  const from = `${year}-01-01`;
  const [months, hours] = await Promise.all([
    fetchAll(db, 'play_history_monthly', uid, from, until),
    fetchAll(db, 'play_hours_monthly', uid, from, until),
  ]);
  const path = `${uid}/${year}.json.gz`;
  const archive = buildArchive(await download(db, path), months, hours, { userId: uid, year });
  const target = dryRun ? `${uid}/dry-run-${year}.json.gz` : path;
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(target, await gzipJson(archive), { contentType: 'application/gzip', upsert: true });
  if (uploadError) throw uploadError;

  // 下载回来核对，确定存好了才删
  const saved = await download(db, target);
  if (!saved || !containsAll(saved, months, hours)) throw new Error(`${target} 存好后内容不齐，没有删任何资料`);

  if (dryRun) {
    await db.storage.from(BUCKET).remove([target]);
    return { user: uid, year, months: months.length, hours: hours.length, dryRun: true };
  }
  const { error } = await db.rpc('finish_archive', {
    uid,
    year,
    until,
    expected_months: months.length,
    expected_hours: hours.length,
  });
  if (error) throw error;
  return { user: uid, year, months: months.length, hours: hours.length };
}

async function handle(req) {
  // @ts-ignore Deno
  const env = name => Deno.env.get(name);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const secret = req.headers.get('x-archive-secret') ?? '';
  if (!secret) return json({ error: 'forbidden', reason: 'no secret' }, 403);
  // 检查失败时说明是哪一步（不会透露密码本身），方便看是数据库还是密码的问题
  const { data: ok, error: checkError } = await db.rpc('archive_secret_ok', { secret });
  if (checkError) return json({ error: 'forbidden', reason: `check failed: ${checkError.message}` }, 403);
  if (!ok) return json({ error: 'forbidden', reason: 'wrong secret' }, 403);

  const body = await req.json().catch(() => ({}));
  if (body?.task === 'backup') {
    try {
      return json(await backup(db));
    } catch (err) {
      return json({ ok: false, task: 'backup', error: err?.message ?? String(err) }, 500);
    }
  }
  const dryRun = body?.dryRun === true;
  // 只有试跑可以改「留几个月」（拿来测试）；真的搬至少留两年
  const keepMonths = dryRun && Number.isInteger(body?.keepMonths) ? Math.max(0, body.keepMonths) : MIN_KEEP_MONTHS;

  const { data: groups, error } = await db.rpc('archive_candidates', { keep_months: keepMonths });
  if (error) return json({ error: error.message }, 500);

  const done = [];
  const failed = [];
  for (const group of groups) {
    try {
      done.push(await archiveOne(db, group, dryRun));
    } catch (err) {
      // 一个人失败不影响别人；这个人的资料原封不动，下个月再试
      failed.push({ user: group.user_id, year: group.year, error: err?.message ?? String(err) });
    }
  }
  return json({ ok: failed.length === 0, dryRun, keepMonths, done, failed }, failed.length ? 500 : 200);
}

// @ts-ignore Deno（单元测试在 Node 里跑，没有 Deno）
if (typeof Deno !== 'undefined') Deno.serve(handle);
