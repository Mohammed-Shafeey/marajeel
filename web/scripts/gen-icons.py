"""Generate every app-icon size from web/icons-src/icon-source.webp.

    python scripts/gen-icons.py        (from web/, needs Pillow)

All outputs are opaque RGB PNGs: iOS fills transparent pixels with black.
The maskable icon is shrunk onto the artwork's own background colour so the
ball stays inside the 40% safe-zone circle whatever mask the launcher uses.
"""
from pathlib import Path
from PIL import Image

web = Path(__file__).resolve().parent.parent
src = Image.open(web / "icons-src" / "icon-source.webp").convert("RGB")
out = web / "public" / "icons"
bg = src.getpixel((0, 0))  # the artwork's near-black background

def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)
    print(name, size)

for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                   (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
    save(src, size, name)

MASKABLE_SCALE = 0.88
n = src.width
inner = src.resize((round(n * MASKABLE_SCALE),) * 2, Image.LANCZOS)
canvas = Image.new("RGB", (n, n), bg)
canvas.paste(inner, ((n - inner.width) // 2, (n - inner.height) // 2))
save(canvas, 512, "icon-maskable-512.png")
