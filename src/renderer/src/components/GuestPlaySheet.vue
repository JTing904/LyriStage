<script setup>
// 一起听的成员在歌单里点了歌：点给房主 / 离开房间自己播 / 取消（手机从下面滑上来，电脑在中间）
import { computed, ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { useNoticeStore } from '../stores/notice';
import { useUiStore } from '../stores/ui';
import { artistNames } from '../utils/format';
import { t } from '../i18n';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const room = useRoomStore();
const notice = useNoticeStore();
const ui = useUiStore();

const dialog = ref(null);
const busy = ref(false);
const pick = computed(() => ui.guestPick);
const hostName = computed(() => room.host?.name ?? t('房主'));

watch(pick, value => {
  if (value && !dialog.value?.open) dialog.value?.showModal();
  else if (!value && dialog.value?.open) dialog.value.close();
});
// 房间关了（或被换成房主）：不用再问
watch(
  () => room.role === 'guest' && room.inRoom,
  guest => !guest && (ui.guestPick = null)
);

async function request() {
  const { track } = pick.value;
  busy.value = true;
  const ok = await room.sendRequest(track);
  busy.value = false;
  ui.guestPick = null;
  notice.show(ok ? t('点了《{name}》，等房主加进队列', { name: track.name }) : t('点歌没送出去，再试一次'));
}

async function leaveAndPlay() {
  const { replay } = pick.value;
  busy.value = true;
  await room.leave();
  busy.value = false;
  ui.guestPick = null;
  replay();
}
</script>

<template>
  <dialog ref="dialog" class="guest-sheet" @close="ui.guestPick = null" @click.self="dialog.close()">
    <div v-if="pick" class="box">
      <div class="grab" aria-hidden="true" />
      <div class="song">
        <Cover v-if="pick.track" :url="pick.track.al?.picUrl" :size="52" radius="10px" class="cover" />
        <span v-else class="cover fm"><Icon name="radio" :size="24" /></span>
        <span class="meta">
          <b>{{ pick.track?.name ?? pick.label }}</b>
          <span v-if="pick.track">{{ artistNames(pick.track) }}</span>
        </span>
      </div>
      <p class="note">{{ $t('你在 {name} 的房间里，大家听的歌由房主决定。', { name: hostName }) }}</p>
      <button v-if="pick.track" class="btn primary" :disabled="busy" @click="request">
        <Icon name="plus" :size="18" />{{ $t('点给房主') }}
      </button>
      <button class="btn" :disabled="busy" @click="leaveAndPlay">
        <Icon name="logout" :size="18" />{{ $t('离开房间，自己播') }}
      </button>
      <button class="btn plain" @click="dialog.close()">{{ $t('取消') }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.guest-sheet {
  width: min(420px, calc(100vw - 24px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.guest-sheet::backdrop {
  background: rgb(0 0 0 / 0.55);
}
.box {
  display: grid;
  /* minmax(0, …)：名字、歌名很长时截短，不要把面板撑宽 */
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 22px 20px 20px;
}
.grab {
  display: none;
}
.song {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cover {
  flex: none;
  width: 52px;
}
.fm {
  display: grid;
  place-items: center;
  height: 52px;
  border-radius: 10px;
  background: var(--surface-hover);
  color: var(--text-dim);
}
.meta {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.meta b,
.meta span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.meta b {
  font-size: 16px;
}
.meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.note {
  margin: 4px 0 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-hover);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
}
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
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
.btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn.plain {
  border-color: transparent;
  color: var(--text-dim);
  font-weight: 700;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .guest-sheet {
    width: 100vw;
    max-width: 100vw;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .guest-sheet[open] {
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
