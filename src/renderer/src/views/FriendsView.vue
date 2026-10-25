<script setup>
// 好友（底部第 3 个分页）：便签那一排（像 IG）、在一起听、好友名单、周榜、加好友、隐私设置。
// 参考 IG 私讯页的便签、Apple Music（要对方同意才能看到）和 Spotify（好友动态、私人模式）
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onPullRefresh } from '../composables/usePullRefresh';
import { useRoute } from 'vue-router';
import { useFriendsStore } from '../stores/friends';
import { useNoticeStore } from '../stores/notice';
import { usePlayer } from '../composables/usePlayer';
import { timeAgo } from '../utils/format';
import { t } from '../i18n';
import Cover from '../components/Cover.vue';
import WeeklyBoard from '../components/WeeklyBoard.vue';
import FriendNotes from '../components/FriendNotes.vue';
import FriendRooms from '../components/FriendRooms.vue';
import NoteSheet from '../components/NoteSheet.vue';
import Icon from '../components/Icon.vue';
import { showError, humanMessage } from '../friendlyError';
import { shareLink } from '../platform';

const friendsStore = useFriendsStore();
const notice = useNoticeStore();
const { player } = usePlayer();
const route = useRoute();
// 下拉刷新：好友、邀请、在听什么
onPullRefresh(() => friendsStore.refresh());

const code = ref('');
const busy = ref(false);

/** 网页版的链接（手机、电脑版都打得开：没装 App 的人也能先看到网页） */
const inviteLink = computed(() =>
  friendsStore.profile?.friendCode
    ? `https://lyristage.vercel.app/#/friends?add=${friendsStore.profile.friendCode}`
    : ''
);

/** 「分享」：手机跳出系统分享（WhatsApp…，附好友码和链接），电脑复制 */
async function shareInvite() {
  try {
    const result = await shareLink({
      title: t('加我当 LyriStage 好友'),
      text: t('在 LyriStage 加我当好友，好友码 {code}', { code: friendsStore.profile.friendCode }),
      url: inviteLink.value,
    });
    if (result === 'copied') notice.show(t('邀请链接已复制，传给朋友就好'));
  } catch {
    notice.show(t('分享不了，把上面的好友码传给朋友吧'));
  }
}

const RESULT = {
  sent: '邀请已送出，对方同意后就是好友了',
  accepted: '对方也邀请过你，你们现在是好友了',
  friends: '你们已经是好友了',
  not_found: '找不到这个好友码，检查一下有没有打错',
  self: '这是你自己的好友码',
};
/**
 * 送出后的结果：直接显示在输入框下面、不会自己消失（画面下方一闪而过的提示在手机上很容易错过）
 * @type {import('vue').Ref<{ ok: boolean, text: string } | null>}
 */
const addResult = ref(null);
// 开始打下一个好友码，就把上次的结果收起来
watch(code, value => {
  if (value) addResult.value = null;
});

// ---- 搜名字或好友码（打 2 个字以上，停 0.3 秒才搜）----
/** @type {import('vue').Ref<Array<any> | null>} null = 还没搜 */
const results = ref(null);
const searching = ref(false);
let searchTimer = 0;
let searchSeq = 0;
watch(code, value => {
  clearTimeout(searchTimer);
  const text = value.trim();
  if (!friendsStore.searchAvailable || [...text].length < 2) {
    results.value = null;
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const list = await friendsStore.search(text);
      if (seq === searchSeq) results.value = list;
    } catch (err) {
      if (seq === searchSeq) {
        results.value = null;
        addResult.value = { ok: false, text: humanMessage(err, t('搜不到')) };
      }
    } finally {
      if (seq === searchSeq) searching.value = false;
    }
  }, 300);
});
onBeforeUnmount(() => clearTimeout(searchTimer));
/** 搜到的人：送邀请（用好友码找到的就用好友码送，对方关掉搜索也可以） */
async function addPerson(person) {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = person.byCode ? await friendsStore.send(code.value.trim()) : await friendsStore.sendTo(person.id);
    person.relation = result === 'accepted' || result === 'friends' ? 'friends' : result === 'sent' ? 'sent' : person.relation;
    if (result === 'accepted') notice.show(t(RESULT.accepted));
  } catch (err) {
    showError(err, t('好友邀请没送出去'));
  } finally {
    busy.value = false;
  }
}
async function acceptPerson(person) {
  await answer({ id: person.id, name: person.name }, true);
  person.relation = 'friends';
}
/** 按 Enter：只搜到一个就直接送；还没有搜索功能就照旧用好友码 */
function submitAdd() {
  if (!friendsStore.searchAvailable) return add();
  const only = results.value?.length === 1 ? results.value[0] : null;
  if (only && !only.relation) addPerson(only);
}
async function add() {
  const value = code.value.trim();
  if (!value || busy.value) return;
  busy.value = true;
  addResult.value = null;
  // 收起手机键盘，下面的结果和「已送出的邀请」才看得到
  /** @type {HTMLElement | null} */ (document.activeElement)?.blur();
  try {
    const result = await friendsStore.send(value);
    const ok = result !== 'not_found' && result !== 'self';
    addResult.value = { ok, text: t(RESULT[result] ?? RESULT.sent) };
    if (ok) code.value = '';
  } catch (err) {
    addResult.value = { ok: false, text: humanMessage(err, t('好友邀请没送出去')) };
  } finally {
    busy.value = false;
  }
}

