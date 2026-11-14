#!/usr/bin/env python3
"""
Builds the night-time texture set for the perfboard clock from the original
flat-illustration SVG (perfboard_topview.svg).

Four passes are rasterised from *the same* element list, so they line up
pixel-for-pixel:

  albedo.jpg    everything switched off (LEDs dark, segments dark, no glow rings)
  height.png    a height field in mm/10  (board 0 … chip body 0.35 … display 0.55)
  material.png  R = roughness, G = specular strength, B = metalness
  ao.png        contact occlusion derived from the height field

plus geometry.json: LED centres & BCD bit weights, 7-segment polygons, windows.

Usage:  python3 build_assets.py "/path/to/perfboard_topview.svg" [texwidth]
"""
import json
import os
import re
import subprocess
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/refs/perfboard_topview.svg"
TEXW = int(sys.argv[2]) if len(sys.argv) > 2 else 1600
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "assets")
os.makedirs(OUT, exist_ok=True)
RESVG = os.path.join(HERE, "resvg.js")

src = open(SRC, encoding="utf-8").read()

BX, BY, BW, BH = 129.8, 371.8, 1489.4, 1880.6              # board outline rect
MARGIN = 3.0
CX, CY = BX - MARGIN, BY - MARGIN
CW, CH = BW + 2 * MARGIN, BH + 2 * MARGIN
MM_PER_UNIT = 127.0 / BW                                    # 127 mm wide board


