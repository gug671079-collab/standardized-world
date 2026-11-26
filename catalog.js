/* A provisional geometric comparison. Source dimensions are millimetres.
 * The physical outline is independent of the reference photograph.
 */
(() => {
  "use strict";

  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const positive = n => Number.isFinite(n) && n > 0;
  const fmtCm = mm => Number((mm / 10).toFixed(4)).toString();
  const measuredCm = mm => Number((mm / 10).toFixed(2)).toString();

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    return total;
  }

  // Several separately drawn sides may still form one closed outline.
  function joinOutline(strokes, tolerance) {
    if (strokes.length > 8) return null;
    const remaining = strokes.slice(1);
    let path = strokes[0];
    while (remaining.length) {
      const last = path[path.length - 1];
      let best = Infinity, index = 0, reverse = false;
      remaining.forEach((segment, i) => {
        const head = distance(last, segment[0]);
        const tail = distance(last, segment[segment.length - 1]);
        if (Math.min(head, tail) < best) {
          best = Math.min(head, tail);
          index = i;
          reverse = tail < head;
        }
      });
      if (best > tolerance) return null;
      const next = remaining.splice(index, 1)[0];
      path = path.concat(reverse ? next.slice().reverse() : next);
    }
    if (path.length < 4 || distance(path[0], path[path.length - 1]) > tolerance) return null;
    return path.concat(path[0]);
  }

  // Arc-length sampling makes the result independent of pauses at a corner.
  function sampleRing(path) {
    const step = pathLength(path) / 96;
    const samples = [];
    if (!positive(step)) return samples;
    let walked = 0;
    for (let i = 1; i < path.length && samples.length < 96; i++) {
      const a = path[i - 1], b = path[i];
      const length = distance(a, b);
      if (!length) continue;
      while (samples.length < 96 && samples.length * step <= walked + length) {
        const fraction = (samples.length * step - walked) / length;
        samples.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
      }
      walked += length;
    }
    return samples;
  }

  function extent(points, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const x = p.x * c + p.y * s, y = -p.x * s + p.y * c;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { width: maxX - minX, height: maxY - minY, angle };
  }

  function measure(drawing) {
    if (!drawing || drawing.calibrated !== true) return null;
    const { widthMm, heightMm, pxPerMm, strokes } = drawing;
    if (![widthMm, heightMm].every(n => Number.isFinite(n) && n >= 0) || widthMm + heightMm === 0) return null;
    const outline = { shape: "outline", widthMm, heightMm };
    if (!Array.isArray(strokes)) return outline;
    if (!strokes.length) return null;
    if (!positive(pxPerMm) || !strokes.every(stroke => Array.isArray(stroke) && stroke.length >= 2 &&
        stroke.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)))) return outline;

    if (strokes.length === 1) {
      const path = strokes[0], a = path[0], b = path[path.length - 1];
      const chord = distance(a, b);
      if (chord > 0 && chord >= .945 * pathLength(path)) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const tolerance = Math.max(.35 * pxPerMm, .035 * chord);
        const straight = path.every(p =>
          Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / chord <= tolerance);
        if (straight) return { ...outline, shape: "line", lengthMm: chord / pxPerMm };
      }
    }

    const ring = joinOutline(strokes, Math.min(widthMm, heightMm) * pxPerMm * .18);
    if (!ring) return outline;
    const samples = sampleRing(ring);
    if (samples.length < 4) return outline;
    let twiceArea = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], b = samples[(i + 1) % samples.length];
      twiceArea += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(twiceArea) / 2;
    let box = extent(samples, 0);
    for (let degrees = -45; degrees <= 45; degrees += 3) {
      const candidate = extent(samples, degrees * Math.PI / 180);
      if (candidate.width * candidate.height < box.width * box.height) box = candidate;
    }
    if (!positive(box.width * box.height)) return outline;
    const fill = area / (box.width * box.height);
    if (fill >= .875) {
      const result = { ...outline, shape: "rectangle", sideXmm: widthMm, sideYmm: heightMm };
      if (Math.abs(box.angle) > 4 * Math.PI / 180) {
        const sides = extent(ring, box.angle);
        const nib = positive(drawing.strokeWidthPx) ? drawing.strokeWidthPx : 0;
        result.sideXmm = (sides.width + nib) / pxPerMm;
        result.sideYmm = (sides.height + nib) / pxPerMm;
      }
      return result;
    }
    const perimeter = pathLength(samples) + distance(samples[0], samples[samples.length - 1]);
    const circularity = 4 * Math.PI * area / perimeter ** 2;
    const aspect = Math.min(box.width, box.height) / Math.max(box.width, box.height);
    if (aspect >= .79 && fill >= .69 && fill <= .86 && circularity >= .86) {
      return { ...outline, shape: "circle", diameterMm: (widthMm + heightMm) / 2 };
    }
    return outline;
  }

  function limits(item, kind) {
    const lo = item[kind + "_min_mm"], hi = item[kind + "_max_mm"];
    if (positive(lo) && positive(hi) && hi >= lo) return [lo, hi];
    if (lo != null || hi != null) return null;
    const fixed = item[kind + "_mm"];
    return positive(fixed) ? [fixed, fixed] : null;
  }

  function compare(item, measurement) {
    if (!item || (measurement.shape !== "outline" && measurement.shape !== item.shape)) return null;
    const { widthMm, heightMm } = measurement;
    if (item.shape === "rectangle") {
      const short = item.short_mm, long = item.long_mm;
      if (!positive(short) || !positive(long) || short > long || !positive(widthMm) || !positive(heightMm)) return null;
      const x = measurement.sideXmm ?? widthMm, y = measurement.sideYmm ?? heightMm;
      const w = x >= y ? long : short, h = x >= y ? short : long;
      const score = Math.hypot(Math.log(x / w), Math.log(y / h)) / Math.SQRT2;
      return { item, score, key: "rect/" + short + "/" + long,
        geometry: { shape: "rectangle", widthMm: w, heightMm: h },
        sizeLabel: fmtCm(w) + " × " + fmtCm(h) + " cm" };
    }
    if (item.shape !== "line" && item.shape !== "circle") return null;
    if (item.shape === "line" && measurement.shape !== "line") return null;
    const circle = item.shape === "circle";
    const range = limits(item, circle ? "diameter" : "length");
    if (!range) return null;
    const [lo, hi] = range;
    const different = lo !== hi;
    const observed = circle ? (measurement.diameterMm ?? (widthMm + heightMm) / 2) : measurement.lengthMm;
    const delta = n => Math.log(n / Math.min(hi, Math.max(lo, n)));
    const score = circle && measurement.shape === "outline"
      ? Math.hypot(delta(widthMm), delta(heightMm)) / Math.SQRT2 : Math.abs(delta(observed));
    if (!Number.isFinite(score)) return null;
    const geometry = { shape: item.shape, widthMm: hi, heightMm: circle ? hi : 0 };
    if (different) geometry.minMm = lo;
    return { item, score, key: item.shape + "/" + lo + "/" + hi, geometry,
      sizeLabel: (circle ? "直径 " : "长度 ") + fmtCm(lo) + (different ? "–" + fmtCm(hi) : "") + " cm" };
  }

  function match(drawing, candidates = window.ExhibitItems) {
    const measurement = measure(drawing);
    if (!measurement || !Array.isArray(candidates)) return null;
    let best = null;
    const bySpec = new Map();
    for (const item of candidates) {
      const candidate = compare(item, measurement);
      if (!candidate) continue;
      if (!bySpec.has(candidate.key)) bySpec.set(candidate.key, []);
      bySpec.get(candidate.key).push(item);
      if (!best || candidate.score < best.score - 1e-10 ||
          (Math.abs(candidate.score - best.score) <= 1e-10 &&
           best.geometry.minMm !== undefined && candidate.geometry.minMm === undefined)) best = candidate;
    }
    if (!best) return null;
    const { item, geometry } = best;
    const { widthMm, heightMm } = measurement;
    let basis;
    if (measurement.shape === "line") {
      basis = "画迹两端相距 " + measuredCm(measurement.lengthMm) + " cm，按这段直线的长度对照。";
    } else if (measurement.shape === "circle") {
      basis = "画迹近圆，按实测宽高的平均值估算直径，约 " + measuredCm(measurement.diameterMm) + " cm。";
    } else if (measurement.shape === "rectangle") {
      basis = "画迹近矩形，按两条边约 " + measuredCm(measurement.sideXmm) + " × " + measuredCm(measurement.sideYmm) + " cm 对照。";
    } else {
      basis = "按画迹外围的宽高 " + measuredCm(widthMm) + " × " + measuredCm(heightMm) + " cm 对照。";
    }
    if (geometry.minMm !== undefined) {
      basis += geometry.shape === "circle" ? "两个圆分别表示资料所列直径的下限和上限。" : "中间刻线与末端分别表示资料所列长度的下限和上限。";
    }
    const equivalentItems = bySpec.get(best.key).filter(other => other !== item);
    if (equivalentItems.length) basis += "库中还有 " + equivalentItems.length + " 项具有相同对照尺寸。";
    const approximate = typeof item.specification_class === "string" && /近似|约值|估算/.test(item.specification_class);
    const sizeLabel = (approximate ? "约 " : "") + best.sizeLabel;
    return { item, measurement, geometry, sizeLabel, basis, equivalentItems };
  }

  window.ExhibitCatalog = { get entries() { return window.ExhibitItems || []; }, measure, match };
})();
