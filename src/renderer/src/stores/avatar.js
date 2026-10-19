// 我的 3D 公仔：选哪一套衣服（设置页可以换），或按时间自动换
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const KEY = 'lyristage:avatar';

/** 模型在 src/renderer/public/models/（原始模型怎么压缩的见 scripts/models/README.md） */
export const OUTFITS = [
  { id: 'plaid', label: '蓝格子衬衫' },
  { id: 'suit', label: '黑色西装' },
  { id: 'grey', label: '灰色开衫' },
  { id: 'beige', label: '米色毛衣' },
];

/** 默认（主要）穿蓝格子 */
const DEFAULT_CHOICE = 'plaid';

/** 底座名片上的 IG 帐号 */
export const NAME_CARD_HANDLE = '@jtinnnng';

export const modelUrl = id => `${import.meta.env.BASE_URL}models/${id}.glb`;

/**
 * 自动：按时间换衣服和表情
 * 早上比耶、中午托眼镜、下午笑、晚上和深夜西装
 */
function outfitForHour(hour) {
  if (hour >= 6 && hour < 11) return 'plaid';
  if (hour >= 11 && hour < 14) return 'beige';
  if (hour >= 14 && hour < 18) return 'grey';
  return 'suit';
}

function load() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'auto' || OUTFITS.some(o => o.id === value)
      ? value
      : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

export const useAvatarStore = defineStore('avatar', () => {
  /** 'auto' 或 OUTFITS 里的 id */
  const choice = ref(load());
  watch(choice, value => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // 不能保存就只在这次生效
    }
  });

  // 自动模式要跟着时间变：每分钟看一下现在几点
  const hour = ref(new Date().getHours());
  setInterval(() => (hour.value = new Date().getHours()), 60 * 1000);

  const outfit = computed(() =>
    choice.value === 'auto' ? outfitForHour(hour.value) : choice.value
  );
  const url = computed(() => modelUrl(outfit.value));

  return { choice, outfit, url };
});
