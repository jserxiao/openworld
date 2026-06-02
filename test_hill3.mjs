// 检查素材图片：对比9个山坡素材的像素数据
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const files = [
  '山坡左上.png', '山坡中上.png', '山坡右上.png',
  '山坡左中.png', '山坡中中.png', '山坡右中.png',
  '山坡左下.png', '山坡中下.png', '山坡右下.png',
];

// 简单检查文件是否可以读取
for (const file of files) {
  const path = `public/assets/${file}`;
  try {
    const buf = fs.readFileSync(path);
    console.log(`${file}: ${buf.length} bytes, OK`);
  } catch (e) {
    console.log(`${file}: ERROR - ${e.message}`);
  }
}

// 检查每个文件的像素hash来确认它们是不同的
import crypto from 'crypto';
for (const file of files) {
  const path = `public/assets/${file}`;
  const buf = fs.readFileSync(path);
  const hash = crypto.createHash('md5').update(buf).digest('hex').substring(0, 8);
  console.log(`  ${file} hash: ${hash}`);
}