# --------------------------------------------------------------- classification
# h is in mm/10.  (spec, rough, metal) drive the shader's BRDF.
PCB = dict(h=0.00, spec=0.03, rough=0.92, metal=0.0)
FILLS = {
    # perfboard copper / solder / holes
    "#c9a06a": dict(h=0.014, spec=0.14, rough=0.56, metal=0.60),   # copper ring
    "#e2c08c": dict(h=0.014, spec=0.14, rough=0.56, metal=0.60),
    "#d9d2c4": dict(h=0.024, spec=0.30, rough=0.38, metal=0.88),   # solder fillet
    "#a9a294": dict(h=0.024, spec=0.30, rough=0.38, metal=0.88),
    "#8a6a3c": dict(h=0.000, spec=0.00, rough=1.00, metal=0.00),   # drilled hole
    "#6a5433": dict(h=0.000, spec=0.00, rough=1.00, metal=0.00),
    "#7d6136": dict(h=0.020, spec=0.25, rough=0.55, metal=0.30),
    "#bda269": dict(h=0.020, spec=0.25, rough=0.55, metal=0.30),
    # DIP sockets + chip bodies
    "#3b2c17": dict(h=0.200, spec=0.20, rough=0.62, metal=0.00),
    "#161616": dict(h=0.350, spec=0.20, rough=0.52, metal=0.00),
    "#2c2c2c": dict(h=0.380, spec=0.20, rough=0.52, metal=0.00),
    "#232323": dict(h=0.300, spec=0.30, rough=0.50, metal=0.00),
    # 7-segment modules
    "#151515": dict(h=0.520, spec=0.35, rough=0.40, metal=0.00),
    "#2a2a2a": dict(h=0.545, spec=0.22, rough=0.45, metal=0.00),
    "#120d0d": dict(h=0.552, spec=0.12, rough=0.42, metal=0.00),   # glass
    "#ff2d18": dict(h=0.558, spec=0.10, rough=0.40, metal=0.00),   # lit bar
    "#ff5a3a": dict(h=0.558, spec=0.10, rough=0.40, metal=0.00),
    "#ffd2c6": dict(h=0.558, spec=0.10, rough=0.40, metal=0.00),
    "#ffffff": dict(h=0.558, spec=0.10, rough=0.40, metal=0.00),
    "#3a1410": dict(h=0.558, spec=0.45, rough=0.30, metal=0.00),   # dark bar
    # LEDs
    "#a8240f": dict(h=0.280, spec=0.55, rough=0.22, metal=0.00),
    "#7d1a10": dict(h=0.280, spec=0.55, rough=0.22, metal=0.00),
    "#4a1008": dict(h=0.280, spec=0.55, rough=0.22, metal=0.00),
    "#8d2a1c": dict(h=0.330, spec=0.55, rough=0.22, metal=0.00),
    "#5c1810": dict(h=0.330, spec=0.55, rough=0.22, metal=0.00),
    "#ffe3dc": dict(h=0.345, spec=0.75, rough=0.15, metal=0.00),
    "#ffc8bc": dict(h=0.345, spec=0.75, rough=0.15, metal=0.00),
    # passives / hardware
    "#6b3f16": dict(h=0.215, spec=0.22, rough=0.62, metal=0.00),
    "#1a1008": dict(h=0.215, spec=0.22, rough=0.62, metal=0.00),
    "#a02020": dict(h=0.215, spec=0.22, rough=0.60, metal=0.00),
    "#c9a24a": dict(h=0.215, spec=0.25, rough=0.60, metal=0.00),
    "#e6e8ea": dict(h=0.220, spec=0.55, rough=0.30, metal=0.90),   # pins / sockets
    "#9aa0a4": dict(h=0.220, spec=0.55, rough=0.30, metal=0.90),
    "#efe9dc": dict(h=0.120, spec=0.60, rough=0.40, metal=0.80),
    "#c8b287": dict(h=0.110, spec=0.40, rough=0.50, metal=0.40),
    "#4a4a4a": dict(h=0.400, spec=0.25, rough=0.55, metal=0.20),
    "#8b8b8b": dict(h=0.400, spec=0.55, rough=0.45, metal=0.70),
    "#1b2740": dict(h=0.380, spec=0.30, rough=0.50, metal=0.05),
    "#9aa4b8": dict(h=0.390, spec=0.70, rough=0.30, metal=0.90),
    "#dcdcdc": dict(h=0.300, spec=0.60, rough=0.35, metal=0.50),
    "#2a2118": dict(h=0.300, spec=0.25, rough=0.55, metal=0.00),
    "#1f1f1f": dict(h=0.300, spec=0.28, rough=0.50, metal=0.00),
    "#3a3a3a": dict(h=0.300, spec=0.30, rough=0.50, metal=0.00),
    "#1a1a1a": dict(h=0.300, spec=0.30, rough=0.50, metal=0.00),
    "#d8d8d8": dict(h=0.300, spec=0.60, rough=0.35, metal=0.50),
    "#b9b9b9": dict(h=0.300, spec=0.60, rough=0.35, metal=0.50),
    "#c9ced3": dict(h=0.300, spec=0.70, rough=0.30, metal=0.80),
    "#050505": dict(h=0.300, spec=0.20, rough=0.55, metal=0.00),
}
# wires drawn with a stroke: tinned copper vs insulated colours
STROKES = {
    "#b9bdc0": dict(h=0.042, spec=0.30, rough=0.38, metal=0.80),   # bare tinned wire
    "#9aa0a4": dict(h=0.042, spec=0.30, rough=0.38, metal=0.80),
    "#cfc8b8": dict(h=0.048, spec=0.35, rough=0.45, metal=0.30),
    "#e8e8e8": dict(h=0.048, spec=0.40, rough=0.42, metal=0.45),
    "#8a8a8a": dict(h=0.048, spec=0.35, rough=0.45, metal=0.30),
    "#141414": dict(h=0.055, spec=0.25, rough=0.55, metal=0.00),
    "#2a1f10": dict(h=0.055, spec=0.25, rough=0.55, metal=0.00),
    "#000": dict(h=0.000, spec=0.10, rough=0.80, metal=0.00),
    "#000000": dict(h=0.000, spec=0.10, rough=0.80, metal=0.00),
    "#0a0a0a": dict(h=0.000, spec=0.10, rough=0.80, metal=0.00),
}
WIRE_DEFAULT = dict(h=0.038, spec=0.18, rough=0.55, metal=0.05)
GOLDEN = dict(h=0.040, spec=0.22, rough=0.50, metal=0.10)

