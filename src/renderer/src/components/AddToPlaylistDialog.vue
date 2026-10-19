<script setup>
// 「加到歌单」对话框：勾选一个或好几个歌单，按「加入」一次加进去；也可以马上新建一个
import { computed, nextTick, ref, watch } from 'vue';
import { useLibraryStore } from '../stores/library';
import Cover from './Cover.vue';
import Icon from './Icon.vue';
import { t } from '../i18n';

const library = useLibraryStore();
const tracks = computed(() => library.pendingTracks);
const dialog = ref(null);
const newName = ref('');
const creating = ref(false);
const busy = ref(false);
const nameInput = ref(null);
/** 勾选的歌单 id */
const chosen = ref(new Set());

watch(tracks, value => {
  if (value) {
    newName.value = '';
    creating.value = false;
    chosen.value = new Set();
    nextTick(() => dialog.value?.showModal());
  } else {
    dialog.value?.close();
  }
});

function toggle(id) {
  const next = new Set(chosen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  chosen.value = next;
}

async function addChosen() {
  if (busy.value || !chosen.value.size) return;
  busy.value = true;
  try {
    await library.addToPlaylists([...chosen.value], tracks.value);
    library.closeAddDialog();
  } catch (err) {
    library.say(t('加入失败：{error}', { error: err.message || err }));
  } finally {
    busy.value = false;
  }
}

async function startCreate() {
  creating.value = true;
  await nextTick();
  nameInput.value?.focus();
}

/** 新建的歌单自动勾上 */
async function create() {
  const name = newName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  try {
    const row = await library.createPlaylist(name);
    chosen.value = new Set([...chosen.value, row.id]);
    newName.value = '';
    creating.value = false;
  } catch (err) {
    library.say(t('新建失败：{error}', { error: err.message || err }));
  } finally {
    busy.value = false;
  }
}

const title = computed(() => {
  const list = tracks.value ?? [];
  return list.length === 1
    ? t('把「{name}」加到歌单', { name: list[0].name })
    : t('把 {n} 首歌加到歌单', { n: list.length });
});
</script>

<template>
  <dialog ref="dialog" class="add-dialog" @close="library.closeAddDialog()" @click.self="library.closeAddDialog()">
    <div v-if="tracks" class="box">
      <header>
        <h2>{{ title }}</h2>
        <button class="close" :aria-label="$t('关闭')" @click="library.closeAddDialog()">
          <Icon name="x" :size="20" />
        </button>
      </header>

      <form v-if="creating" class="create" @submit.prevent="create">
        <input ref="nameInput" v-model="newName" :placeholder="$t('歌单名字')" maxlength="60" required />
        <button class="primary" :disabled="busy || !newName.trim()">{{ $t('新建') }}</button>
      </form>
      <button v-else class="row new" @click="startCreate">
        <span class="plus"><Icon name="plus" /></span>
        <strong>{{ $t('新建歌单') }}</strong>
      </button>

      <ul class="list">
        <li v-for="p in library.playlists" :key="p.id">
          <button
            class="row"
            :class="{ on: chosen.has(p.id) }"
            :aria-pressed="chosen.has(p.id)"
            :disabled="busy"
            @click="toggle(p.id)"
          >
            <span class="check" :class="{ on: chosen.has(p.id) }" aria-hidden="true">
              <svg v-if="chosen.has(p.id)" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <Cover :url="p.cover_url" :size="44" radius="8px" class="cover" />
            <span class="meta">
              <strong>{{ p.name }}</strong>
              <span>{{ $t('{n} 首', { n: p.trackCount }) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="!library.playlists.length && !creating" class="empty">{{ $t('还没有歌单，先新建一个吧。') }}</p>

      <footer v-if="library.playlists.length">
        <span>{{ chosen.size ? $t('已选 {n} 个歌单', { n: chosen.size }) : $t('可以选好几个') }}</span>
        <button class="primary" :disabled="busy || !chosen.size" @click="addChosen">
          {{ busy ? $t('加入中…') : $t('加入') }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.add-dialog {
  width: min(420px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 64px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.add-dialog::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
h2 {
  flex: 1;
  margin: 0;
  font-size: 17px;
  line-height: 1.4;
}
.close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.close:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover:not(:disabled) {
  background: var(--surface-hover);
}
.row.on {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.check {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--line-strong);
  border-radius: 6px;
}
.check.on {
  border-color: var(--accent);
  background: var(--accent);
}
.check svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--on-accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 歌单很多时，「加入」固定在底部 */
footer {
  position: sticky;
  bottom: -18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 6px -18px -18px;
  padding: 12px 18px 18px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  font-size: 14px;
  color: var(--text-dim);
}
footer .primary {
  padding: 10px 26px;
  border-radius: 999px;
}
.cover {
  width: 44px;
  flex: none;
}
.plus {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: var(--surface-hover);
  color: var(--accent);
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.create {
  display: flex;
  gap: 8px;
  padding: 4px 0;
}
.create input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.create input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.primary {
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
}
.empty {
  margin: 4px 8px;
  font-size: 14px;
  color: var(--text-dim);
}
</style>
