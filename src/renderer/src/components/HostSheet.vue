<script setup>
// 房主按「关闭房间」、在成员里按「设为房主」时跳出来（手机从下面滑上来，电脑在中间）
// - close：写清楚谁会一起离开；还有别人在的话可以先交给别人当房主，房间就不用关
// - pick：选谁当房主（从成员列表打开时只列那一个人），可以选交出去以后自己也离开
import { computed, ref } from 'vue';
import { useRoomStore } from '../stores/room';
import { t } from '../i18n';
import Cover from './Cover.vue';

const room = useRoomStore();

const dialog = ref(null);
/** 'close' | 'pick' */
const mode = ref('close');
/** 从成员列表打开：只列这个人，按「返回」就关掉 */
const only = ref(null);
const leaveAfter = ref(false);
const busy = ref(false);

const others = computed(() => room.members.filter(m => m.id !== room.selfId));
const candidates = computed(() => (only.value ? others.value.filter(m => m.id === only.value) : others.value));
const initial = name => (name || '?').slice(0, 1).toUpperCase();

/** 「小明、Ivy 会一起离开」（人多就写「等 N 个人」） */
const leavers = computed(() => {
  const names = others.value.map(m => m.name);
  if (!names.length) return t('房间会关掉，聊天记录也会清掉。');
  if (names.length <= 3) return t('{names} 会一起离开，聊天记录也会清掉。', { names: names.join(t('、')) });
  return t('{names} 等 {n} 个人会一起离开，聊天记录也会清掉。', { names: names.slice(0, 2).join(t('、')), n: names.length });
});

/**
 * @param {'close' | 'pick'} openMode
 * @param {{ id: string } | null} [member] 从成员列表打开时是哪个人
 */
function open(openMode, member = null) {
  mode.value = openMode;
  only.value = member?.id ?? null;
  leaveAfter.value = false;
  dialog.value.showModal();
}
defineExpose({ open });

function back() {
  if (only.value) dialog.value.close();
  else mode.value = 'close';
}

async function closeRoom() {
  busy.value = true;
  dialog.value.close();
  await room.leave();
  busy.value = false;
}

async function handOver(member) {
  busy.value = true;
  await room.transferHost(member.id, { stay: !leaveAfter.value });
  busy.value = false;
  dialog.value.close();
}
</script>

<template>
  <dialog ref="dialog" class="host-sheet" @click.self="dialog.close()">
    <div class="box">
      <div class="grab" aria-hidden="true" />

      <template v-if="mode === 'close'">
        <h3>{{ $t('关闭房间？') }}</h3>
        <p class="text">{{ leavers }}</p>
        <div v-if="others.length" class="faces">
          <Cover v-for="m in others.slice(0, 5)" :key="m.id" :url="m.avatar || ''" :size="32" round class="face">
            <span class="initial">{{ initial(m.name) }}</span>
          </Cover>
          <span class="count">{{ $t('{n} 人在听', { n: others.length }) }}</span>
        </div>
        <button v-if="others.length" class="btn" :disabled="busy" @click="mode = 'pick'">
          <span aria-hidden="true">👑</span>{{ $t('交给别人当房主') }}
        </button>
        <button class="btn danger" :disabled="busy" @click="closeRoom">{{ $t('关闭房间') }}</button>
        <button class="btn plain" @click="dialog.close()">{{ $t('取消') }}</button>
      </template>

      <template v-else>
        <h3>{{ $t('交给谁当房主？') }}</h3>
        <p class="text">{{ $t('之后由新房主决定大家听什么。') }}</p>
        <ul class="members">
          <li v-for="m in candidates" :key="m.id">
            <Cover :url="m.avatar || ''" :size="40" round class="face">
              <span class="initial">{{ initial(m.name) }}</span>
            </Cover>
            <span class="name">{{ m.name }}</span>
            <button class="pick" :disabled="busy" @click="handOver(m)">{{ $t('设为房主') }}</button>
          </li>
        </ul>
        <label class="leave">
          <span>{{ $t('交出去以后我也离开') }}</span>
          <input v-model="leaveAfter" type="checkbox" role="switch" class="switch" />
        </label>
        <button class="btn plain" @click="back">{{ only ? $t('取消') : $t('返回') }}</button>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.host-sheet {
  width: min(420px, calc(100vw - 24px));
  max-height: min(680px, calc(100dvh - 48px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.host-sheet::backdrop {
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
h3 {
  margin: 0;
  font-size: 20px;
}
.text {
  margin: 0 0 4px;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.55;
}
.faces {
  display: flex;
  align-items: center;
  margin: 0 0 6px;
  padding-left: 6px;
}
.face {
  flex: none;
  width: 32px;
  margin-left: -6px;
  border: 2px solid var(--surface);
  border-radius: 50%;
}
.initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
}
.count {
  margin-left: 10px;
  color: var(--text-dim);
  font-size: 13px;
}
.members {
  margin: 0;
  padding: 0;
  list-style: none;
}
.members li {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  border-bottom: 1px solid var(--line);
}
.members .face {
  width: 40px;
  margin: 0;
  border: 0;
}
.members .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick {
  flex: none;
  min-height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
}
.leave {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  font-weight: 700;
  cursor: pointer;
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
.btn:disabled,
.pick:disabled {
  opacity: 0.5;
  cursor: default;
}
/* 开关 */
.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 46px;
  height: 26px;
  margin: 0;
  border-radius: 999px;
  background: var(--line-strong);
  cursor: pointer;
  transition: background 0.2s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch:checked {
  background: var(--accent);
}
.switch:checked::after {
  transform: translateX(20px);
}

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .host-sheet {
    width: 100vw;
    max-width: 100vw;
    max-height: 88dvh;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .host-sheet[open] {
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
