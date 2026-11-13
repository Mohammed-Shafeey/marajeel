export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SIZE = 512;
/** Stay safely under the API's 1 MB photo limit. */
const MAX_BYTES = 950_000;

/**
 * Crops the chosen square, resizes to 512 × 512 and encodes WebP (quality 0.85), which keeps transparency.
 * Browsers that can't encode WebP from a canvas (Safari, every iPhone browser) fall back to PNG when the
 * image has transparent pixels (JPEG would turn them black), shrinking it if needed to fit the size limit,
 * and to JPEG otherwise. The API accepts all three.
 */
export async function cropToBlob(src: string, area: CropArea): Promise<Blob> {
  const img = await loadImage(src);
  const draw = (size: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
    return canvas;
  };
  const canvas = draw(SIZE);
  const webp = await toBlob(canvas, 'image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  if (hasTransparency(canvas)) {
    for (const size of [SIZE, 384, 256]) {
      const png = await toBlob(size === SIZE ? canvas : draw(size), 'image/png');
      if (png && png.size <= MAX_BYTES) return png;
    }
  }
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88);
  if (!jpeg) throw new Error('encode failed');
  return jpeg;
}

function hasTransparency(c: HTMLCanvasElement) {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function toBlob(c: HTMLCanvasElement, type: string, q?: number) {
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
