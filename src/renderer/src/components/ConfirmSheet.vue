<script setup>
// 「确定要…吗？」的确认面板（代替系统的 window.confirm：那个很丑、手机上字很小）
// 用法：const ok = await confirmSheet.value.ask()
import { ref } from 'vue';

defineProps({
  title: { type: String, required: true },
  text: { type: String, default: '' },
  confirmLabel: { type: String, required: true },
  /** 红色按钮（删除这种不能复原的） */
  danger: { type: Boolean, default: true },
});

const dialog = ref(null);
let resolve = null;

/** @returns {Promise<boolean>} 按了确认就是 true */
function ask() {
  dialog.value.showModal();
  return new Promise(r => (resolve = r));
}
function answer(ok) {
  resolve?.(ok);
  resolve = null;
  if (dialog.value?.open) dialog.value.close();
}
defineExpose({ ask });
</script>

<template>
  <dialog ref="dialog" class="confirm-sheet" @close="answer(false)" @click.self="answer(false)">
    <div class="box">
      <div class="grab" aria-hidden="true" />
      <h3>{{ title }}</h3>
      <p v-if="text" class="text">{{ text }}</p>
      <button class="btn" :class="{ danger }" @click="answer(true)">{{ confirmLabel }}</button>
      <button class="btn plain" autofocus @click="answer(false)">{{ $t('取消') }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-sheet {
  width: min(420px, calc(100vw - 24px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.confirm-sheet::backdrop {
  background: rgb(0 0 0 / 0.55);
}
.box {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 22px 20px 18px;
}
.grab {
  display: none;
}
h3 {
  margin: 0;
  font-size: 19px;
  line-height: 1.35;
}
.text {
  margin: 0 0 6px;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.55;
}
.btn {
  min-height: 48px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}
.btn.danger {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn.plain {
  border-color: transparent;
  color: var(--text-dim);
  font-weight: 700;
}

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .confirm-sheet {
    width: 100vw;
    max-width: 100vw;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .confirm-sheet[open] {
    animation: up 0.22s ease-out;
  }
  .box {
    padding: 10px 18px calc(18px + env(safe-area-inset-bottom));
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
