package com.jting904.lyristage;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.widget.RemoteViews;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * 桌面小组件「正在播放」：封面、歌名、歌手、上一首 / 播放 / 下一首；拉高到两格以上时多显示正在唱的那句歌词。
 * 资料由 App 里的 JS 透过 WidgetPlugin 送进来（存在 SharedPreferences，App 关掉后小组件还显示最后那首）。
 * 按钮：App 开着时送广播给 WidgetPlugin（JS 去播放 / 切歌）；App 没开时改成打开 App，打开后接着做那个动作。
 */
public class NowPlayingWidget extends AppWidgetProvider {

    static final String PREFS = "now_playing_widget";
    static final String COVER_FILE = "widget_cover.png";
    static final String EXTRA_ACTION = "lyristage.widget.action";
    private static final String ACTION_PREFIX = "com.jting904.lyristage.widget.";
    /** 高度到这么多（dp）才用有歌词的大版面（大封面 + 歌词放得下）；矮的用一排的版面 */
    private static final int LARGE_MIN_HEIGHT_DP = 150;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        // Android 12 以前没有自动按大小换版面：拉大拉小时自己换
        manager.updateAppWidget(id, build(context, manager, id));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action != null && action.startsWith(ACTION_PREFIX)) {
            String name = action.substring(ACTION_PREFIX.length());
            WidgetPlugin plugin = WidgetPlugin.instance;
            if (plugin != null) {
                plugin.emitAction(name);
            } else {
                // App 已经被关掉了：按钮改成打开 App（下次按就会打开），这次也试着直接打开
                refreshAll(context);
                Intent open = launchIntent(context, name);
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(open);
                } catch (RuntimeException ignored) {
                    // 有的系统不让背景打开画面：小组件已经换成打开 App 的按钮，再按一次就好
                }
            }
            return;
        }
        super.onReceive(context, intent);
    }

    /** 资料变了：重画所有放在桌面上的小组件 */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NowPlayingWidget.class));
        for (int id : ids) manager.updateAppWidget(id, build(context, manager, id));
    }

    private static RemoteViews build(Context context, AppWidgetManager manager, int id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12 起：系统按实际大小自动挑版面
            Map<SizeF, RemoteViews> layouts = new HashMap<>();
            layouts.put(new SizeF(180f, 40f), views(context, false));
            layouts.put(new SizeF(180f, LARGE_MIN_HEIGHT_DP), views(context, true));
            return new RemoteViews(layouts);
        }
        Bundle options = manager.getAppWidgetOptions(id);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return views(context, height >= LARGE_MIN_HEIGHT_DP);
    }

    private static RemoteViews views(Context context, boolean large) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String title = prefs.getString("title", "");
        String artist = prefs.getString("artist", "");
        String lyric = prefs.getString("lyric", "");
        String lyricNext = prefs.getString("lyricNext", "");
        boolean playing = prefs.getBoolean("playing", false) && WidgetPlugin.instance != null;
        int color = prefs.getInt("color", 0xFF1C1C21);

        RemoteViews v = new RemoteViews(
            context.getPackageName(),
            large ? R.layout.widget_now_playing_large : R.layout.widget_now_playing
        );
        v.setInt(R.id.widget_bg, "setColorFilter", color);

        if (title.isEmpty()) {
            v.setTextViewText(R.id.widget_title, "LyriStage");
            v.setTextViewText(R.id.widget_artist, context.getString(R.string.widget_nothing_playing));
        } else {
            v.setTextViewText(R.id.widget_title, title);
            v.setTextViewText(R.id.widget_artist, artist);
        }
        // 还没有歌词（刚换歌、纯音乐）时留着空位，按钮才不会跳上跳下
        if (large) {
            v.setTextViewText(R.id.widget_lyric, lyric);
            v.setTextViewText(R.id.widget_lyric_next, lyricNext);
        }

        File cover = new File(context.getFilesDir(), COVER_FILE);
        Bitmap bitmap = cover.exists() && !title.isEmpty() ? BitmapFactory.decodeFile(cover.getPath()) : null;
        if (bitmap != null) v.setImageViewBitmap(R.id.widget_cover, bitmap);
        else v.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher);

        v.setImageViewResource(R.id.widget_toggle, playing ? R.drawable.widget_pause : R.drawable.widget_play);
        v.setContentDescription(
            R.id.widget_toggle,
            context.getString(playing ? R.string.widget_pause : R.string.widget_play)
        );

        // 点封面、歌名：打开 App
        PendingIntent open = PendingIntent.getActivity(
            context, 0, new Intent(context, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        v.setOnClickPendingIntent(R.id.widget_info, open);
        v.setOnClickPendingIntent(R.id.widget_cover, open);

        boolean appRunning = WidgetPlugin.instance != null;
        v.setOnClickPendingIntent(R.id.widget_prev, button(context, "prev", 1, appRunning));
        v.setOnClickPendingIntent(R.id.widget_toggle, button(context, "toggle", 2, appRunning));
        v.setOnClickPendingIntent(R.id.widget_next, button(context, "next", 3, appRunning));
        return v;
    }

    private static PendingIntent button(Context context, String action, int code, boolean appRunning) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        if (appRunning) {
            Intent intent = new Intent(context, NowPlayingWidget.class).setAction(ACTION_PREFIX + action);
            return PendingIntent.getBroadcast(context, code, intent, flags);
        }
        return PendingIntent.getActivity(context, 10 + code, launchIntent(context, action), flags);
    }

    private static Intent launchIntent(Context context, String action) {
        return new Intent(context, MainActivity.class)
            .setAction(ACTION_PREFIX + "open." + action)
            .putExtra(EXTRA_ACTION, action);
    }
}
