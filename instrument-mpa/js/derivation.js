// PROB–MPA–01 · DERIVATION
//
// The source derivation of the Machine Portrait Apparatus. Pure functions over
// typed arrays; no DOM, no canvas, no clock, no randomness. The same decoded
// pixels through the same DERIVATION_VERSION yield the same 32 × 32 band matrix.
//
//   decoded pixels (RGBA, 8-bit, sRGB)
//     → locked square crop
//     → explicit per-cell box filter over source pixels
//     → linear sRGB (literal table) → relative luminance (Rec. 709 weights)
//     → perceptual lightness L*
//     → 2–98 percentile clip → normalisation → five equal-width bands
//     → authoritative 32 × 32 band matrix
//
// The 16 × 16 preliminary reading is derived from that matrix alone (reduce16).
// It is never a second measurement, clip or cut.

export const DERIVATION_VERSION = "MPA-01/1";

export const N = 32;              // issued lattice side
export const CELLS = N * N;       // 1024
export const PN = 16;             // preliminary lattice side
export const PCELLS = PN * PN;    // 256
export const BANDS = 5;
export const CLIP_LO = 0.02;
export const CLIP_HI = 0.98;
export const CROP_BIAS = 0.22;    // vertical position of the square in the slack: chosen, not measured
export const MIN_SIDE = 512;      // admissible input: shorter side in pixels