# albedo: the same passes but with everything switched off
BOARD_DIM = {
    "#d9d2c4": ("#5c5850", "#403c36"),   # solder ring fill, stroke
    "#c9a06a": ("#6e5636", "#5e4a2e"),   # copper ring
    "#e2c08c": ("#5e4c30", "#4e3f28"),
    "#8a6a3c": ("#40331f", "#3a2e1c"),
    "#a9a294": ("#57534b", "#3e3b35"),
    "#bda269": ("#63543a", "#574a33"),
    "#d9b98c": ("#6a5638", "#5c4b31"),
}
DARKEN_FILL = {
    "#a8240f": "#3d0d06", "url(#led)": "#4a1209",
    "#ffc8bc": "#6b473f", "#ff5a3a": "#2a1009", "#ffd2c6": "#2a1009",
    "#7d1a10": "#3d0d06", "#8d2a1c": "#4a1209", "#ffe3dc": "#7a544a",
}


def attr(tag, k):
    m = re.search(r'\b%s="([^"]*)"' % k, tag)
    return m.group(1) if m else None


def num(tag, k, d=0.0):
    v = attr(tag, k)
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def set_attr(tag, k, v):
    if re.search(r'\b%s="[^"]*"' % k, tag):
        return re.sub(r'(\b%s=")[^"]*(")' % k, r'\g<1>%s\g<2>' % v, tag, count=1)
    return tag[:-2] + ' %s="%s"/>' % (k, v)


def gray(h):
    v = int(round(max(0.0, min(1.0, h)) * 255))
    return "#%02x%02x%02x" % (v, v, v)


def mat_color(c):
    return "#%02x%02x%02x" % (int(c["rough"] * 255), int(c["spec"] * 255),
                              int(c["metal"] * 255))


# ------------------------------------------------------------------- element pass
def classify(name, tag):
    """-> (kind, classification dict) where kind is one of
       'skip' | 'glyph' | 'stroke' | 'dome' | 'led_part' | 'fill'"""
    fill = attr(tag, "fill")
    stroke = attr(tag, "stroke")
    r = num(tag, "r", -1)

    # board background
    if fill in ("url(#bg)", "url(#boardg)"):
        return "fill", PCB
    # LED dome -> hemisphere
    if name == "circle" and abs(r - 25.85) < 0.3:
        return "dome", FILLS["#a8240f"]
    # the die / specular dot inside an LED dome
    if name == "circle" and abs(r - 22.55) < 0.3:
        return "led_part", FILLS["#8d2a1c"]
    if name == "circle" and r < 8 and fill in ("#ffe3dc", "#ffc8bc"):
        return "led_part", FILLS["#ffe3dc"]
    if fill == "url(#led)":
        return "led_part", FILLS["#8d2a1c"]
    if fill and fill in FILLS:
        return "fill", FILLS[fill]
    if fill and fill != "none":
        return "fill", dict(h=0.18, spec=0.25, rough=0.60, metal=0.0)
    if stroke and stroke != "none":
        if stroke in STROKES:
            return "stroke", STROKES[stroke]
        # coloured insulated jumper wire
        return "stroke", GOLDEN if stroke.startswith("#d8") else WIRE_DEFAULT
    return "glyph", PCB          # text / silk print


ELEMENTS = re.compile(r"<(circle|rect|polygon|polyline|path|text)\b[^>]*?/>")
DOME_GRAD = (
    '<radialGradient id="hdome" cx="0.5" cy="0.5" r="0.5">'
    '<stop offset="0" stop-color="#808080"/>'
    '<stop offset="0.55" stop-color="#787878"/>'
    '<stop offset="0.85" stop-color="#5c5c5c"/>'
    '<stop offset="1" stop-color="#242424"/></radialGradient>')


