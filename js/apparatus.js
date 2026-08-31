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
  function buildStepLanes(S) {
    let lanes = [], px = 0, py = 0, target = null, fadeAcc = 0;
    const sheet = () => {
      const { ctx } = S;
      lanes = [0.22, 0.4, 0.58, 0.76].map(f => Math.round(S.h * f) + 0.5);
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, S.w, S.h);
      ctx.strokeStyle = FAINT;
      lanes.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.w, y); ctx.stroke(); });
      px = 14; py = lanes[1]; target = null;
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
  function buildRaster(S) {
    const RH = 9;
    let x = 0, row = 0, rows = 0, seed = Math.random() * 100;
    const clear = () => {
      S.ctx.fillStyle = PAPER; S.ctx.fillRect(0, 0, S.w, S.h);
      rows = Math.max(1, Math.floor((S.h - 16) / RH)); x = 0; row = 0;
    };
    S.onFit = clear; clear();
    const amp = (r, xx) => (Math.sin(xx * 0.07 + r * 1.7 + seed) * Math.sin(xx * 0.017 + r * 0.4)
      + 0.5 * Math.sin(xx * 0.21 + r * 2.9)) * (RH * 0.36);

    return {
      tick: (dt, norm) => {
        const { ctx } = S;
        const step = 5 * norm * S.speed(), y0 = 10 + row * RH;
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
  function buildHarmonograph(S) {
    let t = 0, px = null, py = null, decay = 0, stepAcc = 0;
    const p = [
      { a: 0.31, f: 2.01, ph: 0.0, d: 0.0022 },
      { a: 0.26, f: 3.02, ph: 1.1, d: 0.0028 },
      { a: 0.29, f: 2.99, ph: 0.5, d: 0.0019 },
      { a: 0.24, f: 4.01, ph: 2.2, d: 0.0031 }
    ];
    const clear = () => { S.ctx.fillStyle = PAPER; S.ctx.fillRect(0, 0, S.w, S.h); t = 0; px = py = null; decay = 0; };
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
            ctx.strokeStyle = decay > 0.86 ? BLUE : INK;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          }
          px = x; py = y;
          decay = 1 - Math.exp(-0.0022 * t * 30);
        }
        if (decay > 0.985) { ctx.fillStyle = BLUE; ctx.fillRect(cx - 2, cy - 2, 4, 4); if (Math.random() < 0.02 * norm) clear(); }
      }
    };
  }

  return {
    INK, PAPER, BLUE, MID, FAINT,
    mount,
    buildTrace, buildStepLanes, buildRaster, buildStrip, buildRecordReading, buildSeismo, buildHarmonograph
  };
})();
