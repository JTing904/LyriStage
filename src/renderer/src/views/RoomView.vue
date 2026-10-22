<script setup>
// 一起听：开房间 / 用房间码加入
// 房间里：左边是歌词（直接用歌词舞台的风格，大家同步），上面一条是房间码和谁在听；右边是聊天、成员
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useRoomStore, normalizeCode, REACTIONS } from '../stores/room';
import { useUiStore } from '../stores/ui';
import { usePlayer } from '../composables/usePlayer';
import { getEnglishTranslation, getLyrics } from '../services';
import { t } from '../i18n';
import Cover from '../components/Cover.vue';
import LyricStage from '../lyric-stage/LyricStage.vue';

const room = useRoomStore();
const ui = useUiStore();
const route = useRoute();
const { state, player } = usePlayer();

const input = ref('');
const copied = ref('');

// 网址带了房间码（/room?code=ABC123）就直接加入
onMounted(() => {
  const code = normalizeCode(route.query.code);
  if (code && !room.inRoom) {
    input.value = code;
    room.joinRoom(code);
  }
});

// ---- 聊天 ----
const tab = ref('chat');
const draft = ref('');
const sending = ref(false);
const chatList = ref(null);
async function sendChat() {
  if (!draft.value.trim() || sending.value) return;
  sending.value = true;
  if (await room.sendChat(draft.value)) draft.value = '';
  sending.value = false;
}
// 有新消息就卷到最下面
const scrollChat = () => nextTick(() => chatList.value && (chatList.value.scrollTop = chatList.value.scrollHeight));
watch(() => room.messages.length, scrollChat);
watch(tab, value => value === 'chat' && scrollChat());

function handOver(member) {
  if (window.confirm(t('把房主交给 {name}？之后由 {name} 决定播什么，你会变成普通成员继续听。', { name: member.name }))) {
    room.transferHost(member.id);
  }
}

const memberOf = id => room.members.find(m => m.id === id);
const initial = name => (name || '?').slice(0, 1).toUpperCase();
const timeOf = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** 上面那条只放前 5 个头像，其他的显示 +N */
const shownMembers = computed(() => room.members.slice(0, 5));

const shareLink = computed(() => `https://lyristage.vercel.app/#/room?code=${room.code}`);
async function copy(text, which) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = which;
    setTimeout(() => (copied.value = ''), 2000);
  } catch {
    // 不能复制就让用户自己抄
  }
}

// 「⋯」选单：关闭 / 离开房间
const menuOpen = ref(false);
const onOutside = event => {
  if (menuOpen.value && !event.target.closest?.('.more-wrap')) menuOpen.value = false;
};
window.addEventListener('pointerdown', onOutside, true);
onBeforeUnmount(() => window.removeEventListener('pointerdown', onOutside, true));
</script>

