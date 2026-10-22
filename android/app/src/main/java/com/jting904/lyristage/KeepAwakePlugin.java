package com.jting904.lyristage;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 看歌词时屏幕不要自己暗掉（renderer/src/keepAwake.js）。
 * Android 的 WebView 不支持网页的 Screen Wake Lock，所以用视窗的 FLAG_KEEP_SCREEN_ON：
 * 只在 App 显示时有效，切到别的 App、按电源键都照常。
 */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void keepAwake(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void allowSleep(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
