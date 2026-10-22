package com.jting904.lyristage;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
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
 * App 里直接更新（renderer/src/platform 的 installAndroidUpdate）：
 * 下载 GitHub Release 上的 APK → 确认是 LyriStage、而且比现在的新 → 打开系统的安装画面。
 * 第一次要用户允许「LyriStage 可以安装 App」（会先打开那个设定，允许后回来再按一次）。
 * 系统安装时还会检查签名和现在的一样，别人的 APK 盖不过去。
 */
@CapacitorPlugin(name = "AppUpdater")
public class UpdatePlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    /** App 打开时：上次下载的安装档已经用不到了（装好了，或没装），删掉省空间 */
    @Override
    public void load() {
        File[] old = new File(getContext().getCacheDir(), "updates").listFiles();
        if (old != null) for (File f : old) f.delete();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        // 只从 GitHub 下载（Release 的附件网址）
        if (!url.startsWith("https://github.com/")) {
            call.reject("下载网址不对");
            return;
        }
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            getActivity().startActivity(settings);
            JSObject result = new JSObject();
            result.put("status", "needs-permission");
            call.resolve(result);
            return;
        }
        if (busy) {
            call.reject("正在下载");
            return;
        }
        busy = true;
        executor.execute(() -> {
            try {
                File dir = new File(context.getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "LyriStage.apk");
                download(url, apk);
                checkApk(context, apk);
                getActivity().runOnUiThread(() -> openInstaller(context, apk));
                JSObject result = new JSObject();
                result.put("status", "installing");
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                busy = false;
            }
        });
    }

    private void download(String url, File target) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true); // GitHub 会转到下载服务器
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        try {
            if (conn.getResponseCode() != 200) throw new Exception("下载失败（" + conn.getResponseCode() + "）");
            long total = conn.getContentLengthLong();
            long done = 0;
            int lastPercent = -1;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                    done += n;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
            }
        } finally {
            conn.disconnect();
        }
    }

    /** 下载的是 LyriStage，而且版本比现在的新 */
    private static void checkApk(Context context, File apk) throws Exception {
        PackageManager pm = context.getPackageManager();
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getPath(), 0);
        if (downloaded == null || !context.getPackageName().equals(downloaded.packageName)) {
            throw new Exception("下载的文件不是 LyriStage");
        }
        PackageInfo installed = pm.getPackageInfo(context.getPackageName(), 0);
        if (versionCode(downloaded) <= versionCode(installed)) {
            throw new Exception("已经是最新版本");
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private void openInstaller(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(install);
    }
}
