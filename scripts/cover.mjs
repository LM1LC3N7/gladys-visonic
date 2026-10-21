// Generates cover.png (800x534) for gladys-visonic: plain Node, no dependency.
// An alarm keypad, a serial cable to a small network adapter, local network
// waves and a shield with a padlock on a dark teal gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [12 + 20 * t, 60 + 40 * t, 70 + 45 * t]);
  }
}
const white = [255, 255, 255];
const dark = [18, 28, 52];
const red = [230, 60, 60];
const green = [90, 210, 130];
const glass = [150, 200, 240];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// An arc of a ring, between two angles (radians, 0 = right, clockwise on screen).
const arc = (cx, cy, r, width, from, to, color) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
// A filled shield: straight top, sides curving to a point.
const shield = (cx, top, w, h, color) => {
  for (let y = top; y < top + h; y += 1) {
    const t = (y - top) / h;
    const half = t < 0.45 ? w / 2 : (w / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.45) / 0.55) ** 2));
    for (let x = Math.floor(cx - half - 1); x <= cx + half + 1; x += 1) {
      const a = Math.max(0, Math.min(1, half - Math.abs(x - cx) + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

// Soft halo.
disc(400, 270, 250, white, 0.06);

// Keypad: body, display, LEDs, 3x4 keys.
box(110, 100, 330, 440, 26, white);
box(135, 125, 305, 190, 10, dark);
box(150, 145, 240, 170, 5, glass);
disc(265, 157, 8, green);
disc(288, 157, 8, red);
for (let row = 0; row < 4; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const x = 140 + col * 55;
    const y = 210 + row * 55;
    box(x, y, x + 45, y + 42, 9, dark, 0.85);
  }
}

// A serial cable from the keypad to a small network adapter.
line(330, 402, 362, 402, 6, white);
box(360, 380, 440, 426, 8, white);
box(372, 392, 400, 414, 4, dark);
disc(422, 403, 6, green);

// Local network waves from the adapter to the shield (no cloud).
for (const r of [22, 42, 62]) {
  arc(395, 270, r, 9, -0.8, 0.8, white);
}
disc(395, 270, 7, white);
line(400, 278, 400, 380, 5, white);

// Shield with a padlock.
shield(570, 110, 230, 300, white);
box(530, 250, 610, 320, 10, dark);
arc(570, 250, 26, 12, -Math.PI, 0, dark);
disc(570, 278, 8, white);
line(570, 280, 570, 302, 7, white);

// A small house below the shield.
line(520, 455, 570, 420, 10, white);
line(570, 420, 620, 455, 10, white);
box(530, 452, 610, 500, 6, white);
box(560, 468, 580, 500, 4, dark);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