// sRGB 8-bit value → linear light. The table is the specification: these
// literals define lin(u), so no per-pixel transcendental call is made and the
// linearisation does not depend on the engine's pow().
//   lin(u): v = u / 255; v ≤ 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ^ 2.4
export const SRGB_LINEAR = new Float64Array([
  0.0, 0.0003035269835488375, 0.000607053967097675, 0.0009105809506465125,
  0.00121410793419535, 0.0015176349177441874, 0.001821161901293025, 0.0021246888848418626,
  0.0024282158683907, 0.0027317428519395373, 0.003035269835488375, 0.003346535763899161,
  0.003676507324047436, 0.004024717018496307, 0.004391442037410293, 0.004776953480693729,
  0.005181516702338386, 0.005605391624202723, 0.006048833022857054, 0.006512090792594475,
  0.006995410187265387, 0.007499032043226175, 0.008023192985384994, 0.008568125618069307,
  0.009134058702220787, 0.00972121732023785, 0.010329823029626936, 0.010960094006488246,
  0.011612245179743885, 0.012286488356915872, 0.012983032342173012, 0.013702083047289686,
  0.014443843596092545, 0.01520851442291271, 0.01599629336550963, 0.016807375752887384,
  0.017641954488384078, 0.018500220128379697, 0.019382360956935723, 0.0202885630566524,
  0.021219010376003555, 0.02217388479338738, 0.02315336617811041, 0.024157632448504756,
  0.02518685962736163, 0.026241221894849898, 0.027320891639074894, 0.028426039504420793,
  0.0295568344378088, 0.030713443732993635, 0.03189603307301153, 0.033104766570885055,
  0.03433980680868217, 0.03560131487502034, 0.03688945040110004, 0.0382043715953465,
  0.03954623527673284, 0.04091519690685319, 0.042311410620809675, 0.043735029256973465,
  0.04518620438567554, 0.046665086336880095, 0.04817182422688942, 0.04970656598412723,
  0.05126945837404324, 0.052860647023180246, 0.05448027644244237, 0.05612849004960009,
  0.05780543019106723, 0.0595112381629812, 0.06124605423161761, 0.06301001765316767,
  0.06480326669290577, 0.06662593864377289, 0.06847816984440017, 0.07036009569659588,
  0.07227185068231748, 0.07421356838014963, 0.07618538148130785, 0.07818742180518633,
  0.08021982031446832, 0.0822827071298148, 0.08437621154414882, 0.08650046203654976,
  0.08865558628577294, 0.09084171118340768, 0.09305896284668745, 0.0953074666309647,
  0.09758734714186246, 0.09989872824711389, 0.10224173308810132, 0.10461648409110419,
  0.10702310297826761, 0.10946171077829933, 0.1119324278369056, 0.11443537382697373,
  0.11697066775851084, 0.11953842798834562, 0.12213877222960187, 0.12477181756095049,
  0.12743768043564743, 0.1301364766903643, 0.13286832155381798, 0.13563332965520566,
  0.13843161503245183, 0.14126329114027164, 0.14412847085805777, 0.14702726649759498,
  0.14995978981060856, 0.15292615199615017, 0.1559264637078274, 0.1589608350608804,
  0.162029375639111, 0.1651321945016676, 0.16826940018969075, 0.1714411007328226,
  0.17464740365558504, 0.17788841598362912, 0.18116424424986022, 0.184474994500441,
  0.18782077230067787, 0.19120168274079138, 0.1946178304415758, 0.19806931955994886,
  0.20155625379439707, 0.20507873639031693, 0.20863687014525575, 0.21223075741405523,
  0.21586050011389926, 0.2195261997292692, 0.2232279573168085, 0.22696587351009836,
  0.23074004852434915, 0.23455058216100522, 0.238397573812271, 0.24228112246555486,
  0.24620132670783548, 0.25015828472995344, 0.25415209433082675, 0.2581828529215958,
  0.26225065752969623, 0.26635560480286247, 0.2704977910130658, 0.27467731206038465,
  0.2788942634768104, 0.2831487404299921, 0.2874408377269175, 0.29177064981753587,
  0.2961382707983211, 0.3005437944157765, 0.3049873140698863, 0.30946892281750854,
  0.31398871337571754, 0.31854677812509186, 0.32314320911295075, 0.3277780980565422,
  0.33245153634617935, 0.33716361504833037, 0.3419144249086609, 0.3467040563550296,
  0.35153259950043936, 0.3564001441459435, 0.3613067797835095, 0.3662525955988395,
  0.3712376804741491, 0.3762621229909065, 0.38132601143253014, 0.386429433787049,
  0.39157247774972326, 0.39675523072562685, 0.4019777798321958, 0.4072402119017367,
  0.41254261348390375, 0.4178850708481375, 0.4232676699860717, 0.4286904966139066,
  0.43415363617474895, 0.4396571738409188, 0.44520119451622786, 0.45078578283822346,
  0.45641102318040466, 0.4620769996544071, 0.467783796112159, 0.47353149614800955,
  0.4793201831008268, 0.4851499400560704, 0.4910208498478356, 0.4969329950608704,
  0.5028864580325687, 0.5088813208549338, 0.5149176653765214, 0.5209955732043543,
  0.5271151257058131, 0.5332764040105052, 0.5394794890121072, 0.5457244613701866,
  0.5520114015120001, 0.5583403896342679, 0.5647115057049292, 0.5711248294648731,
  0.5775804404296506, 0.5840784178911641, 0.5906188409193369, 0.5972017883637634,
  0.6038273388553378, 0.6104955708078648, 0.6172065624196511, 0.6239603916750761,
  0.6307571363461468, 0.6375968739940326, 0.6444796819705821, 0.6514056374198242,
  0.6583748172794485, 0.665387298282272, 0.6724431569576875, 0.6795424696330938,
  0.6866853124353135, 0.6938717612919899, 0.7011018919329731, 0.7083757798916868,
  0.7156935005064807, 0.7230551289219693, 0.7304607400903537, 0.7379104087727308,
  0.7454042095403874, 0.7529422167760779, 0.7605245046752924, 0.768151147247507,
  0.7758222183174236, 0.7835377915261935, 0.7912979403326302, 0.799102738014409,
  0.8069522576692516, 0.8148465722161012, 0.8227857543962835, 0.8307698767746546,
  0.83879901174074, 0.846873231509858, 0.8549926081242338, 0.8631572134541023,
  0.8713671191987972, 0.8796223968878317, 0.8879231178819663, 0.8962693533742664,
  0.9046611743911496, 0.9130986517934192, 0.9215818562772946, 0.9301108583754237,
  0.938685728457888, 0.9473065367331999, 0.9559733532492861, 0.9646862478944651,
  0.9734452903984125, 0.9822505503331171, 0.9911020971138298, 1.0,
]);

// Rec. 709 / sRGB relative luminance weights.
export const WR = 0.2126, WG = 0.7152, WB = 0.0722;

// Crop rule. The square is the largest that fits, centred horizontally, with its
// top edge at 22 % of the vertical slack. Origins are floored to whole pixels so
// the crop is an exact pixel rectangle.
export function cropRect(width, height) {
  const side = Math.min(width, height);
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) * CROP_BIAS),
    side
  };
}

// Cell boundaries on a side of `side` pixels: an exact integer partition. Every
// source pixel in the crop belongs to exactly one cell; no pixel is weighted.
export function cellEdges(side, n = N) {
  const e = new Int32Array(n + 1);
  for (let k = 0; k <= n; k++) e[k] = Math.floor((k * side) / n);
  return e;
}

