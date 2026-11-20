'use client';
import { readPlate, type PlateReading } from './zone-reader';

// Loads a plate photo (URL or file) into a canvas and runs the zone reader on it.
// The photo is drawn at most 1400 px on its long side; readings are returned as
// fractions of the image, so they map back onto the full-size photo unchanged.
export async function readPlateImage(src: string | Blob): Promise<PlateReading> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * s);
    canvas.height = Math.round(img.naturalHeight * s);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('Canvas is not available in this browser.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise(r => setTimeout(r, 0)); // let the UI paint before the analysis runs
    const reading = readPlate(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return { ...reading, width: img.naturalWidth, height: img.naturalHeight, mmPerPx: reading.mmPerPx * s };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}
