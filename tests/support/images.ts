import { encodePng } from './png';
import { encodeWebp } from './webp';

/** An image the e2e suite can upload, built in memory as Playwright's file inputs take it. */
export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** The formats content-service accepts (WebP plan, W-D4); it stores both as WebP. */
export type ImageFormat = 'webp' | 'png';

/**
 * An opaque block inset by `margin` pixels on a transparent background (none when `margin`
 * is 0): enough transparency for the profiles that ask for it, two colours at most, so both
 * encoders stay small. Generated at run time rather than committed: no binary in the suite.
 */
export interface BlockImage {
  width: number;
  height: number;
  margin: number;
  color: { red: number; green: number; blue: number };
}

const BLOCK_COLOR = { red: 0xe8, green: 0x6a, blue: 0x2c };

/**
 * A fruit the Devil Fruit image profile accepts (content-service plan D6): 4:5, an opaque
 * block on a transparent margin, so that enough of it is transparent.
 */
export function fruitImage(format: ImageFormat = 'webp'): UploadFile {
  return upload('e2e-fruit', format, { width: 320, height: 400, margin: 20 });
}

/**
 * A poster the bounty image profile accepts (bounty plan D4): fully opaque, 560 x 800 at
 * least and close to 7:10, so the backend fits it into its 420 x 600 canvas.
 */
export function posterImage(format: ImageFormat = 'webp'): UploadFile {
  return upload('e2e-poster', format, { width: 560, height: 800, margin: 0 });
}

/**
 * An emblem the affiliation image profile accepts (affiliation plan D5): a square of 512 x
 * 512 at least, an opaque block on a transparent margin - 44 % of the pixels are transparent,
 * the profile asks for 5 % - that the backend fits into its 400 x 400 canvas.
 */
export function emblemImage(format: ImageFormat = 'webp'): UploadFile {
  return upload('e2e-emblem', format, { width: 512, height: 512, margin: 64 });
}

/**
 * A picture the species image profile accepts (species plan D5): fully opaque, 400 x 500 at
 * least and close to 4:5, so the backend fits it into its 320 x 400 canvas.
 */
export function speciesImage(format: ImageFormat = 'webp'): UploadFile {
  return upload('e2e-species', format, { width: 400, height: 500, margin: 0 });
}

/**
 * A portrait the character image profile accepts (character plan D7): fully opaque, 400 x 500
 * at least and close to 4:5, so the backend fits it into its 320 x 400 canvas.
 */
export function characterImage(format: ImageFormat = 'webp'): UploadFile {
  return upload('e2e-character', format, { width: 400, height: 500, margin: 0 });
}

/** An image id as the public API names it: the SHA-256 of its bytes, no extension. */
export const PUBLIC_IMAGE_PATH = /^v1\/images\/[0-9a-f]{64}$/;

function upload(name: string, format: ImageFormat, size: Omit<BlockImage, 'color'>): UploadFile {
  const image = { ...size, color: BLOCK_COLOR };
  return format === 'webp'
    ? { name: `${name}.webp`, mimeType: 'image/webp', buffer: encodeWebp(image) }
    : { name: `${name}.png`, mimeType: 'image/png', buffer: encodePng(image) };
}
