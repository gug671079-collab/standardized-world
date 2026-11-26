(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const exhibit = $("exhibit");
  const viewport = $("viewport");
  const world = $("world");
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
    world.style.removeProperty("width");
    world.style.removeProperty("height");
    viewport.scrollTo(0, 0);
    viewport.removeAttribute("tabindex");
    viewport.removeAttribute("aria-label");
    $("comparison").classList.remove("entering");
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

  function place(element, x, y, width) {
    element.style.left = px(x);
    element.style.top = px(y);
    element.style.width = px(width);
  }

  function arrangeComparison() {
    const { bounds, match } = result;
    const item = match?.item;
    const viewW = viewport.clientWidth;
    const viewH = viewport.clientHeight;
    const margin = clamp(viewW * .085, 27, 170);
    const gap = clamp(viewW * .082, 46, 164);
    const geometry = match?.geometry;
    const displayW = geometry ? scale.toPx(geometry.widthMm, calibration) : 0;
    // A one-dimensional record has no physical thickness. The extra vertical
    // space is solely for its two endpoint ticks.
    const displayH = geometry?.shape === "line" ? 18 : geometry ? scale.toPx(geometry.heightMm, calibration) : 0;
    const textW = clamp(viewW * .32, Math.min(255, viewW - 2 * margin), 570);
    const rightW = Math.max(textW, displayW);
    const leftW = Math.max(bounds.width, Math.min(150, textW), viewW - 2 * margin - gap - rightW);
    const rightX = margin + leftW + gap;
    const itemX = rightX + (rightW - displayW) / 2;
    const textX = rightX + (rightW - textW) / 2;
    const caption = $("object-caption");
    caption.style.width = px(textW);
    const captionH = caption.offsetHeight;
    const belowImage = item ? 24 : 0;
    const upper = Math.max(bounds.height / 2, displayH / 2);
    const lower = Math.max(bounds.height / 2 + 67, displayH / 2 + belowImage + captionH);
    const paddingY = clamp(viewH * .075, 28, 100);
    const fullH = Math.max(viewH, upper + lower + 2 * paddingY);
    const centerY = (fullH - upper - lower) / 2 + upper;
    const artX = margin + (leftW - bounds.width) / 2;
    const artY = centerY - bounds.height / 2;
    const fullW = rightX + rightW + margin;
    world.style.width = px(Math.ceil(fullW));
    world.style.height = px(Math.ceil(fullH));
    drawing.style.transform = "translate(" + px(artX - bounds.x) + ", " + px(artY - bounds.y) + ")";
    place($("art-caption"), artX, artY + bounds.height + 17, bounds.width);
    place($("object-position"), itemX, centerY - displayH / 2, displayW);
    $("object-position").style.height = px(displayH);
    const limit = $("range-limit");
    limit.hidden = !geometry?.minMm;
    if (!limit.hidden) {
      const min = px(scale.toPx(geometry.minMm, calibration));
      if (geometry.shape === "circle") {
        limit.style.width = limit.style.height = min;
        limit.style.removeProperty("left");
      } else {
        limit.style.removeProperty("width");
        limit.style.removeProperty("height");
        limit.style.left = min;
      }
    }
    place(caption, textX, centerY + displayH / 2 + belowImage, textW);
    const horizontal = fullW > viewW + 1;
    const vertical = fullH > viewH + 1;
    $("pan-help").hidden = !(horizontal || vertical);
    $("pan-help").textContent = horizontal && vertical ? "滑动画面，原大对照" : horizontal ? "左右滑动，原大对照" : "上下滑动，原大对照";
  }

  onAction($("finish"), () => {
    if (scene !== "draw" || pen || !strokes.length) return;
    const current = scale.read();
    if (!current.calibrated || current.pxPerMm !== calibration.pxPerMm) return idle();
    const box = drawing.getBBox();
    const bounds = { x: box.x - penWidth / 2, y: box.y - penWidth / 2, width: box.width + penWidth, height: box.height + penWidth };
    const widthMm = scale.toMm(bounds.width, calibration);
    const heightMm = scale.toMm(bounds.height, calibration);
    const match = window.ExhibitCatalog.match({ calibrated: true, widthMm, heightMm, strokes,
      boundsPx: bounds, strokeWidthPx: penWidth, pxPerMm: calibration.pxPerMm });
    result = { bounds, match };
    const item = match?.item;
    $("art-size").textContent = "画稿宽 " + (widthMm / 10).toFixed(2) + " cm";
    $("object-position").hidden = !item;
    $("standard-object").dataset.shape = match?.geometry.shape || "";
    $("standard-object").setAttribute("aria-label", item ? item.view + "，" + match.sizeLabel : "");
    $("object-size").textContent = match?.sizeLabel || "";
    $("object-name").textContent = item?.name || "暂无可对照的规格";
    $("object-name").classList.toggle("long-name", (item?.name.length || 0) > 12);
    if (item) {
      const source = item.standard || item.dimension_basis;
      $("object-description").textContent = "图中量的是" + item.view + "。" + (source ? "规格依据为" + source + "。" : "");
    } else {
      $("object-description").textContent = "这次保留了你的画稿和实测宽度。";
    }
    $("match-basis").textContent = match?.basis || "";
    $("photo-reference").hidden = !item?.image_file;
    if (item?.image_file) {
      $("reference-photo").src = item.image_file;
      $("reference-photo").alt = item.name + "的参考图";
      $("photo-scope").textContent = item.image_scope || "";
    }
    show("result");
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", "画稿与标准物原大对照，可滚动查看");
    viewport.scrollTo(0, 0);
    arrangeComparison();
    $("comparison").classList.add("entering");
    $("next").focus({ preventScroll: true });
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
