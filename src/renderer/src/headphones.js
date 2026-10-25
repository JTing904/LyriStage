// 拔掉耳机、蓝牙耳机断开时暂停（Android App，原生部分在 android/.../HeadphonesPlugin.java）。
// 别的 App 放声音、来电时 WebView 自己会暂停，这里不用管
import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform';

const Headphones = isNativeApp ? registerPlugin('Headphones') : null;
const ignore = () => {};

/**
 * 用原本的播放器（不是 controls）：一起听的成员拔掉耳机也要停自己这边
 * @param {ReturnType<typeof import('@core/player/player').createPlayer>} player
 */
export function connectHeadphones(player) {
  if (!Headphones) return;
  // WebView 可能已经自己停了：还在播才按暂停，不要变成又播起来
  Headphones.addListener('noisy', () => player.getState().playing && player.toggle());

  let last = false;
  player.on('change', state => {
    if (state.playing === last) return;
    last = state.playing;
    (state.playing ? Headphones.watch() : Headphones.unwatch()).catch(ignore);
  });
}
