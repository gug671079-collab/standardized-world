/* A measured 100 mm line establishes the only physical scale for this screen. */
(() => {
  "use strict";

  const storageKey = "standard-world.physical-scale.v1";
  const referenceMm = 100;

  function displaySignature() {
    const { screen } = window;
    // Browser zoom normally changes devicePixelRatio. Pinch zoom is exposed separately.
    return JSON.stringify([
      screen.width, screen.height, screen.availLeft ?? null, screen.availTop ?? null,
      window.devicePixelRatio, window.visualViewport?.scale ?? 1
    ]);
  }

  function unavailable(reason) {
    return { calibrated: false, pxPerMm: null, reason };
  }

  function read() {
    let raw;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      return unavailable("storage-unavailable");
    }
    if (raw === null) return unavailable("missing");

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return unavailable("invalid");
    }
    if (!record || !Number.isFinite(record.pxPerMm) || record.pxPerMm <= 0 ||
        typeof record.display !== "string") return unavailable("invalid");
    if (record.display !== displaySignature()) return unavailable("changed-display");
    return { calibrated: true, pxPerMm: record.pxPerMm, reason: "calibrated" };
  }

  function save(referencePx) {
    if (!Number.isFinite(referencePx) || referencePx / referenceMm <= 0) {
      throw new RangeError("参考线长度必须是大于零的像素数。");
    }
    const pxPerMm = referencePx / referenceMm;
    window.localStorage.setItem(storageKey, JSON.stringify({ pxPerMm, display: displaySignature() }));
    const state = read();
    if (!state.calibrated || state.pxPerMm !== pxPerMm) {
      throw new Error("未能保存本屏的校准值。");
    }
    return state;
  }

  function factor(state) {
    if (!state?.calibrated || !Number.isFinite(state.pxPerMm) || state.pxPerMm <= 0) {
      throw new Error("请先用直尺校准当前展览屏。");
    }
    return state.pxPerMm;
  }

  window.ExhibitScale = {
    read, save, referenceMm,
    toPx: (mm, state = read()) => mm * factor(state),
    toMm: (cssPx, state = read()) => cssPx / factor(state)
  };
})();
