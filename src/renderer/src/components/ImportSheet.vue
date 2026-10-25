<script setup>
// 导入歌单的面板（音乐库 ＋ →「导入歌单」）：贴上别的 App 的歌单链接，或改贴一行一首的歌名清单
// 读到了就到导入页（/import）看配对结果；网易云的歌单直接打开那张
// 用法：sheet.value.open()
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useImporterStore } from '../stores/importer';

const router = useRouter();
const importer = useImporterStore();
const dialog = ref(null);
const field = ref(null);
const text = ref('');
/** 改贴歌名清单 */
const listMode = ref(false);
const reading = ref(false);

function open() {
  importer.error = '';
  dialog.value.showModal();
  nextTick(() => field.value?.focus());
}
defineExpose({ open });

async function submit() {
  if (!text.value.trim() || reading.value) return;
  reading.value = true;
  try {
    const result = await importer.start(text.value);
    if (!result) return;
    dialog.value.close();
    text.value = '';
    router.push(typeof result === 'object' ? `/playlist/${result.netease}` : '/import');
  } finally {
    reading.value = false;
  }
}

const APPS = ['QQ 音乐', 'Spotify', 'Apple Music', 'YouTube Music'];
</script>

<template>
  <dialog ref="dialog" class="import-sheet" @click.self="dialog.close()">
    <form class="box" @submit.prevent="submit">
      <div class="grab" aria-hidden="true" />
      <h3>{{ $t('导入歌单') }}</h3>
      <p class="hint">{{ $t('把别的 App 的歌单复制一份过来，变成你自己的歌单。') }}</p>
      <textarea
        ref="field"
        v-model="text"
        :rows="listMode ? 7 : 3"
        :placeholder="listMode ? $t('一行一首：歌名 - 歌手') : $t('贴上歌单链接')"
        :aria-label="listMode ? $t('歌名清单') : $t('歌单链接')"
        spellcheck="false"
        @keydown.enter.exact="!listMode && ($event.preventDefault(), submit())"
      />
      <div v-if="!listMode" class="apps">
        <span v-for="app in APPS" :key="app">{{ app }}</span>
      </div>
      <p v-if="importer.error" class="error" role="alert">{{ importer.error }}</p>
      <button class="primary" :disabled="!text.trim() || reading">
        {{ reading ? $t('正在读取…') : listMode ? $t('开始找歌') : $t('读取歌单') }}
      </button>
      <button type="button" class="switch" @click="listMode = !listMode">
        {{ listMode ? $t('改贴歌单链接') : $t('改贴歌名清单') }}
      </button>
    </form>
  </dialog>
</template>

<style scoped>
.import-sheet {
  width: min(460px, calc(100vw - 24px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.import-sheet::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: grid;
  gap: 12px;
  padding: 22px 20px 20px;
}
.grab {
  display: none;
}
h3 {
  margin: 0;
  font-size: 19px;
}
.hint {
  margin: -6px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}
textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  word-break: break-all;
}
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.apps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.apps span {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--danger);
}
.primary {
  height: 46px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.switch {
  justify-self: center;
  padding: 6px 10px;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .import-sheet {
    width: 100vw;
    max-width: 100vw;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .import-sheet[open] {
    animation: up 0.22s ease-out;
  }
  .box {
    padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
  }
  .grab {
    display: block;
    width: 40px;
    height: 5px;
    margin: 0 auto 2px;
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
