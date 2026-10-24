<script setup>
// 已经有账号的人：更新后第一次打开，确认一次名字（只跳一次）。
// 朋友用名字搜你、好友列表看到的都是它；名字像邮箱前缀（kengtingtan）的话提醒一句
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { showError } from '../friendlyError';
import { t } from '../i18n';

const auth = useAuthStore();
const dialog = ref(null);
const name = ref('');
const busy = ref(false);

const needed = computed(() => auth.ready && auth.allowed && !auth.nameConfirmed);
watch(
  needed,
  value => {
    if (!value) return dialog.value?.open && dialog.value.close();
    name.value = auth.displayName;
    // 等画面出来再打开（登录后马上跳出来会盖住进场动画）
    setTimeout(() => needed.value && !dialog.value?.open && dialog.value?.showModal(), 800);
  },
  { immediate: true }
);

const emailPrefix = computed(() => auth.user?.email?.split('@')[0]?.toLowerCase() ?? '');
const looksLikeEmail = computed(() => Boolean(emailPrefix.value) && name.value.trim().toLowerCase() === emailPrefix.value);

async function save() {
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await auth.saveName(name.value);
    dialog.value.close();
  } catch (err) {
    showError(err, t('没保存成功'), { retry: save });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- 不能按外面关掉：一定要确认（按确定就好，不用改） -->
  <dialog ref="dialog" class="name-sheet" @cancel.prevent>
    <form class="box" @submit.prevent="save">
      <div class="grab" aria-hidden="true" />
      <h3>{{ $t('确认你的名字') }}</h3>
      <p class="text">{{ $t('朋友加你好友时会用名字搜你，也会在好友列表看到它。') }}</p>
      <label>
        {{ $t('名字') }}
        <input v-model="name" autocomplete="nickname" maxlength="30" required />
      </label>
      <p v-if="looksLikeEmail" class="warn">{{ $t('这看起来像邮箱的前缀，朋友可能认不出是你，要不要换成平常的称呼？') }}</p>
      <!-- 打开时焦点在「确定」：不要一跳出来就弹键盘（大部分人按确定就好） -->
      <button class="primary" autofocus :disabled="busy || !name.trim()">{{ busy ? $t('请稍候…') : $t('确定') }}</button>
    </form>
  </dialog>
</template>

<style scoped>
.name-sheet {
  width: min(420px, calc(100vw - 24px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.name-sheet::backdrop {
  background: rgb(0 0 0 / 0.55);
}
.box {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 22px 20px 20px;
}
.grab {
  display: none;
}
h3 {
  margin: 0;
  font-size: 20px;
}
.text {
  margin: 0;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.55;
}
label {
  display: grid;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
input {
  height: 48px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  font-weight: 400;
}
input:focus {
  border-color: var(--accent);
  outline: 0;
}
.warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, #f5a524 18%, transparent);
  color: color-mix(in srgb, #f5a524 55%, var(--text));
  font-size: 13px;
  line-height: 1.5;
}
.primary {
  min-height: 48px;
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

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .name-sheet {
    width: 100vw;
    max-width: 100vw;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .name-sheet[open] {
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
