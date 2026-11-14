How it works

Two programs live in one 1.9 MB file: **a scene** (one HTML page, WebGL2) and **a host**
(C# WinForms + WebView2). The host does windows, monitors and settings; the scene does
everything you actually look at.

```
PerfboardSaver.scr                       .NET Framework 4.8, x64, one file
└── Program.Main  /s | /c | /p
    ├── ClockForm                        one borderless window, on the clock display
    │   └── WebView2
    │       └── scene.html               embedded resource, 1.14 MB
    │           └── WebGL2               one fragment shader does the relight
    └── BlackForm  × N                   one per remaining display, pure #000000
```

Four maps, one flat drawing

The illustration is one flat drawing plus four
greyscale/colour maps, all baked into `index.html` as base64 JPEG data URIs (1.1 MB of the
1.14 MB):

| Map | Size | What it encodes |
| --- | --- | --- |
| `assets/albedo.jpg` | 1200 × 1514 | the board with **every LED off** — colour, silkscreen, tin, copper |
| `assets/height.jpg` | 1000 × 1262 | part heights → normals, so components have thickness |
| `assets/material.jpg` | 1000 × 1256 | `r` roughness, `g` specular tint, `b` metalness, per pixel |
| `assets/ao.jpg` | 700 × 883 | contact shadows where tall parts meet the board |

Everything else is derived at runtime. That is why the file is small.

All four are rasterised from **one flat SVG illustration**, `assets/perfboard_topview.svg`, and the
scripts that do it are in `tools/`

Where to change what

| Thing | Where |
| --- | --- |
| brightness, bump, light falloff, DOF, grain, vignette | `src/app.js`, the `uM.*` uniforms in `frame()` |
| framing / crop | `FIT` in `src/app.js` (or `?fit=x0,y0,x1,y1`) |
| bar shape, lean, halo | `paintEmissive()` and the `tube()` alphas |
| look variants | `?segStyle=`, `?mood=`, `?panel=`, `?digits=` |
| segment geometry, LED positions, colons | `assets/geometry.json` |
| the drawing itself | `assets/albedo.jpg` + the three maps, then `build.py` |
| the four maps | `assets/perfboard_topview.svg` is the source — see [regenerating the artwork](../README.md#regenerating-the-artwork) |
| monitors, scale, position | `host/PerfboardSaver/Program.cs`, `SettingsForm.cs` |
| the offline guarantees | `Program.cs`, the WebView2 environment flags + resource filter |

