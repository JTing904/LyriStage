<script setup>
// 好友：好友码、加好友、收到的邀请、好友在听什么、隐私设置。
// 参考 Apple Music（要对方同意才能看到）和 Spotify（好友动态、私人模式）
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useFriendsStore } from '../stores/friends';
import { useNoticeStore } from '../stores/notice';
import { usePlayer } from '../composables/usePlayer';
import { timeAgo } from '../utils/format';
import { t } from '../i18n';
import Cover from '../components/Cover.vue';
import Icon from '../components/Icon.vue';

const friendsStore = useFriendsStore();
const notice = useNoticeStore();
const { player } = usePlayer();
const route = useRoute();

const code = ref('');
const busy = ref(false);

/** 网页版的链接（手机、电脑版都打得开：没装 App 的人也能先看到网页） */
const inviteLink = computed(() =>
  friendsStore.profile?.friendCode
    ? `https://lyristage.vercel.app/#/friends?add=${friendsStore.profile.friendCode}`
    : ''
);

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    notice.show(message);
  } catch {
    notice.show(t('复制失败，请手动选取'));
  }
}

const RESULT = {
  sent: '邀请已送出，对方同意后就是好友了',
  accepted: '对方也邀请过你，你们现在是好友了',
  friends: '你们已经是好友了',
  not_found: '找不到这个好友码，检查一下有没有打错',
  self: '这是你自己的好友码',
};
async function add() {
  const value = code.value.trim();
  if (!value || busy.value) return;
  busy.value = true;
  try {
    const result = await friendsStore.send(value);
    notice.show(t(RESULT[result] ?? '邀请已送出，对方同意后就是好友了'));
    if (result !== 'not_found') code.value = '';
  } catch (err) {
    notice.show(t('送出失败：{error}', { error: err.message || err }));
  } finally {
    busy.value = false;
  }
}

// 从邀请链接打开（#/friends?add=好友码）：先填好，用户按一下就送出
onMounted(() => {
  if (typeof route.query.add === 'string') code.value = route.query.add;
});

async function answer(person, accept) {
  try {
    await friendsStore.answer(person.id, accept);
    notice.show(accept ? t('你和 {name} 现在是好友了', { name: person.name }) : t('已拒绝'));
  } catch (err) {
    notice.show(t('操作失败：{error}', { error: err.message || err }));
  }
}

const removing = ref(null);
const confirmBox = ref(null);
function askRemove(person) {
  removing.value = person;
  confirmBox.value.showModal();
}
async function confirmRemove() {
  confirmBox.value.close();
  const person = removing.value;
  try {
    await friendsStore.remove(person.id);
  } catch (err) {
    notice.show(t('操作失败：{error}', { error: err.message || err }));
  }
}

/** 好友 + 他最近在听的（没在听的也列出来） */
const rows = computed(() => {
  const active = new Map(friendsStore.activity.map(a => [a.id, a]));
  return friendsStore.friends
    .map(f => active.get(f.id) ?? f)
    .sort((a, b) => (b.live ?? false) - (a.live ?? false) || Boolean(b.track) - Boolean(a.track));
});
const artists = track => (track?.ar ?? []).map(a => a.name).join(' / ');

const privateLeft = computed(() => {
  if (!friendsStore.inPrivateMode) return '';
  const minutes = Math.max(1, Math.round((new Date(friendsStore.privateUntil) - Date.now()) / 60000));
  return minutes >= 60
    ? t('还有 {h} 小时', { h: Math.ceil(minutes / 60) })
    : t('还有 {m} 分钟', { m: minutes });
});
async function toggleShare(on) {
  try {
    await friendsStore.setShareListening(on);
  } catch (err) {
    notice.show(t('保存失败：{error}', { error: err.message || err }));
  }
}
async function togglePrivate() {
  try {
    await friendsStore.setPrivateMode(!friendsStore.inPrivateMode);
  } catch (err) {
    notice.show(t('保存失败：{error}', { error: err.message || err }));
  }
}
</script>

