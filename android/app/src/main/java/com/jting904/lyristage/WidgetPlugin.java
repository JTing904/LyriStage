package com.jting904.lyristage;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS 和桌面小组件之间的桥（renderer/src/widget.js）：
 * - update：歌名、歌手、歌词、播放中、封面网址 → 存起来、重画小组件（封面在背景下载，顺便算底色）
 * - 小组件的按钮 → "action" 事件给 JS
 * - App 是被小组件的按钮打开的 → consumeLaunchAction 告诉 JS 要接着做什么
 */
@CapacitorPlugin(name = "NowPlayingWidget")
public class WidgetPlugin extends Plugin {

    /** App 开着（JS 在跑）时才有；小组件靠它判断按钮要送广播还是打开 App */
    static volatile WidgetPlugin instance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String pendingAction;

    @Override
    public void load() {
        instance = this;
        pendingAction = getActivity().getIntent().getStringExtra(NowPlayingWidget.EXTRA_ACTION);
        getActivity().getIntent().removeExtra(NowPlayingWidget.EXTRA_ACTION);
        NowPlayingWidget.refreshAll(getContext());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String action = intent.getStringExtra(NowPlayingWidget.EXTRA_ACTION);
        if (action != null) emitAction(action);
    }

    @Override
    protected void handleOnDestroy() {
        instance = null;
        // App 关了：按钮换成打开 App、显示成暂停
        NowPlayingWidget.refreshAll(getContext());
        executor.shutdown();
        super.handleOnDestroy();
    }

    void emitAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("action", data, true);
    }

    /** 设置页的「加到桌面」：叫桌面跳出加小组件的确认（不支持的桌面回传 false，要自己长按桌面加） */
    @PluginMethod
    public void pin(PluginCall call) {
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager manager = getContext().getSystemService(AppWidgetManager.class);
            if (manager != null && manager.isRequestPinAppWidgetSupported()) {
                ok = manager.requestPinAppWidget(new ComponentName(getContext(), NowPlayingWidget.class), null, null);
            }
        }
        JSObject result = new JSObject();
        result.put("ok", ok);
        call.resolve(result);
    }

    @PluginMethod
    public void consumeLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        result.put("action", pendingAction);
        pendingAction = null;
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(NowPlayingWidget.PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor edit = prefs.edit();
        for (String key : new String[] { "title", "artist", "lyric", "lyricNext" }) {
            if (call.getData().has(key)) edit.putString(key, call.getString(key, ""));
        }
        if (call.getData().has("playing")) edit.putBoolean("playing", Boolean.TRUE.equals(call.getBoolean("playing")));
        edit.apply();

        String cover = call.getString("cover");
        if (cover != null && !cover.equals(prefs.getString("cover", null))) {
            prefs.edit().putString("cover", cover).apply();
            executor.execute(() -> {
                saveCover(context, cover);
                // 封面下载的时候可能又换歌了：只有还是这张才重画
                if (cover.equals(prefs.getString("cover", null))) NowPlayingWidget.refreshAll(context);
            });
        } else {
            NowPlayingWidget.refreshAll(context);
        }
        call.resolve();
    }

    /** 下载封面、做成圆角存起来，再算一个够深、白字看得清楚的底色 */
    private static void saveCover(Context context, String url) {
        File file = new File(context.getFilesDir(), NowPlayingWidget.COVER_FILE);
        SharedPreferences prefs = context.getSharedPreferences(NowPlayingWidget.PREFS, Context.MODE_PRIVATE);
        Bitmap source = null;
        if (!url.isEmpty()) {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                try (InputStream in = conn.getInputStream()) {
                    source = BitmapFactory.decodeStream(in);
                } finally {
                    conn.disconnect();
                }
            } catch (Exception ignored) {
                // 下载不了就用 App 图示
            }
        }
        if (source == null) {
            file.delete();
            prefs.edit().putInt("color", 0xFF1C1C21).apply();
            return;
        }
        int size = 240;
        Bitmap scaled = Bitmap.createScaledBitmap(source, size, size, true);
        Bitmap rounded = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        new Canvas(rounded).drawRoundRect(new RectF(0, 0, size, size), 24, 24, paint);
        try (FileOutputStream out = new FileOutputStream(file)) {
            rounded.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception ignored) {
            file.delete();
        }

        // 底色：封面的平均色，压暗到白字看得清楚
        int average = Bitmap.createScaledBitmap(source, 1, 1, true).getPixel(0, 0);
        float[] hsv = new float[3];
        Color.colorToHSV(average, hsv);
        hsv[1] = Math.min(hsv[1], 0.6f);
        hsv[2] = Math.min(hsv[2], 0.32f);
        prefs.edit().putInt("color", Color.HSVToColor(hsv)).apply();
    }
}
