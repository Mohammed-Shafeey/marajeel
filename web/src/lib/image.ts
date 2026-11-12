export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIZE = 512;

/**
 * Crops the chosen square, resizes to 512 × 512 and encodes WebP (quality 0.85).
 * Browsers that can't encode WebP from a canvas (Safari) fall back to JPEG; the API accepts both.
 */
export async function cropToBlob(src: string, area: CropArea): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, SIZE, SIZE);
  const webp = await toBlob(canvas, 'image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88);
  if (!jpeg) throw new Error('encode failed');
  return jpeg;
}

function toBlob(c: HTMLCanvasElement, type: string, q: number) {
  return new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, q));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
