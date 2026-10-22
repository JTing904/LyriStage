// 英文对照（首页、搜索、歌单、专辑、歌手、每日推荐、音乐库）
// 跟 components.js 重复的字要写一样的翻译（两个表会合在一起，后面的盖掉前面的）
export default {
  // 共用
  '{n} 首': '{n} song | {n} songs',
  '{n} 首歌': '{n} song | {n} songs',
  '加载中…': 'Loading…',
  '载入中…': 'Loading…',
  '加载失败：{error}': "Couldn't load: {error}",
  '载入失败：{error}': "Couldn't load: {error}",
  取消: 'Cancel',
  搜索: 'Search',
  单曲: 'Song',
  歌手: 'Artist',
  专辑: 'Album',
  歌单: 'Playlist',

  // 首页
  夜深了: 'Up late',
  早上好: 'Good morning',
  下午好: 'Good afternoon',
  晚上好: 'Good evening',
  '，{name}': ', {name}',
  '今天也有歌想听吗？': 'What do you feel like listening to today?',
  '搜索歌曲、歌手、歌单': 'Search songs, artists, playlists',
  设置: 'Settings',
  为你准备: 'Made for you',
  每日推荐: 'Daily Mix',
  按你最近的听歌记录挑选: 'Picked from what you\'ve been playing',
  登录后会按你的口味推荐: 'Log in for picks based on your taste',
  '私人 FM': 'Personal FM',
  '随便听听，遇见没听过的歌': 'Discover new music',
  '暂停私人 FM': 'Pause Personal FM',
  '播放私人 FM': 'Play Personal FM',
  继续播放: 'Jump back in',
  播过的歌会出现在这里: 'Songs you play will show up here',
  '有些内容没有载入成功。': 'Some content didn\'t load.',
  重试: 'Retry',
  推荐歌单: 'Recommended playlists',
  新歌速递: 'New releases',
  排行榜: 'Charts',

  // 搜索
  综合: 'All',
  '搜索歌曲、歌手、专辑、歌单': 'Search songs, artists, albums, playlists',
  搜索分类: 'Search categories',
  '搜索中…': 'Searching…',
  '搜索失败：{error}': 'Search failed: {error}',
  '没有找到「{q}」相关的结果': 'No results for “{q}”',
  最佳结果: 'Top result',
  加载更多: 'Load more',
  '输入歌名、歌手或歌单名字开始搜索': 'Search for a song, artist or playlist',

  // 歌单、专辑、歌手
  '{n} 次播放': '{n} play | {n} plays',
  '歌单加载失败：{error}': "Couldn't load playlist: {error}",
  '专辑加载失败：{error}': "Couldn't load album: {error}",
  '歌手加载失败：{error}': "Couldn't load artist: {error}",
  '歌手：{name}': 'Artist: {name}',
  '{n} 张专辑': '{n} album | {n} albums',
  热门歌曲: 'Popular',
  收起: 'Show less',
  '显示全部 {n} 首': 'Show all {n} songs',

  // 每日推荐
  '按你最近听的歌、喜欢的歌手挑的，每天更新一次。':
    'Picked from your recent plays and favorite artists. Updated daily.',
  '正在重新挑…': 'Picking new songs…',
  换一批: 'Refresh',
  '正在按你的口味挑歌，第一次会久一点…': 'Picking songs for you. The first time takes a little longer…',
  '每日推荐加载失败：{error}': "Couldn't load Daily Mix: {error}",

  // 音乐库
  我的音乐库: 'Your Library',
  我喜欢的音乐: 'Liked Songs',
  '按 ♡ 收藏喜欢的歌': 'Tap ♡ to save songs you love',
  '最近喜欢：{name}': 'Latest: {name}',
  播放我喜欢的音乐: 'Play Liked Songs',
  听歌排行: 'Top tracks',
  排行范围: 'Time range',
  本周: 'This week',
  全部: 'All',
  '这周还没有听歌记录，听完一首歌就会出现在这里。':
    'Nothing played this week yet. Finish a song and it\'ll show up here.',
  '还没有听歌记录，听完一首歌就会出现在这里。':
    'No listening history yet. Finish a song and it\'ll show up here.',
  '{n} 次': '{n} play | {n} plays',
  我的歌单: 'Your Playlists',
  排序: 'Sort by',
  最近更新: 'Recently updated',
  名称: 'Name',
  新建歌单: 'New playlist',
  歌单名字: 'Playlist name',
  新建: 'Create',
  '新建失败：{error}': "Couldn't create playlist: {error}",
  '还没有歌单。在任何一首歌旁边按 ＋ 就能加进歌单。':
    'No playlists yet. Tap ＋ next to any song to add it to one.',

  // 我喜欢的音乐
  '还没有喜欢的歌。听到喜欢的就按一下 ♡。': 'No liked songs yet. Tap ♡ on a song you love.',

  // 自己的歌单
  还没有歌: 'No songs yet',
  '移除失败：{error}': "Couldn't remove: {error}",
  '加入失败：{error}': "Couldn't add: {error}",
  '保存失败：{error}': "Couldn't save: {error}",
  '删除失败：{error}': "Couldn't delete: {error}",
  '＋ 添加歌曲': '＋ Add songs',
  编辑: 'Edit',
  删除歌单: 'Delete playlist',
  '歌单还是空的。按上面的「＋ 添加歌曲」一次挑好几首，':
    'This playlist is empty. Use “＋ Add songs” above to pick a few at once,',
  '或者按播放条红心旁边的 ＋ 把正在播的歌加进来。':
    'or tap the ＋ next to the heart in the player bar to add the current song.',
  '删除歌单「{name}」？': 'Delete “{name}”?',
  '只删除这个歌单，里面的歌不会受影响。删除后不能复原。':
    'Only the playlist is deleted; the songs aren\'t affected. This can\'t be undone.',
  删除: 'Delete',
  编辑歌单: 'Edit playlist',
  换照片: 'Choose photo',
  用歌曲封面: 'Use song covers',
  名字: 'Name',
  介绍: 'Description',
  '写点什么（可以不写）': 'Add an optional description',
  保存: 'Save',
};
