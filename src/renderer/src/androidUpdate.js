// Android：按「更新」就在 App 里下载新版 APK、跳出安装画面（拿不到 APK 网址时才开浏览器）
// 启动时的新版本提示和设定里的「检查更新」都用这个
import { installAndroidUpdate, openInBrowser } from './platform';
import { t } from './i18n';
import { useNoticeStore } from './stores/notice';
import { explainError } from './friendlyError';

/** @param {{ version: string, url: string }} update findAndroidUpdate / checkAndroidUpdate 找到的新版本 */
export async function updateAndroidNow(update) {
  const { url } = update;
  if (!url.endsWith('.apk')) return openInBrowser(url);
  const notice = useNoticeStore();
  notice.show(t('正在下载新版本…'), { duration: 120000 });
  try {
    const status = await installAndroidUpdate(url, percent =>
      notice.show(t('正在下载新版本… {p}%', { p: percent }), { duration: 120000 })
    );
    if (status === 'needs-permission') {
      notice.show(t('请允许 LyriStage 安装 App，回来再按一次「更新」'), {
        action: { label: t('更新'), run: () => updateAndroidNow(update) },
        duration: 60000,
      });
    } else {
      notice.dismiss();
    }
  } catch (err) {
    notice.show(explainError(err, t('新版本没下载成功')).message, {
      action: { label: t('改用浏览器下载'), run: () => openInBrowser(url) },
      duration: 20000,
    });
  }
}