def warp(tag, name, kind, cls, mode):
    """Return the tag rewritten for albedo (mode 'a'), height ('h') or material ('m')."""
    width = num(tag, "stroke-width", 0)
    if mode == "a":
        fill = attr(tag, "fill")
        stroke0 = attr(tag, "stroke")
        if fill in BOARD_DIM:
            tag = set_attr(tag, "fill", BOARD_DIM[fill][0])
        if stroke0 in BOARD_DIM:
            tag = set_attr(tag, "stroke", BOARD_DIM[stroke0][1])
        if fill in DARKEN_FILL:
            tag = set_attr(tag, "fill", DARKEN_FILL[fill])
        elif fill == "#ff2d18":
            tag = set_attr(tag, "fill", "#3a1410")
            if attr(tag, "stroke") == "#ff7a58":
                tag = set_attr(tag, "stroke", "#1c0a08")
        # fatter wires: hairlines read as a schematic, real wires have diameter
        if kind == "stroke":
            # insulated wire is a lot darker than the schematic colour suggests
            for k in ("stroke", "fill"):
                cur = attr(tag, k)
                if cur and cur.startswith("#") and len(cur) == 7:
                    r, g2, b2 = (int(cur[i:i + 2], 16) for i in (1, 3, 5))
                    tag = set_attr(tag, k, "#%02x%02x%02x" % (int(r * 0.44), int(g2 * 0.40), int(b2 * 0.40)))
            if 0 < width < 4.5:
                tag = set_attr(tag, "stroke-width", round(width * 1.45, 2))
        return tag

    if mode == "h":
        if kind in ("dome", "led_part"):
            return "" if kind == "led_part" else set_attr(tag, "fill", "url(#hdome)")
        if kind == "stroke":
            tag = set_attr(tag, "fill", "none") if attr(tag, "fill") not in (None, "none") else tag
            tag = set_attr(tag, "stroke", gray(cls["h"]))
            if 0 < width < 4.5:
                tag = set_attr(tag, "stroke-width", round(width * 1.45, 2))
            return tag
        return set_attr(set_attr(tag, "fill", gray(cls["h"])), "stroke", "none")

    # material pass
    if kind in ("dome", "led_part"):
        return "" if kind == "led_part" else set_attr(tag, "fill", mat_color(cls))
    if kind == "stroke":
        tag = set_attr(tag, "stroke", mat_color(cls))
        if 0 < width < 4.5:
            tag = set_attr(tag, "stroke-width", round(width * 1.45, 2))
        return tag
    return set_attr(set_attr(tag, "fill", mat_color(cls)), "stroke", "none")


def build_pass(mode):
    out = []
    for m in ELEMENTS.finditer(src):
        tag, name = m.group(0), m.group(1)
        kind, cls = classify(name, tag)
        if kind == "skip":
            continue
        if kind == "glyph":
            continue                        # no silkscreen lettering in the photo
        out.append(warp(tag, name, kind, cls, mode))
    head = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
            'viewBox="%.2f %.2f %.2f %.2f"><defs>%s</defs>'
            '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>'
            % (TEXW, round(TEXW * CH / CW), CX, CY, CW, CH, DOME_GRAD,
               CX, CY, CW, CH,
               gray(PCB["h"]) if mode == "h" else
               (mat_color(PCB) if mode == "m" else "url(#boardg)")))
    tail = "</svg>"
    return head + "".join(out) + tail


def raster(svg_text, png_path, width=None):
    tmp = png_path.replace(".png", ".svg")
    open(tmp, "w", encoding="utf-8").write(svg_text)
    subprocess.run(["node", RESVG, tmp, png_path, str(width or TEXW)], check=True)
    return png_path


# --------------------------------------------------------------------- geometry
def points_of(p):
    vals = [float(v) for v in re.split(r"[,\s]+", p.strip()) if v]
    return [[vals[i], vals[i + 1]] for i in range(0, len(vals), 2)]


