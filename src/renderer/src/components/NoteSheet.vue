<script setup>
// 点便签后弹出来的面板（手机从下面滑上来，电脑在中间）
// - 好友的：完整的便签、他附的 / 正在听的歌（播放、加入队列）、送一个表情回应他
// - 自己的：写便签（最多 60 字，可以附上正在听的歌）、删除，下面是收到的回应
import { computed, ref } from 'vue';
import { NOTE_MAX, NOTE_REACTIONS } from '@core/data';
import { useAuthStore } from '../stores/auth';
import { useFriendsStore } from '../stores/friends';
import { useNoticeStore } from '../stores/notice';
import { usePlayer } from '../composables/usePlayer';
import { artistNames, timeAgo } from '../utils/format';
import { t } from '../i18n';
import Cover from './Cover.vue';
import Icon from './Icon.vue';

const auth = useAuthStore();
const friendsStore = useFriendsStore();
const notice = useNoticeStore();
const { state, player } = usePlayer();

const dialog = ref(null);
/** 打开的是谁：FriendNotes 的一项（isMe = 自己） */
const item = ref(null);
const draft = ref('');
const attach = ref(true);
const busy = ref(false);
/** 这次送出去的表情（按过的亮起来） */
const sent = ref(new Set());

function open(target) {
  item.value = target;
  sent.value = new Set();
  if (target.isMe) {
    draft.value = target.note?.body ?? '';
    attach.value = target.note ? Boolean(target.note.track) : true;
    friendsStore.markSeen();
  }
  dialog.value.showModal();
}
const close = () => dialog.value?.close();
defineExpose({ open });

const initial = name => (name || '?').slice(0, 1).toUpperCase();

/** 便签还会显示多久 */
const hoursLeft = computed(() => {
  const until = item.value?.note?.expiresAt;
  return until ? Math.max(1, Math.round((new Date(until) - Date.now()) / 3600000)) : 0;
});

// ---- 好友的 ----
function play() {
  player.playList([item.value.song], 0, `friend:${item.value.id}`);
  close();
}
function queue() {
  player.addToQueue(item.value.song);
  notice.show(t('已加入播放队列：{name}', { name: item.value.song.name }));
}
async function react(emoji) {
  const { id, note, song } = item.value;
  try {
    await friendsStore.react(id, emoji, note?.body ? 'note' : 'listening', note?.body || song?.name || '');
    sent.value = new Set(sent.value).add(emoji);
  } catch (err) {
    notice.show(
      err?.code === '54000' ? t('送太多了，等一下再送') : t('送不出去：{error}', { error: err.message || err })
    );
  }
}

