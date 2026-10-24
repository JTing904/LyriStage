# 把 GLB 里的 PNG 贴图缩小并转成 WebP（EXT_texture_webp），其他数据原样保留
# 用法：python glb_webp.py in.glb out.glb [size]
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
data = open(src, 'rb').read()
json_len = struct.unpack_from('<I', data, 12)[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 20 + json_len + 8
bin_chunk = data[bin_start:]
assert not gltf.get('extensionsRequired'), '只处理没有扩展的 GLB'

views = [bin_chunk[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in gltf['bufferViews']]
for img in gltf.get('images', []):
    im = Image.open(io.BytesIO(views[img['bufferView']])).convert('RGB')
    if im.width > size:
        im = im.resize((size, size * im.height // im.width), Image.LANCZOS)
    out = io.BytesIO()
    quality = 92 if 'normal' in img.get('name', '') else 85
    im.save(out, 'WEBP', quality=quality, method=6)
    views[img['bufferView']] = out.getvalue()
    img['mimeType'] = 'image/webp'
    print(img.get('name'), len(out.getvalue()) // 1024, 'KB')
for tex in gltf.get('textures', []):
    tex.setdefault('extensions', {})['EXT_texture_webp'] = {'source': tex.pop('source')}
for key in ('extensionsUsed', 'extensionsRequired'):
    gltf.setdefault(key, []).append('EXT_texture_webp')

blob = bytearray()
for view, content in zip(gltf['bufferViews'], views):
    blob += b'\0' * (-len(blob) % 4)
    view['byteOffset'] = len(blob)
    view['byteLength'] = len(content)
    blob += content
blob += b'\0' * (-len(blob) % 4)
gltf['buffers'] = [{'byteLength': len(blob)}]
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
total = 12 + 8 + len(js) + 8 + len(blob)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
print('ok', dst, total // 1024, 'KB')
