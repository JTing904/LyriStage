<script setup>
// 均衡器：预设一排、10 条直的滑杆（往上加大、往下减小），设置页里用
import { computed } from 'vue';
import { BANDS, MAX_DB, PRESETS, matchPreset } from '@core/audio/equalizer';

const props = defineProps({
  /** audioEffects.settings（直接改就会生效） */
  settings: { type: Object, required: true },
});

const current = computed(() => matchPreset(props.settings.gains));
const label = hz => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const signed = db => (db > 0 ? `+${db}` : String(db));

function choose(preset) {
  props.settings.gains = [...preset.gains];
}
function setBand(i, value) {
  const gains = [...props.settings.gains];
  gains[i] = Number(value);
  props.settings.gains = gains;
}
</script>

<template>
  <div class="eq">
    <div class="presets" role="radiogroup" :aria-label="$t('均衡器预设')">
      <button
        v-for="p in PRESETS"
        :key="p.id"
        class="chip"
        role="radio"
        :aria-checked="current === p.id"
        :class="{ on: current === p.id }"
        @click="choose(p)"
      >
        {{ $t(p.name) }}
      </button>
      <span v-if="current === null" class="chip on custom">{{ $t('自定义') }}</span>
    </div>

    <div class="bands">
      <label v-for="(hz, i) in BANDS" :key="hz" class="band">
        <span class="db">{{ signed(settings.gains[i]) }}</span>
        <input
          type="range"
          :min="-MAX_DB"
          :max="MAX_DB"
          step="1"
          :value="settings.gains[i]"
          :aria-label="$t('{hz} Hz', { hz: label(hz) })"
          :aria-valuetext="`${signed(settings.gains[i])} dB`"
          @input="setBand(i, $event.target.value)"
          @dblclick="setBand(i, 0)"
        />
        <span class="hz">{{ label(hz) }}</span>
      </label>
    </div>
    <p class="note">{{ $t('往上是加大、往下是减小（dB）。双击一条滑杆回到 0') }}</p>
  </div>
</template>

<style scoped>
.eq {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}
/* 预设：手机上一排放不下就左右滑 */
.presets {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0 -4px;
  padding: 0 4px;
}
.chip {
  flex: none;
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 30px;
  cursor: pointer;
}
.chip.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.chip.custom {
  cursor: default;
}

.bands {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 2px;
}
.band {
  display: grid;
  justify-items: center;
  gap: 6px;
  min-width: 0;
}
.db,
.hz {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  white-space: nowrap;
}
.hz {
  color: var(--text-faint);
}
/* 直的滑杆：往上是加大 */
input[type='range'] {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 28px;
  height: 150px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
  touch-action: none;
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}
</style>
