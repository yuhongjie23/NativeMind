/**
 * 生成占位应用图标
 *
 * tauri-build 在 Windows 上要求 src-tauri/icons/icon.ico 存在，缺了连
 * cargo check 都过不去。设计稿还没出，先生成一个纯色圆角方块占位，
 * 把编译链路打通；正式图标直接覆盖同名文件即可，不用改任何配置。
 *
 * 用 Node 而不是 Python：项目本来就依赖 Node，不该为一个占位图
 * 再引入第二种脚本运行时。ICO 容器格式简单，手写省掉图像库依赖。
 *
 * 用法：node scripts/generate-placeholder-icon.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 64;
// 与 UI 强调色一致，让占位图标不至于看起来像坏文件
const FILL = { r: 0x7a, g: 0x8e, b: 0x6c };
const CORNER = 10;

/** 生成 BGRA 像素，BMP 要求自底向上 */
function buildPixels() {
  const rows = [];

  for (let y = 0; y < SIZE; y += 1) {
    const row = Buffer.alloc(SIZE * 4);

    for (let x = 0; x < SIZE; x += 1) {
      const dx = Math.min(x, SIZE - 1 - x);
      const dy = Math.min(y, SIZE - 1 - y);
      // 落在四个圆角之外的像素设为透明
      const outsideCorner =
        dx < CORNER &&
        dy < CORNER &&
        (CORNER - dx) ** 2 + (CORNER - dy) ** 2 > CORNER ** 2;

      const offset = x * 4;
      if (outsideCorner) {
        row.writeUInt32LE(0, offset);
      } else {
        row[offset] = FILL.b;
        row[offset + 1] = FILL.g;
        row[offset + 2] = FILL.r;
        row[offset + 3] = 0xff;
      }
    }

    rows.push(row);
  }

  return Buffer.concat(rows.reverse());
}

function buildIco() {
  const pixels = buildPixels();
  // 32 位图靠 alpha 通道透明，AND 掩码全 0，但字段不能省
  const mask = Buffer.alloc((SIZE * SIZE) / 8);

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(SIZE, 4); // biWidth
  header.writeInt32LE(SIZE * 2, 8); // biHeight：ICO 规定写成两倍（XOR + AND）
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(pixels.length + mask.length, 20);

  const image = Buffer.concat([header, pixels, mask]);

  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type = icon
  directory.writeUInt16LE(1, 4); // 图像数量
  directory.writeUInt8(SIZE, 6);
  directory.writeUInt8(SIZE, 7);
  directory.writeUInt8(0, 8); // 调色板颜色数，真彩色为 0
  directory.writeUInt8(0, 9); // reserved
  directory.writeUInt16LE(1, 10); // planes
  directory.writeUInt16LE(32, 12); // bit count
  directory.writeUInt32LE(image.length, 14);
  directory.writeUInt32LE(22, 18); // 图像数据偏移：紧跟目录之后

  return Buffer.concat([directory, image]);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const target = resolve(scriptDir, '..', 'src-tauri', 'icons', 'icon.ico');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildIco());

console.log(`已生成 ${target}`);
