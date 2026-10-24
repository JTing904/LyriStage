<script setup>
// 整页载不出来（歌单、专辑、歌手、搜索…）：说清楚是什么问题、要怎么做，有「重试」
import { computed } from 'vue';
import { explainError, loginAgain } from '../friendlyError';
import { offlineSupported } from '../offline';
import { t } from '../i18n';

const props = defineProps({
  error: { type: [Object, String, Error], required: true },
  /** 载不出来的是什么（已翻译），例如 t('歌单') */
  what: { type: String, default: '' },
});
const emit = defineEmits(['retry']);

const kind = computed(() => explainError(props.error, t('{what}载不出来', { what: props.what })).kind);
const view = computed(
  () =>
    ({
      offline: { icon: '📡', title: t('连不上网络'), text: t('检查一下 Wi-Fi 或流量，好了再按重试。') },
      busy: { icon: '⏳', title: t('服务器有点忙'), text: t('等一下再按重试。') },
      limit: { icon: '⏳', title: t('太多次了'), text: t('等一分钟再按重试。') },
      auth: { icon: '🔑', title: t('登录过期了'), text: t('重新登录后就能看。') },
    })[kind.value] ?? { icon: '😵', title: capitalize(t('{what}载不出来', { what: props.what })), text: t('已经自动回报，可以再试一次。') }
);
/** 英文的 "playlist didn’t load" 开头要大写 */
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
</script>

<template>
  <div class="load-error" role="alert">
    <span class="icon" aria-hidden="true">{{ view.icon }}</span>
    <h3>{{ view.title }}</h3>
    <p>{{ view.text }}</p>
    <button v-if="kind === 'auth'" class="btn" @click="loginAgain">{{ $t('重新登录') }}</button>
    <button v-else class="btn" @click="emit('retry')">↻ {{ $t('重试') }}</button>
    <RouterLink v-if="kind === 'offline' && offlineSupported" to="/offline" class="offline-link">
      {{ $t('没网也能听存在手机里的歌') }}
    </RouterLink>
  </div>
</template>

<style scoped>
.load-error {
  display: grid;
  justify-items: center;
  gap: 6px;
  max-width: 360px;
  margin: 48px auto;
  padding: 28px 22px 24px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface);
  text-align: center;
}
.icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--surface-hover);
  font-size: 28px;
}
h3 {
  margin: 0;
  font-size: 19px;
}
p {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.55;
}
.btn {
  min-height: 46px;
  padding: 0 28px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}
.offline-link {
  margin-top: 10px;
  color: var(--text-dim);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
