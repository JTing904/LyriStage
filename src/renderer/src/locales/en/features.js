// 2026-10 新功能：播放队列、睡眠定时、私人 FM「不喜欢」、歌词分享卡片、听歌报告、一起听聊天、自动更新
export default {
  // ---- 播放队列（QueuePanel.vue、TrackList.vue、PlayerBar.vue） ----
  播放队列: 'Queue',
  '播放队列（睡眠定时中）': 'Queue (sleep timer on)',
  正在播放: 'Now playing',
  '私人 FM 会一首一首为你挑歌，没有固定的播放队列。': 'Personal FM picks songs for you one at a time, so there is no fixed queue.',
  '接下来（你加入的）': 'Next up (added by you)',
  清空: 'Clear',
  '拖动排序：{name}（也可以按上下键）': 'Drag to reorder: {name} (or use the up and down arrow keys)',
  从队列移除: 'Remove from queue',
  接下来: 'Up next',
  '还有 {n} 首': '{n} more song | {n} more songs',
  '后面没有歌了。在歌曲的「⋯」选「下一首播放」或「加入播放队列」就会出现在这里。':
    'Nothing else is queued. Choose "Play next" or "Add to queue" from a song\'s ⋯ menu and it will show up here.',
  更多: 'More',
  '更多：{name}': 'More: {name}',
  下一首播放: 'Play next',
  加入播放队列: 'Add to queue',
  '下一首播放：{name}': 'Playing next: {name}',
  '已加入播放队列：{name}': 'Added to queue: {name}',

  // ---- 睡眠定时 ----
  睡眠定时: 'Sleep timer',
  这首播完就停: 'Stops after this song',
  '{time} 后暂停': 'Pausing in {time}',
  '{n} 分钟': '{n} min',
  这首播完: 'End of song',
  '睡眠定时到了，已经暂停': 'Sleep timer finished. Playback paused.',

  // ---- 私人 FM「不喜欢」 ----
  '不喜欢（跳过，以后少推荐）': "Dislike (skip, and you'll hear fewer like it)",
  以后会少推荐这类歌: "Got it. You'll hear fewer songs like that.",

  // ---- 歌词分享卡片（ShareLyricsDialog.vue） ----
  分享歌词: 'Share lyrics',
  把歌词做成图片分享: 'Turn the lyrics into an image to share',
  '最多选 {n} 句': 'You can pick up to {n} lines',
  '选歌词（最多 {n} 句）': 'Pick lyrics (up to {n} lines)',
  卡片预览: 'Card preview',
  分享: 'Share',
  复制图片: 'Copy image',
  存成图片: 'Save image',
  '已复制图片，可以直接贴上': 'Image copied. You can paste it now.',

  // ---- 听歌报告（ReportView.vue） ----
  听歌报告: 'Listening report',
  这个月: 'This month',
  今年: 'This year',
  '正在整理你的听歌记录…': 'Putting your listening history together…',
  '这段时间还没有听歌记录。多听几首再来看看！': 'No listening history for this period yet. Play a few songs and come back!',
  分钟的音乐: 'minutes of music',
  首歌: 'songs',
  位歌手: 'artists',
  天有听歌: 'days with music',
  最常听的歌: 'Top songs',
  最常听的歌手: 'Top artists',
  夜猫子: 'night owl',
  早起的人: 'early bird',
  午间时光: 'lunchtime',
  下午: 'afternoon',
  晚上: 'evening',
  '你最常在 {hour} 点听歌（{name}）': 'You listen most around {hour}:00 ({name})',
  '听最多的一天是 {m} 月 {d} 日，听了 {n} 分钟': 'Your biggest day was {m}/{d}, with {n} minutes',
  分享报告: 'Share report',

  // ---- 一起听聊天（RoomView.vue、stores/room.js） ----
  聊天: 'Chat',
  '说点什么，或按下面的表情': 'Say something, or tap a reaction below',
  '送出表情 {emoji}': 'Send {emoji}',
  '说点什么…': 'Say something…',
  聊天内容: 'Message',
  发送: 'Send',
  我: 'Me',
  '发不出去：发得太快了，或房间已经关了': "Couldn't send: you're sending too fast, or the room has closed",
  '发送失败：{error}': "Couldn't send: {error}",
  '聊天还没开通：要先在 Supabase 执行聊天的 SQL': 'Chat is not set up yet: run the chat SQL in Supabase first',

  // ---- 自动更新（SettingsView.vue、App.vue） ----
  版本: 'Version',
  检查更新: 'Check for updates',
  重启更新: 'Restart to update',
  '新版本 {version} 已经下载好': 'Version {version} is ready',
  开发模式不会自动更新: "Development builds don't update automatically",
  '正在检查…': 'Checking…',
  '有新版本，正在下载…': 'Downloading a new version…',
  已经是最新版本: "You're on the latest version",
  '检查更新失败，等一下再试': "Couldn't check for updates. Try again later.",
  '有新版本会自动下载，下载好会提示你重启': "New versions download automatically. You'll be asked to restart when one is ready.",
  // ---- 房主转让 ----
  设为房主: 'Make host',
  '把房主交给 {name}？之后由 {name} 决定播什么，你会变成普通成员继续听。':
    'Make {name} the host? {name} will choose what plays, and you will keep listening as a member.',
  '已经把房主交给 {name}': '{name} is now the host',
  '你现在是房主了，你播什么大家就听什么': "You're the host now. Everyone hears what you play.",
  '{name} 现在是房主': '{name} is now the host',
  '转让失败：{error}': "Couldn't hand over: {error}",
  没有权限: 'not allowed',

  // ---- 用歌词找歌 ----
  '搜索歌曲、歌手、专辑、歌单或一句歌词': 'Search songs, artists, albums, playlists or a lyric',
  '输入歌名、歌手、歌单名字，或记得的一句歌词': 'Type a song, artist or playlist, or a line of lyrics you remember',

  // ---- 快捷键 ----
  快捷键: 'Keyboard shortcuts',
  '播放 / 暂停': 'Play / pause',
  '有 Alt 的那组在 App 收到背景时也能用；键盘上的播放、下一首键也可以':
    'The ones with Alt also work while the app is in the background, and so do the media keys on your keyboard',

  // ---- 导出资料、删除账号 ----
  导出我的资料: 'Export my data',
  '下载一个档案，里面有你喜欢的歌、歌单和听歌记录。': 'Download a file with your liked songs, playlists and listening history.',
  '导出中…': 'Exporting…',
  导出: 'Export',
  '导出失败：{error}': "Couldn't export: {error}",
  删除账号: 'Delete account',
  '永久删除账号和所有资料，不能复原。': 'Permanently delete your account and all of its data. This cannot be undone.',
  '永久删除你的 LyriStage 账号？': 'Permanently delete your LyriStage account?',
  '会一起删掉：我喜欢的音乐、所有歌单、听歌记录、头像、成员身份。删除后不能复原，要再用就得重新注册、重新拿邀请码。想留一份的话，先按「导出」。':
    'This also deletes your liked songs, all playlists, listening history, profile photo and membership. It cannot be undone: to use LyriStage again you would need to sign up and get a new invite code. To keep a copy, press Export first.',
  '输入「{word}」确认': 'Type "{word}" to confirm',
  '删除中…': 'Deleting…',
  永久删除: 'Delete forever',
  账号和所有资料已经删除: 'Your account and all of its data have been deleted',
};
