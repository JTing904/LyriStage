// 一起听的音量（只记在这台设备）：房间里的音乐大小、语音大小、有人讲话时音乐变多小。
// 音乐只在房间里才乘上去（离开房间就回到平常的音量）；语音套在每个人的声音上（stores/voice.js）
import { reactive } from 'vue';

const KEY = 'lyristage:room-volume';
/** 有人讲话时音乐变成原本的几倍 */
export const DUCK_LEVELS = { off: 1, some: 0.35, lots: 0.15 };

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {};
  } catch {
    return {};
  }
}

export const roomVolume = reactive({ music: 1, voice: 1, duck: 'some', ...read() });

/** @param {Partial<{ music: number, voice: number, duck: keyof DUCK_LEVELS }>} patch */
export function saveRoomVolume(patch) {
  Object.assign(roomVolume, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify({ music: roomVolume.music, voice: roomVolume.voice, duck: roomVolume.duck }));
  } catch {
    // 存不了就只在这次有效
  }
}