<template>
  <div class="page room-page" :class="{ inside: room.inRoom }">
    <header v-if="!room.inRoom">
      <h1 class="display">{{ $t('一起听') }}</h1>
      <p>{{ $t('开一个房间，把房间码发给朋友。你播什么、暂停、切歌，大家都会同步。') }}</p>
    </header>

    <!-- 还没在房间里 -->
    <div v-if="!room.inRoom" class="start">
      <section class="card">
        <h2>{{ $t('开一个房间') }}</h2>
        <p>{{ $t('你当房主，大家跟着你的歌听。') }}</p>
        <button class="primary" :disabled="room.status === 'connecting'" @click="room.createRoom()">
          {{ room.status === 'connecting' && room.role === 'host' ? $t('正在开房间…') : $t('开房间') }}
        </button>
      </section>

      <section class="card">
        <h2>{{ $t('加入朋友的房间') }}</h2>
        <p>{{ $t('输入朋友给你的 6 位房间码。') }}</p>
        <form class="join" @submit.prevent="room.joinRoom(input)">
          <input
            v-model="input"
            class="code-input"
            maxlength="6"
            :placeholder="$t('例如 7KQ3MZ')"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
          />
          <button class="primary" :disabled="room.status === 'connecting'">
            {{ room.status === 'connecting' && room.role === 'guest' ? $t('加入中…') : $t('加入') }}
          </button>
        </form>
      </section>

      <p v-if="room.error" class="error" role="alert">{{ room.error }}</p>
    </div>

    <!-- 在房间里 -->
    <div v-else class="room">
      <!-- 左边：房间资料一条 + 歌词（跟全屏歌词同一组风格和设置） -->
      <div class="left">
        <div class="room-top">
          <span class="chip">
            <span class="chip-label">{{ $t('房间') }}</span>
            <code>{{ room.code }}</code>
            <button class="chip-btn" @click="copy(room.code, 'code')">
              {{ copied === 'code' ? $t('已复制 ✓') : $t('复制') }}
            </button>
            <button class="chip-btn" @click="copy(shareLink, 'link')">
              {{ copied === 'link' ? $t('已复制 ✓') : $t('邀请链接') }}
            </button>
          </span>
          <span class="grow" />
          <span class="avatars" :aria-label="$t('{n} 人在听', { n: room.members.length })">
            <span v-for="m in shownMembers" :key="m.id" class="av" :title="m.name">
              <Cover :url="m.avatar || ''" :size="34" round>
                <span class="initial">{{ initial(m.name) }}</span>
              </Cover>
              <span v-if="m.id === room.hostId" class="crown" aria-hidden="true">👑</span>
            </span>
            <span v-if="room.members.length > shownMembers.length" class="av more-count">
              +{{ room.members.length - shownMembers.length }}
            </span>
          </span>
          <span class="listening"><i />{{ $t('{n} 人在听', { n: room.members.length }) }}</span>
          <span class="more-wrap">
            <button class="round-btn" :aria-label="$t('更多')" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">⋯</button>
            <div v-if="menuOpen" class="menu" role="menu">
              <button role="menuitem" class="danger" @click="(menuOpen = false), room.leave()">
                {{ room.role === 'host' ? $t('关闭房间') : $t('离开房间') }}
              </button>
            </div>
          </span>
        </div>

        <section class="stage-panel">
          <LyricStage
            embedded
            :state="state"
            :player="player"
            :get-lyrics="getLyrics"
            :get-translation="getEnglishTranslation"
            @expand="ui.stageOpen = true"
          />

          <p v-if="room.notice" class="room-notice" role="status">{{ room.notice }}</p>
          <p v-if="!state.track" class="stage-hint">
            {{ room.role === 'host' ? $t('还没播歌。去首页或搜索点一首，大家就会一起听。') : $t('等房主播歌…') }}
          </p>
        </section>
      </div>

      <!-- 右边：聊天、成员 -->
      <aside class="side-panel">
        <div class="tabs" role="tablist">
          <button role="tab" :aria-selected="tab === 'chat'" :class="{ on: tab === 'chat' }" @click="tab = 'chat'">
            {{ $t('聊天') }}
          </button>
          <button role="tab" :aria-selected="tab === 'members'" :class="{ on: tab === 'members' }" @click="tab = 'members'">
            {{ $t('成员 {n}', { n: room.members.length }) }}
          </button>
        </div>

        <template v-if="tab === 'chat'">
          <div ref="chatList" class="messages" aria-live="polite">
            <p v-if="!room.messages.length" class="hint">{{ $t('说点什么，或按下面的表情') }}</p>
            <div
              v-for="m in room.messages"
              :key="m.id"
              class="message"
              :class="{ mine: m.userId === room.selfId }"
            >
              <Cover :url="memberOf(m.userId)?.avatar || ''" :size="30" round class="msg-avatar">
                <span class="initial">{{ initial(room.nameOf(m.userId)) }}</span>
              </Cover>
              <div class="msg-body">
                <span class="who">
                  <b v-if="m.userId !== room.selfId">{{ room.nameOf(m.userId) }} · </b>{{ timeOf(m.at) }}
                </span>
                <span class="bubble">{{ m.body }}</span>
              </div>
            </div>
          </div>
          <div class="reaction-bar">
            <button
              v-for="e in REACTIONS"
              :key="e"
              class="reaction"
              :aria-label="$t('送出表情 {emoji}', { emoji: e })"
              @click="room.sendReaction(e)"
            >
              {{ e }}
            </button>
          </div>
          <form class="composer" @submit.prevent="sendChat">
            <input
              v-model="draft"
              maxlength="200"
              :placeholder="$t('说点什么…')"
              :aria-label="$t('聊天内容')"
            />
            <button type="submit" :disabled="!draft.trim() || sending">{{ $t('发送') }}</button>
          </form>
        </template>

        <ul v-else class="members">
          <li v-for="m in room.members" :key="m.id">
            <Cover :url="m.avatar || ''" :size="40" round class="avatar">
              <span class="initial">{{ initial(m.name) }}</span>
            </Cover>
            <span class="name">{{ m.name }}<template v-if="m.id === room.selfId"> {{ $t('（我）') }}</template></span>
            <span v-if="m.id === room.hostId" class="badge">{{ $t('房主') }}</span>
            <button
              v-else-if="room.role === 'host' && m.id !== room.selfId"
              class="ghost small"
              @click="handOver(m)"
            >
              {{ $t('设为房主') }}
            </button>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
button {
  font: inherit;
  cursor: pointer;
}

/* ---------- 还没在房间里 ---------- */
header h1 {
  margin: 8px 0 8px;
  font-size: clamp(30px, 4vw, 44px);
}
header p {
  margin: 0;
  color: var(--text-dim);
}
.start {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  align-items: start;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
}
.card h2 {
  margin: 0;
  font-size: 18px;
}
.card p {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
}
.primary {
  align-self: flex-start;
  padding: 11px 24px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
.primary:disabled {
  opacity: 0.6;
}
.ghost {
  padding: 8px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}
.ghost:hover {
  border-color: var(--text-dim);
}
.ghost.small {
  margin-left: auto;
  min-height: 32px;
  padding: 0 12px;
  font-size: 12px;
}
.join {
  display: flex;
  gap: 8px;
}
.code-input {
  flex: 1;
  min-width: 0;
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font: 700 18px/1 ui-monospace, 'Cascadia Mono', Consolas, monospace;
  letter-spacing: 0.25em;
  text-transform: uppercase;
}
.code-input::placeholder {
  font-weight: 400;
  letter-spacing: 0.05em;
}
.code-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.join .primary {
  align-self: stretch;
}
.error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--accent);
  font-size: 14px;
}