def collect_geometry():
    elems = re.findall(r"<(circle|polygon)\b([^>]*?)/>", src)
    leds = [[num(a, "cx"), num(a, "cy")] for n, a in elems
            if n == "circle" and abs(num(a, "r") - 25.85) < 0.2]
    colons = [[num(a, "cx"), num(a, "cy")] for n, a in elems
              if n == "circle" and abs(num(a, "r") - 12.65) < 0.2]

    cols = sorted({round(x, 2) for x, _ in leds})
    idx = {c: i for i, c in enumerate(cols)}
    grid = [{"x": x, "y": y, "col": idx[round(x, 2)]} for x, y in leds]
    for ci in range(len(cols)):
        members = sorted([g for g in grid if g["col"] == ci], key=lambda g: -g["y"])
        for bit, g in enumerate(members):
            g["bit"] = bit

    def bbox(pts):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return min(xs), min(ys), max(xs), max(ys)

    raw = []
    for name, a in elems:
        if name != "polygon":
            continue
        pts = points_of(attr(a, "points"))
        x0, y0, x1, y1 = bbox(pts)
        raw.append({"pts": pts, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
                    "w": x1 - x0, "h": y1 - y0, "area": (x1 - x0) * (y1 - y0)})

    clusters = []
    for r in raw:
        for c in clusters:
            if abs(c["cx"] - r["cx"]) < 6 and abs(c["cy"] - r["cy"]) < 6:
                c["members"].append(r); break
        else:
            clusters.append({"cx": r["cx"], "cy": r["cy"], "members": [r]})

    wins = []
    for m in re.finditer(r"<rect\b([^>]*?)/>", src):
        a = m.group(1)
        if attr(a, "fill") == "#120d0d":
            wins.append([num(a, "x"), num(a, "y"), num(a, "width"), num(a, "height")])
    wins.sort(key=lambda w: w[0])

    segs = []
    for c in clusters:
        body = max(c["members"], key=lambda m: m["area"])
        x0, y0, x1, y1 = bbox(body["pts"])
        win = min(wins, key=lambda w: abs((w[0] + w[2] / 2) - c["cx"]))
        wx, wy, ww, wh = win
        fx, fy = (c["cx"] - wx) / ww, (c["cy"] - wy) / wh
        if (x1 - x0) > (y1 - y0):
            letter = "A" if fy < 0.3 else ("G" if fy < 0.62 else "D")
        else:
            letter = ("F" if fx < 0.5 else "B") if fy < 0.5 else ("E" if fx < 0.5 else "C")
        segs.append({"digit": wins.index(win), "seg": letter,
                     "pts": body["pts"], "cx": c["cx"], "cy": c["cy"]})
    segs.sort(key=lambda s: (s["digit"], "ABCDEFG".index(s["seg"])))

    nx = lambda x: round((x - CX) / CW, 5)
    ny = lambda y: round((y - CY) / CH, 5)
    return {
        "board": {"view": [CX, CY, CW, CH], "aspect": CW / CH},
        "leds": [{"x": nx(g["x"]), "y": ny(g["y"]), "col": g["col"], "bit": g["bit"]}
                 for g in grid],
        "colons": [{"x": nx(x), "y": ny(y)} for x, y in colons],
        "windows": [{"x": nx(x), "y": ny(y), "w": round(w / CW, 5),
                     "h": round(h / CH, 5)} for x, y, w, h in wins],
        "segments": [{"digit": s["digit"], "seg": s["seg"], "x": nx(s["cx"]),
                      "y": ny(s["cy"]),
                      "pts": [[nx(px), ny(py)] for px, py in s["pts"]]} for s in segs],
    }


