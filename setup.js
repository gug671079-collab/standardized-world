(function () {
  "use strict";

  const notices = {
    missing: "本设备尚未校准。",
    "changed-display": "屏幕或缩放已改变，请重新校准。",
    invalid: "已保存的校准记录无效，请重新校准。",
    "storage-unavailable": "当前浏览器无法读取本机校准记录。"
  };

  function formatPixels(value) {
    return Number(value.toFixed(2)).toString();
  }

  function savedStatus(state) {
    if (state.calibrated) {
      return "当前已保存 · 10 cm = " + formatPixels(state.pxPerMm * 100) + " CSS px";
    }
    return notices[state.reason] || "本设备尚未校准。";
  }

  let stopWatching = function () {};

  function open(onSaved) {
    stopWatching();
    const setupHash = location.hash;
    const panel = document.getElementById("calibration");
    const scale = window.ExhibitScale;
    const state = scale.read();
    panel.hidden = false;
    panel.innerHTML = `
      <div class="setup-inner">
        <header class="setup-header">
          <div>
            <p class="setup-kicker">布展设置</p>
            <h1>屏幕尺度校准</h1>
          </div>
          <button type="button" class="setup-back" data-back>返回观众入口</button>
        </header>
        <p class="setup-instructions">把实物尺贴近屏幕，将零刻度对准左端竖线的中心。调整线长，直到右端竖线的中心对准 10 cm 刻度。</p>
        <div class="setup-stage" data-stage>
          <div class="setup-line" data-line aria-hidden="true">
            <i class="setup-tick setup-tick-start" data-start><span>0</span></i>
            <i class="setup-tick setup-tick-end" data-end><span>10 cm</span></i>
          </div>
          <p class="setup-range-warning" data-warning hidden></p>
        </div>
        <div class="setup-control-row" role="group" aria-label="调整参考线长度">
          <label>参考线长度 <span class="setup-number"><input type="number" data-value min="1" step="any" inputmode="decimal" autocomplete="off" aria-label="参考线长度，CSS 像素"> CSS px</span></label>
          <div class="setup-steps">
            <button type="button" data-step="-10" aria-label="缩短 10 像素">−10</button>
            <button type="button" data-step="-1" aria-label="缩短 1 像素">−1</button>
            <button type="button" data-step="1" aria-label="加长 1 像素">+1</button>
            <button type="button" data-step="10" aria-label="加长 10 像素">+10</button>
          </div>
        </div>
        <div class="setup-footer">
          <div>
            <p class="setup-state" data-status></p>
            <p class="setup-note">初始线长仅供调节。更换屏幕、修改显示缩放或浏览器缩放后，请再用实物尺复核。</p>
          </div>
          <button type="button" class="setup-save" data-save>已与实物尺对齐，保存</button>
        </div>
        <p class="setup-feedback" role="status" aria-live="polite" data-feedback></p>
      </div>`;

    const get = (name) => panel.querySelector("[data-" + name + "]");
    const stage = get("stage");
    const line = get("line");
    const start = get("start");
    const end = get("end");
    const value = get("value");
    const save = get("save");
    const warning = get("warning");
    const status = get("status");
    const feedback = get("feedback");
    value.value = state.calibrated ? formatPixels(state.pxPerMm * 100) : Math.max(1, Math.min(378, stage.clientWidth - 48));
    if (onSaved) {
      save.textContent = "已与实物尺对齐，保存并开始画";
    }

    function measuredLength() {
      const a = start.getBoundingClientRect();
      const b = end.getBoundingClientRect();
      return (b.left + b.width / 2) - (a.left + a.width / 2);
    }

    function render() {
      const px = value.valueAsNumber;
      const isValid = Number.isFinite(px) && px >= 1;
      // Keep space for the full ticks and their labels at both ends.
      const fits = isValid && px <= stage.clientWidth - 48;
      line.hidden = !fits;
      warning.hidden = fits;
      save.disabled = !fits;
      if (fits) {
        line.style.width = px + "px";
      } else {
        warning.textContent = isValid
          ? "参考线超出可见宽度。请加宽窗口或横置屏幕，直至两端完整可见。"
          : "请输入大于或等于 1 的像素数。";
      }
      status.textContent = savedStatus(scale.read());
    }

    value.addEventListener("input", function () {
      feedback.textContent = "";
      render();
    });

    panel.querySelectorAll("[data-step]").forEach(function (button) {
      button.addEventListener("click", function () {
        const current = value.valueAsNumber;
        if (!Number.isFinite(current)) return;
        value.value = formatPixels(Math.max(1, current + Number(button.dataset.step)));
        feedback.textContent = "";
        render();
      });
    });

    save.addEventListener("click", function () {
      render();
      if (save.disabled) return;
      const length = measuredLength();
      if (!(length > 0)) return;
      try {
        status.textContent = savedStatus(scale.save(length));
        feedback.textContent = "校准已保存。现在可以返回观众入口。";
      } catch (error) {
        feedback.textContent = "保存失败。请检查浏览器是否允许本地存储，再点击保存。";
        return;
      }
      if (onSaved) {
        stopWatching();
        onSaved();
      }
    });

    get("back").addEventListener("click", function () {
      location.hash = "";
    });

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(render) : null;
    if (observer) observer.observe(stage);
    window.addEventListener("resize", render);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", render);
    function onLeave() {
      if (location.hash !== setupHash) stopWatching();
    }
    window.addEventListener("hashchange", onLeave);
    stopWatching = function () {
      if (observer) observer.disconnect();
      window.removeEventListener("resize", render);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", render);
      window.removeEventListener("hashchange", onLeave);
    };
    render();
  }

  window.ExhibitSetup = { open: open };
})();
