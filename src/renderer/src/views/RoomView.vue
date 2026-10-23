<script setup>
// 一起听：开房间 / 用房间码加入
// 房间里：左边是歌词（直接用歌词舞台的风格，大家同步），上面一条是房间码和谁在听；右边是聊天、成员
// 成员可以「点歌」，房主在聊天里按「下一首播放 / 加入队列」；好友敲门时房主上面会出现「同意 / 拒绝」
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRoomStore, normalizeCode, REACTIONS } from '../stores/room';
import { useUiStore } from '../stores/ui';
import { useVoiceStore } from '../stores/voice';
import { usePlayer } from '../composables/usePlayer';
import { getEnglishTranslation, getLyrics } from '../services';
import { artistNames } from '../utils/format';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';
import SongPicker from '../components/SongPicker.vue';
import HostSheet from '../components/HostSheet.vue';
import LyricStage from '../lyric-stage/LyricStage.vue';
import { t } from '../i18n';
import { shareLink } from '../platform';

const room = useRoomStore();
const ui = useUiStore();
const voice = useVoiceStore();
/** 语音里的人：id → { muted } */
const inVoice = computed(() => new Map(voice.participants.map(p => [p.id, p])));
const route = useRoute();
const router = useRouter();
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

// 聊天面板可以收起来（歌词就能占满整个画面）；记住上次的选择。收起来时有新消息，按钮上显示几则
const CHAT_KEY = 'lyristage:room-chat';
const chatOpen = ref((() => {
  try {
    return localStorage.getItem(CHAT_KEY) !== 'closed';
  } catch {
    return true;
  }
})());
const unread = ref(0);
watch(chatOpen, open => {
  try {
    localStorage.setItem(CHAT_KEY, open ? 'open' : 'closed');
  } catch {
    // 存不了就只在这次生效
  }
  if (open) {
    unread.value = 0;
    scrollChat();
  }
});
watch(
  () => room.messages.length,
  (n, before) => {
    if (!chatOpen.value && n > before) unread.value += n - before;
  }
);

// ---- 点歌 ----
const picker = ref(null);
const requesting = ref(false);
async function sendRequests(tracks) {
  requesting.value = true;
  for (const track of tracks.slice(0, 10)) {
    if (!(await room.sendRequest(track))) break;
  }
  requesting.value = false;
  tab.value = 'chat';
}
// 成员在别的地方按到灰色的播放键，提示上按了「点歌」：/room?pick=1
async function openPickerFromQuery() {
  if (!route.query.pick) return;
  router.replace({ query: { ...route.query, pick: undefined } });
  await nextTick();
  if (room.role === 'guest') picker.value?.open();
}
onMounted(openPickerFromQuery);
watch(() => route.query.pick, openPickerFromQuery);

// 房主：关闭房间、换房主之前先确认（成员离开不用问）
const hostSheet = ref(null);
const handOver = member => hostSheet.value.open('pick', member);
function leaveOrClose() {
  menuOpen.value = false;
  if (room.role === 'host') hostSheet.value.open('close');
  else room.leave();
}

const memberOf = id => room.members.find(m => m.id === id);
const initial = name => (name || '?').slice(0, 1).toUpperCase();
const timeOf = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** 上面那条只放前 5 个头像，其他的显示 +N */
// 手机：顶部那条放不下一排头像（人多会把整页撑宽），只放房主一个，右下角写几个人
const phoneQuery = window.matchMedia('(max-width: 899px)');
const isPhone = ref(phoneQuery.matches);
const onPhoneChange = e => (isPhone.value = e.matches);
phoneQuery.addEventListener('change', onPhoneChange);
onBeforeUnmount(() => phoneQuery.removeEventListener('change', onPhoneChange));
const shownMembers = computed(() =>
  isPhone.value ? [room.host ?? room.members[0]].filter(Boolean) : room.members.slice(0, 5)
);

