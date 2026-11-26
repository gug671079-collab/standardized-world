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
        <p class="setup-instructions" data-instructions></p>
        <div class="setup-workbench">
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
    const instructions = get("instructions");
    const controls = panel.querySelector(".setup-control-row");
    const footer = panel.querySelector(".setup-footer");
    const portrait = window.matchMedia("(max-width: 640px) and (orientation: portrait)");
    value.value = state.calibrated ? formatPixels(state.pxPerMm * 100) : "378";
    if (onSaved) {
      save.textContent = "已与实物尺对齐，保存并开始画";
    }

    function measuredLength() {
      const a = start.getBoundingClientRect();
      const b = end.getBoundingClientRect();
      return Math.hypot(b.left + b.width / 2 - a.left - a.width / 2,
        b.top + b.height / 2 - a.top - a.height / 2);
    }

    function render() {
      const px = value.valueAsNumber;
      const isValid = Number.isFinite(px) && px >= 1;
      const vertical = portrait.matches;
      const viewport = window.visualViewport;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const axis = vertical ? "vertical" : "horizontal";
      if (panel.dataset.axis !== axis || !instructions.textContent) {
        panel.dataset.axis = axis;
        instructions.textContent = vertical
          ? "竖放实物尺，微调线长，让上下两条横线的中心分别对准 0 和 10 cm。"
          : "将实物尺横放，零刻度对准左端竖线中心。调整线长，直到右端竖线中心对准 10 cm。";
        (vertical ? controls : footer).append(save);
        if (vertical) controls.append(feedback);
        else footer.after(feedback);
      }
      // Allow the longest line whose endpoints can be seen together.
      stage.style.height = vertical
        ? Math.min(Math.max(220, (isValid ? px : 378) + 50), viewHeight - 16) + "px" : "";
      const available = vertical ? Math.min(stage.clientHeight, viewHeight) : Math.min(stage.clientWidth, viewWidth);
      const fits = isValid && px <= available - 48;
      line.hidden = !fits;
      warning.hidden = fits;
      save.disabled = !fits;
      if (fits) {
        line.style.width = vertical ? "2px" : px + "px";
        line.style.height = vertical ? px + "px" : "2px";
      } else {
        warning.textContent = isValid
          ? (vertical ? "屏幕可见高度不足。请收起键盘、扩大窗口，或换用能完整显示 10 cm 的屏幕。"
            : "屏幕可见宽度不足。请加宽窗口或转动屏幕，让两端都能显示。")
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
      if (portrait.matches) {
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop ?? 0;
        const bottom = top + (viewport?.height ?? window.innerHeight);
        if (start.getBoundingClientRect().top < top || end.getBoundingClientRect().bottom > bottom) {
          stage.scrollIntoView({ block: "center", behavior: "instant" });
          feedback.textContent = "请核对上、下两个刻度，再点击保存。";
          return;
        }
      }
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
