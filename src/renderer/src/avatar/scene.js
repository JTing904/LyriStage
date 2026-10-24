// 我的 3D 公仔：用 three.js 画在透明的 canvas 上。
// 只有 components/AvatarFigure.vue 会（动态）载入这个文件，three.js 不会拖慢 App 启动。
// 动作：慢慢左右摆，头跟着鼠标 / 手指转
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createNameCard, measurePedestal } from './nameCard.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
/** 同一个模型只下载、解析一次（首页和歌词舞台同时显示时共用） */
const cache = new Map();

/** 模型 + 量好的底座（量一次就好） */
function loadModel(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      loader.loadAsync(url).then(gltf => ({
        gltf,
        pedestal: measurePedestal(gltf.scene),
      })).catch(err => {
        cache.delete(url); // 下次再试
        throw err;
      })
    );
  }
  return cache.get(url);
}

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ handle?: string }} [options]
 *   handle：底座名片上的帐号（例如 '@jtinnnng'），不给就不放名片
 */
export function createAvatarScene(canvas, { handle = '' } = {}) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x2a2a35, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);
  // 背后的紫色轮廓光，和头发的紫色反光呼应
  const rim = new DirectionalLight(0xb48cff, 1.6);
  rim.position.set(-2, 2, -2);
  scene.add(rim);

  const camera = new PerspectiveCamera(26, 1, 0.1, 50);
  /** 转动、晃动都作用在这一层，模型本身不动 */
  const pivot = new Group();
  scene.add(pivot);

  let disposed = false;
  /** 现在显示的公仔（模型 + 名片） */
  let model = null;
  let card = null;
  let wantedUrl = '';
  /** 模型的中心和大小（载入后按实际模型更新） */
  let size = { center: new Vector3(0, 0.95, 0), box: new Vector3(1.1, 1.9, 1.1) };

  /** 让整个公仔刚好放进画面（上下左右留一点空） */
  function frame() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const halfFov = MathUtils.degToRad(camera.fov / 2);
    const margin = 1.08;
    const fitHeight = (size.box.y / 2) * margin / Math.tan(halfFov);
    const fitWidth = (size.box.x / 2) * margin / (Math.tan(halfFov) * camera.aspect);
    const distance = Math.max(fitHeight, fitWidth) + size.box.z / 2;
    camera.position.set(0, size.center.y + size.box.y * 0.04, distance);
    camera.lookAt(size.center);
    camera.updateProjectionMatrix();
    // 先画一次：窗口被挡住、切到后台时动画会暂停，至少不会是空白
    if (!disposed) renderer.render(scene, camera);
  }

  async function setModel(url) {
    wantedUrl = url;
    const { gltf, pedestal } = await loadModel(url);
    if (url !== wantedUrl || disposed) return false; // 等的时候又换了别的
    if (model) pivot.remove(model);
    if (card) {
      pivot.remove(card);
      card.userData.dispose();
      card = null;
    }
    // 同一个模型可能同时出现在好几个地方，每个地方用一份复制（几何和材质共用）
    model = gltf.scene.clone();
    pivot.add(model);
    if (handle) {
      card = createNameCard(pedestal, handle);
      pivot.add(card);
    }
    const box = new Box3().setFromObject(model);
    size = { center: box.getCenter(new Vector3()), box: box.getSize(new Vector3()) };
    frame();
    return true;
  }

  // ---- 鼠标 / 手指：头跟着转 ----
  const pointer = { x: 0, y: 0 };
  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = MathUtils.clamp(
      (event.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2),
      -1,
      1
    );
    pointer.y = MathUtils.clamp(
      (event.clientY - (rect.top + rect.height / 3)) / (window.innerHeight / 2),
      -1,
      1
    );
  }
  window.addEventListener('pointermove', onPointerMove);

  // ---- 动画 ----
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let visible = true;

  function tick(now) {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;
    const still = reducedMotion();

    const sway = still ? 0 : Math.sin(time * 0.6) * 0.18;
    const targetY = sway + pointer.x * 0.55;
    const targetX = pointer.y * 0.08;
    pivot.rotation.y = MathUtils.damp(pivot.rotation.y, targetY, 4, dt);
    pivot.rotation.x = MathUtils.damp(pivot.rotation.x, targetX, 4, dt);

    renderer.render(scene, camera);
    schedule();
  }

  function schedule() {
    if (!raf && visible && !disposed && document.visibilityState === 'visible') {
      raf = requestAnimationFrame(tick);
    }
  }

  // 看不到的时候（滚出画面、切到后台）不画，省电
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    last = performance.now();
    schedule();
  });
  intersection.observe(canvas);
  const onVisibility = () => {
    last = performance.now();
    schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const resize = new ResizeObserver(() => frame());
  resize.observe(canvas);

  frame();
  schedule();

  return {
    setModel,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointerMove);
      card?.userData.dispose();
      renderer.dispose();
    },
  };
}
