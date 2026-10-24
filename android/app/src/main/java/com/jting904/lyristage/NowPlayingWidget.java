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
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * 桌面小组件「正在播放」，底是模糊的封面（Android 12 起）：
 * - 一格高：封面、歌名、歌手（播放中换成正在唱的那句）、上一首 / 播放 / 下一首
 * - 两格以上：歌词当主角。上面小封面、歌名 · 歌手和 LyriStage 字标，中间大大的一句歌词，下面按钮和进度条；
 *   暂停或没有歌词时中间换成大大的歌名
 * 资料由 App 里的 JS 透过 WidgetPlugin 送进来（存在 SharedPreferences，App 关掉后小组件还显示最后那首）。
 * 按钮：App 开着时送广播给 WidgetPlugin（JS 去播放 / 切歌）；App 没开时改成打开 App，打开后接着做那个动作。
 */
public class NowPlayingWidget extends AppWidgetProvider {

    static final String PREFS = "now_playing_widget";
    static final String COVER_FILE = "widget_cover.png";
    /** 模糊、压暗的封面（小组件的底） */
    static final String ART_FILE = "widget_art.png";
    static final String EXTRA_ACTION = "lyristage.widget.action";
    private static final String ACTION_PREFIX = "com.jting904.lyristage.widget.";
    /** 高度到这么多（dp）才用有歌词的版面（大封面 + 歌词放得下）；矮的用一排的版面 */
    private static final int LARGE_MIN_HEIGHT_DP = 150;
    /** 拉得更高：封面、字跟着放大的版面 */
    private static final int XL_MIN_HEIGHT_DP = 260;

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
        // 几个版面用同一组图（同一个 Bitmap 只传一次）
        Bitmap cover = loadBitmap(context, COVER_FILE);
        Bitmap art = loadBitmap(context, ART_FILE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12 起：系统按实际大小自动挑版面
            Map<SizeF, RemoteViews> layouts = new HashMap<>();
            layouts.put(new SizeF(180f, 40f), views(context, R.layout.widget_now_playing, cover, art));
            layouts.put(new SizeF(180f, LARGE_MIN_HEIGHT_DP), views(context, R.layout.widget_now_playing_large, cover, art));
            layouts.put(new SizeF(180f, XL_MIN_HEIGHT_DP), views(context, R.layout.widget_now_playing_xl, cover, art));
            return new RemoteViews(layouts);
        }
        Bundle options = manager.getAppWidgetOptions(id);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int layout = height >= XL_MIN_HEIGHT_DP
            ? R.layout.widget_now_playing_xl
            : height >= LARGE_MIN_HEIGHT_DP ? R.layout.widget_now_playing_large : R.layout.widget_now_playing;
        return views(context, layout, cover, art);
    }

    private static Bitmap loadBitmap(Context context, String name) {
        File file = new File(context.getFilesDir(), name);
        boolean hasSong = !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("title", "").isEmpty();
        return file.exists() && hasSong ? BitmapFactory.decodeFile(file.getPath()) : null;
    }

    private static RemoteViews views(Context context, int layout, Bitmap cover, Bitmap art) {
        boolean row = layout == R.layout.widget_now_playing;
        boolean xl = layout == R.layout.widget_now_playing_xl;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String title = prefs.getString("title", "");
        String artist = prefs.getString("artist", "");
        String lyric = prefs.getString("lyric", "");
        String lyricNext = prefs.getString("lyricNext", "");
        boolean playing = prefs.getBoolean("playing", false) && WidgetPlugin.instance != null;
        int color = prefs.getInt("color", 0xFF1C1C21);
        // 播放中、而且唱到某一句了：歌词当主角；不然显示歌名
        boolean showLyric = playing && !lyric.isEmpty();

        RemoteViews v = new RemoteViews(context.getPackageName(), layout);
        v.setInt(R.id.widget_bg, "setColorFilter", color);
        // 模糊的封面要靠 clipToOutline 裁成圆角，Android 12 以前不支持：只用封面取的颜色
        if (art != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            v.setImageViewBitmap(R.id.widget_art, art);
            v.setViewVisibility(R.id.widget_art, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.widget_art, View.GONE);
        }

        if (row) {
            if (title.isEmpty()) {
                v.setTextViewText(R.id.widget_title, "LyriStage");
                v.setTextViewText(R.id.widget_artist, context.getString(R.string.widget_nothing_playing));
            } else {
                v.setTextViewText(R.id.widget_title, title);
                v.setTextViewText(R.id.widget_artist, showLyric ? lyric : artist);
            }
        } else if (title.isEmpty()) {
            v.setTextViewText(R.id.widget_head, "");
            v.setTextViewText(R.id.widget_lyric, context.getString(R.string.widget_nothing_playing));
            v.setTextViewTextSize(R.id.widget_lyric, TypedValue.COMPLEX_UNIT_SP, xl ? 30 : 22);
            v.setViewVisibility(R.id.widget_sub, View.GONE);
        } else if (showLyric) {
            v.setTextViewText(R.id.widget_head, titleAndArtist(title, artist));
            v.setTextViewText(R.id.widget_lyric, lyric);
            v.setTextViewTextSize(R.id.widget_lyric, TypedValue.COMPLEX_UNIT_SP, xl ? 30 : 22);
            // 拉得很高的才放得下下一句
            v.setTextViewText(R.id.widget_sub, lyricNext);
            v.setViewVisibility(R.id.widget_sub, xl && !lyricNext.isEmpty() ? View.VISIBLE : View.GONE);
        } else {
            v.setTextViewText(R.id.widget_head, context.getString(playing ? R.string.widget_now_playing : R.string.widget_paused));
            v.setTextViewText(R.id.widget_lyric, title);
            v.setTextViewTextSize(R.id.widget_lyric, TypedValue.COMPLEX_UNIT_SP, xl ? 36 : 28);
            v.setTextViewText(R.id.widget_sub, artist);
            v.setViewVisibility(R.id.widget_sub, artist.isEmpty() ? View.GONE : View.VISIBLE);
        }
        if (!row) {
            float duration = prefs.getFloat("duration", 0f);
            float position = prefs.getFloat("position", 0f);
            int progress = duration > 0 ? Math.round(Math.min(1f, position / duration) * 1000) : 0;
            v.setProgressBar(R.id.widget_progress, 1000, title.isEmpty() ? 0 : progress, false);
        }

        if (cover != null) v.setImageViewBitmap(R.id.widget_cover, cover);
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

    /** 「歌名 · 歌手」，歌手淡一点 */
    private static CharSequence titleAndArtist(String title, String artist) {
        if (artist.isEmpty()) return title;
        SpannableStringBuilder text = new SpannableStringBuilder(title).append("  ·  ");
        int start = title.length();
        text.append(artist);
        text.setSpan(new ForegroundColorSpan(0xB3FFFFFF), start, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return text;
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
