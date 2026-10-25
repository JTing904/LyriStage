<script setup>
// 正在唱的那一行：每个字带 --p（0 到 1，唱到多少）。
// 单独成一个组件：每一帧只有这一行重新渲染，整页歌词不用跟着重画（省电）
import { wordProgress } from '@core/lyrics';
import { useStage } from './useStage';

defineProps({ words: { type: Array, required: true } });
const { now } = useStage();
</script>

<template>
  <span
    v-for="(word, w) in words"
    :key="w"
    class="word"
    :style="{ '--p': wordProgress(word, now) }"
    >{{ word.text }}</span
  >
</template>
