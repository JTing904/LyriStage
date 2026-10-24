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
 * - update：歌名、歌手、歌词、播放中、进度、封面网址 → 存起来、重画小组件（封面在背景下载，顺便做模糊的底）
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
        // 进度条：播到第几秒 / 一共几秒（换一句歌词、播放暂停时才送，不是每秒）
        if (call.getData().has("position")) edit.putFloat("position", call.getFloat("position", 0f));
        if (call.getData().has("duration")) edit.putFloat("duration", call.getFloat("duration", 0f));
        edit.apply();

        String cover = call.getString("cover");
        // 换了封面，或是从旧版更新上来还没有模糊的底：重新下载、做一次
        boolean noArt = !new File(context.getFilesDir(), NowPlayingWidget.ART_FILE).exists();
        if (cover != null && (!cover.equals(prefs.getString("cover", null)) || (noArt && !cover.isEmpty()))) {
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

    /** 下载封面、做成圆角存起来；再做一张模糊、压暗的当小组件的底，算一个备用底色（Android 12 以前用） */
    private static void saveCover(Context context, String url) {
        File file = new File(context.getFilesDir(), NowPlayingWidget.COVER_FILE);
        File art = new File(context.getFilesDir(), NowPlayingWidget.ART_FILE);
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
            art.delete();
            prefs.edit().putInt("color", 0xFF1C1C21).apply();
            return;
        }
        // 小组件里的封面最大 56dp 左右：192px 就够清楚（每次换一句歌词都会整个重送，图越小越省）
        int size = 192;
        Bitmap scaled = Bitmap.createScaledBitmap(source, size, size, true);
        Bitmap rounded = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        new Canvas(rounded).drawRoundRect(new RectF(0, 0, size, size), 40, 40, paint);
        save(rounded, file);
        save(blurredArt(source), art);

        // 备用底色：封面的平均色，压暗到白字看得清楚
        int average = Bitmap.createScaledBitmap(source, 1, 1, true).getPixel(0, 0);
        float[] hsv = new float[3];
        Color.colorToHSV(average, hsv);
        hsv[1] = Math.min(hsv[1], 0.6f);
        hsv[2] = Math.min(hsv[2], 0.32f);
        prefs.edit().putInt("color", Color.HSVToColor(hsv)).apply();
    }

    private static void save(Bitmap bitmap, File file) {
        try (FileOutputStream out = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception ignored) {
            file.delete();
        }
    }

    /**
     * 小组件的底：封面缩小、模糊三次（看起来像一片颜色），再压暗，上面亮一点、下面暗一点（按钮、进度条在下面）。
     * 只要 96px：模糊过的图放大也看不出来
     */
    static Bitmap blurredArt(Bitmap source) {
        int n = 96;
        int[] px = new int[n * n];
        Bitmap.createScaledBitmap(source, n, n, true).getPixels(px, 0, n, 0, 0, n, n);
        for (int pass = 0; pass < 3; pass++) {
            boxBlur(px, n, 7, true);
            boxBlur(px, n, 7, false);
        }
        for (int y = 0; y < n; y++) {
            float shade = 0.62f - 0.22f * y / (n - 1); // 上 62% 亮度 → 下 40%
            for (int x = 0; x < n; x++) {
                int c = px[y * n + x];
                float r = Color.red(c) * shade, g = Color.green(c) * shade, b = Color.blue(c) * shade;
                // 很亮的封面（白底）压暗一点：白字才看得清楚
                float light = (0.2126f * r + 0.7152f * g + 0.0722f * b) / 255f;
                float cap = light > 0.36f ? 0.36f / light : 1f;
                px[y * n + x] = Color.rgb((int) (r * cap), (int) (g * cap), (int) (b * cap));
            }
        }
        return Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888);
    }

    /** 一个方向的方框模糊（边缘用最边上的颜色补） */
    private static void boxBlur(int[] px, int n, int radius, boolean horizontal) {
        int[] out = new int[px.length];
        int span = radius * 2 + 1;
        for (int line = 0; line < n; line++) {
            int r = 0, g = 0, b = 0;
            for (int i = -radius; i <= radius; i++) {
                int c = px[index(line, Math.max(0, Math.min(n - 1, i)), n, horizontal)];
                r += Color.red(c);
                g += Color.green(c);
                b += Color.blue(c);
            }
            for (int i = 0; i < n; i++) {
                out[index(line, i, n, horizontal)] = Color.rgb(r / span, g / span, b / span);
                int add = px[index(line, Math.min(n - 1, i + radius + 1), n, horizontal)];
                int drop = px[index(line, Math.max(0, i - radius), n, horizontal)];
                r += Color.red(add) - Color.red(drop);
                g += Color.green(add) - Color.green(drop);
                b += Color.blue(add) - Color.blue(drop);
            }
        }
        System.arraycopy(out, 0, px, 0, px.length);
    }

    private static int index(int line, int i, int n, boolean horizontal) {
        return horizontal ? line * n + i : i * n + line;
    }
}
