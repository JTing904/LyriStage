// 把 core 的播放器状态变成 Vue 响应式数据，组件里直接用。
// 没登录（或还不是成员）的人可以逛 App，但按播放会先弹出「登录后才能听歌」
import { reactive, readonly } from 'vue';
import { player } from '../services';
import { useAuthStore } from '../stores/auth';

const state = reactive(player.getState());

player.on('change', next => Object.assign(state, next));
player.on('time', time => {
  state.time = time;
});

/** 这些操作要登录才能用 */
const NEEDS_MEMBER = new Set(['play', 'toggle', 'next', 'prev', 'playList', 'playIndex', 'playFm', 'playFromQueue', 'playNext', 'addToQueue']);
let gated = null;

export function usePlayer() {
  if (!gated) {
    const auth = useAuthStore();
    gated = new Proxy(player, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function' || !NEEDS_MEMBER.has(key)) return value;
        return (...args) =>
          auth.requireMember('听歌') ? value.apply(target, args) : undefined;
      },
    });
  }
  return { state: readonly(state), player: gated };
}