const roomLink = computed(() => `https://lyristage.vercel.app/#/room?code=${room.code}`);
/** 「邀请」：手机叫出系统分享（WhatsApp…），电脑复制 */
async function invite() {
  try {
    const result = await shareLink({
      title: t('LyriStage 一起听'),
      text: t('来 LyriStage 跟我一起听歌，房间码 {code}', { code: room.code }),
      url: roomLink.value,
    });
    if (result === 'copied') {
      copied.value = 'link';
      setTimeout(() => (copied.value = ''), 2000);
    }
  } catch {
    // 分享不了：房间码就在旁边，用户自己抄
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
      <!-- 刚才在房间里（App 被关掉、断线连不回来）：一键回去 -->
      <section v-if="room.lastRoom" class="card back">
        <h2>{{ $t('你刚才在房间 {code}', { code: room.lastRoom.code }) }}</h2>
        <p>{{ room.lastRoom.role === 'host' ? $t('你是房主，回去后大家可以继续跟着你听。') : $t('房间还开着，按一下就回去。') }}</p>
        <button class="primary" :disabled="room.status === 'connecting'" @click="room.rejoinLast()">
          {{ room.status === 'connecting' ? $t('连线中…') : $t('回到房间') }}
        </button>
      </section>

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
    <div v-else class="room" :class="{ 'no-chat': !chatOpen }">
      <!-- 左边：房间资料一条 + 歌词（跟全屏歌词同一组风格和设置） -->
      <div class="left">
        <div class="room-top">
          <span class="chip">
            <span class="chip-label">{{ $t('房间') }}</span>
            <code>{{ room.code }}</code>
            <!-- 一个「邀请」：手机跳出分享（WhatsApp…，附房间码和链接），电脑复制 -->
            <button class="chip-btn invite-btn" @click="invite">
              <template v-if="copied === 'link'">{{ $t('已复制 ✓') }}</template>
              <template v-else><Icon name="share" :size="14" />{{ $t('邀请') }}</template>
            </button>
          </span>
          <span class="grow" />
          <!-- 语音：默认关麦克风，按了才加入 -->
          <button
            v-if="voice.status === 'off'"
            class="voice-btn"
            :title="$t('加入语音')"
            @click="voice.join()"
          >
            <Icon name="mic" :size="16" /><span class="label">{{ $t('加入语音') }}</span>
          </button>
          <span v-else class="voice-on">
            <button
              class="voice-btn"
              :class="{ muted: voice.muted }"
              :disabled="voice.status === 'connecting'"
              :aria-label="voice.muted ? $t('打开麦克风') : $t('静音')"
              :title="voice.muted ? $t('打开麦克风') : $t('静音')"
              @click="voice.toggleMute()"
            >
              <Icon :name="voice.muted ? 'mic-off' : 'mic'" :size="16" />
              <span class="label">{{ voice.status === 'connecting' ? $t('连接中…') : voice.muted ? $t('已静音') : $t('语音中') }}</span>
            </button>
            <button class="voice-leave" :aria-label="$t('离开语音')" :title="$t('离开语音')" @click="voice.leave()">
              <Icon name="x" :size="14" />
            </button>
          </span>
          <span class="avatars" :aria-label="$t('{n} 人在听', { n: room.members.length })">
            <span
              v-for="m in shownMembers"
              :key="m.id"
              class="av"
              :class="{ speaking: voice.speaking.has(m.id) }"
              :title="m.name"
            >
              <Cover :url="m.avatar || ''" :size="34" round>
                <span class="initial">{{ initial(m.name) }}</span>
              </Cover>
              <span v-if="m.id === room.hostId" class="crown" aria-hidden="true">👑</span>
              <span v-if="inVoice.get(m.id)?.muted" class="mic-badge" aria-hidden="true"><Icon name="mic-off" :size="10" /></span>
              <span v-else-if="inVoice.has(m.id)" class="mic-badge on" aria-hidden="true"><Icon name="mic" :size="10" /></span>
              <span v-if="isPhone && room.members.length > 1" class="people-count" aria-hidden="true">{{ room.members.length }}</span>
            </span>
            <span v-if="!isPhone && room.members.length > shownMembers.length" class="av more-count">
              +{{ room.members.length - shownMembers.length }}
            </span>
          </span>
          <span class="listening"><i />{{ $t('{n} 人在听', { n: room.members.length }) }}</span>
          <!-- 打开 / 收起聊天 -->
          <button
            class="round-btn chat-toggle"
            :class="{ on: chatOpen }"
            :aria-pressed="chatOpen"
            :aria-label="chatOpen ? $t('收起聊天') : $t('打开聊天')"
            :title="chatOpen ? $t('收起聊天') : $t('打开聊天')"
            @click="chatOpen = !chatOpen"
          >
            <Icon name="chat" :size="16" />
            <span v-if="!chatOpen && unread" class="unread">{{ unread > 9 ? '9+' : unread }}</span>
          </button>
          <span class="more-wrap">
            <button class="round-btn" :aria-label="$t('更多')" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">⋯</button>
            <div v-if="menuOpen" class="menu" role="menu">
              <button role="menuitem" class="danger" @click="leaveOrClose">
                {{ room.role === 'host' ? $t('关闭房间') : $t('离开房间') }}
              </button>
            </div>
          </span>
        </div>

        <!-- 好友敲门（只有房主看得到） -->
        <div v-for="k in room.knocks" :key="k.id" class="knock" role="alert">
          <Cover :url="k.avatar" :size="32" round class="knock-avatar">
            <span class="initial">{{ initial(k.name) }}</span>
          </Cover>
          <span class="knock-text">{{ $t('{name} 想加入你的房间', { name: k.name }) }}</span>
          <button class="knock-no" @click="room.answerKnock(k.id, false)">{{ $t('拒绝') }}</button>
          <button class="knock-yes" @click="room.answerKnock(k.id, true)">{{ $t('同意') }}</button>
        </div>

        <p v-if="voice.error" class="voice-error" role="alert">{{ voice.error }}</p>
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
      <aside v-show="chatOpen" class="side-panel">
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
                <span v-if="!m.track" class="bubble">{{ m.body }}</span>
                <!-- 点歌 -->
                <div v-else class="request">
                  <span class="request-label"><Icon name="queue" :size="14" />{{ $t('点歌') }}</span>
                  <span class="request-song">
                    <Cover :url="m.track.al?.picUrl" :size="44" radius="8px" class="request-cover" />
                    <span class="request-meta">
                      <strong>{{ m.track.name }}</strong>
                      <span>{{ artistNames(m.track) }}</span>
                    </span>
                  </span>
                  <span v-if="room.accepted.has(m.id)" class="request-done">
                    <Icon name="check" :size="14" />{{ $t('已加进队列') }}
                  </span>
                  <span v-else-if="room.role === 'host'" class="request-actions">
                    <button @click="room.acceptRequest(m, 'next')">{{ $t('下一首播放') }}</button>
                    <button @click="room.acceptRequest(m, 'queue')">{{ $t('加入队列') }}</button>
                  </span>
                  <span v-else class="request-wait">{{ $t('等房主加进队列') }}</span>
                </div>
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
            <!-- 成员点歌（房主自己播就好） -->
            <button
              v-if="room.role === 'guest'"
              type="button"
              class="pick-btn"
              :aria-label="$t('点歌')"
              :title="$t('点歌')"
              @click="picker.open()"
            >
              <Icon name="plus" :size="18" />
            </button>
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
            <span class="name">
              {{ m.name }}<template v-if="m.id === room.selfId"> {{ $t('（我）') }}</template>
              <small v-if="inVoice.has(m.id)" class="voice-state">
                <Icon :name="inVoice.get(m.id).muted ? 'mic-off' : 'mic'" :size="12" />
                {{ inVoice.get(m.id).muted ? $t('已静音') : voice.speaking.has(m.id) ? $t('正在讲话') : $t('语音中') }}
              </small>
            </span>
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

      <HostSheet ref="hostSheet" />
      <SongPicker
        ref="picker"
        :busy="requesting"
        title="点歌"
        confirm-label="点给房主"
        busy-label="送出中…"
        @add="sendRequests"
      />
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
.card.back {
  grid-column: 1 / -1;
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
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
/* 要排在歌词框上面：「⋯」的选单会往下盖到歌词框（歌词框是独立的一层，不提高就会被它挡住） */
.room-top {
  position: relative;
  z-index: 30;
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
  white-space: nowrap;
}
.invite-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.chip-btn:hover {
  background: var(--line-strong);
}
.avatars {
  display: flex;
  align-items: center;
}
.people-count {
  position: absolute;
  right: -6px;
  bottom: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 2px solid var(--bg);
  border-radius: 999px;
  background: var(--text);
  color: var(--bg);
  font-size: 10px;
  font-weight: 800;
  line-height: 14px;
  text-align: center;
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
/* 语音 */
.voice-on {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.voice-btn {
  display: inline-flex;
  white-space: nowrap;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.voice-on .voice-btn {
  border-color: #30a46c;
  background: color-mix(in srgb, #30a46c 16%, var(--surface));
  color: #30a46c;
}
.voice-on .voice-btn.muted {
  border-color: var(--line-strong);
  background: var(--surface);
  color: var(--text-dim);
}
.voice-leave {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-dim);
}
.voice-leave:hover {
  border-color: var(--accent);
  color: var(--accent);
}
/* 正在讲话：头像外面一圈绿光 */
.av.speaking {
  box-shadow: 0 0 0 2px #30a46c, 0 0 12px 2px rgb(48 164 108 / 0.6);
  z-index: 1;
}
.mic-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--bg);
  border-radius: 50%;
  background: var(--text-faint);
  color: #fff;
}
.mic-badge.on {
  background: #30a46c;
}
.voice-error {
  margin: 0;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}
.voice-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  color: #30a46c;
  font-size: 12px;
  font-weight: 600;
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
.chat-toggle {
  position: relative;
  flex: none;
}
.chat-toggle.on {
  border-color: var(--accent);
  color: var(--accent);
}
.unread {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 2px solid var(--bg);
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 800;
  line-height: 14px;
  text-align: center;
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
  z-index: 1;
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
/* 点歌卡片 */
.request {
  display: grid;
  gap: 8px;
  width: 230px;
  max-width: 100%;
  padding: 10px 12px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface-2);
}
.request-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.request-song {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.request-cover {
  flex: none;
  width: 44px;
}
.request-meta {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.request-meta strong,
.request-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.request-meta strong {
  font-size: 14px;
}
.request-meta span,
.request-wait {
  font-size: 12px;
  color: var(--text-dim);
}
.request-done {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #30a46c;
}
.request-actions {
  display: flex;
  gap: 6px;
}
.request-actions button {
  flex: 1;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.request-actions button:last-child {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
/* 「点歌」按钮（盖过下面 .composer button 的红底） */
.composer .pick-btn {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--bg);
  color: var(--text);
}
/* 好友敲门 */
.knock {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.knock-avatar {
  flex: none;
  width: 32px;
}
.knock-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
}
.knock-yes,
.knock-no {
  flex: none;
  min-height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}
.knock-no {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
}
.knock-yes {
  border: 0;
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
  .listening,
  .voice-btn .label {
    display: none;
  }
  .voice-btn {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
  .voice-error {
    padding: 0 12px 6px;
  }
  .knock {
    margin: 0 12px 10px;
  }
  .chip {
    flex: none;
    gap: 6px;
  }
  .chip code {
    font-size: 15px;
    letter-spacing: 0.08em;
  }
  .chip-btn {
    padding: 4px 9px;
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
/* 手指：顶部的圆按钮加大到 40px（34px 太小，容易按错） */
@media (pointer: coarse) {
  .round-btn {
    width: 40px;
    height: 40px;
  }
  .voice-btn {
    height: 40px;
  }
  .room-top .voice-btn {
    min-width: 40px;
  }
  .chip {
    min-height: 40px;
  }
}
/* 很窄的手机：头像放不下就收起来（成员分页看得到） */
@media (max-width: 379px) {
  .avatars {
    display: none;
  }
}
/* 手机横屏：画面矮，歌词在左、聊天在右，跟电脑版一样排，不用往下卷才看到聊天 */
@media (pointer: coarse) and (max-height: 600px) and (orientation: landscape) {
  .room-page.inside {
    padding: 8px 12px 8px 0;
  }
  .room {
    grid-template-columns: minmax(0, 1fr) minmax(260px, 36%);
    gap: 12px;
    height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 80px);
    min-height: 0;
  }
  .left {
    gap: 8px;
  }
  .room-top {
    padding: 0;
  }
  .stage-panel {
    height: auto;
    min-height: 0;
    border-radius: 18px;
  }
  .side-panel {
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
  }
  .messages {
    max-height: none;
    min-height: 0;
    padding: 12px;
  }
  .reaction-bar {
    padding: 8px 10px;
  }
  .reaction {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }
  .composer {
    padding: 0 10px 10px;
  }
  .composer input,
  .composer button,
  .composer .pick-btn {
    min-height: 38px;
    height: 38px;
  }
  .composer .pick-btn {
    width: 38px;
  }
}
/* 聊天收起来：歌词占满 */
.room.no-chat {
  grid-template-columns: minmax(0, 1fr);
}
</style>
