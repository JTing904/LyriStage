<script setup>
// 好友开着「一起听」：按「请求加入」，房主同意才进得去（首页、好友页都用）
import { computed } from 'vue';
import { useFriendsStore } from '../stores/friends';
import { useRoomStore } from '../stores/room';
import { timeAgo } from '../utils/format';
import { t } from '../i18n';
import Cover from './Cover.vue';

const friendsStore = useFriendsStore();
const room = useRoomStore();

/** 好友开着的房间（我已经在里面的那间不用再显示）；顺便带上他正在放的歌 */
const friendRooms = computed(() =>
  friendsStore.rooms
    .filter(f => !(room.inRoom && room.hostId === f.id))
    .map(f => ({ ...f, song: friendsStore.activity.find(a => a.id === f.id && a.live)?.track.name ?? '' }))
);
</script>

<template>
  <section v-if="friendRooms.length" class="friend-rooms" :aria-label="$t('朋友在一起听')">
    <div v-for="f in friendRooms" :key="f.id" class="friend-room">
      <span class="room-avatar">
        <Cover :url="f.avatar" :size="44" round>
          <span class="room-initial">{{ (f.name || '?').slice(0, 1).toUpperCase() }}</span>
        </Cover>
        <span class="room-dot" aria-hidden="true" />
      </span>
      <span class="room-meta">
        <strong>{{ $t('{name} 在一起听', { name: f.name }) }}</strong>
        <span>{{ f.song ? $t('正在放《{song}》', { song: f.song }) : $t('{time}开的房间', { time: timeAgo(f.startedAt, t) }) }}</span>
      </span>
      <button
        class="knock"
        :class="{ waiting: room.knocking === f.id }"
        :disabled="Boolean(room.knocking) && room.knocking !== f.id"
        @click="room.knocking === f.id ? room.stopKnocking() : room.knock(f.id, f.name)"
      >
        {{ room.knocking === f.id ? $t('等对方同意…') : $t('请求加入') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.friend-rooms {
  display: grid;
  gap: 10px;
}
.friend-room {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
}
.room-avatar {
  position: relative;
  flex: none;
  width: 44px;
}
.room-initial {
  display: grid;
  place-items: center;
  height: 100%;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 800;
}
.room-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border: 2.5px solid var(--surface);
  border-radius: 50%;
  background: #2fa463;
}
.room-meta {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.room-meta strong,
.room-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.room-meta strong {
  font-size: 15px;
}
.room-meta span {
  font-size: 13px;
  color: var(--text-dim);
}
.knock {
  flex: none;
  min-height: 38px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.knock.waiting {
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--text-dim);
}
.knock:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
