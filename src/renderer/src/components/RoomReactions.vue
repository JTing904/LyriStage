<script setup>
// 一起听时，房间里有人按表情：从画面下方飘上去（在任何页面、歌词舞台上都看得到）
import { useRoomStore } from '../stores/room';

const room = useRoomStore();
</script>

<template>
  <div class="reactions" aria-hidden="true">
    <span v-for="r in room.floating" :key="r.id" class="float" :style="{ left: `${r.x}%` }">{{ r.emoji }}</span>
  </div>
</template>

<style scoped>
.reactions {
  position: fixed;
  inset: 0;
  z-index: 250;
  pointer-events: none;
  overflow: hidden;
}
.float {
  position: absolute;
  bottom: 90px;
  font-size: 44px;
  animation: rise 2.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes rise {
  0% {
    transform: translateY(0) scale(0.6);
    opacity: 0;
  }
  15% {
    transform: translateY(-40px) scale(1.15);
    opacity: 1;
  }
  100% {
    transform: translateY(-55vh) scale(1);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .float {
    animation-duration: 1.5s;
    animation-name: fade;
  }
  @keyframes fade {
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
}
</style>
