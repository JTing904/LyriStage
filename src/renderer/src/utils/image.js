// 头像图片：裁成正方形（取中间）、缩小，转成小档案再上传
const SIZE = 256;

/**
 * @param {File} file 使用者选的图片
 * @returns {Promise<Blob>} 256×256 的 webp（浏览器不支持 webp 时用 jpeg）
 */
export async function squareAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE
  );
  bitmap.close();
  const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.86));
  const webp = await encode('image/webp');
  // 旧版 Safari 不会编码 webp，会悄悄给 png（档案大很多）
  return webp?.type === 'image/webp' ? webp : encode('image/jpeg');
}
