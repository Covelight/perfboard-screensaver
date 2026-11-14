/* ===========================================================================
   Perfboard clock — night scene
   The flat perfboard illustration is *relit* in a WebGL2 shader:

     albedo (all LEDs off)  ×  point lights at the lit LEDs
     + height field  -> real normals, so parts have thickness
     + material map  -> solder/copper/plastic/glass respond differently
     + AO map        -> contact shadows where tall parts meet the board
     + emissive & bloom for the LEDs, segments and colons

   Everything outside the board stays pure black.
   =========================================================================== */
(function () {
  'use strict';

  const GEO = window.__GEO__;
  const TEX = window.__TEX__;

  const ALB_W = 1600;
  const ALB_H = Math.round(ALB_W * (GEO.board.view[3] / GEO.board.view[2]));
  const ASPECT = GEO.board.view[2] / GEO.board.view[3];
  // The emissive buffer covers the board *plus* a margin, so an LED halo near
  // the edge is not sliced off by the texture boundary.
  const EPAD = 0.14;                       // margin, as a fraction of the board
  const E_W = 2048;
  const E_H = Math.round(E_W / ASPECT);
  const PADX = Math.round(E_W * EPAD), PADY = Math.round(E_H * EPAD);
  const CW = E_W + PADX * 2, CH = E_H + PADY * 2;
  // uv -> emission uv:  (uv + EPAD) / (1 + 2*EPAD)
  const EMIS_K = 1 / (1 + 2 * EPAD), EMIS_B = EPAD / (1 + 2 * EPAD);
  const VIEW_W = GEO.board.view[2];
  const VIEW_H = GEO.board.view[3];
  const DOME_R = 25.85 / VIEW_W;
  // ---- look variants (driven by ?segStyle= and ?mood=, see the contact sheet)
  const QP = new URLSearchParams(location.search);
  const SEG_STYLE = QP.get('segStyle') || 'classic';      // art | classic | tube
  const MOOD = QP.get('mood') || 'chosen';                // now | pure | bounce | warm | chosen

  // red: 1 = emission forced to the red channel only (RGB with just R on)
  // spill: how much the emitters light the board
  // profile: 0 = even, 1 = softer over the LED band than below the digits
  const MOODS = {
    now:    { red: 0, spill: 0.05, bloom: 0.17, profile: 0 },
    pure:   { red: 1, spill: 0.05, bloom: 0.17, profile: 0 },
    bounce: { red: 1, spill: 0.45, bloom: 0.24, profile: 0 },
    warm:   { red: 0, spill: 1.00, bloom: 0.32, profile: 0 },
    chosen: { red: 1, spill: 0.45, bloom: 0.17, profile: 1 }
  };
  const M = MOODS[MOOD] || MOODS.chosen;
  const RED_ONLY = M.red === 1;
  const SPILL = M.spill;
  const BLOOM_AMT = M.bloom;
  const SPILL_PROFILE = M.profile;
  const PANEL = (() => {                          // ?panel=0|1|2
    const v = parseInt(QP.get('panel'), 10);
    return v === 0 || v === 1 || v === 2 ? v : 1;
  })();
  const DIG_SCALE = (() => {                      // ?digits=1.08 grows the display
    const v = parseFloat(QP.get('digits'));
    return isFinite(v) && v > 0.2 ? v : 1.0;
  })();


  // Classic 7-segment modules are set slightly slanted. Shear every segment
  // polygon (and its centre, which the light list uses) about its own window.
  const SHEAR = -0.13;                       // tan of the lean, ~7.5 degrees
  (function shearDigits() {
    const rowY = GEO.windows.reduce((a, w) => a + w.y + w.h / 2, 0) / GEO.windows.length;
    for (const S2 of GEO.segments) {
      const w = GEO.windows[S2.digit];
      const yc = w ? w.y + w.h / 2 : rowY;
      for (const q of S2.pts) q[0] += SHEAR * (q[1] - yc);
      S2.x += SHEAR * (S2.y - yc);
    }
    for (const C of GEO.colons) C.x += SHEAR * (C.y - rowY);
  })();

  // A generated "classic" display: never mind what the illustration drew, a
  // 7-segment digit is a fixed recipe — chamfered bars, corner gaps, a lean.
  function buildClassicSegments() {
    const Wp = VIEW_W, Hp = VIEW_H, out = [];
    GEO.windows.forEach((w, i) => {
      const cx = (w.x + w.w / 2) * Wp, cy = (w.y + w.h / 2) * Hp;
      const cellH = w.h * Hp;
      const Hd = 0.92 * cellH * DIG_SCALE, Wd = 0.62 * Hd;
      const T = 0.19 * Wd, hh = T / 2, ch = T * 0.45, gp = T * 0.35;
      const L = cx - Wd / 2, R = cx + Wd / 2;
      const Tp = cy - Hd / 2, Bt = cy + Hd / 2, M = cy;
      const hz = (x0, x1, y) => [[x0, y], [x0 + ch, y - hh], [x1 - ch, y - hh],
                                 [x1, y], [x1 - ch, y + hh], [x0 + ch, y + hh]];
      const vt = (y0, y1, x) => [[x, y0], [x + hh, y0 + ch], [x + hh, y1 - ch],
                                 [x, y1], [x - hh, y1 - ch], [x - hh, y0 + ch]];
      const raw = {
        A: hz(L + gp, R - gp, Tp),
        G: hz(L + gp, R - gp, M),
        D: hz(L + gp, R - gp, Bt),
        F: vt(Tp + gp, M - gp, L),
        B: vt(Tp + gp, M - gp, R),
        E: vt(M + gp, Bt - gp, L),
        C: vt(M + gp, Bt - gp, R)
      };
      for (const k in raw) {
        const pts = raw[k].map(([x, y]) => [(x + SHEAR * (y - cy)) / Wp, y / Hp]);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        out.push({
          digit: i, seg: k,
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
          pts, r: (T / 2) / Wp
        });
      }
    });
    return out;
  }

  const SEGLIST = SEG_STYLE === 'classic' ? buildClassicSegments() : GEO.segments;

  // module plates: each display window, grown a little so the plate covers the
  // module's frame as well as its face
  const PLATES = GEO.windows.map(w => [w.x - w.w * 0.05, w.y - w.h * 0.05,
                                       w.w * 1.10, w.h * 1.10]);
  const PLATE_ARR = new Float32Array(PLATES.flat());

  /* ------------------------------------------------------------------ clock */
  const SEGMAP = {
    0: 'ABCDEF', 1: 'BC', 2: 'ABDEG', 3: 'ABCDG', 4: 'BCFG',
    5: 'ACDFG', 6: 'ACDEFG', 7: 'ABC', 8: 'ABCDEFG', 9: 'ABCDFG'
  };
  const digitsOf = d => [Math.floor(d.getHours() / 10), d.getHours() % 10,
                         Math.floor(d.getMinutes() / 10), d.getMinutes() % 10,
                         Math.floor(d.getSeconds() / 10), d.getSeconds() % 10];

  /* ------------------------------------------------------------------- GL */
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: true
  });
  if (!gl) {
    document.body.innerHTML = '<div style="color:#b33;font:14px monospace;padding:2em">' +
      'WebGL2 is not available.</div>';
    return;
  }

  const VERT = `#version 300 es
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const MAXL = 32;

  const FRAG_MAIN = `#version 300 es
  precision highp float;
  out vec4 outColor;

  uniform sampler2D uAlb, uH, uMat, uAO, uEmis, uBloom;
  uniform vec2  uRes, uTexel, uHTexel;
  uniform mat3  uInv;
  uniform vec4  uLights[${MAXL}];
  uniform int   uLightCount;
  uniform float uAspect, uTime, uFlicker, uExposure, uGrain, uVignette;
  uniform float uBump, uLightScale, uParallax, uDof, uAoGain;
  uniform vec3  uTint, uAmbient;
  uniform float uRedOnly, uBloomAmt, uSpillProfile, uOutsideGlow;
  uniform vec4  uWin[${GEO.windows.length}];
  uniform vec2  uEmisKb;
  const float EPADLIM = 0.14;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec2 sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    vec2 s  = sp / uRes;

    vec3 q = uInv * vec3(sp, 1.0);
    vec2 buv = q.xy / q.z;

    // ---------------------------------------------------------------- black
    float edge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
    if (edge < 0.0) {
      // Outside the board. The board is black there, but the emitters still
      // glow over it — clamping the uv and letting the glow decay keeps the
      // picture from ending on a hard black rectangle over the LED halos.
      vec2 cuv = clamp(buv, vec2(-EPADLIM), vec2(1.0 + EPADLIM));
      vec2 euv2 = cuv * uEmisKb.x + uEmisKb.y;
      vec3 e2 = texture(uEmis, euv2).rgb;
      vec3 b2 = texture(uBloom, euv2).rgb;
      if (uRedOnly > 0.5) { e2 = vec3(e2.r, 0.0, 0.0); b2 = vec3(b2.r, 0.0, 0.0); }
      float dd = length(buv - cuv);
      vec3 oc = (e2 + b2 * uBloomAmt) * exp(-dd * 7.5) * uOutsideGlow;
      oc = pow(clamp(aces(oc * uExposure), 0.0, 1.0), vec3(1.0 / 2.2));
      outColor = vec4(oc, 1.0);
      return;
    }

    // ------------------------------------------------- surface, with parallax
    float h0 = texture(uH, buv).r;
    vec2 suv = clamp(buv + (buv - 0.5) * h0 * uParallax, vec2(0.002), vec2(0.998));

    // depth of field: the lens is sharpest on the middle of the board
    float rad = length((s - 0.5) * vec2(uRes.x / uRes.y, 1.0));
    float lod = 0.85 + uDof * rad * rad * 3.0;   // a hair of softness: kills vector crispness

    // The module face is a *plate*: an opaque black rectangle sitting on top
    // of the board. No albedo, no light, no specular inside it — only the
    // emissive bars are drawn over it, exactly like a real display module.
    float plateM = 0.0;
    for (int i = 0; i < ${GEO.windows.length}; i++) {
      vec4 w = uWin[i];
      vec2 a = (buv - w.xy) / w.zw;
      vec2 dd2 = min(a, 1.0 - a);
      plateM = max(plateM, smoothstep(-0.0035, 0.0035, min(dd2.x, dd2.y)));
    }
    float plateK = 1.0 - plateM;

    vec3 albS = textureLod(uAlb, suv, lod).rgb;
    vec3 alb = pow(albS, vec3(2.2));
    alb = mix(alb, vec3(dot(alb, vec3(0.30, 0.59, 0.11))), 0.16);
    vec3 mat = texture(uMat, suv).rgb;
    float ao = mix(1.0, texture(uAO, suv).r, uAoGain);

    float rough = clamp(mat.r, 0.06, 1.0);
    float specTint = mat.g;
    float metal = mat.b;

    // ------------------------------------------------------------ normals
    vec2 ht = uHTexel * 1.6;
    float hL = texture(uH, buv - vec2(ht.x, 0.0)).r;
    float hR = texture(uH, buv + vec2(ht.x, 0.0)).r;
    float hU = texture(uH, buv - vec2(0.0, ht.y)).r;
    float hD = texture(uH, buv + vec2(0.0, ht.y)).r;
    vec2 g = clamp(vec2(hL - hR, hU - hD) * uBump, vec2(-1.4), vec2(1.4));
    vec3 N = normalize(vec3(g, 1.0));

    vec2 p = vec2(buv.x * uAspect, buv.y);

    // -------------------------------------------------------------- lights
    float sExp = mix(260.0, 5.0, rough);
    vec3 diff = vec3(0.0), spec = vec3(0.0);
    // the board under the LED matrix gets ~half the light the area below the
    // digits does: the emitters are tiny points, their reach should fall off
    float spillShape = mix(1.0, mix(0.49, 1.0, smoothstep(0.08, 0.62, buv.y)), uSpillProfile);

    for (int i = 0; i < ${MAXL}; i++) {
      if (i >= uLightCount) break;
      vec4 L = uLights[i];
      vec2 d = p - vec2(L.x * uAspect, L.y);
      float d2 = dot(d, d);
      float att = L.z * uLightScale / (d2 + 0.00018) * exp(-d2 * 21.0);
      float lz = 0.035 + L.w * 0.14;
      vec3 dir = normalize(vec3(-d, lz));

      float ndl = dot(N, dir);
      float wrap = clamp((ndl + 0.30) / 1.30, 0.0, 1.0);
      diff += uTint * att * wrap * spillShape;

      vec3 H = normalize(dir + vec3(0.0, 0.0, 1.0));
      float sp = pow(max(dot(N, H), 0.0), sExp) * (sExp + 8.0) * 0.0038;
      spec += uTint * att * sp * specTint * (0.25 + 0.75 * metal) * (0.6 + 0.4 * h0) * spillShape;
    }

    // ------------------------------------------------------------- ambient
    vec3 amb = uAmbient * (0.35 + 0.65 * max(N.z, 0.0)) * (1.10 - 0.30 * N.y);
    // a whisper of off-camera key light: without it a spill-free board goes flat
    vec3 keyDir = normalize(vec3(-0.38, -0.52, 0.76));
    amb += vec3(0.016, 0.014, 0.017) * max(dot(N, keyDir), 0.0);

    // ------------------------------------------------------- emissive/bloom
    vec2 euv = buv * uEmisKb.x + uEmisKb.y;
    vec3 emis = texture(uEmis, euv).rgb;
    vec2 ca = (s - 0.5) * 0.0013 * dot(s - 0.5, s - 0.5) * 4.0;
    emis = vec3(texture(uEmis, euv + ca).r, emis.g, texture(uEmis, euv - ca).b);
    vec3 bloom = texture(uBloom, euv).rgb;
    emis *= uFlicker;
    bloom *= uFlicker;
    if (uRedOnly > 0.5) {           // pure R, like an RGB strip with only red on
      emis = vec3(emis.r, 0.0, 0.0);
      bloom = vec3(bloom.r, 0.0, 0.0);
    }

    // board surface dissolves at the edges; the glow does not, otherwise LEDs
    // near the border sit in a black shadow
    float eDist = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y) / uAspect);
    float fade = smoothstep(0.0, 0.13, eDist);
    fade *= fade;

    vec3 surf = (alb * (amb + diff) * ao + spec * ao) * plateK * fade;
    vec3 glow = (emis + bloom * uBloomAmt) * mix(0.82, 1.0, fade);
    vec3 col = surf + glow;

    col *= uExposure;
    col = aces(col);
    col = pow(col, vec3(1.0 / 2.2));
    // ACES pushes bright reds towards orange; pull the chroma back so the LEDs
    // stay red instead of drifting to amber
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = clamp(mix(vec3(lum), col, 1.62), 0.0, 1.0);

    // ------------------------------------------------------------ film
    float vig = 1.0 - uVignette * smoothstep(0.28, 1.05, length((s - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
    col *= mix(1.0, vig, smoothstep(0.0, 0.0015, edge));

    float gr = hash(sp + fract(uTime) * 371.0) - 0.5;
    col += gr * uGrain * fade * (1.0 - 0.6 * dot(col, vec3(0.3, 0.6, 0.1)));

    outColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

  const FRAG_BLUR = `#version 300 es
  precision highp float;
  out vec4 outColor;
  uniform sampler2D uT;
  uniform vec2 uStep, uRes;
  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
    vec3 c = texture(uT, uv).rgb * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 o = uStep * float(i);
      c += texture(uT, uv + o).rgb * w[i];
      c += texture(uT, uv - o).rgb * w[i];
    }
    outColor = vec4(c, 1.0);
  }`;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    return p;
  }
  const pMain = prog(FRAG_MAIN);
  const pBlur = prog(FRAG_BLUR);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const uM = {
    alb: U(pMain, 'uAlb'), h: U(pMain, 'uH'), mat: U(pMain, 'uMat'),
    ao: U(pMain, 'uAO'), emis: U(pMain, 'uEmis'), bloom: U(pMain, 'uBloom'),
    res: U(pMain, 'uRes'), texel: U(pMain, 'uTexel'), htexel: U(pMain, 'uHTexel'),
    inv: U(pMain, 'uInv'), lights: U(pMain, 'uLights[0]'), nLights: U(pMain, 'uLightCount'),
    aspect: U(pMain, 'uAspect'), time: U(pMain, 'uTime'), flicker: U(pMain, 'uFlicker'),
    exposure: U(pMain, 'uExposure'), grain: U(pMain, 'uGrain'), vignette: U(pMain, 'uVignette'),
    bump: U(pMain, 'uBump'), lscale: U(pMain, 'uLightScale'),
    parallax: U(pMain, 'uParallax'), dof: U(pMain, 'uDof'), aoGain: U(pMain, 'uAoGain'),
    tint: U(pMain, 'uTint'), ambient: U(pMain, 'uAmbient'),
    redOnly: U(pMain, 'uRedOnly'), bloomAmt: U(pMain, 'uBloomAmt'),
    spillProfile: U(pMain, 'uSpillProfile'), outsideGlow: U(pMain, 'uOutsideGlow'),
    win: U(pMain, 'uWin[0]'), emisKb: U(pMain, 'uEmisKb')
  };
  const uB = { t: U(pBlur, 'uT'), step: U(pBlur, 'uStep'), res: U(pBlur, 'uRes') };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  function makeTex(w, h, mip) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeFBO(tex) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }

  const texEmis = makeTex(CW, CH, false);
  const BW = Math.round(CW / 4), BH2 = Math.round(CH / 4);
  const texA = makeTex(BW, BH2, false), texB = makeTex(BW, BH2, false);
  const fboA = makeFBO(texA), fboB = makeFBO(texB);

  let texAlb = null, texH = null, texMat = null, texAO = null;
  let HW = 1000, HH = 1256;

  function uploadImage(tex, img, mip) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  }

  /* ------------------------------------------------------- emissive paint */
  const ec = document.createElement('canvas');
  ec.width = CW; ec.height = CH;
  const ex = ec.getContext('2d');
  const S = E_W / VIEW_W;
  const domePx = 25.85 * S;

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * E_W, pts[0][1] * E_H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * E_W, pts[i][1] * E_H);
    ctx.closePath();
  }
  function radial(ctx, x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  // Fit a capsule to a segment polygon: PCA for the long axis, then take the
  // extreme projections as the two end points and the perpendicular extent as
  // the tube radius (slightly fattened, real bars are chunkier than schematics).
  function capsuleOf(pts) {
    const n = pts.length;
    let mx = 0, my = 0;
    for (const q of pts) { mx += q[0]; my += q[1]; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const q of pts) {
      const dx = q[0] - mx, dy = q[1] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(th), uy = Math.sin(th);
    let tmin = 1e9, tmax = -1e9, wmax = 0;
    for (const q of pts) {
      const dx = q[0] - mx, dy = q[1] - my;
      const t = dx * ux + dy * uy, w = Math.abs(-dx * uy + dy * ux);
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
      if (w > wmax) wmax = w;
    }
    const r = Math.max(wmax * 1.46, (tmax - tmin) * 0.040);
    // pull the end points in so the round caps land on the chamfered ends
    return { a: [mx + ux * (tmin + r * 0.52), my + uy * (tmin + r * 0.52)],
             b: [mx + ux * (tmax - r * 0.52), my + uy * (tmax - r * 0.52)],
             r: r };
  }

  function paintEmissive(leds, segs, colons) {
    ex.setTransform(1, 0, 0, 1, 0, 0);
    ex.globalCompositeOperation = 'source-over';
    ex.fillStyle = '#000';
    ex.fillRect(0, 0, CW, CH);
    ex.globalCompositeOperation = 'lighter';
    ex.setTransform(1, 0, 0, 1, PADX, PADY);   // board uv starts at the margin

    // ---------------------------------------------------------- LEDs
    for (const L of GEO.leds) {
      const b = leds[L.col + ':' + L.bit];
      if (b < 0.004) continue;
      const x = L.x * E_W, y = L.y * E_H, r = domePx;

      // air glow — the part of the look that stays over the black background
      radial(ex, x, y, r * 3.3, [
        [0.00, `rgba(255,20,6,${0.15 * b})`],
        [0.16, `rgba(250,12,3,${0.055 * b})`],
        [0.45, `rgba(220,8,2,${0.016 * b})`],
        [1.00, 'rgba(180,5,1,0)']]);

      // the dome: hot die, deep red plastic to the rim (no orange, no yellow)
      const dy = -r * 0.14;
      const dg = ex.createRadialGradient(x, y + dy, r * 0.04, x, y + dy, r * 1.04);
      dg.addColorStop(0.00, `rgba(255,40,18,${1.00 * b})`);
      dg.addColorStop(0.16, `rgba(255,38,18,${0.99 * b})`);
      dg.addColorStop(0.34, `rgba(248,20,8,${0.97 * b})`);
      dg.addColorStop(0.62, `rgba(214,11,4,${0.94 * b})`);
      dg.addColorStop(0.85, `rgba(160,7,2,${0.90 * b})`);
      dg.addColorStop(1.00, `rgba(104,4,1,${0.84 * b})`);
      ex.fillStyle = dg;
      ex.beginPath(); ex.arc(x, y, r * 1.04, 0, 6.2832); ex.fill();
    }

    // ----------------------------------------------- unlit segments (panel 1+)
    // A real module shows all seven bars as dark red plastic even when off.
    if (PANEL >= 1) {
      ex.lineCap = 'butt';
      for (const S2 of SEGLIST) {
        const b = segs[S2.digit + S2.seg];
        if (b >= 0.06) continue;
        const cap = capsuleOf(S2.pts);
        const rH = (S2.r !== undefined ? S2.r : cap.r) * E_W;
        poly(ex, S2.pts);
        ex.fillStyle = 'rgba(3,0.35,0.2,0.70)';
        ex.fill();
        ex.beginPath();
        ex.moveTo(cap.a[0] * E_W, cap.a[1] * E_H);
        ex.lineTo(cap.b[0] * E_W, cap.b[1] * E_H);
        ex.lineWidth = rH * 1.5;
        ex.strokeStyle = 'rgba(6,0.8,0.4,0.30)';
        ex.stroke();
      }
    }

    // ------------------------------------------------------------ segments
    // Three ways to make a bar, switchable for the contact sheet:
    //   art      the drawn polygon, fattened, hot line down the middle
    //   classic  a generated 7-segment bar: hard edges, chamfered ends, lean
    //   tube     rounded capsule strokes only, no polygon (soft, neon-ish)
    for (const S2 of SEGLIST) {
      const b = segs[S2.digit + S2.seg];
      if (b < 0.004) continue;
      const cap = capsuleOf(S2.pts);
      const ax = cap.a[0] * E_W, ay = cap.a[1] * E_H;
      const bx = cap.b[0] * E_W, by = cap.b[1] * E_H;
      const r = cap.r * E_W;
      const rH = (S2.r !== undefined ? S2.r : cap.r) * E_W;   // true half-thickness

      const line = () => { ex.beginPath(); ex.moveTo(ax, ay); ex.lineTo(bx, by); };
      const tube = (w, col, al) => {
        ex.lineWidth = w; ex.strokeStyle = `rgba(${col},${al * b})`; ex.stroke();
      };

      if (SEG_STYLE === 'tube') {
        // soft rounded tube: strokes only
        const rt = rH * 1.25;
        ex.lineCap = 'round';
        line();
        tube(rt * 4.0, '200,10,3', 0.030);
        tube(rt * 2.2, '235,14,4', 0.070);
        tube(rt * 1.55, '255,18,6', 0.66);
        tube(rt * 0.75, '255,44,16', 0.52);
        tube(rt * 0.30, '255,70,36', 0.30);
      } else if (SEG_STYLE === 'classic') {
        // crisp generated bar: hard polygon, butt caps, tight halo
        ex.lineCap = 'butt';
        ex.lineJoin = 'miter';
        line();
        tube(rH * 3.8, '210,8,2', 0.016);
        tube(rH * 2.2, '240,11,3', 0.034);
        poly(ex, S2.pts);
        ex.fillStyle = `rgba(255,14,3,${1.00 * b})`;
        ex.fill();
        line();                                   // slightly hotter spine
        tube(rH * 0.95, '255,34,12', 0.42);
      } else {
        // the drawn polygon, fattened across and pulled back along
        const WF = 1.92, LF = 0.90;
        const r2 = r * WF;
        ex.lineCap = 'round';
        ex.lineJoin = 'round';
        line();
        tube(r2 * 2.6, '200,8,2', 0.016);
        tube(r2 * 1.5, '240,11,3', 0.038);

        const ux = cap.b[0] - cap.a[0], uy = cap.b[1] - cap.a[1];
        const ul = Math.hypot(ux, uy) || 1;
        const dx = ux / ul, dy = uy / ul, nx = -dy, ny = dx;
        const grown = S2.pts.map(q => {
          const px = q[0] - S2.x, py = q[1] - S2.y;
          const t = (px * dx + py * dy) * LF, w = (px * nx + py * ny) * WF;
          return [S2.x + dx * t + nx * w, S2.y + dy * t + ny * w];
        });
        poly(ex, grown);
        ex.fillStyle = `rgba(255,14,3,${1.00 * b})`;
        ex.fill();

        line();
        tube(r2 * 1.05, '255,30,10', 0.60);
        tube(r2 * 0.38, '255,48,20', 0.20);
      }
    }

    // --------------------------------------------------- module bezel (panel 2)
    if (PANEL >= 2) {
      ex.lineCap = 'butt';
      ex.lineJoin = 'miter';
      for (const W2 of GEO.windows) {
        ex.strokeStyle = 'rgba(96,7,3,0.055)';
        ex.lineWidth = E_W * 0.0022;
        ex.strokeRect(W2.x * E_W, W2.y * E_H, W2.w * E_W, W2.h * E_H);
      }
    }

    // -------------------------------------------------------------- colons
    for (const C of GEO.colons) {
      const b = colons.b;
      if (b < 0.004) continue;
      const x = C.x * E_W, y = C.y * E_H, r = E_W * 0.0042;
      radial(ex, x, y, r * 7.0, [[0, `rgba(230,20,7,${0.09 * b})`],
                                 [0.4, `rgba(210,14,5,${0.03 * b})`],
                                 [1, 'rgba(200,12,4,0)']]);
      radial(ex, x, y, r * 2.4, [[0, `rgba(250,34,12,${0.72 * b})`],
                                 [1, 'rgba(235,24,8,0)']]);
      radial(ex, x, y, r * 1.0, [[0, `rgba(255,118,80,${0.92 * b})`],
                                 [0.55, `rgba(250,56,24,${0.72 * b})`],
                                 [1, 'rgba(230,26,10,0)']]);
    }

    gl.bindTexture(gl.TEXTURE_2D, texEmis);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ec);
  }

  function runBloom() {
    gl.bindVertexArray(vao);
    gl.useProgram(pBlur);
    gl.uniform2f(uB.res, BW, BH2);
    gl.viewport(0, 0, BW, BH2);
    const pass = (src, dst, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(uB.t, 0);
      gl.uniform2f(uB.step, dx / BW, dy / BH2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(texEmis, fboA, 0, 0);
    pass(texA, fboB, 1.1, 0); pass(texB, fboA, 0, 1.1);
    pass(texA, fboB, 2.8, 0); pass(texB, fboA, 0, 2.8);
    pass(texA, fboB, 6.0, 0); pass(texB, fboA, 0, 6.0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* --------------------------------------------------------------- camera */
  let uInv = new Float32Array(9);

  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
            C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  /* View framing: zoom 1 = the board fitted to the window, ox/oy shift it in
     fractions of the screen. The screensaver drives this from its config. */
  const view = { zoom: 1, ox: 0, oy: 0 };
  (function readViewParams() {
    let q = '';
    try { q = location.search || ''; } catch (e) { q = ''; }
    const par = new URLSearchParams(q);
    const num = (k, d) => { const v = parseFloat(par.get(k)); return isFinite(v) ? v : d; };
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    view.zoom = cl(num('zoom', 0.40), 0.15, 6);
    view.ox = cl(num('ox', 0), -1, 1);
    view.oy = cl(num('oy', 0), -1, 1);
  })();
  window.PB_VIEW = view;
  window.setView = function (z, x, y) {
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    if (typeof z === 'number' && isFinite(z)) view.zoom = cl(z, 0.15, 6);
    if (typeof x === 'number' && isFinite(x)) view.ox = cl(x, -1, 1);
    if (typeof y === 'number' && isFinite(y)) view.oy = cl(y, -1, 1);
    resize();
    needPaint = true;
    if (window.__READY__) frame(performance.now());   // repaint right away
    return { zoom: view.zoom, ox: view.ox, oy: view.oy };
  };

  // which slice of the board the camera points at (uv rect). The default is the
  // band that actually has something in it: LED matrix + display. The empty
  // lower half of the board is deliberately out of frame.
  const FIT = (() => {
    const q = new URLSearchParams(location.search).get('fit');
    if (q) {
      const a = q.split(',').map(Number);
      if (a.length === 4 && a.every(isFinite)) return a;
    }
    return [0.03, 0.015, 0.97, 0.50];
  })();
  let driftTime = 0;

  function setCamera(W, H) {
    const rw = (FIT[2] - FIT[0]) * VIEW_W, rh = (FIT[3] - FIT[1]) * VIEW_H;
    const sc = Math.min((W * 0.985) / rw, (H * 0.985) / rh);
    const bw = VIEW_W * sc, bh = VIEW_H * sc;
    const rcx = (FIT[0] + FIT[2]) * 0.5 * VIEW_W, rcy = (FIT[1] + FIT[3]) * 0.5 * VIEW_H;
    const ox0 = W * 0.5 - rcx * sc, oy0 = H * 0.5 - rcy * sc;
    const cx = W * 0.5, cy = H * 0.5;
    let c = [[ox0, oy0], [ox0 + bw, oy0],
             [ox0 + bw, oy0 + bh], [ox0, oy0 + bh]];
    const k = 0.020;
    c[0][0] += bw * k * 0.9; c[0][1] += bh * k * 0.5;
    c[1][0] -= bw * k * 0.9; c[1][1] += bh * k * 0.5;
    c[2][0] -= bw * k * 0.15; c[3][0] += bw * k * 0.15;
    const th = -0.6 * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    c = c.map(([x, y]) => {
      const dx = (x - cx) / W, dy = (y - cy) / H;
      return [cx + (dx * ct - dy * st) * W, cy + (dx * st + dy * ct) * H];
    });
    // zoom about the centre, then shift — this is what the config drives
    const z = view.zoom, px = view.ox * W, py = view.oy * H;
    // live-camera drift: a locked-off shot that never sits perfectly still
    const tt = driftTime;
    const ddx = (Math.sin(tt * 0.113) * 0.0017 + Math.sin(tt * 0.041 + 1.7) * 0.0011) * W;
    const ddy = (Math.cos(tt * 0.087) * 0.0015 + Math.sin(tt * 0.31 + 0.4) * 0.0005) * H;
    const rot = Math.sin(tt * 0.049) * 0.00085;
    const ct2 = Math.cos(rot), st2 = Math.sin(rot);
    c = c.map(([x, y]) => {
      const X = cx + (x - cx) * z + px, Y = cy + (y - cy) * z + py;
      const rx = X - cx, ry = Y - cy;
      return [cx + rx * ct2 - ry * st2 + ddx, cy + rx * st2 + ry * ct2 + ddy];
    });
    const [p0, p1, p2, p3] = c;
    const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0],
          dx3 = p0[0] - p1[0] + p2[0] - p3[0];
    const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1],
          dy3 = p0[1] - p1[1] + p2[1] - p3[1];
    const det = dx1 * dy2 - dx2 * dy1;
    let g = 0, hh = 0;
    if (Math.abs(det) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / det; hh = (dx1 * dy3 - dx3 * dy1) / det; }
    const M = [p1[0] - p0[0] + g * p1[0], p3[0] - p0[0] + hh * p3[0], p0[0],
               p1[1] - p0[1] + g * p1[1], p3[1] - p0[1] + hh * p3[1], p0[1],
               g, hh, 1];
    const I = invert3(M);
    uInv = new Float32Array([I[0], I[3], I[6], I[1], I[4], I[7], I[2], I[5], I[8]]);
  }

  let maxW = 2400;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    const cap = Math.min(1, maxW / w);
    w = Math.round(w * cap); h = Math.round(h * cap);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    setCamera(w, h);
  }
  window.addEventListener('resize', resize);

  /* --------------------------------------------------------------- lights */
  const lights = new Float32Array(MAXL * 4);
  let nLights = 0;

  function buildLights(leds, segs, colons) {
    nLights = 0;
    const push = (x, y, i, r) => {
      if (nLights >= MAXL || i <= 0.002) return;
      lights[nLights * 4] = x; lights[nLights * 4 + 1] = y;
      lights[nLights * 4 + 2] = i; lights[nLights * 4 + 3] = r;
      nLights++;
    };
    // LEDs and bars are emitters, not lamps: they light nothing but themselves.
    for (const L of GEO.leds) {
      const b = leds[L.col + ':' + L.bit];
      push(L.x, L.y, b * 1.30 * SPILL, DOME_R * 0.9);
    }
    for (let i = 0; i < GEO.windows.length; i++) {
      let n = 0;
      for (const S2 of SEGLIST) if (S2.digit === i && segs[S2.digit + S2.seg] > 0.5) n++;
      const W2 = GEO.windows[i];
      push(W2.x + W2.w / 2, W2.y + W2.h / 2, (0.24 + 0.16 * n) * SPILL, W2.w * 0.9);
    }
    for (const C of GEO.colons) push(C.x, C.y, 0.12 * colons.b * SPILL, 0.02);
  }

  /* ---------------------------------------------------------------- state */
  const cur = Object.create(null), flash = Object.create(null);
  let lastPaint = 0, needPaint = true;

  function targetState(t) {
    const dg = digitsOf(t);
    const ledT = {}, segT = {};
    for (let c = 0; c < 6; c++) {
      const v = dg[c];
      for (const L of GEO.leds) {
        if (L.col !== c) continue;
        ledT[L.col + ':' + L.bit] = (v >> L.bit) & 1 ? 1 : 0;
      }
    }
    for (const S2 of SEGLIST) {
      segT[S2.digit + S2.seg] = SEGMAP[dg[S2.digit]].indexOf(S2.seg) >= 0 ? 1 : 0;
    }
    const ms = t.getMilliseconds();
    const ph = (t.getSeconds() % 2) + ms / 1000;
    const colonB = (t.getSeconds() % 2 === 0) ? Math.min(1, Math.sin(Math.min(ph, 1) * Math.PI) * 2.4) : 0;
    return { leds: ledT, segs: segT, colons: { b: colonB } };
  }

  /* ----------------------------------------------------------------- loop */
  let fixedTime = null;
  const params = new URLSearchParams(location.search);
  if (params.get('t')) {
    const [H2, M2, S2] = params.get('t').split(':').map(Number);
    fixedTime = new Date(2026, 0, 1, H2 || 0, M2 || 0, S2 || 0);
  }
  if (params.get('scale')) maxW = Number(params.get('scale')) * 2000;

  const t0 = performance.now();
  let flick = 1;

  const driftOn = params.get('still') !== '1';

  function frame(now) {
    resize();
    const dt = Math.min(0.05, (now - lastPaint) / 1000);
    lastPaint = now;
    if (driftOn) {
      driftTime = (now - t0) / 1000;
      setCamera(canvas.width, canvas.height);   // the camera breathes every frame
    }

    const t = fixedTime || new Date();
    const T = targetState(t);

    let changed = 0;
    const keys = [];
    for (const k in T.leds) keys.push(['l', k, T.leds[k]]);
    for (const k in T.segs) keys.push(['s', k, T.segs[k]]);

    const ease = 1 - Math.exp(-dt / 0.055);
    for (const [kind, k, tv] of keys) {
      const id = kind + k;
      const c0 = cur[id] === undefined ? tv : cur[id];
      let c1 = c0 + (tv - c0) * ease;
      if (Math.abs(c1 - tv) < 0.004) c1 = tv;
      cur[id] = c1;
      if (c1 > (flash[id] || 0)) flash[id] = c1;
      flash[id] *= Math.exp(-dt / 0.055);
      if (Math.abs(c1 - c0) > 0.004) changed = 1;
    }
    const cb0 = cur.colonB === undefined ? T.colons.b : cur.colonB;
    let cb1 = cb0 + (T.colons.b - cb0) * ease;
    if (Math.abs(cb1 - T.colons.b) < 0.01) cb1 = T.colons.b;
    if (Math.abs(cb1 - cb0) > 0.01) changed = 1;
    cur.colonB = cb1;

    flick += (1 + (Math.random() - 0.5) * 0.035 - flick) * 0.35;

    if (changed || needPaint) {
      needPaint = false;
      const ledsV = {}, segsV = {};
      const tw = (id2, base) => driftOn
        ? base * (1 + 0.045 * Math.sin(driftTime * 4.7 + id2 * 2.39)
                    + 0.02 * Math.sin(driftTime * 11.3 + id2 * 5.11))
        : base;
      let hi = 0;
      for (const k in T.leds) {
        const id = 'l' + k;
        hi++;
        ledsV[k] = tw(hi, Math.min(1.4, (cur[id] || 0) + (flash[id] || 0) * 0.14));
      }
      for (const k in T.segs) {
        const id = 's' + k;
        segsV[k] = Math.min(1.3, (cur[id] || 0) + (flash[id] || 0) * 0.10);
      }
      paintEmissive(ledsV, segsV, { b: cur.colonB });
      runBloom();
      buildLights(ledsV, segsV, { b: cur.colonB });
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(pMain);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texAlb); gl.uniform1i(uM.alb, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texH); gl.uniform1i(uM.h, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texMat); gl.uniform1i(uM.mat, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, texAO); gl.uniform1i(uM.ao, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, texEmis); gl.uniform1i(uM.emis, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, texA); gl.uniform1i(uM.bloom, 5);
    gl.uniform2f(uM.res, canvas.width, canvas.height);
    gl.uniform2f(uM.texel, 1 / ALB_W, 1 / ALB_H);
    gl.uniform2f(uM.htexel, 1 / HW, 1 / HH);
    gl.uniformMatrix3fv(uM.inv, false, uInv);
    gl.uniform4fv(uM.lights, lights);
    gl.uniform1i(uM.nLights, nLights);
    gl.uniform1f(uM.aspect, ASPECT);
    gl.uniform1f(uM.time, (now - t0) / 1000);
    gl.uniform1f(uM.flicker, fixedTime ? 1 : flick);
    gl.uniform1f(uM.exposure, 1.06);
    gl.uniform1f(uM.grain, 0.022);
    gl.uniform1f(uM.vignette, 0.35);
    gl.uniform1f(uM.bump, 4.2);
    gl.uniform1f(uM.lscale, 0.0024);
    gl.uniform1f(uM.parallax, 0.045);
    gl.uniform1f(uM.dof, 1.5 * (driftOn ? (1 + 0.10 * Math.sin(driftTime * 0.37)) : 1));
    gl.uniform1f(uM.aoGain, 0.95);
    gl.uniform3f(uM.tint, 1.0, 0.115, 0.045);
    gl.uniform3f(uM.ambient, 0.0105, 0.0098, 0.0125);
    gl.uniform1f(uM.redOnly, RED_ONLY ? 1 : 0);
    gl.uniform1f(uM.bloomAmt, BLOOM_AMT);
    gl.uniform1f(uM.spillProfile, SPILL_PROFILE);
    gl.uniform1f(uM.outsideGlow, 1.0);
    gl.uniform2f(uM.emisKb, EMIS_K, EMIS_B);
    gl.uniform4fv(uM.win, PLATE_ARR);   // plates cover window + frame
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- load */
  let pending = 4;
  const done = () => { if (--pending === 0) { window.__READY__ = true; requestAnimationFrame(frame); } };

  function loadTex(src, mip, cb) {
    const img = new Image();
    img.onload = () => { cb(img); done(); };
    img.src = src;
  }

  texAlb = makeTex(ALB_W, ALB_H, true);
  loadTex(TEX.albedo, true, img => uploadImage(texAlb, img, true));

  loadTex(TEX.height, false, img => {
    HW = img.naturalWidth; HH = img.naturalHeight;
    texH = makeTex(HW, HH, false);
    uploadImage(texH, img, false);
  });
  texMat = makeTex(1000, 1256, false);
  loadTex(TEX.material, false, img => uploadImage(texMat, img, false));
  texAO = makeTex(1000, 1256, false);
  loadTex(TEX.ao, false, img => uploadImage(texAO, img, false));

  // placeholders so the first draw has all six units bound
  texH = texH || makeTex(4, 5, false);
  texMat = texMat || makeTex(4, 5, false);
  texAO = texAO || makeTex(4, 5, false);
})();
