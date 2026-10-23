<script setup>
// 好友页最上面那排「便签」（参考 IG 私讯页的便签）：头像上面飘一个泡泡
// - 自己：第一个，没写就是「写一句话…」，点了可以写
// - 好友写了便签：灰色泡泡显示那句话（有附歌或正在听，下面多一行小字）
// - 好友正在听（没写便签）：泡泡颜色用那首歌封面的颜色，写「♫ 歌名 / 歌手」
// 只列有便签或正在听的好友；其他好友在下面的名单里
import { computed, reactive, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useFriendsStore } from '../stores/friends';
import { getPalette, rgb, withLightness } from '../lyric-stage/palette';
import { artistNames, timeAgo } from '../utils/format';
import { t } from '../i18n';
import Cover from './Cover.vue';

const emit = defineEmits(['open']);
const auth = useAuthStore();
const friendsStore = useFriendsStore();

/** 每个人：{ id, name, avatar, isMe, note, song, live } */
const items = computed(() => {
  const mine = friendsStore.notes.get(auth.user?.id) ?? null;
  const me = {
    id: auth.user?.id,
    name: t('你的便签'),
    avatar: auth.avatarUrl,
    isMe: true,
    note: mine,
    song: mine?.track ?? null,
    live: false,
  };
  const others = friendsStore.friends
    .map(f => {
      const note = friendsStore.notes.get(f.id) ?? null;
      const activity = friendsStore.activity.find(a => a.id === f.id);
      const live = Boolean(activity?.live);
      if (!note && !live) return null;
      return { ...f, isMe: false, note, song: live ? activity.track : note?.track ?? null, live };
    })
    .filter(Boolean)
    // 正在听的排前面，再按便签新旧
    .sort((a, b) => b.live - a.live || new Date(b.note?.createdAt ?? 0) - new Date(a.note?.createdAt ?? 0));
  return [me, ...others];
});

// 泡泡的颜色：封面主色调到中等亮度（白字看得清）；取不到就用 App 的红色
const colors = reactive({});
watch(
  () => items.value.map(i => i.song?.al?.picUrl).filter(Boolean),
  urls => {
    for (const url of urls) {
      if (url in colors) continue;
      colors[url] = '';
      getPalette(url)
        .then(p => (colors[url] = rgb(withLightness(p.vibrant, 0.42, 0.45))))
        .catch(() => {});
    }
  },
  { immediate: true }
);
const songColor = song => colors[song?.al?.picUrl] || 'var(--accent)';
const initial = name => (name || '?').slice(0, 1).toUpperCase();
</script>

<template>
  <div class="notes" role="list" :aria-label="$t('便签')">
    <button v-for="item in items" :key="item.id" class="note" role="listitem" @click="emit('open', item)">
      <!-- 写了字：灰色泡泡 -->
      <span v-if="item.note?.body" class="bubble">
        <span class="text">{{ item.note.body }}</span>
        <span v-if="item.song" class="tiny" :style="{ color: songColor(item.song) }">
          <span v-if="item.live" class="eq" aria-hidden="true"><i /><i /><i /></span>
          <template v-else>♫</template>
          {{ item.song.name }}
        </span>
      </span>
      <!-- 只有歌：泡泡用封面的颜色 -->
      <span v-else-if="item.song" class="bubble music" :style="{ background: songColor(item.song) }">
        <span class="song">
          <span v-if="item.live" class="eq" aria-hidden="true"><i /><i /><i /></span>
          <template v-else>♫</template>
          {{ item.song.name }}
        </span>
        <span class="sub">{{ artistNames(item.song) }}</span>
      </span>
      <span v-else class="bubble empty">{{ $t('写一句话…') }}</span>

      <span class="avatar" :class="{ live: item.live }">
        <Cover :url="item.avatar || ''" :size="68" round>
          <span class="initial">{{ initial(item.isMe ? auth.displayName : item.name) }}</span>
        </Cover>
        <span v-if="item.isMe && !item.note" class="plus" aria-hidden="true">+</span>
      </span>
      <span class="name" :class="{ me: item.isMe }">{{ item.name }}</span>
      <span v-if="item.live" class="when now">{{ $t('正在听') }}</span>
      <span v-else-if="item.note" class="when">{{ timeAgo(item.note.createdAt, t) }}</span>
    </button>
  </div>
</template>

<style scoped>
.notes {
  display: flex;
  gap: 8px;
  margin: 0 calc(-1 * var(--page-x, 0px));
  padding: 56px var(--page-x, 0px) 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.notes::-webkit-scrollbar {
  display: none;
}
.note {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  width: 96px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
/* 泡泡：头像上面，跟 IG 一样下面拖两个小圆点 */
.bubble {
  position: absolute;
  z-index: 1;
  /* 泡泡的底边压在头像上缘一点点 */
  top: 10px;
  left: 50%;
  display: grid;
  width: max-content;
  min-width: 64px;
  max-width: 104px;
  padding: 7px 10px;
  border-radius: 16px;
  background: var(--surface-2, var(--surface-hover));
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
  font-size: 12px;
  line-height: 1.35;
  text-align: center;
  overflow-wrap: anywhere;
  transform: translate(-50%, -100%);
}
/* 便签最多显示两行，完整的点开看 */
.text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.bubble::after,
.bubble::before {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: inherit;
}
.bubble::after {
  left: 30%;
  bottom: -6px;
  width: 11px;
  height: 11px;
}
.bubble::before {
  left: 23%;
  bottom: -12px;
  width: 5px;
  height: 5px;
}
.bubble.music {
  color: #fff;
}
.bubble.empty {
  color: var(--text-faint);
}
.song {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.85;
}
.tiny {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  margin-top: 2px;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 正在听：三根会跳的音柱 */
.eq {
  display: inline-flex;
  flex: none;
  align-items: flex-end;
  gap: 1.5px;
  height: 10px;
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
.avatar {
  position: relative;
  width: 68px;
  border-radius: 50%;
}
.avatar :deep(.cover) {
  width: 100%;
}
.avatar.live {
  box-shadow: 0 0 0 2.5px var(--bg), 0 0 0 4.5px #2fa463;
}
.initial {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 24px;
  font-weight: 900;
}
.plus {
  position: absolute;
  right: -2px;
  bottom: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 3px solid var(--bg);
  border-radius: 50%;
  background: var(--text);
  color: var(--bg);
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
}
.name {
  max-width: 88px;
  margin-top: 8px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.name.me {
  color: var(--text-dim);
}
.when {
  font-size: 11px;
  color: var(--text-faint);
}
.when.now {
  color: #2fa463;
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  .eq i {
    animation: none;
    height: 70%;
  }
}
</style>
