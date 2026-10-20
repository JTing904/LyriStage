<script setup>
// 一起听：开房间 / 用房间码加入；房间里显示房间码、谁在听、正在播什么
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useRoomStore, normalizeCode, REACTIONS } from '../stores/room';
import { usePlayer } from '../composables/usePlayer';
import { artistNames } from '../utils/format';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';

const room = useRoomStore();
const route = useRoute();
const { state } = usePlayer();

const input = ref('');
const copied = ref(false);

// 网址带了房间码（/room?code=ABC123）就直接加入
onMounted(() => {
  const code = normalizeCode(route.query.code);
  if (code && !room.inRoom) {
    input.value = code;
    room.joinRoom(code);
  }
});

// ---- 聊天 ----
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
watch(
  () => room.messages.length,
  () => nextTick(() => chatList.value && (chatList.value.scrollTop = chatList.value.scrollHeight))
);
const timeOf = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const shareLink = computed(() => `https://lyristage.vercel.app/#/room?code=${room.code}`);
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // 不能复制就让用户自己抄
  }
}
</script>

<template>
  <div class="page room-page">
    <header>
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
    <div v-else class="inside">
      <section class="card code-card">
        <span class="label">{{ room.role === 'host' ? $t('你是房主 · 房间码') : $t('房间码') }}</span>
        <div class="code">{{ room.code }}</div>
        <div class="actions">
          <button class="ghost" @click="copy(room.code)">{{ copied ? $t('已复制 ✓') : $t('复制房间码') }}</button>
          <button class="ghost" @click="copy(shareLink)">{{ $t('复制网页链接') }}</button>
          <button class="ghost danger" @click="room.leave()">
            {{ room.role === 'host' ? $t('关闭房间') : $t('离开房间') }}
          </button>
        </div>
        <p v-if="room.notice" class="notice">{{ room.notice }}</p>
      </section>

      <section class="card">
        <h2>{{ $t('正在听') }}</h2>
        <div v-if="state.track" class="now">
          <Cover :url="state.track.al?.picUrl" :size="72" radius="10px" class="cover" />
          <div class="meta">
            <strong>{{ state.track.name }}</strong>
            <span>{{ artistNames(state.track) }}</span>
            <span class="hint">
              {{ room.role === 'host' ? $t('你播什么大家就听什么，去别的页面点歌也会同步。') : $t('跟着 {name} 一起听', { name: room.host?.name ?? $t('房主') }) }}
            </span>
          </div>
        </div>
        <p v-else class="hint">
          {{ room.role === 'host' ? $t('还没播歌。去首页或搜索点一首，大家就会一起听。') : $t('等房主播歌…') }}
        </p>
      </section>

      <section class="card chat">
        <h2>{{ $t('聊天') }}</h2>
        <div ref="chatList" class="messages" aria-live="polite">
          <p v-if="!room.messages.length" class="hint">{{ $t('说点什么，或按下面的表情') }}</p>
          <div
            v-for="m in room.messages"
            :key="m.id"
            class="message"
            :class="{ mine: m.userId === room.selfId }"
          >
            <span class="who">{{ room.nameOf(m.userId) }} · {{ timeOf(m.at) }}</span>
            <span class="bubble">{{ m.body }}</span>
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
      </section>

      <section class="card">
        <h2>{{ $t('房间里 {n} 个人', { n: room.members.length }) }}</h2>
        <ul class="members">
          <li v-for="m in room.members" :key="m.id">
            <Cover v-if="m.avatar" :url="m.avatar" :size="40" round class="avatar" />
            <span v-else class="avatar initial">{{ m.name.slice(0, 1).toUpperCase() }}</span>
            <span class="name">{{ m.name }}</span>
            <span v-if="m.id === room.hostId" class="badge">{{ $t('房主') }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 聊天 */
.chat {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  min-height: 120px;
  overflow-y: auto;
  padding: 4px 2px;
}
.message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}
.message.mine {
  align-items: flex-end;
}
.who {
  font-size: 12px;
  color: var(--text-dim);
}
.bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 14px 14px 14px 4px;
  background: var(--surface-hover);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.message.mine .bubble {
  border-radius: 14px 14px 4px 14px;
  background: var(--accent);
  color: var(--on-accent);
}
.reaction-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.reaction {
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg);
  font-size: 22px;
  cursor: pointer;
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
}
.composer input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.composer button {
  min-height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.composer button:disabled {
  opacity: 0.5;
  cursor: default;
}
header h1 {
  margin: 8px 0 8px;
  font-size: clamp(30px, 4vw, 44px);
}
header p {
  margin: 0;
  color: var(--text-dim);
}
.start,
.inside {
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
button {
  font: inherit;
  cursor: pointer;
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
.ghost.danger:hover {
  border-color: var(--accent);
  color: var(--accent);
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

.code-card {
  grid-column: 1 / -1;
  align-items: flex-start;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), var(--surface));
}
.label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}
.code {
  font: 800 clamp(40px, 7vw, 64px) / 1 ui-monospace, 'Cascadia Mono', Consolas, monospace;
  letter-spacing: 0.18em;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.notice {
  color: var(--accent) !important;
  font-weight: 700;
}
.now {
  display: flex;
  align-items: center;
  gap: 14px;
}
.now .cover {
  width: 72px;
  flex: none;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.meta strong {
  font-size: 17px;
}
.meta span {
  font-size: 14px;
  color: var(--text-dim);
}
.hint {
  font-size: 13px;
  color: var(--text-faint) !important;
}
.members {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.members li {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 40px;
  flex: none;
}
.initial {
  display: grid;
  place-items: center;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 800;
}
.name {
  flex: 1;
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
</style>
