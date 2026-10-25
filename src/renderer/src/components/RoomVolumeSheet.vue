<script setup>
// 一起听的音量面板：音乐、语音分开调，有人讲话时音乐变多小（roomVolume.js，只记在这台设备）
// 用法：sheet.value.open()
import { ref } from 'vue';
import { roomVolume, saveRoomVolume } from '../roomVolume';

const dialog = ref(null);
const open = () => dialog.value.showModal();
defineExpose({ open });

const DUCK_OPTIONS = [
  { id: 'off', label: '不变' },
  { id: 'some', label: '小一点' },
  { id: 'lots', label: '很小' },
];
const percent = value => `${Math.round(value * 100)}%`;
</script>

<template>
  <dialog ref="dialog" class="room-volume" @click.self="dialog.close()">
    <div class="box">
      <div class="grab" aria-hidden="true" />
      <h3>{{ $t('房间音量') }}</h3>
      <label class="row">
        <span class="name">{{ $t('音乐') }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="roomVolume.music"
          :aria-label="$t('音乐')"
          @input="saveRoomVolume({ music: Number($event.target.value) })"
        />
        <span class="pct">{{ percent(roomVolume.music) }}</span>
      </label>
      <label class="row">
        <span class="name">{{ $t('语音') }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="roomVolume.voice"
          :aria-label="$t('语音')"
          @input="saveRoomVolume({ voice: Number($event.target.value) })"
        />
        <span class="pct">{{ percent(roomVolume.voice) }}</span>
      </label>
      <p class="label">
        {{ $t('有人说话时，音乐') }}
        <small>{{ $t('别人开口讲话时自动变小，讲完恢复') }}</small>
      </p>
      <div class="segmented" role="radiogroup" :aria-label="$t('有人说话时，音乐')">
        <button
          v-for="option in DUCK_OPTIONS"
          :key="option.id"
          role="radio"
          :aria-checked="roomVolume.duck === option.id"
          :class="{ on: roomVolume.duck === option.id }"
          @click="saveRoomVolume({ duck: option.id })"
        >
          {{ $t(option.label) }}
        </button>
      </div>
      <p class="note">{{ $t('只调你这台设备听到的声音。') }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.room-volume {
  width: min(420px, calc(100vw - 24px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.room-volume::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: grid;
  gap: 14px;
  padding: 22px 20px 20px;
}
.grab {
  display: none;
}
h3 {
  margin: 0 0 4px;
  font-size: 19px;
}
.row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 12px;
}
.name {
  font-size: 15px;
  font-weight: 700;
}
input[type='range'] {
  width: 100%;
  height: 32px;
  margin: 0;
  accent-color: var(--accent);
}
.pct {
  text-align: right;
  font-size: 13px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.label {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 700;
}
.label small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
}
.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-hover);
}
.segmented button {
  flex: 1;
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.segmented button.on {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}
.note {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-dim);
}

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .room-volume {
    width: 100vw;
    max-width: 100vw;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .room-volume[open] {
    animation: up 0.22s ease-out;
  }
  .box {
    padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
  }
  .grab {
    display: block;
    width: 40px;
    height: 5px;
    margin: 0 auto 6px;
    border-radius: 3px;
    background: var(--line-strong);
  }
}
@keyframes up {
  from {
    transform: translateY(40px);
    opacity: 0;
  }
}
</style>
