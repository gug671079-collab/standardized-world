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

  // Describe the museum's measurement in its original orientation and scope.
  // Comparing can rotate a rectangle and can show the upper bound of a range.
  const rectParts = {
    "单枚标签轮廓": "单枚标签", "纸张正面": "一张纸", "单张纸面": "一张纸",
    "封好后的信封平面": "封好后的信封", "封口后正面外沿": "封好后的信封",
    "表壳正面（不含表带）": "单独量表壳时，正面轮廓", "侧面外接框（口宽×高）": "从侧面量蛋筒口的宽和蛋筒的高，外框",
    "口部俯视外接框": "从上方量蛋筒口，外框", "展开平面外轮廓": "把书皮铺平，外轮廓",
    "正面外接框（最大宽×总高）": "从正面量最宽处和总高，外框", "正面外接框（宽×高）": "正面外框",
    "瓶身外径 × 瓶体总高": "从侧面量瓶身外径和总高，外框", "正面外接矩形（宽面）": "电池较宽的那一面",
    "闭合机身俯视外接矩形": "合上电脑后，从正上方量机身，外框",
    "显示器面板外接矩形；不含支架": "只量支架上方的显示器面板，外框",
    "收拢状态机身正面外接矩形": "将打印机收拢后，机身的正面外框",
    "机身俯视外接矩形": "从正上方量机身，外框"
  };

  const roundParts = {
    "单枚标签轮廓": "一枚圆贴的直径", "管端外圆": "管口的外径",
    "共同面外径": "硬币的直径", "币面外径": "硬币的直径", "正面外径": "硬币的直径",
    "软木球头外圆": "软木球头的直径", "羽毛裙端外圆": "羽毛张开一端的直径",
    "球体投影圆": "球的直径", "单球投影圆": "一颗球的直径", "冰球顶面": "冰球顶面的直径",
    "蛋筒底外径": "蛋筒底部的外径", "蛋筒口外径": "蛋筒开口的外径",
    "蛋挞俯视外径": "从上方量，蛋挞的外径", "最大外径（非杯口内径）": "从容器最宽处横量，外径",
    "俯视面包外缘直径": "量到面包外缘为止，直径", "壶身最大外圆（不含手柄）": "单独量壶身最宽处，直径",
    "标称直径": "从上方量，外缘直径", "俯视标称外径": "从上方量，外缘直径"
  };

  const lineParts = {
    "表壳长边（不含表带）": "单独量表壳，长边", "蛋筒高度": "从筒底到筒口的高度",
    "电池总高（轴向）": "沿电池中轴从一端量到另一端，长度", "电池总高": "电池两端之间的高度",
    "钟体外径长度": "沿钟面中心横量，钟体的外径", "罐体/瓶体高度": "从容器底部到顶部的高度",
    "总高度": "从底部到顶部的高度", "机身总宽度": "横向量机身，两侧之间的距离",
    "机身总高度": "从机身底部量到顶部，高度", "收拢状态机身深度": "收拢机身后，从前到后的深度",
    "俯视长轴长度": "沿长轴从一头量到另一头，长度", "长轴长度": "球体两个尖端之间的距离"
  };

  function describe(result) {
    const item = result?.item;
    if (!item) return "";
    const { view, category, shape, dimension_basis: basis = "", specification_class: spec = "" } = item;
    const approximate = /近似/.test(spec);
    const nominal = /^(标称|公称)/.test(spec);
    let lead = "", note = "";
    if (category === "纸张" && /^ISO 216\b/.test(item.standard)) lead = "按 ISO 216 裁切，";
    else if (category === "银行卡" && item.standard?.includes("ID-1")) lead = "按 ID-1 规格，";
    else if (basis.includes("比赛规则")) lead = "按比赛规则，";
    else if (spec === "具体型号" && !["不干胶标签", "电子钟"].includes(category)) lead = "按这款产品的规格，";
    else if (basis.includes("冲印")) lead = "按这一冲印规格，";

    let sentence;
    if (shape === "rectangle") {
      if (!positive(item.long_mm) || !positive(item.short_mm)) return "";
      const long = fmtCm(item.long_mm), short = fmtCm(item.short_mm);
      if (basis.includes("外径上限")) {
        sentence = "封口后的标称高度是 " + long + " cm，罐身外径上限是 " + short + " cm。";
      } else {
        const part = rectParts[view] || (category === "纸币" ? "一张纸币" :
          (view || "正面轮廓").replace("外接矩形", "外框").replace("单张相纸纸面", "一张相纸"));
        const qualifier = approximate ? "约" : nominal ? "标称为" : "";
        sentence = long === short
          ? part + "的两边一样长，边长" + qualifier + " " + long + " cm。"
          : part + "的长边" + qualifier + " " + long + " cm，短边" + qualifier + " " + short + " cm。";
      }
    } else if (shape === "circle" || shape === "line") {
      const span = limits(item, shape === "circle" ? "diameter" : "length");
      if (!span) return "";
      const [lo, hi] = span;
      const dimension = fmtCm(lo) + (lo === hi ? "" : " 至 " + fmtCm(hi)) + " cm";
      const part = shape === "circle" ? roundParts[view] || (category === "电子钟" ? "钟体正面的外径" : "外缘直径")
        : lineParts[view] || (view === "长边长度" ? "长边" : view === "短边长度" ? "短边" : "两端之间的距离");
      if (basis.includes("周长÷π")) {
        lead = "";
        sentence = "比赛规则给出的是球的周长，换算成直径约为 " + dimension + "。";
      } else if (basis.includes("外径上限") && shape === "line") {
        sentence = "封好罐口后，从罐底到罐顶的标称高度是 " + dimension + "。";
      } else {
        const verb = approximate ? "约为 " : nominal ? "标称为 " : lo === hi ? "是 " : "为 ";
        sentence = part + verb + dimension + "。";
        if (basis.includes("成品有变化")) note = "实际做出的三明治会有长短差异。";
      }
    } else return "";

    if (!note) {
      if (category === "平板电脑" && item.image_scope?.includes("含键盘")) note = "图中配有键盘，这里只量平板本身。";
      else if (item.image_type === "跨规格参考图") note = "配图借用其他规格作示意。";
      else if (item.image_type === "官方系列示例") note = "配图展示的是同系列产品。";
      else if (item.image_type === "官方包装图") note = "配图展示的是产品包装。";
    }
    return (lead + sentence + note).replace(/ {2,}/g, " ");
  }

  window.ExhibitCatalog = { get entries() { return window.ExhibitItems || []; }, measure, match, describe };
})();
