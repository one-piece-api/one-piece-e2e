import type { BlockImage } from './images';

/** `VP8L` header: signature byte, then 14 + 14 bits of size minus one, alpha hint, version 0. */
const VP8L_SIGNATURE = 0x2f;

/**
 * The block image as a lossless WebP (RFC 9649, section 3). A block image has at most two
 * colours, so the bitstream stays minimal: no transforms, no colour cache, no meta prefix
 * codes, and one "simple" prefix code per channel - one symbol (no bits per pixel) or two
 * (one bit, 0 for the transparent pixel, 1 for the block). Not a general encoder.
 */
export function encodeWebp({ width, height, margin, color }: BlockImage): Buffer {
  const transparent = margin > 0;
  const bits = new BitWriter();
  bits.write(VP8L_SIGNATURE, 8);
  bits.write(width - 1, 14);
  bits.write(height - 1, 14);
  bits.write(transparent ? 1 : 0, 1);
  bits.write(0, 3);
  bits.write(0, 1); // no transform
  bits.write(0, 1); // no colour cache
  bits.write(0, 1); // no meta prefix codes
  // Prefix codes in the order the format reads them: green, red, blue, alpha, distance.
  for (const value of [color.green, color.red, color.blue, 0xff]) {
    simpleCode(bits, transparent ? [0, value] : [value]);
  }
  simpleCode(bits, [0]);
  if (transparent) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBlock = x >= margin && x < width - margin && y >= margin && y < height - margin;
        bits.write(inBlock ? 0b1111 : 0b0000, 4); // green, red, blue, alpha: one bit each
      }
    }
  }
  return riff(bits.bytes());
}

/**
 * A simple prefix code of one or two symbols below 256, the first one first. With two, the
 * smaller one gets the code 0 (canonical order), which is why the transparent 0 comes first.
 */
function simpleCode(bits: BitWriter, symbols: number[]): void {
  bits.write(1, 1);
  bits.write(symbols.length - 1, 1);
  const [first, second] = symbols;
  const firstIsBit = first <= 1;
  bits.write(firstIsBit ? 0 : 1, 1);
  bits.write(first, firstIsBit ? 1 : 8);
  if (second !== undefined) {
    bits.write(second, 8);
  }
}

/** `RIFF` size `WEBP`, then the `VP8L` chunk, padded to an even length. */
function riff(data: Buffer): Buffer {
  const padded = data.length % 2 === 0 ? data : Buffer.concat([data, Buffer.alloc(1)]);
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(12 + padded.length, 4);
  header.write('WEBPVP8L', 8, 'ascii');
  header.writeUInt32LE(data.length, 16);
  return Buffer.concat([header, padded]);
}

/** Packs values least significant bit first, as the WebP lossless bitstream reads them. */
class BitWriter {
  private readonly buffer: number[] = [];
  private current = 0;
  private used = 0;

  write(value: number, count: number): void {
    for (let bit = 0; bit < count; bit++) {
      this.current |= ((value >>> bit) & 1) << this.used;
      if (++this.used === 8) {
        this.buffer.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  bytes(): Buffer {
    return Buffer.from(this.used > 0 ? [...this.buffer, this.current] : this.buffer);
  }
}
