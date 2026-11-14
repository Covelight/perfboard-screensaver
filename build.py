#!/usr/bin/env python3
"""Inline albedo + height/material/ao maps + geometry + app.js into one HTML."""
import base64, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
A = lambda *p: os.path.join(HERE, *p)
b64 = lambda p: base64.b64encode(open(A("assets", p), "rb").read()).decode()

geo = json.load(open(A("assets", "geometry.json")))
tpl = open(A("src", "index.html"), encoding="utf-8").read()
app = open(A("src", "app.js"), encoding="utf-8").read()

out = (tpl.replace("/*GEOJSON*/", json.dumps(geo, separators=(",", ":")))
          .replace("/*ALBEDO*/", "data:image/jpeg;base64," + b64("albedo.jpg"))
          .replace("/*HEIGHT*/", "data:image/jpeg;base64," + b64("height.jpg"))
          .replace("/*MATERIAL*/", "data:image/jpeg;base64," + b64("material.jpg"))
          .replace("/*AO*/", "data:image/jpeg;base64," + b64("ao.jpg"))
          .replace("/*APPJS*/", app))
p = A("index.html")
open(p, "w", encoding="utf-8").write(out)
print("built", p, round(os.path.getsize(p) / 1024), "KB")
