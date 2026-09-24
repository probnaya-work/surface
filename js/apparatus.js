// PROBNAYA — the apparatus.
//
// Every figure on this site is a small simulation advanced on a shared
// requestAnimationFrame loop and drawn straight to a <canvas> each tick.
// Nothing here is a pre-rendered animation: positions, decay and ink
// accumulation are all computed live, in the browser, every frame —
// the picture is the apparatus's current state, not a recording of it.
//
// Ticks are driven by measured wall-clock delta time (not frame count),
// so the pen moves at the same physical speed on a 60Hz display as on a
// 120/144Hz one. `norm` below is "how many 1/60s frames this tick is
// worth" — multiply any of the original per-frame constants by it.

const Apparatus = (() => {
  const INK = "#16181C", PAPER = "#EFF0F2", BLUE = "#2233CC", MID = "#767B84", FAINT = "#C7CAD0";

  const plates = [];
  let raf = null;
  let lastT = null;
  let frames = 0;
  let watchdog = null;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    frames++;
    if (lastT === null) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 0.05); // clamp a stall (tab refocus, GC pause) to one nominal frame's worth
    const norm = dt * 60;
    for (const p of plates) {
      if (p.tick) {
        try { p.tick(dt, norm); } catch (err) { p.tick = null; }
      }
    }
  }

  function ensureLoop() {
    if (raf === null) {
      lastT = null;
      raf = requestAnimationFrame(loop);
    }
    if (!watchdog) {
      let seen = -1;
      watchdog = setInterval(() => {
        if (raf !== null && frames === seen) { cancelAnimationFrame(raf); raf = null; ensureLoop(); }
        seen = frames;
      }, 900);
    }
  }

  // Mounts one plate on a canvas. `build(S)` returns { tick(dt, norm), cleanup(), }.
  // `S.onFit` (set inside build) re-primes any layout-dependent state after a resize.
  function mount(canvas, build, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = { ctx, canvas, dpr, w: 0, h: 0, speed: () => opts.speed ?? 1 };

    S.fit = () => {
      if (!canvas.clientWidth || !canvas.clientHeight) return false;
      S.w = canvas.clientWidth; S.h = canvas.clientHeight;
      canvas.width = Math.round(S.w * dpr); canvas.height = Math.round(S.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = INK;
      ctx.font = "10px 'Geist Mono', monospace";
      if (S.onFit) S.onFit(S);
      return true;
    };

    const entry = { tick: null, cleanup: null, ro: null };
    plates.push(entry);

    const boot = () => {
      if (!S.fit()) return false;
      const eng = build(S) || {};
      entry.tick = eng.tick; entry.cleanup = eng.cleanup;
      entry.ro = new ResizeObserver(() => {
        const want = Math.round(canvas.clientWidth * dpr);
        if (canvas.clientWidth && canvas.width !== want) S.fit();
      });
      entry.ro.observe(canvas);
      return true;
    };

    if (!boot()) {
      let tries = 0;
      const retry = () => {
        if (!plates.includes(entry)) return;
        if (boot() || ++tries > 240) return;
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }

    ensureLoop();

    return {
      destroy() {
        if (entry.cleanup) entry.cleanup();
        if (entry.ro) entry.ro.disconnect();
        const i = plates.indexOf(entry);
        if (i >= 0) plates.splice(i, 1);
      }
    };
  }

  // ---- FIG.1 — continuous harmonic trace, deflected by the pointer ----
  function buildTrace(S, hooks) {
    hooks = hooks || {};
    const host = hooks.host || S.canvas.parentElement;
    let t = Math.random() * 900, px = S.w * 0.55, py = S.h * 0.42, mx = null, my = null, near = 0, stepAcc = 0, fadeAcc = 0;

    const move = e => { const r = host.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; near = 1; };
    const touch = e => { const p = e.touches ? e.touches[0] : e; move(p); };
    const leave = () => { near = 0; };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("touchstart", touch, { passive: true });
    host.addEventListener("touchmove", touch, { passive: true });
    host.addEventListener("touchend", leave, { passive: true });

    const pos = tt => {
      const cx = S.w * 0.55, cy = S.h * 0.40, a = Math.min(S.w, S.h) * 0.30;
      return [
        cx + a * Math.sin(tt * 0.31) * Math.cos(tt * 0.117) + a * 0.45 * Math.sin(tt * 0.73 + 1.3),
        cy + a * 0.75 * Math.cos(tt * 0.27) * Math.sin(tt * 0.141 + 0.6) + a * 0.35 * Math.cos(tt * 0.61)
      ];
    };

    return {
      cleanup: () => {
        host.removeEventListener("pointermove", move);
        host.removeEventListener("pointerleave", leave);
        host.removeEventListener("touchstart", touch);
        host.removeEventListener("touchmove", touch);
        host.removeEventListener("touchend", leave);
      },
      tick: (dt, norm) => {
        const { ctx } = S;
        fadeAcc += norm;
        while (fadeAcc >= 3) {
          fadeAcc -= 3;
          ctx.fillStyle = "rgba(239,240,242,0.022)"; ctx.fillRect(0, 0, S.w, S.h);
        }
        ctx.strokeStyle = INK;
        stepAcc += 3 * norm;
        while (stepAcc >= 1) {
          stepAcc -= 1;
          t += 0.012 * S.speed();
          let [x, y] = pos(t);
          if (mx !== null && near) {
            const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy) || 1;
            const pull = Math.max(0, 1 - d / 420) * 60;
            x += (dx / d) * pull; y += (dy / d) * pull;
          }
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          px = x; py = y;
        }
        if (hooks.onMove) hooks.onMove(px, py);
      }
    };
  }

  // ---- FIG.2 — 0x2F: rectilinear pen stepping between four task lanes ----
  function buildStepLanes(S, opts) {
    opts = opts || {};
    const top = opts.top == null ? 0 : opts.top;   // leave the upper band clear
    let lanes = [], px = 0, py = 0, target = null, fadeAcc = 0;
    const sheet = () => {
      const { ctx } = S;
      const head = S.h * top, band = S.h - head;
      lanes = [0.22, 0.4, 0.58, 0.76].map(f => Math.round(head + band * f) + 0.5);
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, S.w, S.h);
      ctx.strokeStyle = FAINT;
      lanes.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.w, y); ctx.stroke(); });
      px = 14; py = lanes[1]; target = null;
      history();
    };

    // A plate the size of a page would otherwise be watched while it is still
    // empty. A wide sheet therefore arrives with the path already walked once,
    // laid down quieter than the live pen: the runtime was running before the
    // page was opened. Narrow figures start clean, as they always have.
    const history = () => {
      if (S.w < 700) return;
      const { ctx } = S;
      let x = 14, y = lanes[1];
      ctx.strokeStyle = INK;
      while (x < S.w - 14) {
        const nx = Math.min(S.w - 14, x + 30 + Math.random() * 90);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, y); ctx.stroke();
        if (Math.random() < 0.4) { ctx.fillStyle = BLUE; ctx.fillRect(nx - 2, y - 2, 4, 4); }
        x = nx;
        if (Math.random() < 0.35) {
          const ny = lanes[Math.floor(Math.random() * lanes.length)];
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ny); ctx.stroke();
          y = ny;
        }
      }
      ctx.fillStyle = "rgba(239,240,242,0.55)"; ctx.fillRect(0, 0, S.w, S.h);
      px = 14; py = lanes[Math.floor(Math.random() * lanes.length)];
    };

    S.onFit = sheet; sheet();

    return {
      tick: (dt, norm) => {
        const { ctx } = S;
        fadeAcc += norm;
        while (fadeAcc >= 4) {
          fadeAcc -= 4;
          ctx.fillStyle = "rgba(239,240,242,0.035)"; ctx.fillRect(0, 0, S.w, S.h);
        }
        if (!target) {
          target = Math.random() < 0.35
            ? { x: px, y: lanes[Math.floor(Math.random() * lanes.length)], mark: false }
            : { x: Math.min(S.w - 14, px + 30 + Math.random() * 90), y: py, mark: Math.random() < 0.4 };
        }
        const sp = 1.6 * norm * S.speed();
        const dx = target.x - px, dy = target.y - py, d = Math.hypot(dx, dy);
        const nx = d <= sp ? target.x : px + (dx / d) * sp, ny = d <= sp ? target.y : py + (dy / d) * sp;
        ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        px = nx; py = ny;
        if (d <= sp) {
          if (target.mark) { ctx.fillStyle = BLUE; ctx.fillRect(px - 2, py - 2, 4, 4); }
          target = null;
          if (px >= S.w - 16) {
            ctx.fillStyle = "rgba(239,240,242,0.75)"; ctx.fillRect(0, 0, S.w, S.h);
            ctx.strokeStyle = FAINT;
            lanes.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.w, y); ctx.stroke(); });
            px = 14; py = lanes[Math.floor(Math.random() * lanes.length)];
          }
        }
      }
    };
  }

  // ---- FIG.3 — 057: raster sweep, one line per pass, amplitude = activity ----
  function buildRaster(S, opts) {
    opts = opts || {};
    const top = opts.top == null ? 0 : opts.top;   // leave the upper band clear
    const RH = 9;
    let x = 0, row = 0, rows = 0, head = 0, seed = Math.random() * 100;
    const clear = () => {
      S.ctx.fillStyle = PAPER; S.ctx.fillRect(0, 0, S.w, S.h);
      head = S.h * top;
      rows = Math.max(1, Math.floor((S.h - head - 16) / RH)); x = 0; row = 0;
    };
    S.onFit = clear; clear();
    const amp = (r, xx) => (Math.sin(xx * 0.07 + r * 1.7 + seed) * Math.sin(xx * 0.017 + r * 0.4)
      + 0.5 * Math.sin(xx * 0.21 + r * 2.9)) * (RH * 0.36);

    return {
      tick: (dt, norm) => {
        const { ctx } = S;
        const step = 5 * norm * S.speed(), y0 = head + 10 + row * RH;
        ctx.strokeStyle = row % 4 === 3 ? BLUE : INK;
        ctx.beginPath();
        for (let i = 0; i <= step; i++) {
          const xx = x + i, yy = y0 + amp(row, xx);
          i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        x += step;
        if (x > S.w) {
          x = 0; row++;
          if (row >= rows) { row = 0; seed = Math.random() * 100; ctx.fillStyle = "rgba(239,240,242,0.9)"; ctx.fillRect(0, 0, S.w, S.h); }
        }
        ctx.strokeStyle = "rgba(34,51,204,0.35)";
        ctx.beginPath(); ctx.moveTo(x, y0 - 5); ctx.lineTo(x, y0 + 5); ctx.stroke();
      }
    };
  }

  // ---- FIG.4 — register: a cursor sweeping the time axis, spiking on each entry ----
  function buildStrip(S, hooks) {
    hooks = hooks || {};
    const records = hooks.records || [];
    let cur = 0;
    const glow = records.map(() => 0);

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
        const base = h - 26;
        ctx.strokeStyle = FAINT;
        ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(w, base + 0.5); ctx.stroke();
        for (let i = 0; i <= 24; i++) {
          const gx = Math.round((i / 24) * w) + 0.5;
          ctx.beginPath(); ctx.moveTo(gx, base); ctx.lineTo(gx, base + (i % 6 === 0 ? 8 : 4)); ctx.stroke();
        }
        const hov = hooks.hoverIndex ? hooks.hoverIndex() : -1;
        if (hov >= 0) cur += (records[hov].f - cur) * Math.min(1, 0.14 * norm);
        else { cur += 0.0016 * norm * S.speed(); if (cur > 1.04) cur = -0.02; }
        records.forEach((r, i) => {
          const ex = Math.round(r.f * w) + 0.5;
          const hit = Math.abs(cur - r.f) < 0.006 || hov === i;
          glow[i] = hit ? 1 : glow[i] * Math.pow(0.94, norm);
          const hgt = 16 + glow[i] * (base - 34);
          ctx.strokeStyle = glow[i] > 0.05 ? BLUE : INK;
          ctx.beginPath(); ctx.moveTo(ex, base); ctx.lineTo(ex, base - hgt); ctx.stroke();
          if (r.withheld) { ctx.fillStyle = INK; ctx.fillRect(ex - 3, base - hgt - 7, 6, 6); }
          if (glow[i] > 0.35) { ctx.fillStyle = BLUE; ctx.fillText(r.id, Math.min(ex + 7, w - 64), base - hgt - 10); }
        });
        const cx = Math.round(cur * w) + 0.5;
        ctx.strokeStyle = "rgba(34,51,204,0.55)";
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, base); ctx.stroke();
      }
    };
  }

  // ---- FIG.6 — one record's reading: open wanders, closed settles, inconclusive breaks ----
  function buildRecordReading(S, hooks) {
    const kind = (hooks && hooks.kind) || "open";
    let x = 0, last = null, sinceWipe = 0;
    const clear = () => { S.ctx.fillStyle = PAPER; S.ctx.fillRect(0, 0, S.w, S.h); x = 0; last = null; };
    S.onFit = clear; clear();

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        const mid = h / 2, step = 1.6 * norm * S.speed();
        let y = mid;
        if (kind === "open") y = mid + Math.sin(x * 0.05) * h * 0.2 + Math.sin(x * 0.013 + 1) * h * 0.14;
        if (kind === "closed") y = mid + Math.sin(x * 0.04) * h * 0.28 * Math.max(0, 1 - x / (w * 0.7));
        if (kind === "broken") y = mid + Math.sin(x * 0.06) * h * 0.18;
        const gap = kind === "broken" && (Math.floor(x / 34) % 3 === 1);
        if (!gap) {
          ctx.strokeStyle = INK;
          ctx.beginPath();
          last ? ctx.moveTo(last[0], last[1]) : ctx.moveTo(x, y);
          ctx.lineTo(x + step, y); ctx.stroke();
          last = [x + step, y];
        } else last = null;
        x += step;
        if (x > w - 6) {
          if (kind === "closed") { ctx.fillStyle = BLUE; ctx.fillRect(w - 8, mid - 3, 6, 6); }
          sinceWipe += norm;
          if (sinceWipe >= 2) { sinceWipe -= 2; ctx.fillStyle = "rgba(239,240,242,0.6)"; ctx.fillRect(0, 0, w, h); }
          if (x > w + 90) clear();
        }
      }
    };
  }

  // ---- FIG.5 — intake recorder: the trace answers the operator writing ----
  // Sample slots and their decay are paced by an accumulator, not "once per
  // tick" — otherwise a high-refresh display would sample and decay energy
  // faster in wall-clock time than a 60Hz one (the same bug dt-scaling
  // everywhere else is fixing).
  function buildSeismo(S, hooks) {
    hooks = hooks || {};
    let buf = [], acc = 0, frame = 0;
    const clear = () => { buf = new Array(Math.max(1, Math.ceil(S.w))).fill(0); acc = 0; };
    S.onFit = clear; clear();

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        const mid = h / 2;
        const sent = hooks.sent ? hooks.sent() : false;
        acc += norm;
        while (acc >= 1) {
          acc -= 1;
          if (hooks.decay) hooks.decay();
          const e = sent ? 0 : hooks.energy();
          buf.push((Math.random() - 0.5) * e * (h * 0.62) + Math.sin(frame * 0.21) * e * (h * 0.16));
          frame++;
        }
        while (buf.length > w) buf.splice(0, buf.length - w);
        if (hooks.onAmp) {
          const a = (sent ? 0 : Math.min(1, hooks.energy())).toFixed(2);
          hooks.onAmp(a);
        }
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = FAINT;
        ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(w, mid + 0.5); ctx.stroke();
        ctx.strokeStyle = sent ? MID : INK;
        ctx.beginPath();
        for (let i = 0; i < buf.length; i++) i === 0 ? ctx.moveTo(i, mid + buf[i]) : ctx.lineTo(i, mid + buf[i]);
        ctx.stroke();
        if (!sent) { ctx.fillStyle = BLUE; ctx.fillRect(buf.length - 2, mid + (buf[buf.length - 1] || 0) - 2, 4, 4); }
      }
    };
  }

  // ---- FIG.0 — the laboratory: a harmonograph that decays to a point, then restarts ----
  function buildHarmonograph(S, palette = {}) {
    let t = 0, px = null, py = null, decay = 0, stepAcc = 0;
    const ground = palette.ground || PAPER, line = palette.line || INK, accent = palette.accent || BLUE;
    const p = [
      { a: 0.31, f: 2.01, ph: 0.0, d: 0.0022 },
      { a: 0.26, f: 3.02, ph: 1.1, d: 0.0028 },
      { a: 0.29, f: 2.99, ph: 0.5, d: 0.0019 },
      { a: 0.24, f: 4.01, ph: 2.2, d: 0.0031 }
    ];
    const clear = () => { S.ctx.fillStyle = ground; S.ctx.fillRect(0, 0, S.w, S.h); t = 0; px = py = null; decay = 0; };
    S.onFit = clear; clear();

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        const cx = w / 2, cy = h / 2, R = Math.min(w, h);
        stepAcc += 4 * norm;
        while (stepAcc >= 1) {
          stepAcc -= 1;
          t += 0.03 * S.speed();
          const e = k => Math.exp(-p[k].d * t * 30);
          const x = cx + R * (p[0].a * Math.sin(t * p[0].f + p[0].ph) * e(0) + p[1].a * Math.sin(t * p[1].f + p[1].ph) * e(1));
          const y = cy + R * (p[2].a * Math.sin(t * p[2].f + p[2].ph) * e(2) + p[3].a * Math.sin(t * p[3].f + p[3].ph) * e(3));
          if (px !== null) {
            ctx.strokeStyle = decay > 0.86 ? accent : line;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          }
          px = x; py = y;
          decay = 1 - Math.exp(-0.0022 * t * 30);
        }
        if (decay > 0.985) { ctx.fillStyle = accent; ctx.fillRect(cx - 2, cy - 2, 4, 4); if (Math.random() < 0.02 * norm) clear(); }
      }
    };
  }

  // ---- FIG.5 — MPA-01: one 16 x 16 reading committed cell by cell, in marks ----
  // Marks are CONCENTRIC: a centred square of side = cell x level / 4, level 0 left
  // empty. The blue cell is the fiducial, the subject's left pupil at column 9, row 6.
  const MPA_N = 16, MPA_FID_C = 9, MPA_FID_R = 6;
  const MPA_READING = [
    0,0,0,0,0,0,1,2,2,2,1,1,0,0,0,0, 0,0,0,0,0,1,2,3,3,3,3,3,1,0,0,0,
    0,0,0,0,1,3,3,3,3,2,2,2,3,1,0,0, 0,0,0,0,3,3,3,1,1,1,1,1,2,3,0,0,
    0,0,0,1,3,3,1,1,1,1,1,1,2,3,0,0, 0,0,0,3,4,1,2,2,2,2,2,1,1,2,1,0,
    0,0,2,3,2,1,2,4,4,2,2,2,2,2,1,0, 0,0,3,2,1,1,2,2,2,1,3,4,3,3,1,0,
    0,1,4,2,1,1,1,2,1,1,2,3,2,4,1,0, 0,1,4,4,1,1,1,2,1,1,2,2,2,4,2,0,
    1,1,4,4,1,1,2,2,3,3,2,2,3,4,1,0, 0,2,4,4,2,1,3,3,3,3,2,3,4,4,1,0,
    2,2,3,4,4,2,3,3,3,3,3,4,4,4,2,2, 2,3,4,4,4,3,3,3,3,3,4,4,4,4,3,3,
    3,3,4,4,4,4,4,4,4,4,4,4,4,3,2,1, 3,4,4,4,4,4,4,4,4,4,4,4,4,3,2,1
  ];

  function buildPlate(S) {
    const CELLS = MPA_N * MPA_N;
    let g = null, drawn = 0, acc = 0, hold = 0;

    const sheet = () => {
      const { ctx } = S;
      const side = Math.max(48, Math.min(S.w - 76, S.h - 64));
      g = { x: Math.round((S.w - side) / 2), y: Math.round((S.h - side) / 2), side, s: side / MPA_N };
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, S.w, S.h);
      ctx.strokeStyle = "#A7ABB3";
      const o = 8, t = 22;
      [[g.x, g.y, 1, 1], [g.x + side, g.y, -1, 1], [g.x, g.y + side, 1, -1], [g.x + side, g.y + side, -1, -1]]
        .forEach(([cx, cy, sx, sy]) => {
          ctx.beginPath();
          ctx.moveTo(cx + 0.5, cy + sy * o + 0.5); ctx.lineTo(cx + 0.5, cy + sy * (o + t) + 0.5);
          ctx.moveTo(cx + sx * o + 0.5, cy + 0.5); ctx.lineTo(cx + sx * (o + t) + 0.5, cy + 0.5);
          ctx.stroke();
        });
      drawn = 0; acc = 0; hold = 0;
    };
    S.onFit = sheet; sheet();

    return {
      tick: (dt, norm) => {
        const { ctx } = S;
        if (hold > 0) { hold -= dt; if (hold <= 0) sheet(); return; }
        acc += 2.5 * norm * S.speed();
        while (acc >= 1 && drawn < CELLS) {
          acc -= 1;
          const c = drawn % MPA_N, r = (drawn / MPA_N) | 0, level = MPA_READING[drawn];
          drawn++;
          if (!level) continue;
          const cs = g.s * level / 4, off = (g.s - cs) / 2;
          ctx.fillStyle = (c === MPA_FID_C && r === MPA_FID_R) ? BLUE : INK;
          ctx.fillRect(g.x + c * g.s + off, g.y + r * g.s + off, cs, cs);
        }
        if (drawn >= CELLS) acc = 0;
        const row = Math.min(MPA_N - 1, (drawn / MPA_N) | 0);
        ctx.fillStyle = PAPER; ctx.fillRect(g.x - 26, g.y - 2, 12, g.side + 4);
        if (drawn < CELLS) {
          ctx.fillStyle = BLUE;
          ctx.fillRect(g.x - 22, Math.round(g.y + row * g.s + g.s / 2) - 1, 7, 2);
        } else if (hold <= 0) {
          hold = 5; // seconds held before the reading is committed again
        }
      }
    };
  }

  // ---- FIG.6 — Chinotto: moments on a time axis. What is further from now is
  // quieter; continuing an old moment draws it back up for a while, then it
  // settles again. The axis drifts left at a fixed physical speed. ----
  function buildRecord(S, opts) {
    opts = opts || {};
    const top = opts.top == null ? 0.16 : opts.top;
    const NOW = 44, EVERY = 80;       // ticks between moments, at 1/60s each
    let moments = [], links = [], rows = [], acc = 0;

    const lines = () => {
      const y0 = S.h * top + 16, y1 = S.h - 44, n = Math.max(3, Math.floor((y1 - y0) / 22));
      return Array.from({ length: n }, (_, i) => y0 + i * (y1 - y0) / (n - 1));
    };
    const leave = (x) => {
      const m = { x, y: rows[Math.floor(Math.random() * rows.length)], len: 24 + Math.random() * 70, glow: 0 };
      moments.push(m);
      return m;
    };
    const sheet = () => {
      rows = lines(); moments = []; links = []; acc = 0;
      for (let x = S.w - NOW; x > -40; x -= 16 + Math.random() * 34) leave(x);
    };
    S.onFit = sheet; sheet();

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        const drift = 0.12 * norm * S.speed();
        moments.forEach(m => { m.x -= drift; m.glow *= Math.pow(0.992, norm); });

        acc += norm;
        while (acc >= EVERY) {
          acc -= EVERY;
          const m = leave(w - NOW);
          const older = moments.filter(o => o !== m && o.x < w - NOW - 120);
          if (older.length && Math.random() < 0.45) {
            const o = older[Math.floor(Math.random() * older.length)];
            o.glow = 1; m.y = o.y; links.push({ a: o, b: m });
          }
        }
        moments = moments.filter(m => m.x > -120);
        links = links.filter(l => moments.includes(l.a) && moments.includes(l.b));

        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
        const quiet = (m) => Math.max(0.1, Math.min(1, 1 - (w - NOW - m.x) / (w * 0.9)));

        ctx.strokeStyle = FAINT; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(w - NOW + 0.5, h * top); ctx.lineTo(w - NOW + 0.5, h - 12); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = MID; ctx.textAlign = "right"; ctx.fillText("NOW", w - NOW - 6, h - 12);
        ctx.textAlign = "left";

        links.forEach(l => {
          const a = Math.max(quiet(l.a), l.a.glow);
          ctx.strokeStyle = l.a.glow > 0.2 ? BLUE : INK; ctx.globalAlpha = 0.25 + 0.5 * a;
          ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y);
          ctx.quadraticCurveTo((l.a.x + l.b.x) / 2, l.a.y - 26, l.b.x, l.b.y); ctx.stroke();
        });
        moments.forEach(m => {
          ctx.globalAlpha = Math.max(quiet(m), m.glow);
          ctx.fillStyle = m.glow > 0.2 ? BLUE : INK;
          ctx.beginPath(); ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(m.x + 7, m.y - 0.5, Math.min(m.len, w - NOW - m.x - 10), 1);
        });
        ctx.globalAlpha = 1;
      }
    };
  }

  // ---- FIG.4 — HEARD: a field of public voices, read one line at a time. What
  // the reading has passed is inked; a phrase that recurs across the field is
  // marked. The field is redrawn once every line has been read. ----
  function buildField(S, opts) {
    opts = opts || {};
    const top = opts.top == null ? 0 : opts.top;   // leave the upper band clear
    const REST = 120;                 // ticks held on a finished field
    let lines = [], row = 0, cur = 0, rest = 0;

    const field = () => {
      // As many lines as the plate has room for: six on a small figure, more when
      // the plate is the page.
      const head = S.h * top;
      const n = Math.max(6, Math.floor((S.h - head - 44) / 26)), y0 = head + 26, gap = (S.h - head - 44) / n;
      lines = Array.from({ length: n }, (_, i) => {
        const marks = []; let x = 14;
        for (;;) {
          const w = 8 + Math.random() * 42;
          if (x + w > S.w - 14) break;
          marks.push({ x, w, recurring: Math.random() < 0.12 });
          x += w + 5;
        }
        return { y: y0 + i * gap + gap / 2, marks };
      });
      row = 0; cur = 0; rest = 0;
    };
    S.onFit = field; field();

    return {
      tick: (dt, norm) => {
        const { ctx, w, h } = S;
        if (rest > 0) {
          rest -= norm;
          if (rest <= 0) field();
        } else {
          cur += 2.2 * norm * S.speed();
          if (cur > w) {
            cur = 0; row++;
            if (row >= lines.length) { row = lines.length - 1; cur = w; rest = REST; }
          }
        }

        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = MID; ctx.fillText("PUBLIC FIELD", 14, h * top + 16);
        lines.forEach((l, i) => {
          l.marks.forEach(m => {
            const read = i < row || (i === row && m.x + m.w < cur);
            const lift = read && m.recurring;
            ctx.fillStyle = read ? (m.recurring ? BLUE : INK) : FAINT;
            ctx.fillRect(m.x, l.y - (lift ? 3 : 1), m.w, lift ? 6 : 2);
          });
        });
        if (rest <= 0) {
          ctx.strokeStyle = BLUE;
          ctx.beginPath(); ctx.moveTo(cur + 0.5, lines[row].y - 9); ctx.lineTo(cur + 0.5, lines[row].y + 9); ctx.stroke();
        }
      }
    };
  }

  return {
    INK, PAPER, BLUE, MID, FAINT,
    mount,
    buildTrace, buildStepLanes, buildRaster, buildStrip, buildRecordReading, buildSeismo, buildHarmonograph, buildPlate,
    buildRecord, buildField
  };
})();
