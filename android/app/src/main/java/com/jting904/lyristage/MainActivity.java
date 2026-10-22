package com.jting904.lyristage;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 桌面小组件的桥（要在 super.onCreate 之前登记）
        registerPlugin(WidgetPlugin.class);
        // App 里直接下载、安装新版本
        registerPlugin(UpdatePlugin.class);
        // 看歌词时屏幕常亮
        registerPlugin(KeepAwakePlugin.class);
        // 一起听的语音在背景继续
        registerPlugin(VoicePlugin.class);
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        // 画面铺到状态栏、导航列底下，两条都透明，透出页面自己的颜色
        // （不然 Android 14 以下会用主题的颜色画一条深色底，浅色主题时很突兀）。
        // 页面用 CSS 的 env(safe-area-inset-*) 避开它们（styles/base.css 的 #app）
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        // 横屏时画面也铺到摄像头（挖孔）那一边，不然那边会空一条黑边
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        // 导航列（三个按钮那种）不要自动垫半透明底
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
    }
}
