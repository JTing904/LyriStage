package com.jting904.lyristage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 拔掉耳机、蓝牙耳机断开时暂停（renderer/src/headphones.js），不然歌会从喇叭大声放出来。
 * 别的 App 放声音、来电时暂停不用管：WebView 自己会向系统要音频焦点、被打断时自己暂停
 * （再另外要焦点反而会跟 WebView 抢，把自己打断）。
 * watch：开始播放时开始听；unwatch：暂停时不用听。拔掉时送 "noisy" 事件给 JS
 */
@CapacitorPlugin(name = "Headphones")
public class HeadphonesPlugin extends Plugin {

    private boolean watching = false;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                notifyListeners("noisy", null);
            }
        }
    };

    @PluginMethod
    public void watch(PluginCall call) {
        if (!watching) {
            // 系统的广播：不对其他 App 开放也收得到
            ContextCompat.registerReceiver(
                getContext(),
                noisy,
                new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
            watching = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void unwatch(PluginCall call) {
        stop();
        call.resolve();
    }

    private void stop() {
        if (!watching) return;
        try {
            getContext().unregisterReceiver(noisy);
        } catch (IllegalArgumentException ignored) {
            // 已经取消过了
        }
        watching = false;
    }

    @Override
    protected void handleOnDestroy() {
        stop();
        super.handleOnDestroy();
    }
}
