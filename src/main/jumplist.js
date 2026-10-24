// Windows 任务栏的 LyriStage 图标按右键的快捷选单（跟手机长按图标一样）：继续播放、每日推荐、私人 FM、一起听。
// 按了会用 --lyristage-action=… 再开一次 LyriStage：已经开着就交给原本那个（second-instance），没开就照常启动
import { app } from 'electron';
import { sep } from 'node:path';
import resumeIcon from '../../resources/jumplist/resume.ico?asset';
import dailyIcon from '../../resources/jumplist/daily.ico?asset';
import fmIcon from '../../resources/jumplist/fm.ico?asset';
import roomIcon from '../../resources/jumplist/room.ico?asset';

const ICONS = { resume: resumeIcon, daily: dailyIcon, fm: fmIcon, room: roomIcon };
const LABELS = {
  'zh-CN': { resume: '继续播放', daily: '每日推荐', fm: '私人 FM', room: '一起听' },
  en: { resume: 'Resume', daily: 'Daily Mix', fm: 'Personal FM', room: 'Listen Together' },
};
const PREFIX = '--lyristage-action=';

/**
 * 启动参数里的快捷选单动作
 * @param {string[]} argv
 * @returns {'resume' | 'daily' | 'fm' | 'room' | null}
 */
export function findAction(argv) {
  const action = argv.find(arg => arg.startsWith(PREFIX))?.slice(PREFIX.length);
  return action && action in ICONS ? action : null;
}

/** 打包后 resources 在 app.asar.unpacked（electron-builder.yml 的 asarUnpack）：Windows 要真的档案才读得到图标 */
const realPath = path => path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

/** @param {'zh-CN' | 'en'} locale 选单跟着 App 的语言 */
export function setJumpList(locale) {
  if (process.platform !== 'win32') return;
  const labels = LABELS[locale] ?? LABELS['zh-CN'];
  // 开发时 execPath 是 electron.exe，要带上 App 的资料夹
  const appArg = process.defaultApp ? `"${app.getAppPath()}" ` : '';
  app.setUserTasks(
    Object.keys(ICONS).map(action => ({
      program: process.execPath,
      arguments: `${appArg}${PREFIX}${action}`,
      title: labels[action],
      description: labels[action],
      iconPath: realPath(ICONS[action]),
      iconIndex: 0,
    }))
  );
}