/** 「加好友」那张卡：还没有好友、或从邀请链接打开时直接打开，其他时候按右上角的按钮才出来 */
const showAdd = ref(false);
watch(
  () => friendsStore.friends.length,
  n => n === 0 && (showAdd.value = true),
  { immediate: true }
);
// 从邀请链接打开（#/friends?add=好友码）：先填好，用户按一下就送出
onMounted(() => {
  if (typeof route.query.add === 'string') {
    code.value = route.query.add;
    showAdd.value = true;
  }
});

// ---- 便签、回应 ----
const sheet = ref(null);
/** 名单里点头像：有便签或正在听就打开他的便签 */
function openFriend(p) {
  const note = friendsStore.notes.get(p.id) ?? null;
  if (!note && !p.live) return;
  sheet.value.open({ ...p, isMe: false, note, song: p.live ? p.track : note?.track ?? null, live: Boolean(p.live) });
}
/** 进来时还没看的回应：这次显示出来，离开页面就算看过了 */
const fresh = ref([]);
watch(
  () => friendsStore.unseenReactions,
  list => {
    const known = new Set(fresh.value.map(r => r.id));
    fresh.value = [...list.filter(r => !known.has(r.id)), ...fresh.value].slice(0, 10);
  },
  { immediate: true }
);
onBeforeUnmount(() => friendsStore.markSeen());

async function answer(person, accept) {
  try {
    await friendsStore.answer(person.id, accept);
    notice.show(accept ? t('你和 {name} 现在是好友了', { name: person.name }) : t('已拒绝'));
  } catch (err) {
    showError(err, t('没改成功'));
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
    showError(err, t('没改成功'));
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
    showError(err, t('没保存成功'));
  }
}
async function togglePrivate() {
  try {
    await friendsStore.setPrivateMode(!friendsStore.inPrivateMode);
  } catch (err) {
    showError(err, t('没保存成功'));
  }
}
</script>

