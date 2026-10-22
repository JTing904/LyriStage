// 邀请码管理（只有管理员能用，数据库函数会检查）
import { requireSupabase, unwrap } from './supabase';

/**
 * 一键生成邀请码
 * @param {{ maxUses?: number, note?: string }} [options]
 * @returns {Promise<string>} 新的邀请码
 */
export async function createInvite({ maxUses = 1, note } = {}) {
  return unwrap(
    await requireSupabase().rpc('admin_create_invite', {
      max_uses: maxUses,
      note: note || null,
    })
  );
}

/**
 * 最近生成的邀请码（新的在前）
 * grantsAdmin：管理员邀请码（用它注册的人也会是管理员，不要给朋友）
 * @returns {Promise<Array<{ code: string, maxUses: number, usedCount: number, note: string | null, grantsAdmin: boolean, createdAt: string }>>}
 */
export async function listInvites(maxRows = 30) {
  const rows = unwrap(
    await requireSupabase().rpc('admin_list_invites', { max_rows: maxRows })
  );
  return rows.map(r => ({
    code: r.code,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    note: r.note,
    grantsAdmin: Boolean(r.grants_admin),
    createdAt: r.created_at,
  }));
}

/**
 * 管理员：数据库用了多少空间（整个数据库 + 最大的几张表），单位 byte
 * @returns {Promise<{ total: number, tables: Array<{ name: string, bytes: number }> }>}
 */
export async function adminStorageUsage() {
  const rows = unwrap(await requireSupabase().rpc('admin_storage_usage'));
  const total = rows.find(r => r.name === 'database')?.bytes ?? 0;
  // files：File storage 用了多少（还没执行 2026-10-28 那份 SQL 时没有这一行）
  const files = rows.find(r => r.name === 'files')?.bytes;
  return {
    total: Number(total),
    files: files == null ? null : Number(files),
    tables: rows
      .filter(r => r.name !== 'database' && r.name !== 'files')
      .map(r => ({ name: r.name, bytes: Number(r.bytes) })),
  };
}