/* ---------- 在房间里：左边歌词、右边聊天，填满画面 ---------- */
.room-page.inside {
  padding-top: 20px;
  padding-bottom: 20px;
}
.room {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
  height: calc(100dvh - var(--titlebar-height, 0px) - 160px);
  min-height: 520px;
}

.stage-panel {
  position: relative;
  min-height: 0;
  overflow: hidden;
  border-radius: 22px;
  background: #0b0d0d;
  color: #fff;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.left .stage-panel {
  flex: 1;
}
/* 歌词框上面那条：房间码、谁在听（放在框外，不挡歌词，各种风格都看得清） */
.room-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.grow {
  flex: 1;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px 6px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 13px;
}
.chip-label {
  color: var(--text-dim);
}
.chip code {
  font: 700 17px 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.14em;
}
.chip-btn {
  padding: 4px 11px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}
.chip-btn:hover {
  background: var(--line-strong);
}
.avatars {
  display: flex;
  align-items: center;
}
.av {
  position: relative;
  width: 34px;
  height: 34px;
  margin-left: -9px;
  border: 2px solid var(--bg);
  border-radius: 50%;
}
.av:first-child {
  margin-left: 0;
}
.av :deep(.cover) {
  width: 100%;
}
.crown {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
}
.more-count {
  display: grid;
  place-items: center;
  background: var(--surface-hover);
  font-size: 12px;
  font-weight: 700;
}
.initial {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 800;
}
.listening {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--text-dim);
}
.listening i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3ddc84;
  box-shadow: 0 0 0 3px rgb(61 220 132 / 0.25);
}
.more-wrap {
  position: relative;
}
.round-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font-size: 18px;
  line-height: 1;
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 160px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}
.menu button {
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--text);
  text-align: left;
  font-size: 14px;
}
.menu button:hover {
  background: var(--surface-hover);
}
.menu .danger {
  color: var(--accent);
}
.room-notice {
  position: absolute;
  z-index: 20;
  top: 16px;
  left: 20px;
  right: 20px;
  margin: 0;
  color: #ffd0d8;
  font-size: 13px;
  font-weight: 700;
}
.stage-hint {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  bottom: 70px;
  margin: 0;
  padding: 0 24px;
  text-align: center;
  color: rgb(255 255 255 / 0.7);
  font-size: 14px;
}

/* ---------- 右边：聊天、成员 ---------- */
.side-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface);
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  padding: 10px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-dim);
  font-weight: 700;
}
.tabs button.on {
  border-color: var(--accent);
  color: var(--text);
}
.messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
}
.hint {
  margin: auto 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-faint);
}
.message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.message.mine {
  flex-direction: row-reverse;
}
.msg-avatar {
  flex: none;
  width: 30px;
}
.msg-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  max-width: 80%;
}
.mine .msg-body {
  align-items: flex-end;
}
.who {
  font-size: 12px;
  color: var(--text-faint);
}
.who b {
  font-weight: 700;
  color: var(--text-dim);
}
.bubble {
  padding: 8px 13px;
  border-radius: 4px 16px 16px 16px;
  background: var(--surface-hover);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.mine .bubble {
  border-radius: 16px 4px 16px 16px;
  background: var(--accent);
  color: var(--on-accent);
}
.reaction-bar {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}
.reaction {
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 20px;
  transition: transform 0.12s;
}
.reaction:hover {
  transform: scale(1.12);
}
.reaction:active {
  transform: scale(0.92);
}
.composer {
  display: flex;
  gap: 8px;
  padding: 0 14px 14px;
}
.composer input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.composer button {
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
.composer button:disabled {
  opacity: 0.5;
  cursor: default;
}
.members {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  list-style: none;
}
.members li {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  flex: none;
  width: 40px;
}
.name {
  flex: 1;
  min-width: 0;
  font-weight: 700;
}
.badge {
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

/* ---------- 手机：歌词在上、聊天在下 ---------- */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  header h1 {
    font-size: 28px;
  }
  .room-page.inside {
    padding: 0 0 12px;
    gap: 0;
  }
  .room {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    min-height: 0;
    gap: 0;
  }
  .stage-panel {
    height: min(52dvh, 460px);
    min-height: 340px;
    border-radius: 0 0 26px 26px;
  }
  .left {
    gap: 0;
  }
  .room-top {
    padding: 10px 12px;
    gap: 8px;
  }
  .chip {
    padding-left: 12px;
  }
  .chip-label,
  .listening {
    display: none;
  }
  .chip code {
    font-size: 15px;
  }
  .side-panel {
    border: 0;
    border-radius: 0;
    background: none;
  }
  .messages {
    max-height: 46dvh;
    min-height: 180px;
  }
}
</style>