<template>
  <div class="page friends-page">
    <div class="head">
      <h1 class="display title">{{ $t('好友') }}</h1>
      <button
        v-if="friendsStore.available"
        class="icon-btn add-btn"
        :class="{ on: showAdd }"
        :aria-label="$t('加好友')"
        :aria-expanded="showAdd"
        @click="showAdd = !showAdd"
      >
        <Icon name="friends" :size="20" />
      </button>
    </div>

    <p v-if="!friendsStore.available" class="page-state">
      {{ $t('好友功能还没开通（管理员要先更新数据库）') }}
    </p>

    <template v-else>
      <!-- 我的好友码 + 加好友（右上角的按钮打开） -->
      <section v-if="showAdd" class="card">
        <!-- 搜名字或好友码（数据库还没加搜索功能时：只能输入好友码） -->
        <form v-if="friendsStore.searchAvailable" class="add search-add" role="search" @submit.prevent="submitAdd">
          <Icon name="search" :size="18" class="search-icon" />
          <input
            v-model="code"
            class="search-input"
            maxlength="60"
            autocomplete="off"
            enterkeyhint="search"
            :placeholder="$t('搜名字或输入好友码')"
            :aria-label="$t('搜名字或输入好友码')"
          />
        </form>
        <form v-else class="add" @submit.prevent="add">
          <input
            v-model="code"
            class="code-input"
            maxlength="12"
            autocomplete="off"
            :placeholder="$t('输入朋友的好友码')"
            :aria-label="$t('朋友的好友码')"
          />
          <button class="primary" :disabled="busy || !code.trim()">{{ busy ? $t('送出中…') : $t('加好友') }}</button>
        </form>
        <ul v-if="results?.length" class="people results">
          <li v-for="p in results" :key="p.id">
            <Cover :url="p.avatar" :size="44" round class="avatar">
              <span class="initial">{{ (p.name || '?').slice(0, 1).toUpperCase() }}</span>
            </Cover>
            <span class="name">
              {{ p.name }}
              <small v-if="p.relation === 'friends'">{{ $t('已经是好友') }}</small>
              <small v-else-if="p.relation === 'incoming'">{{ $t('邀请了你') }}</small>
              <small v-else-if="p.mutual">{{ $t('{n} 个共同好友', { n: p.mutual }) }}</small>
            </span>
            <button v-if="p.relation === 'sent'" class="ghost small" disabled>{{ $t('已送出') }}</button>
            <button v-else-if="p.relation === 'incoming'" class="primary small" :disabled="busy" @click="acceptPerson(p)">{{ $t('同意') }}</button>
            <button v-else-if="!p.relation" class="primary small" :disabled="busy" @click="addPerson(p)">{{ $t('加好友') }}</button>
          </li>
        </ul>
        <p v-else-if="results && !searching" class="hint none">{{ $t('找不到「{q}」，可能对方关掉了搜索，请他给你好友码', { q: code.trim() }) }}</p>
        <p v-if="addResult" class="add-result" :class="{ ok: addResult.ok }" role="status">
          <Icon :name="addResult.ok ? 'check' : 'x'" :size="16" />{{ addResult.text }}
        </p>
        <div class="my-code" :class="{ below: friendsStore.searchAvailable }">
          <span class="label">{{ friendsStore.searchAvailable ? $t('或用好友码：你的好友码') : $t('你的好友码') }}</span>
          <code>{{ friendsStore.profile?.friendCode ?? '…' }}</code>
          <div class="buttons">
            <button class="ghost" :disabled="!inviteLink" @click="shareInvite">
              <Icon name="share" :size="16" />{{ $t('分享') }}
            </button>
          </div>
          <p class="hint">{{ $t('朋友输入你的好友码、你同意后才是好友。只有好友看得到你在听什么。') }}</p>
        </div>
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

      <!-- 新的回应（这次进来才显示，离开就算看过了） -->
      <section v-if="fresh.length" class="card fresh">
        <h2 class="section-title">{{ $t('新的回应') }}</h2>
        <ul>
          <li v-for="r in fresh" :key="r.id">
            <span class="emoji">{{ r.emoji }}</span>
            <span class="who">
              <span class="name">{{ friendsStore.nameOf(r.from) }}</span>
              <span class="listening">
                {{ r.target === 'note' ? $t('你的便签「{text}」', { text: r.context }) : $t('你在听的《{song}》', { song: r.context }) }}
              </span>
            </span>
            <span class="ago">{{ timeAgo(r.at, t) }}</span>
          </li>
        </ul>
      </section>

      <!-- 便签（像 IG） -->
      <FriendNotes v-if="friendsStore.notesAvailable" class="notes-row" @open="item => sheet.open(item)" />

      <div class="cols">
        <div class="col">
          <section v-if="friendsStore.rooms.length">
            <h2 class="section-title">{{ $t('在一起听') }}</h2>
            <FriendRooms />
          </section>

          <section>
            <h2 class="section-title">{{ $t('好友') }}</h2>
            <p v-if="!rows.length && !friendsStore.loaded" class="empty">{{ $t('载入中…') }}</p>
            <p v-else-if="!rows.length" class="empty">{{ $t('还没有好友。把你的好友码传给朋友吧。') }}</p>
            <ul v-else class="people card">
              <li v-for="p in rows" :key="p.id">
                <button class="avatar-btn" :aria-label="$t('看 {name} 的便签', { name: p.name })" @click="openFriend(p)">
                  <Cover :url="p.avatar" :size="44" round class="avatar" :class="{ live: p.live }">
                    <span class="initial">{{ (p.name || '?').slice(0, 1).toUpperCase() }}</span>
                  </Cover>
                </button>
                <span class="who">
                  <span class="name">{{ p.name }}</span>
                  <span v-if="p.track" class="listening" :class="{ now: p.live }">
                    <span v-if="p.live" class="eq" :aria-label="$t('正在听')"><i /><i /><i /></span>
                    <span v-else class="ago-inline">{{ timeAgo(p.updatedAt, t) }} ·</span>
                    {{ p.track.name }} · {{ artists(p.track) }}
                  </span>
                  <span v-else class="listening quiet">{{ $t('最近没在听') }}</span>
                </span>
                <button
                  v-if="p.track"
                  class="cover-btn"
                  :aria-label="$t('播放 {name}', { name: p.track.name })"
                  @click="player.playList([p.track], 0, `friend:${p.id}`)"
                >
                  <Cover :url="p.track.al?.picUrl" :size="40" radius="8px" />
                  <Icon name="play" :size="16" class="cover-play" />
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
        </div>

        <div class="col">
          <WeeklyBoard v-if="friendsStore.friends.length" />

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
        </div>
      </div>
    </template>

    <NoteSheet ref="sheet" />

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
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.title {
  margin: 0;
  font-size: clamp(28px, 4vw, 44px);
}
.add-btn {
  border: 1px solid var(--line-strong);
}
.add-btn.on {
  border-color: var(--accent);
  color: var(--accent);
}
/* 电脑：左边名单、右边周榜和隐私；窄的叠成一栏 */
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
  gap: 28px;
  align-items: start;
}
.col {
  display: grid;
  gap: 22px;
  min-width: 0;
}
.notes-row {
  --page-x: 4px;
}
.fresh ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.fresh li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.emoji {
  font-size: 24px;
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
.buttons .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
}
.search-add {
  position: relative;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 16px;
  color: var(--text-faint);
  pointer-events: none;
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 46px;
  padding: 0 16px 0 44px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
}
.search-input:focus {
  border-color: var(--accent);
  outline: 0;
}
.results {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.results .name {
  display: grid;
  flex: 1;
  min-width: 0;
}
.results .name small {
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 400;
}
.results .initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #7c3aed);
  color: #fff;
  font-weight: 800;
}
.hint.none {
  margin: 12px 4px 0;
}
.my-code:not(.below) {
  margin-top: 16px;
}
.my-code.below {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.add-result {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, #e5484d 12%, transparent);
  color: #e5484d;
  font-size: 14px;
  font-weight: 600;
}
.add-result.ok {
  background: color-mix(in srgb, #30a46c 14%, transparent);
  color: #30a46c;
}
/* 提示字（"输入朋友的好友码"）用一般字体，窄的手机才放得下 */
.code-input::placeholder {
  font: 400 15px var(--font-sans);
  letter-spacing: 0;
  text-transform: none;
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
.listening.now {
  color: #2fa463;
  font-weight: 700;
}
.ago-inline {
  color: var(--text-faint);
}
/* 正在听：三根会跳的音柱 */
.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  height: 10px;
  margin-right: 4px;
}
.eq i {
  width: 2px;
  border-radius: 1px;
  background: currentColor;
  animation: eq 0.9s ease-in-out infinite alternate;
}
.eq i:nth-child(2) {
  animation-delay: -0.3s;
}
.eq i:nth-child(3) {
  animation-delay: -0.6s;
}
@keyframes eq {
  from {
    height: 30%;
  }
  to {
    height: 100%;
  }
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
.avatar-btn {
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
}
.avatar.live {
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px #2fa463;
}
/* 右边的封面：按了播放那首 */
.cover-btn {
  position: relative;
  flex: none;
  width: 40px;
  padding: 0;
  border: 0;
  background: none;
}
.cover-play {
  position: absolute;
  inset: 0;
  margin: auto;
  color: #fff;
  opacity: 0;
  filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.6));
  transition: opacity 0.15s;
}
.cover-btn:hover .cover-play,
.cover-btn:focus-visible .cover-play {
  opacity: 1;
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
  .eq i {
    height: 70%;
    animation: none;
  }
}
@media (max-width: 1099px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* 手机：便签那排贴齐画面左右两边，滑得到最边上 */
@media (max-width: 899px), (pointer: coarse) and (max-height: 600px) {
  .title {
    font-size: 30px;
  }
  .notes-row {
    --page-x: 16px;
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
