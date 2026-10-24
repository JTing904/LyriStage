// 滚动歌词列表：让当前行停在容器的某个高度（默认正中间），换行时整列滑过去。
// 用 transform 移动整个列表（不用 scrollTop），配合 CSS transition 做出弹簧感。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * @param {import('vue').Ref<number>} lineIndex 当前行（还没开始时是 -1）
 * @param {{ anchor?: number }} [options] anchor：当前行中心放在容器高度的哪里（0~1）
 */
export function useCenteredList(lineIndex, { anchor = 0.5 } = {}) {
  /** 外层容器（overflow: hidden） */
  const viewport = ref(null);
  /** 每一行的元素 */
  const lineEls = [];
  const offset = ref(0);

  function measure() {
    const box = viewport.value;
    const el = lineEls[Math.max(0, lineIndex.value)];
    if (!box || !el) return;
    offset.value =
      box.clientHeight * anchor - (el.offsetTop + el.offsetHeight / 2);
  }

  watch(lineIndex, () => nextTick(measure));
  onMounted(() => {
    nextTick(measure);
    window.addEventListener('resize', measure);
    // 字体载入后行高会变
    document.fonts?.ready.then(measure);
  });
  onBeforeUnmount(() => window.removeEventListener('resize', measure));

  /** 模板里用 :ref="lineRef(i)" 登记每一行 */
  const lineRef = index => el => {
    lineEls[index] = el;
  };

  return { viewport, lineRef, offset, measure };
}
