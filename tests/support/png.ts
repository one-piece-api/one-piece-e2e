import { crc32, deflateSync } from 'node:zlib';

import type { BlockImage } from './images';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGBA = 6;

/** The block image as a PNG: 8-bit RGBA, no filter, deflated by Node. */
export function encodePng({ width, height, margin, color }: BlockImage): Buffer {
  const row = 1 + width * 4;
  const pixels = Buffer.alloc(row * height);
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      pixels.set([color.red, color.green, color.blue, 0xff], y * row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, RGBA, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG chunk: length, type, data and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}
