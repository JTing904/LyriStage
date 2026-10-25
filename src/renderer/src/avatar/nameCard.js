// 公仔底座上、脚前面的名片：IG 图标 + 帐号
// 每个公仔的底座高度、脚的位置都不一样，所以先量模型，再决定名片放哪、多大
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

/**
 * 量底座：中心、半径、顶面高度，还有脚最靠前的位置
 * （模型坐标；量的时候模型还没放进场景，matrixWorld 就是模型自己的变换）
 * @param {import('three').Object3D} model
 */
export function measurePedestal(model) {
  model.updateMatrixWorld(true);
  const points = [];
  const v = new Vector3();
  model.traverse(obj => {
    const position = obj.isMesh && obj.geometry.attributes.position;
    if (!position) return;
    // 不用每个点都看，隔几个取一个就够准了
    const step = Math.max(1, Math.floor(position.count / 60000));
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i).applyMatrix4(obj.matrixWorld);
      points.push(v.x, v.y, v.z);
    }
  });
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < points.length; i += 3) {
    minY = Math.min(minY, points[i]);
    maxY = Math.max(maxY, points[i]);
  }
  const height = maxY - minY;

  // 最底下一层就是底座：用它的范围算中心和半径
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1] > minY + height * 0.01) continue;
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minZ = Math.min(minZ, points[i + 2]);
    maxZ = Math.max(maxZ, points[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2;

  // 往上一层一层看：离中心最远的点突然变近（< 90% 半径）的地方就是底座顶面
  const slice = height * 0.005;
  let top = minY + height * 0.05;
  for (let y = minY; y < minY + height * 0.3; y += slice) {
    let far = 0;
    for (let i = 0; i < points.length; i += 3) {
      const py = points[i + 1];
      if (py < y || py >= y + slice) continue;
      far = Math.max(far, Math.hypot(points[i] - cx, points[i + 2] - cz));
    }
    if (far && far < radius * 0.9) {
      top = y;
      break;
    }
  }

  // 脚：顶面上方一小段、离中心不太远的点，最靠前（+z）的位置
  let feetFront = cz;
  for (let i = 0; i < points.length; i += 3) {
    const py = points[i + 1];
    if (py < top + height * 0.005 || py > top + height * 0.1) continue;
    if (Math.hypot(points[i] - cx, points[i + 2] - cz) > radius * 0.85) continue;
    feetFront = Math.max(feetFront, points[i + 2]);
  }

  return { cx, cz, radius, top, feetFront };
}

/** Instagram 的图标：圆角方框 + 圆 + 小点，渐层颜色 */
function drawInstagramGlyph(ctx, x, y, size) {
  const gradient = ctx.createLinearGradient(x, y + size, x + size, y);
  gradient.addColorStop(0, '#feda75');
  gradient.addColorStop(0.3, '#fa7e1e');
  gradient.addColorStop(0.55, '#d62976');
  gradient.addColorStop(0.8, '#962fbf');
  gradient.addColorStop(1, '#4f5bd5');
  const line = size * 0.09;
  ctx.strokeStyle = gradient;
  ctx.fillStyle = gradient;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.roundRect(x + line / 2, y + line / 2, size - line, size - line, size * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size * 0.75, y + size * 0.25, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function cardTexture(handle, aspect) {
  const height = 320;
  const width = Math.round(height * aspect);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 黑色名片
  ctx.fillStyle = '#111113';
  ctx.fillRect(0, 0, width, height);

  // 内容（图标 + 帐号）整体置中，字太长就缩小
  const glyph = height * 0.5;
  const gap = height * 0.14;
  let fontSize = height * 0.36;
  const font = size => `800 ${size}px "Segoe UI", "SF Pro Display", system-ui, sans-serif`;
  ctx.font = font(fontSize);
  let textWidth = ctx.measureText(handle).width;
  const maxText = width * 0.92 - glyph - gap;
  if (textWidth > maxText) {
    fontSize *= maxText / textWidth;
    ctx.font = font(fontSize);
    textWidth = ctx.measureText(handle).width;
  }
  const startX = (width - (glyph + gap + textWidth)) / 2;
  drawInstagramGlyph(ctx, startX, (height - glyph) / 2, glyph);
  ctx.fillStyle = '#f4f4f5';
  ctx.textBaseline = 'middle';
  ctx.fillText(handle, startX + glyph + gap, height / 2 + fontSize * 0.04);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 做一张名片，放在底座上、脚前面，往后靠一点（像桌上的名牌）
 * @param {ReturnType<typeof measurePedestal>} pedestal
 * @param {string} handle 例如 '@jtinnnng'
 */
export function createNameCard(pedestal, handle) {
  const { cx, cz, radius, top, feetFront } = pedestal;
  const edge = cz + radius;
  // 脚和底座边缘之间的空位，名片放在中间
  const room = Math.max(edge - feetFront, radius * 0.12);
  const width = radius * 0.95;
  const height = Math.min(width / 3.2, radius * 0.3);
  const depth = height * 0.06;
  const tilt = 0.32; // 往后靠的角度（弧度）

  const texture = cardTexture(handle, width / height);
  const front = new MeshStandardMaterial({ map: texture, roughness: 0.35 });
  const side = new MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.5 });
  // BoxGeometry 的面：+x, -x, +y, -y, +z（正面）, -z
  const card = new Mesh(new BoxGeometry(width, height, depth), [
    side,
    side,
    side,
    side,
    front,
    side,
  ]);
  card.rotation.x = -tilt;
  card.position.set(
    cx,
    top + (height / 2) * Math.cos(tilt),
    Math.min(feetFront + room * 0.55, edge - depth * 2) - (height / 2) * Math.sin(tilt)
  );

  card.userData.dispose = () => {
    texture.dispose();
    front.dispose();
    side.dispose();
    card.geometry.dispose();
  };
  return card;
}
