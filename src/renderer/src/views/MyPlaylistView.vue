<script setup>
// 自己的歌单：播放、移除歌曲、改名、删除
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getPlaylist } from '@core/data';
import { useLibraryStore } from '../stores/library';
import { usePlayCollection } from '../composables/usePlayCollection';
import { totalLength } from '../utils/format';
import CollectionHeader from '../components/CollectionHeader.vue';
import TrackList from '../components/TrackList.vue';

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const { playAll, shuffleAll } = usePlayCollection();

const playlist = ref(null);
const loading = ref(true);
const error = ref('');

async function load(id) {
  loading.value = true;
  error.value = '';
  try {
    const data = await getPlaylist(id);
    if (id !== route.params.id) return;
    playlist.value = data;
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
  tracks.value.length ? `${tracks.value.length} 首 · ${totalLength(tracks.value)}` : '还没有歌'
);

async function remove(track) {
  const before = playlist.value.tracks;
  playlist.value.tracks = before.filter(t => t.id !== track.id);
  try {
    await library.removeFromPlaylist(playlist.value.id, [track.id]);
  } catch (err) {
    playlist.value.tracks = before;
    library.say(`移除失败：${err.message || err}`);
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
    library.say(`保存失败：${err.message || err}`);
  }
}

async function removePlaylist() {
  if (!window.confirm(`确定要删除歌单「${playlist.value.name}」吗？歌单里的歌不会被删除。`)) return;
  try {
    await library.deletePlaylist(playlist.value.id);
    router.replace('/library');
  } catch (err) {
    library.say(`删除失败：${err.message || err}`);
  }
}
</script>

<template>
  <div class="page">
    <p v-if="loading && !playlist" class="page-state">加载中…</p>
    <p v-else-if="error" class="page-state">歌单加载失败：{{ error }}</p>
    <template v-else-if="playlist">
      <CollectionHeader
        kind="我的歌单"
        :cover="playlist.cover_url || tracks[0]?.al?.picUrl || ''"
        :title="playlist.name"
        :description="playlist.description || ''"
        :meta="meta"
        :playable="tracks.length > 0"
        @play="playAll(tracks, context)"
        @shuffle="shuffleAll(tracks, context)"
      >
        <template #actions>
          <button @click="openEditor">编辑</button>
          <button @click="removePlaylist">删除歌单</button>
        </template>
      </CollectionHeader>

      <p v-if="!tracks.length" class="page-state">
        歌单还是空的。在任何一首歌旁边按 ＋ 就能加进来。
      </p>
      <TrackList v-else :tracks="tracks" :context="context" removable @remove="remove" />
    </template>

    <dialog ref="editor" class="editor" @click.self="editor.close()">
      <form class="box" @submit.prevent="save">
        <h2>编辑歌单</h2>
        <label>
          名字
          <input v-model="name" maxlength="60" required />
        </label>
        <label>
          介绍
          <textarea v-model="description" rows="3" maxlength="300" placeholder="写点什么（可以不写）" />
        </label>
        <div class="buttons">
          <button type="button" class="ghost" @click="editor.close()">取消</button>
          <button class="primary" :disabled="!name.trim()">保存</button>
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
