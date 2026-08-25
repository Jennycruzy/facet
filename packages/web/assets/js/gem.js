// A low-poly brilliant cut, rendered with canvas 2D: painter's algorithm, flat shading,
// exact face picking. No WebGL, no dependencies, ~40 faces generated procedurally so the
// face count is a parameter rather than an asset.

const TAU = Math.PI * 2;

function ring(n, radius, y, offset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + offset) / n) * TAU;
    out.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
  }
  return out;
}

// Table, crown mains, upper girdle halves, pavilion mains, culet fan.
export function brilliantCut(n = 8) {
  const table = ring(n, 0.52, 0.55);
  const upper = ring(n, 0.86, 0.28);
  const girdle = ring(n, 1.0, 0.0, 0.5);
  const pav = ring(n, 0.6, -0.5);
  const culet = [0, -1.15, 0];

  const verts = [...table, ...upper, ...girdle, ...pav, culet];
  const T = 0, U = n, G = 2 * n, P = 3 * n, C = 4 * n;
  const faces = [];
  const push = (idx, kind) => faces.push({ idx, kind });

  push([...Array(n).keys()].map((i) => T + i).reverse(), "table");
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push([T + i, T + j, U + j, U + i], "crown");        // crown main
    push([U + i, U + j, G + i], "upper");               // upper girdle half
    push([G + (i + n - 1) % n, G + i, U + i], "upper"); // its neighbour
    push([G + i, G + j, P + j], "pavilion");
    push([P + i, P + j, G + i], "pavilion");
    push([P + i, C, P + j], "culet");
  }
  return { verts, faces };
}

const BASE = {
  table: [46, 66, 122],
  crown: [34, 52, 104],
  upper: [26, 42, 88],
  pavilion: [19, 32, 72],
  culet: [13, 23, 56],
};

export function createGem(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const { verts, faces } = brilliantCut(opts.segments ?? 8);
  const litMap = new Map(); // face index -> facet record
  const state = { rx: -0.32, ry: 0.6, spin: 0.0016, hover: -1, visible: true, dragging: false };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let projected = [];
  let order = [];
  let dpr = 1;
  let size = 0;

  if (reduced) state.spin = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.max(1, Math.min(rect.width, rect.height));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }

  function project() {
    const cx = Math.cos(state.rx), sx = Math.sin(state.rx);
    const cy = Math.cos(state.ry), sy = Math.sin(state.ry);
    const scale = size * 0.38;
    const half = size / 2;
    projected = verts.map(([x, y, z]) => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y1 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      const persp = 3.2 / (3.2 - z2);
      return { x: half + x1 * scale * persp, y: half - y1 * scale * persp, z: z2 };
    });
    order = faces
      .map((f, i) => ({ i, z: f.idx.reduce((s, v) => s + projected[v].z, 0) / f.idx.length }))
      .sort((a, b) => a.z - b.z)
      .map((o) => o.i);
  }

  function normalZ(face) {
    const [a, b, c] = face.idx.map((i) => projected[i]);
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function shade(face, i) {
    const [a, b, c] = face.idx.map((i2) => verts[i2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1];
    let ny = u[2] * v[0] - u[0] * v[2];
    let nz = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const cy = Math.cos(state.ry), sy = Math.sin(state.ry);
    const cx = Math.cos(state.rx), sx = Math.sin(state.rx);
    const wx = nx * cy - nz * sy;
    const wz1 = nx * sy + nz * cy;
    const wy = ny * cx - wz1 * sx;
    const lambert = Math.max(0, wx * 0.34 + wy * 0.62 + 0.52);
    const lit = litMap.get(i);
    const base = BASE[face.kind] ?? BASE.crown;
    if (lit) {
      const glow = state.hover === i ? 1.15 : 0.98;
      const r = Math.min(255, 150 + 105 * lambert * glow);
      const g = Math.min(255, 196 + 59 * lambert * glow);
      const bl = Math.min(255, 232 + 23 * lambert * glow);
      return `rgb(${r | 0}, ${g | 0}, ${bl | 0})`;
    }
    const k = 0.52 + Math.min(lambert, 0.85) * 0.72;
    return `rgb(${(base[0] * k) | 0}, ${(base[1] * k) | 0}, ${(base[2] * k) | 0})`;
  }

  function draw() {
    project();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);
    for (const i of order) {
      const face = faces[i];
      if (normalZ(face) <= 0) continue; // back-facing
      ctx.beginPath();
      face.idx.forEach((v, k) => {
        const p = projected[v];
        k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = shade(face, i);
      if (litMap.has(i)) {
        ctx.save();
        ctx.shadowColor = "rgba(120, 170, 255, .75)";
        ctx.shadowBlur = state.hover === i ? 34 : 22;
        ctx.fill();
        ctx.restore();
      }
      ctx.fill();
      ctx.strokeStyle = litMap.has(i) ? "rgba(210,230,255,.75)" : "rgba(255,255,255,.07)";
      ctx.lineWidth = litMap.has(i) ? 1.1 : 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  let raf = null;
  let last = 0;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!state.visible) return;
    if (t - last < 33) return; // cap ~30fps; this must not heat a laptop
    last = t;
    if (!state.dragging && state.spin) state.ry += state.spin;
    draw();
  }

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      const face = faces[i];
      if (normalZ(face) <= 0) continue;
      ctx.beginPath();
      face.idx.forEach((v, n) => {
        const p = projected[v];
        n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      if (ctx.isPointInPath(x, y)) return i;
    }
    return -1;
  }

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, rx: state.rx, ry: state.ry, moved: false };
    state.dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      state.ry = drag.ry + dx * 0.008;
      state.rx = Math.max(-1.2, Math.min(1.2, drag.rx + dy * 0.006));
      draw();
      return;
    }
    const hit = pick(e);
    const next = litMap.has(hit) ? hit : -1;
    if (next !== state.hover) {
      state.hover = next;
      canvas.style.cursor = next >= 0 ? "pointer" : "grab";
      draw();
    }
  });
  const release = (e) => {
    if (drag && !drag.moved) {
      const hit = pick(e);
      if (litMap.has(hit) && opts.onSelect) opts.onSelect(litMap.get(hit));
    }
    drag = null;
    state.dragging = false;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", () => { drag = null; state.dragging = false; });
  canvas.addEventListener("pointerleave", () => {
    if (state.hover !== -1) { state.hover = -1; draw(); }
  });

  new IntersectionObserver((entries) => {
    state.visible = entries[0].isIntersecting;
  }).observe(canvas);

  window.addEventListener("resize", () => { resize(); draw(); });
  resize();

  return {
    faceCount: faces.length,
    // Crown mains are the largest faces and read best. A lit face the visitor cannot see
    // defeats the point, so pick the ones pointing at the camera in the opening orientation
    // and spread the rest around the crown from there.
    setFacets(list) {
      litMap.clear();
      project();
      const crown = faces
        .map((f, i) => (f.kind === "crown" ? { i, facing: normalZ(f) } : null))
        .filter(Boolean)
        .sort((a, b) => b.facing - a.facing)
        .map((o) => o.i);
      const step = Math.max(1, Math.floor(crown.length / Math.max(list.length, 2)));
      list.forEach((facet, n) => litMap.set(crown[(n * step) % crown.length], facet));
      draw();
    },
    start() { if (!raf) raf = requestAnimationFrame(loop); draw(); },
  };
}
