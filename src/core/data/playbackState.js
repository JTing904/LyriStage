// 换设备接着听：每个账号只有一笔「现在播到哪」（supabase/migrations/20261106000000_playback_state.sql）
import { requireSupabase } from './supabase';
import { toSnapshot } from './track';
import { isMissingTable } from './friends';

/**
 * 记下现在播到哪（同一笔一直更新）
 * @param {{ track: object, position: number, deviceId: string, deviceName: string }} state
 */
export async function savePlaybackState({ track, position, deviceId, deviceName }) {
  const { error } = await requireSupabase()
    .from('playback_state')
    .upsert(
      {
        track: toSnapshot(track),
        position: Math.max(0, Math.round(position * 10) / 10),
        device_id: deviceId,
        device_name: deviceName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  // 数据库还没执行那份 SQL：先不记
  if (error && !isMissingTable(error)) throw error;
}

/**
 * 上次在哪台设备播到哪（没有、或数据库还没执行那份 SQL：null）
 * @returns {Promise<{ track: object, position: number, deviceId: string, deviceName: string, updatedAt: string } | null>}
 */
export async function getPlaybackState() {
  const { data, error } = await requireSupabase()
    .from('playback_state')
    .select('track, position, device_id, device_name, updated_at')
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!data) return null;
  return {
    track: { ...data.track, playable: true, reason: '' },
    position: data.position,
    deviceId: data.device_id,
    deviceName: data.device_name,
    updatedAt: data.updated_at,
  };
}
