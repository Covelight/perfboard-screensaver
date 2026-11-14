#!/usr/bin/env python3
"""Re-encode the texture set for shipping.

The four maps are inlined into index.html as base64, so every KB here costs
1.33 KB in the page and in the screen saver binary. All of them are sampled
through bilinear filtering on a scene that is soft and grainy, so a smaller,
lossier encode is invisible at the sizes this is actually drawn at.

    albedo   1350 -> 1200 px, q80   (the only map with real detail)
    material  900 ->  760 px, q80 4:4:4 (no chroma subsampling — r/g/b are
                                       roughness / specular / metalness)
    ao       1000 ->  700 px, q85
    height   1600 -> 1000 px, q92

Run from the repo root:  python3 tools/shrink_assets.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")

SPECS = {
    "albedo.jpg":   dict(w=1200, q=80, gray=False, sub=2),
    "material.png": dict(w=760,  q=80, gray=False, sub=0),
    "ao.png":       dict(w=700,  q=85, gray=True,  sub=None),
    "height.png":   dict(w=1000, q=92, gray=True,  sub=None),
}

total = 0
for name, sp in SPECS.items():
    path = os.path.join(ASSETS, name)
    before = os.path.getsize(path)
    im = Image.open(path)
    im = im.convert("L") if sp["gray"] else im.convert("RGB")
    h = max(1, round(sp["w"] * im.size[1] / im.size[0]))
    im = im.resize((sp["w"], h), Image.LANCZOS)
    kw = dict(format="JPEG", quality=sp["q"], optimize=True)
    if sp["sub"] is not None:
        kw["subsampling"] = sp["sub"]
    out = path.rsplit(".", 1)[0] + ".jpg"          # everything ships as JPEG now
    im.save(out, **kw)
    if out != path:
        os.remove(path)
    after = os.path.getsize(out)
    total += after
    print(f"{name:14s} {before/1e3:8.1f} KB -> {after/1e3:7.1f} KB  {im.size}")
print(f"{'TOTAL':14s} {total/1e3:8.1f} KB")
