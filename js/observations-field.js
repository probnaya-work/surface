// Observations before the first publication.
//
// While the sequence holds no published observation, a field of short strokes
// stands in the reading column. Every stroke is aligned to a field set up by two
// sources that stay outside the figure and are never drawn. They go round it in
// five and eight hours on the wall clock, and the figure is recomputed every few
// seconds, so it looks still and is different when you come back. Where the field
// is weakest the strokes are withheld, leaving an opening that drifts over the
// day. The blue stroke is the first place in the column, where reading begins.
//
// The figure is mounted only when the sequence has no <li>, so publishing the
// first observation removes it without any other edit.
(function () {
  'use strict';

  const sequence = document.querySelector('.obs-sequence');
  const opening = document.querySelector('.obs-opening');
  if (!sequence || !opening || sequence.querySelector('li') || typeof Apparatus === 'undefined') return;

  const { BLUE, MID } = Apparatus;
  const PERIOD_A = 5 * 3600, PERIOD_B = 8 * 3600; // seconds per circuit
  const WITHHELD = 0.34;                          // share of strokes withheld where the field is weakest
  const REDRAW = 4;                               // seconds between recomputations

  const figure = document.createElement('div');
  figure.className = 'obs-plate';
  figure.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  figure.appendChild(canvas);
  sequence.after(figure);

  // The reading column at the current width, read from the opening's grid.
  function column(width) {
    const style = getComputedStyle(opening);
    const cols = style.gridTemplateColumns.split(' ').map(parseFloat);
    if (cols.length < 2) return { mobile: true, from: 0, to: width };
    const from = cols[0] + (parseFloat(style.columnGap) || 0);
    return { mobile: false, from, to: Math.min(width, from + cols[1]) };
  }

  function lattice(from, to, pitch) {
    const n = Math.max(1, Math.floor((to - from) / pitch));
    const start = from + (to - from - (n - 1) * pitch) / 2;
    return Array.from({ length: n }, (_, i) => start + i * pitch);
  }

  // A point on a loop that runs outside the W × H figure, offset by `out`.
  function around(u, W, H, out) {
    const w = W + out * 2, h = H + out * 2, P = 2 * (w + h);
    let d = ((u % 1) + 1) % 1 * P;
    if (d < w) return [d - out, -out];
    d -= w; if (d < h) return [W + out, d - out];
    d -= h; if (d < w) return [W + out - d, H + out];
    d -= w; return [-out, H + out - d];
  }

  function build(S) {
    let col, pts = [];

    function plan() {
      col = column(S.w);
      const pitch = col.mobile ? 22 : 24;
      const xs = lattice(col.from, col.to, pitch);
      const ys = lattice(0, S.h, pitch);
      pts = [];
      for (const y of ys) for (const x of xs) pts.push({ x, y });
    }

    function draw() {
      const { ctx } = S;
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.clearRect(0, 0, S.w, S.h);
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1;

      const seconds = Date.now() / 1000;
      const out = col.mobile ? 50 : 90;
      const a = around(seconds / PERIOD_A, S.w, S.h, out);
      const b = around(0.5 + seconds / PERIOD_B, S.w, S.h, out + 30);

      const field = pts.map((p) => {
        const ax = p.x - a[0], ay = p.y - a[1], bx = b[0] - p.x, by = b[1] - p.y;
        const ra = ax * ax + ay * ay, rb = bx * bx + by * by;
        const ex = ax / ra + bx / rb, ey = ay / ra + by / rb;
        return { angle: Math.atan2(ey, ex), mag: Math.hypot(ex, ey) };
      });
      const mags = field.map((f) => f.mag).sort((x, y) => x - y);
      const threshold = mags[Math.floor(mags.length * WITHHELD)];

      const half = col.mobile ? 4.5 : 5;
      const stroke = (p, angle) => {
        const c = Math.cos(angle) * half, s = Math.sin(angle) * half;
        ctx.moveTo(p.x - c, p.y - s); ctx.lineTo(p.x + c, p.y + s);
      };
      ctx.strokeStyle = MID;
      ctx.beginPath();
      pts.forEach((p, n) => { if (n > 0 && field[n].mag >= threshold) stroke(p, field[n].angle); });
      ctx.stroke();
      ctx.strokeStyle = BLUE;
      ctx.beginPath();
      stroke(pts[0], field[0].angle);
      ctx.stroke();
    }

    S.onFit = () => { plan(); draw(); };
    S.onFit();

    let acc = 0;
    return {
      tick: (dt) => {
        acc += dt;
        while (acc >= REDRAW) { acc -= REDRAW; draw(); }
      }
    };
  }

  Apparatus.mount(canvas, build);
})();
