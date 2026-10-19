<script setup>
// 歌词风格选择：9 张小缩略图（每张是那种风格的迷你示意），3 列排列
import { LYRIC_STYLES } from './styles';

defineProps({
  current: { type: String, required: true },
  showTranslation: { type: Boolean, required: true },
});
const emit = defineEmits(['select', 'update:showTranslation']);
</script>

<template>
  <div class="picker" role="dialog" aria-label="歌词风格">
    <div class="grid">
      <button
        v-for="s in LYRIC_STYLES"
        :key="s.id"
        class="option"
        :class="{ active: s.id === current }"
        :title="s.description"
        :aria-pressed="s.id === current"
        @click="emit('select', s.id)"
      >
        <span class="thumb" :class="`t-${s.id}`" aria-hidden="true">
          <!-- 每种风格的迷你示意 -->
          <template v-if="s.id === 'kinetic'"><b class="big">歌词</b></template>
          <template v-else-if="s.id === 'perspective'">
            <i class="bar w8" /><i class="bar w6 hi" /><i class="bar w7" /><i
              class="bar w5"
            />
          </template>
          <template v-else-if="s.id === 'scroll'">
            <i class="bar w5" /><i class="bar w8 hi" /><i class="bar w6" />
          </template>
          <template v-else-if="s.id === 'block'">
            <i class="bar w7 hi" /><i class="bar w8 hi" /><i class="bar w6" />
          </template>
          <template v-else-if="s.id === 'karaoke'">
            <i class="bar w6 gold" /><i class="bar w6 right" />
          </template>
          <template v-else-if="s.id === 'vertical'">
            <b class="brush">诗词</b><i class="seal" />
          </template>
          <template v-else-if="s.id === 'mv'">
            <b class="pop a">LO</b><b class="pop b">VE</b>
          </template>
          <template v-else-if="s.id === 'typewriter'"
            ><b class="term">&gt; 歌_</b></template
          >
          <template v-else-if="s.id === 'vinyl'"><i class="disc" /></template>
        </span>
        <span class="name">{{ s.name }}</span>
      </button>
    </div>

    <label class="switch-row">
      <span>显示翻译 / 罗马音</span>
      <input
        type="checkbox"
        role="switch"
        :checked="showTranslation"
        @change="emit('update:showTranslation', $event.target.checked)"
      />
      <span class="switch" aria-hidden="true" />
    </label>
  </div>
</template>

<style scoped>
.picker {
  width: min(372px, calc(100vw - 24px));
  padding: 14px;
  border-radius: 18px;
  background: rgba(20, 20, 22, 0.86);
  backdrop-filter: blur(20px) saturate(1.4);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  display: grid;
  gap: 14px;
  color: #fff;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 10px;
}
.option {
  display: grid;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  text-align: center;
}
.thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  aspect-ratio: 4 / 3;
  padding: 0 12%;
  border-radius: 10px;
  overflow: hidden;
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: outline-color 0.2s, transform 0.2s;
}
.option:hover .thumb {
  transform: translateY(-2px);
}
.option.active .thumb {
  outline-color: #fff;
}
.option:focus-visible .thumb {
  outline-color: rgba(255, 255, 255, 0.7);
}
.name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}
.option.active .name {
  color: #fff;
  font-weight: 700;
}

/* 缩略图里的"歌词线条" */
.bar {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.4);
}
.bar.hi {
  background: #fff;
}
.w5 {
  width: 50%;
}
.w6 {
  width: 60%;
}
.w7 {
  width: 70%;
}
.w8 {
  width: 80%;
}

.t-kinetic {
  align-items: center;
  background: radial-gradient(ellipse at center, #4a5a53, #141a18);
}
.t-kinetic .big {
  font: 900 22px/1 'Noto Serif SC', serif;
  color: #e3e9e5;
  letter-spacing: 0.04em;
}
.t-perspective {
  background: linear-gradient(135deg, #b8577a, #f3b46c 60%, #5b3d7a);
  perspective: 80px;
}
.t-perspective .bar {
  transform: rotateY(28deg);
  transform-origin: left;
}
.t-scroll {
  background: radial-gradient(circle at 20% 20%, #ff5a76, transparent 60%),
    radial-gradient(circle at 80% 80%, #6c4fd6, transparent 60%), #2a1b33;
}
.t-scroll .bar:not(.hi) {
  opacity: 0.6;
}
.t-block {
  background: #2f8f7b;
}
.t-block .bar:not(.hi) {
  background: rgba(0, 0, 0, 0.35);
}
.t-karaoke {
  justify-content: flex-end;
  padding-bottom: 14%;
  background: linear-gradient(#3b2a33, #1c1418);
}
.t-karaoke .gold {
  background: #ffd23f;
}
.t-karaoke .right {
  align-self: flex-end;
}
.t-vertical {
  align-items: center;
  background: #efe6d2;
}
.t-vertical .brush {
  writing-mode: vertical-rl;
  font: 400 18px/1 'Ma Shan Zheng', 'KaiTi', serif;
  color: #1d1a16;
}
.t-vertical .seal {
  position: absolute;
  left: 14%;
  bottom: 14%;
  width: 10px;
  height: 14px;
  background: #b3261e;
  border-radius: 2px;
}
.t-mv {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: linear-gradient(135deg, #ff4d6d, #7b2cbf);
}
.t-mv .pop {
  font: 900 18px/1 'Noto Sans SC', sans-serif;
}
.t-mv .a {
  color: #fff;
  transform: rotate(-8deg);
}
.t-mv .b {
  color: #111;
  background: #fff;
  padding: 0 2px;
  transform: rotate(6deg) translateY(4px);
}
.t-typewriter {
  align-items: flex-start;
  background: #0d0904;
}
.t-typewriter .term {
  font: 500 13px/1 'JetBrains Mono', monospace;
  color: #ffb547;
  text-shadow: 0 0 6px rgba(255, 181, 71, 0.7);
}
.t-vinyl {
  align-items: center;
  background: linear-gradient(135deg, #3d3530, #151210);
}
.t-vinyl .disc {
  width: 46%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
      circle,
      #d9363e 0 18%,
      #0b0b0b 19% 21%,
      transparent 22%
    ),
    repeating-radial-gradient(circle, #111 0 1px, #222 1px 2px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}

/* 开关 */
.switch-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 13px;
  cursor: pointer;
}
.switch-row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.2s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch-row input:checked + .switch {
  background: #34c759;
}
.switch-row input:checked + .switch::after {
  transform: translateX(16px);
}
.switch-row input:focus-visible + .switch {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
</style>
