// 均衡器、音量平衡：用 Web Audio 处理正在播的声音
// 声音路线：<audio> → 前级衰减 → 10 段均衡 → （音量平衡）→ 喇叭
//
// - 从来没开过的人完全不经过这里，和以前一模一样
// - 开过一次以后声音就一直经过 Web Audio（<audio> 接上以后拆不掉）；关掉只是把每段调回 0
// - iPhone 不提供：Safari 接了 Web Audio 以后锁屏可能会停播
// - 设定存在这台设备（每个人的耳机、喇叭不一样，不跟账号同步）
import { reactive, watch } from 'vue';
import { BANDS, headroomDb, normalizeEqSettings } from '@core/audio/equalizer';

const STORAGE_KEY = 'lyristage:eq';
const SMOOTH_S = 0.05; // 调整时 50 毫秒内滑过去，不会有爆音

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function load() {
  try {
    return normalizeEqSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeEqSettings(null);
  }
}

/**
 * @param {ReturnType<typeof import('@core/player/audio').createHtmlAudio>} audio
 */
export function createAudioEffects(audio) {
  const supported = !isIOS && typeof AudioContext !== 'undefined';
  const settings = reactive(load());

  /** @type {null | { ctx: AudioContext, preamp: GainNode, filters: BiquadFilterNode[], last: AudioNode, leveler: DynamicsCompressorNode, leveling: boolean }} */
  let graph = null;

  function build() {
    const element = audio.element;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    const source = ctx.createMediaElementSource(element);
    const preamp = ctx.createGain();
    const filters = BANDS.map((hz, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = hz;
      f.Q.value = 1.4;
      return f;
    });
    // 音量平衡：太大声的压下来、太小声的拉上去（压缩器会自动补回音量）
    const leveler = ctx.createDynamicsCompressor();
    leveler.threshold.value = -24;
    leveler.knee.value = 24;
    leveler.ratio.value = 4;
    leveler.attack.value = 0.005;
    leveler.release.value = 0.3;
    leveler.connect(ctx.destination);

    let node = source.connect(preamp);
    for (const f of filters) node = node.connect(f);
    node.connect(ctx.destination);

    // 浏览器要用户点过才让声音出来：每次按播放时确认一下
    element.addEventListener('play', () => {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    });
    if (!element.paused) ctx.resume().catch(() => {});
    graph = { ctx, preamp, filters, last: node, leveler, leveling: false };
  }

  function apply() {
    if (!graph) return;
    const { ctx, preamp, filters, last, leveler } = graph;
    const gains = settings.enabled ? settings.gains : BANDS.map(() => 0);
    const t = ctx.currentTime;
    preamp.gain.setTargetAtTime(10 ** (headroomDb(gains) / 20), t, SMOOTH_S);
    filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], t, SMOOTH_S));
    if (settings.leveler !== graph.leveling) {
      last.disconnect();
      last.connect(settings.leveler ? leveler : ctx.destination);
      graph.leveling = settings.leveler;
    }
  }

  // 开着的时候才以跨域方式载入（Web Audio 要读得到声音）
  function wanted() {
    return supported && (settings.enabled || settings.leveler);
  }

  function update() {
    if (!wanted() && !graph) return;
    audio.useCors = true;
    if (!graph) {
      // 正在播的这首当初不是跨域载入的：接上以后会没声音，先重新载入（从原来的位置接着播）
      if (audio.element.src && audio.element.crossOrigin === null) audio.reload();
      build();
    }
    apply();
  }

  if (wanted()) {
    audio.useCors = true;
    // 打开 App 时还没点过画面，这时建的 AudioContext 会被挡；等第一次按播放再接
    audio.element.addEventListener(
      'play',
      () => {
        if (graph) return;
        build();
        apply();
      },
      { once: true }
    );
  }

  watch(
    settings,
    value => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // localStorage 不能用时只是不记住
      }
      update();
    },
    { deep: true }
  );

  return {
    /** 这台设备能不能用（iPhone 不行） */
    supported,
    /** { enabled, gains, leveler }：直接改就会生效、存起来 */
    settings,
  };
}
