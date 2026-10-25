package com.jting904.lyristage;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 加入 / 离开语音时开关 VoiceCallService（renderer/src/stores/voice.js） */
@CapacitorPlugin(name = "Voice")
public class VoicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), VoiceCallService.class);
            ContextCompat.startForegroundService(getContext(), intent);
            // Android 13 起通知要另外允许：不允许的话语音照样能用，只是通知栏看不到「语音中」
            if (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7302);
            }
            call.resolve();
        } catch (Exception e) {
            // 例如 App 不在前面时开不了：语音还是能用，只是关屏幕后会断
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), VoiceCallService.class));
        call.resolve();
    }
}