<template>
  <div class="page friends-page">
    <h1 class="display title">{{ $t('好友') }}</h1>

    <p v-if="!friendsStore.available" class="page-state">
      {{ $t('好友功能还没开通（管理员要先更新数据库）') }}
    </p>

    <template v-else>
      <!-- 我的好友码 + 加好友 -->
      <section class="card">
        <div class="my-code">
          <span class="label">{{ $t('你的好友码') }}</span>
          <code>{{ friendsStore.profile?.friendCode ?? '…' }}</code>
          <div class="buttons">
            <button class="ghost" :disabled="!friendsStore.profile" @click="copy(friendsStore.profile.friendCode, $t('好友码已复制'))">
              {{ $t('复制好友码') }}
            </button>
            <button class="ghost" :disabled="!inviteLink" @click="copy(inviteLink, $t('邀请链接已复制，传给朋友就好'))">
              {{ $t('复制邀请链接') }}
            </button>
          </div>
          <p class="hint">{{ $t('朋友输入你的好友码、你同意后才是好友。只有好友看得到你在听什么。') }}</p>
        </div>
        <form class="add" @submit.prevent="add">
          <input
            v-model="code"
            class="code-input"
            maxlength="12"
            autocomplete="off"
            :placeholder="$t('输入朋友的好友码')"
            :aria-label="$t('朋友的好友码')"
          />
          <button class="primary" :disabled="busy || !code.trim()">{{ $t('加好友') }}</button>
        </form>
      </section>

      <!-- 收到的邀请 -->
      <section v-if="friendsStore.incoming.length">
        <h2 class="section-title">{{ $t('收到的邀请') }}</h2>
        <ul class="people card">
          <li v-for="p in friendsStore.incoming" :key="p.id">
            <Cover :url="p.avatar" :size="44" round class="avatar" />
            <span class="name">{{ p.name }}</span>
            <button class="ghost small" @click="answer(p, false)">{{ $t('拒绝') }}</button>
            <button class="primary small" @click="answer(p, true)">{{ $t('同意') }}</button>
          </li>
        </ul>
      </section>

      <!-- 好友在听什么 -->
      <section>
        <h2 class="section-title">{{ $t('好友') }}</h2>
        <p v-if="!rows.length" class="empty">{{ $t('还没有好友。把你的好友码传给朋友吧。') }}</p>
        <ul v-else class="people card">
          <li v-for="p in rows" :key="p.id">
            <Cover :url="p.avatar" :size="44" round class="avatar" />
            <span class="who">
              <span class="name">{{ p.name }}</span>
              <span v-if="p.track" class="listening">
                <span v-if="p.live" class="live-dot" :aria-label="$t('正在听')" />
                {{ p.track.name }} · {{ artists(p.track) }}
                <span v-if="!p.live" class="ago">{{ timeAgo(p.updatedAt, t) }}</span>
              </span>
              <span v-else class="listening quiet">{{ $t('最近没在听') }}</span>
            </span>
            <button
              v-if="p.track"
              class="icon-btn"
              :aria-label="$t('播放 {name}', { name: p.track.name })"
              @click="player.playList([p.track], 0, `friend:${p.id}`)"
            >
              <Icon name="play" :size="20" />
            </button>
            <button class="icon-btn" :aria-label="$t('解除好友')" @click="askRemove(p)">
              <Icon name="x" :size="18" />
            </button>
          </li>
        </ul>
      </section>

      <!-- 送出去还没回应的 -->
      <section v-if="friendsStore.outgoing.length">
        <h2 class="section-title">{{ $t('已送出的邀请') }}</h2>
        <ul class="people card">
          <li v-for="p in friendsStore.outgoing" :key="p.id">
            <Cover :url="p.avatar" :size="44" round class="avatar" />
            <span class="name">{{ p.name }}</span>
            <span class="pending">{{ $t('等对方同意') }}</span>
            <button class="ghost small" @click="friendsStore.remove(p.id)">{{ $t('取消') }}</button>
          </li>
        </ul>
      </section>

      <!-- 隐私 -->
      <section>
        <h2 class="section-title">{{ $t('隐私') }}</h2>
        <div class="card privacy">
          <label class="switch-row">
            <span>
              {{ $t('让好友看到我在听什么') }}
              <small>{{ $t('关掉后，好友就看不到你在听的歌') }}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              :checked="friendsStore.profile?.shareListening"
              @change="toggleShare($event.target.checked)"
            />
          </label>
          <div class="switch-row">
            <span>
              {{ $t('私人模式') }}
              <small>{{ friendsStore.inPrivateMode ? privateLeft : $t('暂时不让好友看到，6 小时后自动结束') }}</small>
            </span>
            <button class="ghost small" :disabled="!friendsStore.profile?.shareListening" @click="togglePrivate">
              {{ friendsStore.inPrivateMode ? $t('结束私人模式') : $t('开始') }}
            </button>
          </div>
        </div>
      </section>
    </template>

    <dialog ref="confirmBox" class="confirm" @click.self="confirmBox.close()">
      <div class="confirm-box">
        <h3>{{ $t('解除和 {name} 的好友关系？', { name: removing?.name ?? '' }) }}</h3>
        <p>{{ $t('你们就看不到彼此在听什么了。之后可以再用好友码加回来。') }}</p>
        <div class="confirm-buttons">
          <button class="ghost" @click="confirmBox.close()">{{ $t('取消') }}</button>
          <button class="primary" @click="confirmRemove">{{ $t('解除') }}</button>
        </div>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.title {
  margin: 0;
  font-size: clamp(28px, 4vw, 44px);
}
.card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}
.my-code {
  display: grid;
  gap: 10px;
}
.label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}
.my-code code {
  font: 800 34px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.12em;
}
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hint,
.empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
}
.add {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.code-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font: 700 16px 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
button {
  font: inherit;
  cursor: pointer;
}
.primary,
.ghost {
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.ghost {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text);
}
.small {
  height: 34px;
  padding: 0 14px;
  font-size: 13px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.people {
  margin: 0;
  padding: 4px 14px;
  list-style: none;
}
.people li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.people li:last-child {
  border-bottom: 0;
}
.avatar {
  flex: none;
  width: 44px;
}
.who {
  display: grid;
  flex: 1;
  min-width: 0;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.listening {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-dim);
}
.listening.quiet {
  color: var(--text-faint);
}
.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
  background: #2fa463;
  vertical-align: 1px;
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.ago {
  margin-left: 6px;
  color: var(--text-faint);
}
.pending {
  font-size: 13px;
  color: var(--text-dim);
}
.icon-btn {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text);
}
.icon-btn:hover {
  background: var(--surface-hover);
}
.privacy {
  display: grid;
  gap: 14px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.switch-row small {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-dim);
}
@media (prefers-reduced-motion: reduce) {
  .live-dot {
    animation: none;
  }
}
/* 手机：顶部让出返回列 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .title {
    margin-top: 44px;
    font-size: 28px;
  }
}

/* 开关、确认框（和设置页一样） */
.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 44px;
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
  transform: translateX(18px);
}
.confirm {
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.35);
}
.confirm::backdrop {
  background: rgb(0 0 0 / 0.45);
}
.confirm-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
}
.confirm-box h3 {
  margin: 0;
  font-size: 18px;
}
.confirm-box p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.confirm-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
