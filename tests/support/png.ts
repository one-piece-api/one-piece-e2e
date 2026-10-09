import { crc32, deflateSync } from 'node:zlib';

/** An image the e2e suite can upload, built in memory as Playwright's file inputs take it. */
export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGBA = 6;

/**
 * A PNG the Devil Fruit image profile accepts (content-service plan D6): 4:5, an opaque
 * block on a transparent margin, so that enough of it is transparent. Generated at run time
 * rather than committed, so the suite carries no binary.
 */
export function fruitImage(width = 320, height = 400, margin = 20): UploadFile {
  const row = 1 + width * 4;
  const pixels = Buffer.alloc(row * height);
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      pixels.set([0xe8, 0x6a, 0x2c, 0xff], y * row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, RGBA, 0, 0, 0], 8);
  const buffer = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { name: 'e2e-fruit.png', mimeType: 'image/png', buffer };
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
