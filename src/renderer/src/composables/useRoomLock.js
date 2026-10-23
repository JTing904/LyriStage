// 一起听的成员：播什么、播到哪由房主决定（自己按了几秒后又会被拉回房主播的地方）
// - 按播放 / 暂停、上一首 / 下一首、拖进度：提示「只有房主能控制播放」，旁边的「点歌」直接打开点歌
// - 在歌单里点一首歌（或下一首播放、加入队列）：跳出 GuestPlaySheet，问要点给房主还是离开房间自己播
// 音量、喜欢、加入歌单不受影响。App.vue 装一次
import { useRouter } from 'vue-router';
import { controls, playbackLock } from '../services';
import { useRoomStore } from '../stores/room';
import { useNoticeStore } from '../stores/notice';
import { useUiStore } from '../stores/ui';
import { t } from '../i18n';

/** 这些是在换歌：改成问要不要点给房主（电台没有一首特定的歌，只能离开房间自己听） */
const PICKS = {
  playList: ([tracks, index = 0]) => ({ track: tracks?.[index] ?? null }),
  playFm: ([, options]) => ({ track: null, label: options?.context?.startsWith('radio:') ? t('相似歌曲电台') : t('私人 FM') }),
  playNext: ([track]) => ({ track: track ?? null }),
  addToQueue: ([track]) => ({ track: track ?? null }),
  // 播放队列面板里点的（面板盖在提示上面，提示会看不到）
  playFromQueue: ([section, index]) => ({ track: controls.getQueue()[section]?.[index] ?? null }),
};

/** 成员是不是不能控制播放（画面上把按钮变灰用） */
export function useRoomLocked() {
  const room = useRoomStore();
  return () => room.role === 'guest' && room.inRoom;
}

export function installRoomLock() {
  const room = useRoomStore();
  const notice = useNoticeStore();
  const ui = useUiStore();
  const router = useRouter();
  const locked = useRoomLocked();

  /** 去房间打开点歌（歌词舞台、播放队列开着的话先关掉） */
  function openPicker() {
    ui.stageOpen = false;
    ui.queueOpen = false;
    ui.wallOpen = false;
    router.push({ name: 'room', query: { pick: '1' } });
  }

  playbackLock.check = (action, args) => {
    if (!locked()) return false;
    if (action in PICKS) {
      ui.guestPick = {
        ...PICKS[action](args),
        // 离开房间后照原本按的再做一次（那时已经不是成员，不会再被挡）
        replay: () => controls[action](...args),
      };
    } else {
      notice.show(t('只有房主能控制播放'), { action: { label: t('点歌'), run: openPicker } });
    }
    return true;
  };
}