// Explicit box filter. `pixels` is an RGBA byte array of `width` × `height` (the
// decoded source, or a horizontal strip of it starting at source row `rowOffset`).
// Accumulates Σ Y and pixel counts into `acc` for every cell the strip touches.
// Summation order is fixed (row-major over the crop), so the double-precision
// sums are reproducible.
export function accumulateStrip(acc, pixels, width, rowOffset, rows, crop, edges) {
  const { sum, count } = acc;
  const n = edges.length - 1;
  const x0 = crop.x, y0 = crop.y, side = crop.side;
  const rowStart = Math.max(rowOffset, y0);
  const rowEnd = Math.min(rowOffset + rows, y0 + side);
  for (let y = rowStart; y < rowEnd; y++) {
    const ly = y - y0;
    let r = 0;
    while (edges[r + 1] <= ly) r++;
    const base = (y - rowOffset) * width * 4;
    let c = 0;
    for (let lx = 0; lx < side; lx++) {
      while (edges[c + 1] <= lx) c++;
      const k = base + (x0 + lx) * 4;
      const Y = WR * SRGB_LINEAR[pixels[k]] + WG * SRGB_LINEAR[pixels[k + 1]] + WB * SRGB_LINEAR[pixels[k + 2]];
      const i = r * n + c;
      sum[i] += Y;
      count[i] += 1;
    }
  }
}

export function newAccumulator(n = N) {
  return { sum: new Float64Array(n * n), count: new Int32Array(n * n) };
}

export function finishMeans(acc) {
  const means = new Float64Array(acc.sum.length);
  for (let i = 0; i < means.length; i++) means[i] = acc.count[i] ? acc.sum[i] / acc.count[i] : 0;
  return means;
}

// Whole-image convenience: measure a full decoded RGBA buffer in one pass.
export function measure(pixels, width, height, n = N) {
  const crop = cropRect(width, height);
  const edges = cellEdges(crop.side, n);
  const acc = newAccumulator(n);
  accumulateStrip(acc, pixels, width, 0, height, crop, edges);
  return { crop, means: finishMeans(acc) };
}

// CIE L* from relative luminance Y (white point Y = 1), scaled to 0…1.
export function lightness(Y) {
  return (Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y) / 100;
}

// The only classification in the apparatus. Five equal-width bands on the
// plate's own 2–98 percentile-clipped L* range. Populations are not equalised.
// Band 0 is the lightest fifth of the range, band 4 the darkest.
export function classify(means) {
  const count = means.length;
  const L = new Float64Array(count);
  for (let i = 0; i < count; i++) L[i] = lightness(means[i]);
  const asc = Float64Array.from(L).sort();
  const lo = asc[Math.floor(CLIP_LO * (count - 1))];
  const hi = asc[Math.floor(CLIP_HI * (count - 1))];
  const span = Math.max(1e-4, hi - lo);
  const bands = new Uint8Array(count);
  const population = new Int32Array(BANDS);
  for (let i = 0; i < count; i++) {
    let t = (L[i] - lo) / span;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const b = Math.min(BANDS - 1, Math.floor((1 - t) * BANDS));
    bands[i] = b;
    population[b]++;
  }
  return { bands, population, lo, hi, L };
}

// Preliminary reading: a pure function of the issued matrix. Each 2 × 2 block
// reduces to ρ = (Σb + 2) >> 2 — integer, total, closed on 0…4, exact on a flat
// block, monotone in Σb, halves resolving toward the darker band — then the
// locked tonal merge {0,1} → 0, {2} → 2, {3,4} → 4.
export function reduce16(bands32) {
  const out = new Uint8Array(PCELLS);
  for (let r = 0; r < PN; r++) {
    for (let c = 0; c < PN; c++) {
      const i = 2 * r * N + 2 * c;
      const rho = (bands32[i] + bands32[i + 1] + bands32[i + N] + bands32[i + N + 1] + 2) >> 2;
      out[r * PN + c] = rho <= 1 ? 0 : rho === 2 ? 2 : 4;
    }
  }
  return out;
}

export function preliminaryPopulation(bands16) {
  const p = new Int32Array(3);
  for (let i = 0; i < bands16.length; i++) p[bands16[i] >> 1]++;
  return p;
}

// Full derivation from measured cell means: the authoritative matrix and its
// reduction, in one object.
export function derive(means, crop, width, height) {
  const cls = classify(means);
  const bands16 = reduce16(cls.bands);
  return {
    version: DERIVATION_VERSION,
    n: N,
    source: { width, height },
    crop,
    clip: { lo: cls.lo, hi: cls.hi },
    bands: cls.bands,
    population: cls.population,
    preliminary: bands16,
    preliminaryPopulation: preliminaryPopulation(bands16)
  };
}

export function admissible(width, height) {
  return Math.min(width, height) >= MIN_SIDE;
}
