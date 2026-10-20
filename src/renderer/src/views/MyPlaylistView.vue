<script setup>
// 自己的歌单：播放、移除歌曲、改名、删除
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getPlaylist } from '@core/data';
import { applyPrivileges, fetchPrivileges } from '../services';
import { useLibraryStore } from '../stores/library';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import { t } from '../i18n';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';
import SongPicker from '../components/SongPicker.vue';

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const { playAll, shuffleAll } = usePlayCollection();

const playlist = ref(null);
const loading = ref(true);
const error = ref('');

let loadCount = 0;
async function load(id) {
  const thisLoad = ++loadCount;
  loading.value = true;
  error.value = '';
  try {
    const data = await getPlaylist(id);
    if (id !== route.params.id) return;
    playlist.value = data;
    // 先显示，再补上哪些歌已经下架
    fetchPrivileges(data.tracks ?? []).then(privileges => {
      // 这段时间里换了歌单、重新载入过就不要了
      if (thisLoad !== loadCount || !playlist.value || !privileges.size) return;
      playlist.value.tracks = applyPrivileges(playlist.value.tracks, privileges);
    });
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, id => id && load(id), { immediate: true });

const tracks = computed(() => playlist.value?.tracks ?? []);
const context = computed(() => `my:${route.params.id}`);
const meta = computed(() =>
  tracks.value.length
    ? `${t('{n} 首', { n: tracks.value.length })} · ${totalLength(tracks.value)}`
    : t('还没有歌')
);

/** 从歌单移除（一首或多选的好几首） */
async function remove(list) {
  const ids = new Set(list.map(t => t.id));
  const before = playlist.value.tracks;
  playlist.value.tracks = before.filter(t => !ids.has(t.id));
  try {
    await library.removeFromPlaylist(playlist.value.id, [...ids]);
  } catch (err) {
    playlist.value.tracks = before;
    library.say(t('移除失败：{error}', { error: err.message || err }));
  }
}

// 添加歌曲（搜索 / 我喜欢的 / 最近播放里勾选好几首）
const picker = ref(null);
const adding = ref(false);
async function addSongs(list) {
  adding.value = true;
  try {
    await library.addToPlaylist(playlist.value.id, list);
    playlist.value = await getPlaylist(playlist.value.id);
  } catch (err) {
    library.say(t('加入失败：{error}', { error: err.message || err }));
  } finally {
    adding.value = false;
  }
}

// 改名
const editor = ref(null);
const name = ref('');
const description = ref('');
function openEditor() {
  name.value = playlist.value.name;
  description.value = playlist.value.description ?? '';
  editor.value.showModal();
}
async function save() {
  if (!name.value.trim()) return;
  try {
    await library.renamePlaylist(playlist.value.id, name.value, description.value.trim() || null);
    playlist.value.name = name.value.trim();
    playlist.value.description = description.value.trim() || null;
    editor.value.close();
  } catch (err) {
    library.say(t('保存失败：{error}', { error: err.message || err }));
  }
}

// 删除（用 App 自己的确认框，不用系统弹窗）
const confirmBox = ref(null);
async function removePlaylist() {
  confirmBox.value.close();
  try {
    await library.deletePlaylist(playlist.value.id);
    router.replace('/library');
  } catch (err) {
    library.say(t('删除失败：{error}', { error: err.message || err }));
  }
}
</script>

<template>
  <div class="page">
    <p v-if="loading && !playlist" class="page-state">{{ $t('加载中…') }}</p>
    <p v-else-if="error" class="page-state">{{ $t('歌单加载失败：{error}', { error }) }}</p>
    <template v-else-if="playlist">
      <CollectionHeader
        :kind="$t('我的歌单')"
        :cover="playlist.cover_url || tracks[0]?.al?.picUrl || ''"
        :title="playlist.name"
        :description="playlist.description || ''"
        :meta="meta"
        :playable="tracks.length > 0"
        @play="playAll(tracks, context)"
        @shuffle="shuffleAll(tracks, context)"
      >
        <template #actions>
          <button @click="picker.open()">{{ $t('＋ 添加歌曲') }}</button>
          <button @click="openEditor">{{ $t('编辑') }}</button>
          <button @click="confirmBox.showModal()">{{ $t('删除歌单') }}</button>
        </template>
      </CollectionHeader>

      <p v-if="!tracks.length" class="page-state">
        {{ $t('歌单还是空的。按上面的「＋ 添加歌曲」一次挑好几首，') }}<br />
        {{ $t('或者按播放条红心旁边的 ＋ 把正在播的歌加进来。') }}
      </p>
      <TrackList v-else :tracks="tracks" :context="context" removable @remove="remove" />
    </template>

    <SongPicker
      ref="picker"
      :existing-ids="tracks.map(t => t.id)"
      :busy="adding"
      @add="addSongs"
    />

    <dialog ref="confirmBox" class="editor" @click.self="confirmBox.close()">
      <div v-if="playlist" class="box">
        <h2>{{ $t('删除歌单「{name}」？', { name: playlist.name }) }}</h2>
        <p class="note">{{ $t('只删除这个歌单，里面的歌不会受影响。删除后不能复原。') }}</p>
        <div class="buttons">
          <button type="button" class="ghost" @click="confirmBox.close()">{{ $t('取消') }}</button>
          <button type="button" class="primary" @click="removePlaylist">{{ $t('删除') }}</button>
        </div>
      </div>
    </dialog>

    <dialog ref="editor" class="editor" @click.self="editor.close()">
      <form class="box" @submit.prevent="save">
        <h2>{{ $t('编辑歌单') }}</h2>
        <label>
          {{ $t('名字') }}
          <input v-model="name" maxlength="60" required />
        </label>
        <label>
          {{ $t('介绍') }}
          <textarea v-model="description" rows="3" maxlength="300" :placeholder="$t('写点什么（可以不写）')" />
        </label>
        <div class="buttons">
          <button type="button" class="ghost" @click="editor.close()">{{ $t('取消') }}</button>
          <button class="primary" :disabled="!name.trim()">{{ $t('保存') }}</button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.editor {
  width: min(440px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.editor::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}
input,
textarea {
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-weight: 400;
  resize: vertical;
}
input:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.note {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.buttons button {
  padding: 10px 18px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.primary:disabled {
  opacity: 0.5;
}
.ghost {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
}
</style>
