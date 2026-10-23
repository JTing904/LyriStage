package com.jting904.lyristage;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * 自己显示推送通知（取代推送插件原本的）：右边放朋友的头像（像 WhatsApp），没有头像就放 LyriStage 的 Logo。
 * 服务器（supabase/functions/send-push）只送资料：title、body、url、kind、avatar。
 * - App 在前面：不跳系统通知（App 里本来就有提示），照样交给插件给网页那边
 * - App 在后面、或整个关掉：在这里组好通知；点了打开 App，插件会把 url 交给 push.js 换到那一页
 */
public class PushMessagingService extends MessagingService {

    private static final String CHANNEL = "social";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        String title = data.get("title");
        if (title == null || isAppInForeground()) return;

        String kind = data.containsKey("kind") ? data.get("kind") : "push";
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            // 插件认这个 key：有它才会把点通知的事件（连同下面的资料）交给网页那边
            .putExtra("google.message_id", message.getMessageId() != null ? message.getMessageId() : kind)
            .putExtra("url", data.get("url"))
            .putExtra("kind", kind);
        PendingIntent tap = PendingIntent.getActivity(
            this,
            kind.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setContentTitle(title)
            .setContentText(data.get("body"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(data.get("body")))
            .setLargeIcon(largeIcon(data.get("avatar")))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setPriority(NotificationCompat.PRIORITY_HIGH);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        // 同一种通知、同一个人：新的盖掉旧的
        manager.notify(kind + ":" + data.get("from"), 0, builder.build());
    }

    /** App 正显示在画面上 */
    private boolean isAppInForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }

    /** 右边的大图：朋友的头像（圆的）；没有或下载失败就用 LyriStage 的 Logo */
    private Bitmap largeIcon(String avatarUrl) {
        Bitmap avatar = download(avatarUrl);
        if (avatar != null) return circle(avatar);
        Drawable logo = ContextCompat.getDrawable(this, R.mipmap.ic_launcher_round);
        if (logo == null) return null;
        Bitmap bitmap = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        logo.setBounds(0, 0, 192, 192);
        logo.draw(canvas);
        return bitmap;
    }

    /** 下载头像（只收 https，最多等 4 秒；服务器那边已经只放 Supabase、GitHub、Google 的头像网址） */
    private Bitmap download(String url) {
        if (url == null || !url.startsWith("https://")) return null;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            try (InputStream in = connection.getInputStream()) {
                return BitmapFactory.decodeStream(in);
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private Bitmap circle(Bitmap source) {
        int size = Math.min(source.getWidth(), source.getHeight());
        int x = (source.getWidth() - size) / 2;
        int y = (source.getHeight() - size) / 2;
        Bitmap square = Bitmap.createBitmap(source, x, y, size, size);
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(square, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        new Canvas(output).drawCircle(size / 2f, size / 2f, size / 2f, paint);
        return output;
    }
}
