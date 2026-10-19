// 歌词排版风格清单。加新风格：在 styles/ 写一个组件，再在这里登记。
// 设计说明见 docs/design/lyric-styles.md
import { defineAsyncComponent } from 'vue';

export const LYRIC_STYLES = [
  {
    id: 'kinetic',
    name: '单行大字',
    description: '一次一句，超大做旧字体，逐字浮现',
    component: defineAsyncComponent(() => import('./styles/KineticStyle.vue')),
  },
];

export const findStyle = id =>
  LYRIC_STYLES.find(s => s.id === id) ?? LYRIC_STYLES[0];
