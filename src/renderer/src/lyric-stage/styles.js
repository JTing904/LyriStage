// 歌词排版风格清单。加新风格：在 styles/ 写一个组件，再在这里登记。
// 设计说明见 docs/design/lyric-styles.md
// light: true 表示浅色背景，舞台会把播放条和按钮换成深色
import { defineAsyncComponent } from 'vue';

const lazy = loader => defineAsyncComponent(loader);

export const LYRIC_STYLES = [
  {
    id: 'kinetic',
    name: '单行大字',
    description: '一次一句，超大做旧字体，一段一段浮现',
    component: lazy(() => import('./styles/KineticStyle.vue')),
  },
  {
    id: 'perspective',
    name: '3D 透视',
    description: '清晰封面做背景，整列歌词立体倾斜，花瓣飘落',
    component: lazy(() => import('./styles/PerspectiveStyle.vue')),
  },
  {
    id: 'scroll',
    name: '滚动歌词',
    description: '像 Apple Music，逐字点亮，背景是流动的封面色',
    component: lazy(() => import('./styles/ScrollStyle.vue')),
  },
  {
    id: 'block',
    name: '色块',
    description: '像 Spotify，整片封面主色，大号粗体',
    component: lazy(() => import('./styles/BlockStyle.vue')),
  },
  {
    id: 'karaoke',
    name: '卡拉OK',
    description: 'KTV 双行交替，逐字填色',
    component: lazy(() => import('./styles/KaraokeStyle.vue')),
  },
  {
    id: 'vertical',
    name: '竖排诗词',
    description: '宣纸书法，从右往左竖排，红色印章',
    light: true,
    component: lazy(() => import('./styles/VerticalStyle.vue')),
  },
  {
    id: 'mv',
    name: '动态 MV',
    description: '每段不同大小、角度和颜色，弹出来',
    component: lazy(() => import('./styles/MvStyle.vue')),
  },
  {
    id: 'typewriter',
    name: '打字机',
    description: '复古终端，跟着演唱一个字一个字打出来',
    component: lazy(() => import('./styles/TypewriterStyle.vue')),
  },
  {
    id: 'vinyl',
    name: '黑胶唱片',
    description: '转动的黑胶和唱臂，旁边五行歌词',
    component: lazy(() => import('./styles/VinylStyle.vue')),
  },
];

export const findStyle = id =>
  LYRIC_STYLES.find(s => s.id === id) ?? LYRIC_STYLES[0];
