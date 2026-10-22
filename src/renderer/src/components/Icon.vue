<script setup>
// 图标（线条图标用 stroke，实心图标用 fill）
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 22 },
});

const STROKE = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  library: 'M4 4v16M9 4v16m5-16 5 16',
  plus: 'M12 5v14M5 12h14',
  more: '',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  x: 'M6 6l12 12M18 6 6 18',
  heart:
    'M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 4.2 2.6h2C13.6 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z',
  logout: 'M15 4h4v16h-4M10 17l-5-5 5-5m-5 5h12',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  queue: 'M4 6h12M4 12h12M4 18h8m8-4v6m-3-3h6',
  'desktop-lyrics': 'M3 4h18v12H3zM8 20h8M12 16v4M7 8h10M7 12h6',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  dislike:
    'M17 14V3H8.6a2 2 0 0 0-2 1.6L5.1 12a2 2 0 0 0 2 2.4h4.4l-1 4.6a1.8 1.8 0 0 0 3.3 1.3L17 14zm0-11h3.5v11H17',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v7h14v-7',
  check: 'M5 12.5l4.5 4.5L19 7',
  chart: 'M3 21h18M6 17v-6m5 6V5m5 12v-9m4 9v-4',
  chat: 'M4 5h16v11H10l-5 4v-4H4z',
  'play-next': 'M4 6h10M4 12h10M4 18h6m6-6 5 3-5 3z',
  // 好友：一个人 + 加号
  friends: 'M15 20a6 6 0 0 0-12 0M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10-3v6m-3-3h6',
  // 电台：中间一点，两边各两道电波
  radio: 'M12 11.5v1M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8',
  'eye-off':
    'M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
};
const FILL = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  'heart-fill':
    'M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 4.2 2.6h2C13.6 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z',
  shuffle:
    'M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
};
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    class="icon"
  >
    <template v-if="name === 'more'">
      <circle cx="12" cy="5" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" />
    </template>
    <path v-else-if="FILL[name]" :d="FILL[name]" fill="currentColor" />
    <path
      v-else
      :d="STROKE[name]"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.icon {
  flex-shrink: 0;
}
</style>