// ---- 自己的 ----
/** 现在播的歌（可以附上） */
const nowSong = computed(() => state.track ?? null);
const canShare = computed(() => !busy.value && (draft.value.trim() || (attach.value && nowSong.value)));
async function share() {
  busy.value = true;
  try {
    await friendsStore.saveNote(draft.value, attach.value && Boolean(nowSong.value));
    notice.show(t('便签分享给好友了，24 小时后自动消失'));
    close();
  } catch (err) {
    notice.show(t('分享失败：{error}', { error: err.message || err }));
  } finally {
    busy.value = false;
  }
}
async function remove() {
  busy.value = true;
  try {
    await friendsStore.deleteNote();
    close();
  } catch (err) {
    notice.show(t('删除失败：{error}', { error: err.message || err }));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="sheet" @click.self="close">
    <div v-if="item" class="box">
      <span class="grab" aria-hidden="true" />
      <button class="close" :aria-label="$t('关闭')" @click="close"><Icon name="x" :size="20" /></button>

      <!-- 好友的便签 / 正在听 -->
      <template v-if="!item.isMe">
        <div class="who">
          <span v-if="item.note?.body" class="bubble">{{ item.note.body }}</span>
          <Cover :url="item.avatar || ''" :size="84" round class="who-avatar">
            <span class="initial">{{ initial(item.name) }}</span>
          </Cover>
          <strong>{{ item.name }}</strong>
          <small v-if="item.live">{{ $t('正在听') }}</small>
          <small v-else-if="item.note">
            {{ $t('{time} · 还会显示 {h} 小时', { time: timeAgo(item.note.createdAt, t), h: hoursLeft }) }}
          </small>
        </div>

        <div v-if="item.song" class="song-card">
          <Cover :url="item.song.al?.picUrl" :size="64" radius="10px" class="song-cover" />
          <span class="song-meta">
            <b>{{ item.song.name }}</b>
            <span>{{ artistNames(item.song) }}</span>
          </span>
        </div>
        <div v-if="item.song" class="actions">
          <button class="btn primary" @click="play"><Icon name="play" :size="16" />{{ $t('播放') }}</button>
          <button class="btn" @click="queue"><Icon name="queue" :size="18" />{{ $t('加入队列') }}</button>
        </div>

        <div class="react">
          <button
            v-for="e in NOTE_REACTIONS"
            :key="e"
            :class="{ sent: sent.has(e) }"
            :aria-label="$t('送出表情 {emoji}', { emoji: e })"
            @click="react(e)"
          >
            {{ e }}
          </button>
        </div>
        <p class="hint">
          {{ sent.size ? $t('送出了，{name} 会收到通知', { name: item.name }) : $t('按表情回应，{name} 会收到通知', { name: item.name }) }}
        </p>
      </template>

      <!-- 自己的便签 -->
      <template v-else>
        <h3>{{ $t('你的便签') }}</h3>
        <label class="write">
          <textarea
            v-model="draft"
            :maxlength="NOTE_MAX"
            rows="3"
            :placeholder="$t('写一句话，好友会看到…')"
            :aria-label="$t('便签内容')"
          />
          <span class="count">{{ draft.length }} / {{ NOTE_MAX }}</span>
        </label>
        <label v-if="nowSong" class="attach">
          <Cover :url="nowSong.al?.picUrl" :size="44" radius="8px" class="attach-cover" />
          <span class="attach-meta">
            <b>{{ $t('附上正在听的歌') }}</b>
            <span>{{ nowSong.name }} · {{ artistNames(nowSong) }}</span>
          </span>
          <input v-model="attach" type="checkbox" role="switch" class="switch" />
        </label>
        <p class="info">{{ $t('只有好友看得到，24 小时后自动消失。开着私人模式时不会显示。') }}</p>
        <div class="actions" :class="{ single: !item.note }">
          <button v-if="item.note" class="btn" :disabled="busy" @click="remove">{{ $t('删除便签') }}</button>
          <button class="btn primary" :disabled="!canShare" @click="share">{{ $t('分享') }}</button>
        </div>

        <template v-if="friendsStore.reactions.length">
          <h4>{{ $t('收到的回应') }}</h4>
          <ul class="received">
            <li v-for="r in friendsStore.reactions.slice(0, 20)" :key="r.id">
              <span class="emoji">{{ r.emoji }}</span>
              <span class="received-meta">
                <b>{{ friendsStore.nameOf(r.from) }}</b>
                <span>{{ r.target === 'note' ? $t('你的便签「{text}」', { text: r.context }) : $t('你在听的《{song}》', { song: r.context }) }}</span>
              </span>
              <span class="ago">{{ timeAgo(r.at, t) }}</span>
            </li>
          </ul>
        </template>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: min(460px, calc(100vw - 24px));
  max-height: min(760px, calc(100dvh - 48px));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.sheet::backdrop {
  background: rgb(0 0 0 / 0.55);
}
.box {
  position: relative;
  padding: 14px 22px 24px;
}
.grab {
  display: none;
}
.close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
button {
  font: inherit;
}

.who {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 12px;
}
.bubble {
  position: relative;
  max-width: 280px;
  margin-bottom: 14px;
  padding: 11px 16px;
  border-radius: 18px;
  background: var(--surface-2, var(--surface-hover));
  font-size: 15px;
  line-height: 1.45;
  text-align: center;
  overflow-wrap: anywhere;
}
.bubble::after {
  content: '';
  position: absolute;
  left: 46%;
  bottom: -7px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: inherit;
}
.who-avatar {
  width: 84px;
}
.initial {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 30px;
  font-weight: 900;
}
.who strong {
  margin-top: 10px;
  font-size: 17px;
}
.who small {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-faint);
}
.song-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
  padding: 12px;
  border-radius: 16px;
  background: var(--surface-2, var(--surface-hover));
}
.song-cover {
  flex: none;
  width: 64px;
}
.song-meta,
.attach-meta,
.received-meta {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.song-meta b,
.song-meta span,
.attach-meta b,
.attach-meta span,
.received-meta span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.song-meta b {
  font-size: 16px;
}
.song-meta span,
.attach-meta span,
.received-meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 14px;
}
.actions.single {
  grid-template-columns: 1fr;
}
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 46px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: none;
  color: var(--text);
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
}
.btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.react {
  display: flex;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.react button {
  width: 46px;
  height: 46px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--surface-2, var(--surface-hover));
  font-size: 21px;
  cursor: pointer;
  transition: transform 0.12s;
}
.react button:active {
  transform: scale(0.9);
}
.react button.sent {
  border-color: var(--accent);
  transform: scale(1.08);
}
.hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

h3 {
  margin: 6px 0 14px;
  font-size: 18px;
  text-align: center;
}
h4 {
  margin: 22px 0 6px;
  font-size: 15px;
}
.write {
  position: relative;
  display: block;
}
.write textarea {
  display: block;
  width: 100%;
  min-height: 110px;
  padding: 14px 16px 28px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface-2, var(--surface-hover));
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: none;
  box-sizing: border-box;
}
.write textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.count {
  position: absolute;
  right: 14px;
  bottom: 10px;
  font-size: 12px;
  color: var(--text-faint);
}
.attach {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  cursor: pointer;
}
.attach-cover {
  flex: none;
  width: 44px;
}
.attach-meta b {
  font-size: 14px;
}
.info {
  margin: 12px 4px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-faint);
}
.received {
  margin: 0;
  padding: 0;
  list-style: none;
}
.received li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.received li:last-child {
  border-bottom: 0;
}
.emoji {
  font-size: 22px;
}
.received-meta b {
  font-size: 14px;
}
.ago {
  flex: none;
  font-size: 12px;
  color: var(--text-faint);
}
/* 开关（和设置页一样） */
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

/* 手机：从下面滑上来 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .sheet {
    width: 100vw;
    max-width: 100vw;
    max-height: 88dvh;
    margin: auto 0 0;
    border: 0;
    border-radius: 26px 26px 0 0;
  }
  .sheet[open] {
    animation: up 0.22s ease-out;
  }
  .box {
    padding-bottom: calc(24px + env(safe-area-inset-bottom));
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
