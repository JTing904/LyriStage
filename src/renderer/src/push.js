// App 关着也收得到通知（Android；Firebase Cloud Messaging）
// - 登录成为成员后：问一次通知权限，拿到这台手机的推送代号，登记到数据库（register_push_token）
// - 谁送表情、加好友、敲门：数据库叫 Edge Function send-push 送过来（见 20261104000000_push_notifications.sql）
// - App 开着的时候不跳系统通知（App 里本来就有提示）；点通知打开对应的页（好友 / 一起听）
// - 设置里可以关掉；退出登录前把代号删掉，别人借这台手机登录也不会收到你的通知
// 电脑版、网页版没有这个功能
import { watch } from 'vue';
import { getSupabase } from '@core/data';
import { isNativeApp } from './platform';
import { locale, t } from './i18n';
import { useAuthStore } from './stores/auth';

export const pushSupported = isNativeApp;
const OFF_KEY = 'lyristage:push-off';

/** 用户有没有在设置里关掉 */
export function pushWanted() {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

let plugin = null;
let token = '';

async function save() {
  if (!token) return;
  const { error } = (await getSupabase()?.rpc('register_push_token', {
    token,
    locale: locale.value === 'en' ? 'en' : 'zh-CN',
  })) ?? {};
  // 还没执行 2026-11-04 的 SQL 就先不管
  if (error) console.warn('[LyriStage] 登记推送失败', error.message);
}

/** 问权限、拿代号（拿到后 registration 事件会登记到数据库）；回传有没有允许 */
async function register() {
  let permission = await plugin.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await plugin.requestPermissions();
  }
  if (permission.receive !== 'granted') return false;
  await plugin.register();
  return true;
}

/** 这台手机不收了：数据库删掉代号 */
async function forget() {
  if (!token) return;
  await getSupabase()?.rpc('unregister_push_token', { token }).catch(() => {});
}

/** 设置里的开关；回传开了以后有没有真的允许（系统设置里关掉通知的话是 false） */
export async function setPushWanted(on) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, '1');
  } catch {
    // 存不了就只在这次生效
  }
  if (!plugin) return false;
  if (!on) {
    await forget();
    return false;
  }
  return register();
}

/** App 打开时叫一次（main.js） */
export async function startPush(pinia) {
  if (!isNativeApp) return;
  ({ PushNotifications: plugin } = await import('@capacitor/push-notifications'));
  // 好友和一起听的通知频道（Edge Function 送的通知指定这个频道）
  await plugin
    .createChannel({ id: 'social', name: t('好友和一起听'), importance: 4, visibility: 1 })
    .catch(() => {});
  await plugin.addListener('registration', ({ value }) => {
    token = value;
    save();
  });
  await plugin.addListener('registrationError', err => console.warn('[LyriStage] 推送注册失败', err));
  // 点通知：打开对应的页（数据里的 url 是 #/friends、#/room 这种）
  await plugin.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = notification?.data?.url;
    if (typeof url === 'string' && url.startsWith('#/')) location.hash = url;
  });

  const auth = useAuthStore(pinia);
  // 退出登录前删掉代号（登录还在的时候才删得掉）
  auth.onLogout(forget);
  watch(
    () => auth.allowed,
    allowed => {
      if (allowed && pushWanted()) register().catch(err => console.warn('[LyriStage] 推送', err));
    },
    { immediate: true }
  );
  // 换语言：通知也换
  watch(locale, () => save());
}
