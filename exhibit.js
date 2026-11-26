(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const exhibit = $("exhibit");
  const viewport = $("viewport");
  const ink = $("ink");
  const drawing = $("drawing");
  const scale = window.ExhibitScale;
  const px = n => n + "px";
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  let scene = "idle";
  let calibration = scale.read();
  let strokes = [];
  let pen = null;
  let penWidth = 0;
  let result = null;
  let revealTimer = 0;

  function show(sceneName) {
    scene = sceneName;
    exhibit.dataset.scene = scene;
    $("poster").hidden = scene !== "idle";
    viewport.hidden = !["draw", "result"].includes(scene);
    $("drawing-ui").hidden = scene !== "draw";
    $("result-ui").hidden = scene !== "result";
    $("comparison").hidden = scene !== "result";
    $("calibration").hidden = scene !== "setup";
    exhibit.hidden = scene === "setup";
  }

  function updatePoster() {
    calibration = scale.read();
    const measured = calibration.calibrated;
    // Before setup this mark has no physical meaning. Keep its status attached.
    const width = measured ? scale.toPx(scale.referenceMm, calibration) : Math.min(300, innerWidth * .72);
    const vertical = measured && width > innerWidth - 12 && width + 64 < innerHeight * .85;
    $("poster").classList.toggle("vertical-reference", vertical);
    $("poster").style.setProperty("--reference-length", px(width));
    $("reference").style.width = px(width);
    const left = $("poster-title").parentElement.getBoundingClientRect().left;
    $("reference").style.marginLeft = px(Math.max(6, Math.min(left, innerWidth - width - 6)));
    $("calibration-note").hidden = measured;
  }

  function reset() {
    pen = null;
    strokes = [];
    result = null;
    drawing.replaceChildren();
    drawing.style.removeProperty("transform");
    clearTimeout(revealTimer);
    $("object-card").hidden = true;
    $("search-status").hidden = true;
    $("next").hidden = true;
    $("finish").disabled = true;
    $("prompt").classList.remove("faded");
  }

  function idle(focus = false) {
    show("idle");
    reset();
    updatePoster();
    if (focus) $("poster-title").focus({ preventScroll: true });
  }

  function route() {
    const resume = location.hash === "#calibrate/start";
    if (resume || location.hash === "#calibrate") {
      reset();
      show("setup");
      window.ExhibitSetup.open(resume ? () => {
        history.replaceState(history.state, "", "#");
        startDrawing();
      } : null);
    } else {
      idle();
    }
  }

  // A touch controller can send a complete pointer tap without synthesizing a
  // click after drawing. Prefer the native click, then recover a stationary tap.
  function onAction(button, activate) {
    let touch = null;
    let fallback = 0;
    button.addEventListener("click", () => {
      clearTimeout(fallback);
      if (!button.disabled && button.getClientRects().length) activate();
    });
    button.addEventListener("pointerdown", event => {
      if (event.pointerType === "touch" && event.isPrimary && !button.disabled) {
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    });
    button.addEventListener("pointercancel", () => { touch = null; });
    button.addEventListener("pointerup", event => {
      const tap = touch;
      touch = null;
      if (!tap || tap.id !== event.pointerId || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!button.contains(target)) return;
      clearTimeout(fallback);
      fallback = setTimeout(() => {
        if (!button.disabled && button.getClientRects().length) activate();
      }, 100);
    });
  }

  function startDrawing() {
    calibration = scale.read();
    if (!calibration.calibrated) {
      location.hash = "calibrate/start";
      return;
    }
    reset();
    show("draw");
    penWidth = scale.toPx(.68, calibration);
    drawing.setAttribute("stroke-width", penWidth);
    $("prompt").focus({ preventScroll: true });
  }
  onAction($("start"), startDrawing);

  function point(event) {
    const rect = ink.getBoundingClientRect();
    const radius = penWidth / 2;
    return {
      x: clamp(event.clientX - rect.left, radius, rect.width - radius),
      y: clamp(event.clientY - rect.top, radius, rect.height - radius)
    };
  }

  const coords = p => p.x.toFixed(2) + " " + p.y.toFixed(2);

  ink.addEventListener("pointerdown", event => {
    if (scene !== "draw" || pen || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const first = point(event);
    const path = document.createElementNS(ink.namespaceURI, "path");
    pen = { id: event.pointerId, points: [first], path, d: "M" + coords(first), started: false };
    ink.setPointerCapture(event.pointerId);
    $("prompt").classList.add("faded");
  });

  function extend(event) {
    const p = point(event);
    const last = pen.points[pen.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < .28) return;
    pen.points.push(p);
    // Finish the previous curve at its midpoint to keep the trace continuous.
    const mid = { x: (p.x + last.x) / 2, y: (p.y + last.y) / 2 };
    pen.d += " Q" + coords(last) + " " + coords(mid);
    if (!pen.started) {
      const first = pen.points[0];
      if (Math.hypot(p.x - first.x, p.y - first.y) < Math.max(2, scale.toPx(.8, calibration))) return;
      pen.started = true;
      drawing.append(pen.path);
    }
    pen.path.setAttribute("d", pen.d + " L" + coords(p));
  }

  ink.addEventListener("pointermove", event => {
    if (!pen || pen.id !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.() || [];
    samples.forEach(extend);
    extend(event);
  });

  function endStroke(event) {
    if (!pen || event.pointerId !== pen.id) return;
    if (event.type === "pointerup") extend(event);
    if (pen.started) strokes.push(pen.points);
    pen = null;
    $("finish").disabled = !strokes.length;
    $("prompt").classList.toggle("faded", !!strokes.length);
  }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => ink.addEventListener(type, endStroke));

  function arrangeComparison() {
    if (!result) return;
    const { bounds } = result;
    const area = $("art-slot").getBoundingClientRect();
    const frame = $("sketch-frame");
    const labelW = $("frame-width").offsetWidth;
    const topGap = $("frame-width").offsetHeight + 3;
    const usableW = Math.max(1, area.width - $("frame-height").offsetWidth - 4);
    const usableH = Math.max(1, area.height - topGap - 5);
    const ratio = Math.min(.68, usableW / bounds.width, usableH / bounds.height);
    const width = bounds.width * ratio, height = bounds.height * ratio;
    const left = Math.max((usableW - width) * .22, (labelW - width) / 2, 0);
    const top = topGap + (usableH - height) / 2;
    Object.assign(frame.style, { left:px(left), top:px(top), width:px(width), height:px(height) });
    frame.classList.toggle("thin-frame", height < 15);
    const x = area.left + left - bounds.x * ratio;
    const y = area.top + top - bounds.y * ratio;
    drawing.style.transform = "translate(" + px(x) + ", " + px(y) + ") scale(" + ratio + ")";
  }

  const cm = mm => Number((mm / 10).toFixed(2));
  function prepareCard(match) {
    const item = match?.item;
    $("object-name").textContent = item?.name || "暂无相近规格";
    $("object-name").classList.toggle("long-name", (item?.name.length || 0) > 14);
    $("object-description").textContent = item ? window.ExhibitCatalog.describe(match) : "物件库暂时没有可供比较的记录。";
    const photo = $("reference-photo");
    $("photo-reference").hidden = !item?.image_file;
    if (!item) return;
    if (item.image_file) {
      photo.alt = item.name + (item.image_scope ? "，" + item.image_scope : "");
      photo.style.setProperty("--photo-max-width", px(item.image_width_px * 1.65));
      photo.style.setProperty("--photo-max-height", px(item.image_height_px * 1.65));
      photo.src = item.image_file;
    }
  }

  onAction($("finish"), () => {
    if (scene !== "draw" || pen || !strokes.length) return;
    const current = scale.read();
    if (!current.calibrated || current.pxPerMm !== calibration.pxPerMm) return idle();
    // Take all measurements in drawing coordinates, before moving the same paths.
    const box = drawing.getBBox();
    const bounds = { x: box.x - penWidth / 2, y: box.y - penWidth / 2, width: box.width + penWidth, height: box.height + penWidth };
    const widthMm = scale.toMm(bounds.width, calibration), heightMm = scale.toMm(bounds.height, calibration);
    result = { bounds, match: null };
    $("frame-width").textContent = "宽 " + cm(widthMm) + " cm";
    $("frame-height").textContent = "高 " + cm(heightMm) + " cm";
    show("result");
    $("search-status").hidden = false;
    arrangeComparison();
    const frozen = result;
    requestAnimationFrame(() => {
      if (result !== frozen) return;
      frozen.match = window.ExhibitCatalog.match({ calibrated: true, widthMm, heightMm, strokes,
        boundsPx: bounds, strokeWidthPx: penWidth, pxPerMm: calibration.pxPerMm });
      prepareCard(frozen.match);
      revealTimer = setTimeout(() => {
        if (result !== frozen) return;
        $("search-status").hidden = true;
        $("object-card").hidden = false;
        $("next").hidden = false;
        arrangeComparison();
        $("next").focus({ preventScroll: true });
      }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 680);
    });
  });

  $("reference-photo").addEventListener("error", () => {
    $("photo-reference").hidden = true;
    if (scene === "result") arrangeComparison();
  });

  onAction($("next"), () => idle(true));
  function refresh() {
    if (scene === "setup") return;
    const current = scale.read();
    if (scene !== "idle" && (!current.calibrated || current.pxPerMm !== calibration.pxPerMm)) return idle();
    if (scene === "idle") updatePoster();
    if (scene === "result") arrangeComparison();
  }
  window.addEventListener("hashchange", route);
  ["resize", "focus", "pageshow", "storage"].forEach(type => window.addEventListener(type, refresh));
  window.visualViewport?.addEventListener("resize", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  // Moving an idle kiosk window to another display need not resize its viewport.
  window.setInterval(() => {
    if (document.hidden || scene === "setup") return;
    const state = scale.read();
    if (state.reason !== calibration.reason || state.pxPerMm !== calibration.pxPerMm) refresh();
  }, 750);
  document.fonts?.ready.then(refresh);
  route();
})();
