'use client';
import { readKeyhole, type KeyholeReading } from './keyhole-reader';

// Loads a keyhole assay photo (URL or file) into a canvas and runs the keyhole reader.
// Small images are enlarged so the growth texture spans enough pixels; large ones are reduced.
export async function readKeyholeImage(src: string | Blob, sections: number): Promise<KeyholeReading> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const s = long < 700 ? Math.min(3, 900 / long) : Math.min(1, 1400 / long);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * s);
    canvas.height = Math.round(img.naturalHeight * s);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('Canvas is not available in this browser.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise(r => setTimeout(r, 0));
    const reading = readKeyhole(ctx.getImageData(0, 0, canvas.width, canvas.height), sections);
    return { ...reading, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}
