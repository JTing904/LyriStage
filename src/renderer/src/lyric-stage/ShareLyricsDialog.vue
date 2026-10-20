<script setup>
// 歌词分享卡片：选 1–4 句（默认是正在唱的那句），预览，分享到 IG 限动 / 存图片 / 复制
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useStage, displayWords } from './useStage';
import { canCopyImage, canShareImage, copyImage, saveImage, shareImage } from '../platform';
import { canvasToBlob, renderLyricCard } from '../utils/shareCard';
import { useNoticeStore } from '../stores/notice';
import { t } from '../i18n';
import Icon from '../components/Icon.vue';

const emit = defineEmits(['close']);
const { lines, lineIndex, track, palette, settings } = useStage();
const notice = useNoticeStore();

const MAX_LINES = 4;
const textOf = line => displayWords(line.words).map(w => w.text).join('').trim();

/** 可以选的句子：正在唱的前后几句（空行、间奏跳过） */
const choices = computed(() => {
  const center = Math.max(0, lineIndex.value);
  return lines.value
    .map((line, index) => ({ index, text: textOf(line), sub: line.translation || line.romaji || '' }))
    .filter(c => c.text && Math.abs(c.index - center) <= 8);
});
const selected = ref(new Set([Math.max(0, lineIndex.value)]));
if (!choices.value.some(c => selected.value.has(c.index)) && choices.value.length) {
  selected.value = new Set([choices.value[0].index]);
}
function toggle(index) {
  const next = new Set(selected.value);
  if (next.has(index)) {
    if (next.size > 1) next.delete(index);
  } else if (next.size < MAX_LINES) {
    next.add(index);
  } else {
    notice.show(t('最多选 {n} 句', { n: MAX_LINES }));
    return;
  }
  selected.value = next;
}

// ---- 预览（选的句子变了就重画） ----
const preview = ref(null);
const busy = ref(false);
let canvas = null;
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const picked = choices.value
    .filter(c => selected.value.has(c.index))
    .map(c => ({ text: c.text, sub: settings.showTranslation ? c.sub : '' }));
  const result = await renderLyricCard({ lines: picked, track: track.value, palette: palette.value });
  if (token !== renderToken) return;
  canvas = result;
  const target = preview.value;
  if (!target) return;
  target.width = result.width;
  target.height = result.height;
  target.getContext('2d').drawImage(result, 0, 0);
}
watch(selected, render);
onMounted(render);

// ---- 分享 / 存 / 复制 ----
const fileName = () => `LyriStage-${(track.value?.name ?? 'lyrics').replace(/[\\/:*?"<>|]/g, '')}.png`;
const shareable = canShareImage();
const copyable = canCopyImage();
async function run(action) {
  if (!canvas || busy.value) return;
  busy.value = true;
  try {
    const blob = await canvasToBlob(canvas);
    if (action === 'share') await shareImage(blob, fileName());
    else if (action === 'copy') {
      await copyImage(blob);
      notice.show(t('已复制图片，可以直接贴上'));
    } else await saveImage(blob, fileName());
  } catch (err) {
    // 用户在系统分享里按了取消，不算错误
    if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message ?? '')) {
      notice.show(t('操作失败：{error}', { error: err.message || err }));
    }
  } finally {
    busy.value = false;
  }
}

const dialog = ref(null);
onMounted(() => nextTick(() => dialog.value?.showModal()));
</script>

<template>
  <dialog ref="dialog" class="share-dialog" :aria-label="$t('分享歌词')" @close="emit('close')" @click.self="dialog?.close()">
    <header class="head">
      <h2>{{ $t('分享歌词') }}</h2>
      <button class="icon-btn" :aria-label="$t('关闭')" @click="dialog?.close()"><Icon name="x" :size="20" /></button>
    </header>
    <div class="body">
      <canvas ref="preview" class="preview" :aria-label="$t('卡片预览')" />
      <div class="side">
        <p class="label">{{ $t('选歌词（最多 {n} 句）', { n: MAX_LINES }) }}</p>
        <div class="choices">
          <button
            v-for="c in choices"
            :key="c.index"
            class="choice"
            :class="{ on: selected.has(c.index) }"
            :aria-pressed="selected.has(c.index)"
            @click="toggle(c.index)"
          >
            {{ c.text }}
          </button>
        </div>
        <div class="actions">
          <button v-if="shareable" class="primary" :disabled="busy" @click="run('share')">
            <Icon name="share" :size="18" />{{ $t('分享') }}
          </button>
          <button v-if="copyable" :class="{ primary: !shareable }" :disabled="busy" @click="run('copy')">
            {{ $t('复制图片') }}
          </button>
          <button :disabled="busy" @click="run('save')">{{ $t('存成图片') }}</button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.share-dialog {
  width: min(860px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 0;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 18px;
  background: #16161a;
  color: #f4f4f5;
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.5);
}
.share-dialog::backdrop {
  background: rgb(0 0 0 / 0.55);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 4px 20px;
}
.head h2 {
  margin: 0;
  font-size: 18px;
}
.body {
  display: flex;
  gap: 20px;
  padding: 12px 20px 20px;
}
.preview {
  flex: none;
  width: auto;
  height: min(62vh, 560px);
  aspect-ratio: 9 / 16;
  border-radius: 12px;
  background: #222;
}
.side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.label {
  margin: 0;
  font-size: 13px;
  color: rgb(255 255 255 / 0.65);
}
.choices {
  flex: 1;
  min-height: 0;
  max-height: 46vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.choice {
  padding: 10px 12px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 10px;
  background: none;
  color: rgb(255 255 255 / 0.75);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.choice.on {
  border-color: #ff3b5c;
  background: rgb(255 59 92 / 0.15);
  color: #fff;
  font-weight: 700;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 999px;
  background: none;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.actions button.primary {
  border-color: #ff3b5c;
  background: #ff3b5c;
}
.actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}
.icon-btn:hover {
  background: rgb(255 255 255 / 0.1);
}

/* 手机：上下排，预览小一点 */
@media (max-width: 700px) {
  .body {
    flex-direction: column;
    align-items: center;
  }
  .preview {
    height: 38vh;
  }
  .side {
    width: 100%;
  }
  .choices {
    max-height: 26vh;
  }
}
</style>