# ------------------------------------------------------------------------ main
if __name__ == "__main__":
    from PIL import Image, ImageDraw, ImageFilter

    print("rasterising passes…")
    raster(build_pass("a"), "/tmp/p_albedo.png")
    raster(build_pass("h"), "/tmp/p_height.png")
    raster(build_pass("m"), "/tmp/p_mat.png")

    # --- albedo: crop the cream page away, keep only the board --------------
    alb = Image.open("/tmp/p_albedo.png").convert("RGB")
    k = TEXW / CW
    mask = Image.new("L", alb.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [3.0 * k, 3.0 * k, (CW - 3.0) * k, (CH - 3.0) * k], radius=17.6 * k, fill=255)
    alb = Image.composite(alb, Image.new("RGB", alb.size, (0, 0, 0)), mask)

    # gentle paper/phenolic grain so the vector flatness goes away
    import random
    random.seed(7)
    grain = Image.effect_noise(alb.size, 9).convert("L")
    blotch = Image.effect_noise((alb.width // 24, alb.height // 24), 26).convert("L")
    blotch = blotch.resize(alb.size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(2))
    px = alb.load()
    gpx, bpx = grain.load(), blotch.load()
    for y in range(alb.height):
        for x in range(alb.width):
            g = (gpx[x, y] - 128) * 0.10
            b = (bpx[x, y] - 128) * 0.055
            r, gg, bb = px[x, y]
            px[x, y] = (max(0, min(255, int(r + g + b))),
                        max(0, min(255, int(gg + g + b * 0.9))),
                        max(0, min(255, int(bb + g * 0.9 + b * 0.8))))
    alb.save(os.path.join(OUT, "albedo.jpg"), quality=92, optimize=True, progressive=True)

    # --- height / material (no need for full res: they are smooth) ----------
    HGT_W = 1000
    hgt = Image.open(raster(build_pass("h"), "/tmp/p_height.png", HGT_W)).convert("L")
    hgt = hgt.filter(ImageFilter.GaussianBlur(1.1))       # rounded component edges
    hgt.save(os.path.join(OUT, "height.png"), optimize=True)
    mat = Image.open(raster(build_pass("m"), "/tmp/p_mat.png", HGT_W)).convert("RGB")
    mat.save(os.path.join(OUT, "material.png"), optimize=True)

    # --- ambient / contact occlusion from the height field ------------------
    wide = hgt.filter(ImageFilter.GaussianBlur(9))
    tight = hgt.filter(ImageFilter.GaussianBlur(2.5))
    ao = Image.new("L", hgt.size)
    hp, wp, tp, ap = hgt.load(), wide.load(), tight.load(), ao.load()
    for y in range(hgt.height):
        for x in range(hgt.width):
            h0 = hp[x, y]
            cav = max(0, wp[x, y] - h0) * 1.25 + max(0, tp[x, y] - h0) * 0.9
            # deeper holes / slots read as almost black
            slot = max(0, 60 - h0) / 60.0
            ap[x, y] = int(max(0, min(255, 255 * (1.0 - min(0.92, cav / 90.0)) - 26 * slot * (1 - slot))))
    # contact shadow: board pixels right next to a tall part sit in its shadow
    tall = hgt.point(lambda v: 255 if v > 34 else 0)
    halo = tall.filter(ImageFilter.GaussianBlur(6.5))
    ao = ao.filter(ImageFilter.GaussianBlur(0.6))
    ap, hp2, hl = ao.load(), hgt.load(), halo.load()
    for y in range(ao.height):
        for x in range(ao.width):
            if hp2[x, y] <= 30:            # only on the open board surface
                k2 = 1.0 - 0.72 * (hl[x, y] / 255.0)
                ap[x, y] = int(ap[x, y] * k2)
    ao.save(os.path.join(OUT, "ao.png"), optimize=True)

    geo = collect_geometry()
    json.dump(geo, open(os.path.join(OUT, "geometry.json"), "w"), separators=(",", ":"))

    for f in ("albedo.jpg", "height.png", "material.png", "ao.png", "geometry.json"):
        p = os.path.join(OUT, f)
        print("  %-14s %5d KB" % (f, os.path.getsize(p) // 1024))
    print("cols:", [sum(1 for g in geo["leds"] if g["col"] == c) for c in range(6)],
          " segments:", len(geo["segments"]))
