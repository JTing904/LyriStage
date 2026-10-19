// 把 core 的播放器状态变成 Vue 响应式数据，组件里直接用
import { reactive, readonly } from 'vue';
import { player } from '../services';

const state = reactive(player.getState());

player.on('change', next => Object.assign(state, next));
player.on('time', time => {
  state.time = time;
});

export function usePlayer() {
  return { state: readonly(state), player };
}
