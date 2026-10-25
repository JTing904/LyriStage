<script setup>
// 别人的歌单、专辑、每日推荐页头的「存成我的歌单」（放在 CollectionHeader 的 actions）：
// 复制一份到自己的歌单（同样的名字、同样的顺序），之后可以自己增删、改名
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLibraryStore } from '../stores/library';
import { useNoticeStore } from '../stores/notice';
import { showError } from '../friendlyError';
import { t } from '../i18n';
import Icon from './Icon.vue';

const props = defineProps({
  name: { type: String, required: true },
  tracks: { type: Array, required: true },
});

const library = useLibraryStore();
const router = useRouter();
const busy = ref(false);

async function save() {
  if (busy.value || !props.tracks.length) return;
  busy.value = true;
  try {
    const row = await library.saveAsPlaylist(props.name, props.tracks);
    if (!row) return;
    useNoticeStore().show(t('已存成我的歌单「{name}」', { name: row.name }), {
      action: { label: t('打开'), run: () => router.push(`/my/${row.id}`) },
    });
  } catch (err) {
    showError(err, t('没存成功'), { retry: save });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    v-if="tracks.length"
    class="icon-action save-as"
    :aria-label="$t('存成我的歌单')"
    :title="$t('存成我的歌单')"
    :disabled="busy"
    @click="save"
  >
    <Icon name="copy" :size="17" /><span class="label">{{ busy ? $t('请稍候…') : $t('存成我的歌单') }}</span>
  </button>
</template>

<style scoped>
/* 手机只留图标（CollectionHeader 藏 .label 的样式套不到元件里面，这里自己藏） */
@media (max-width: 640px) {
  .label {
    display: none;
  }
}
</style>
