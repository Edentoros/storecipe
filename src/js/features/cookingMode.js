// Cooking mode: a full-screen, one-step-at-a-time view of a recipe's method,
// with timers for the times mentioned in a step, the ingredients a tap away,
// and the screen kept on. Leaving it (Exit, Back, Finish) resets everything:
// the next time starts at step 1, and no timer is left running anywhere.
(() => {
  const SWIPE_MIN_PX = 60;

  function createCookingMode({ container, i18n, helpers, onOpenChange, onServingsChange }) {
    const t = i18n ? (key, params) => i18n.t(key, params) : (key) => key;
    const { escapeHtml, scaleIngredientList, scaleAmountsInText, nextServings } = helpers;
    const { splitSteps, findTimes } = window.StorecipeCookingSteps;

    let recipe = null;
    let steps = [];
    let stepIndex = 0;
    let serves = 0;
    let originalServes = 0;
    let timers = [];
    let checked = new Set();
    let sheetOpen = false;
    let ringing = null; // the timer whose alert is showing
    let tickId = null;
    let audio = null;
    let alarmId = null;
    let nextTimerId = 1;

    // An earlier version kept progress per recipe on the device; drop it.
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("storecipe_cooking_"))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (_error) {
      /* nothing stored */
    }

    // ── Formatting ──────────────────────────────────────────────────────────

    // 600 → "10 min", 5400 → "1 h 30 min", 45 → "45 sec".
    function formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      const parts = [];
      if (h) parts.push(t("cook.hours", { n: h }));
      if (m) parts.push(t("cook.minutes", { n: m }));
      if (s && !h) parts.push(t("cook.seconds", { n: s }));
      return parts.join(" ") || t("cook.seconds", { n: 0 });
    }

    // 462 → "7:42", 3720 → "1:02:00".
    function formatClock(seconds) {
      const total = Math.max(0, Math.ceil(seconds));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = String(total % 60).padStart(2, "0");
      return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
    }

    function servingsRatio() {
      return originalServes > 0 && serves > 0 ? serves / originalServes : 1;
    }

    // Text with each time highlighted; tapping a time starts its timer.
    function timesHtml(text) {
      let html = "";
      let at = 0;
      for (const time of findTimes(text)) {
        const started = Boolean(timerFor(stepIndex, time.seconds));
        const label = t(started ? "cook.timerStarted" : "cook.startTimer", { time: formatDuration(time.seconds) });
        html += escapeHtml(text.slice(at, time.start));
        html += `<mark class="cooking-mode__time${started ? " is-started" : ""}" data-cook="start-timer" data-seconds="${time.seconds}" role="button" tabindex="0" aria-label="${escapeHtml(label)}"${started ? ' aria-disabled="true"' : ""}>${escapeHtml(text.slice(time.start, time.end))}</mark>`;
        at = time.end;
      }
      return html + escapeHtml(text.slice(at));
    }

    // The step's text: amounts scaled to the servings chosen, times highlighted.
    function stepHtml(text) {
      return scaleAmountsInText(text, servingsRatio())
        .map((piece) => (piece.scaled ? `<strong class="cooking-mode__amount">${escapeHtml(piece.text)}</strong>` : timesHtml(piece.text)))
        .join("");
    }

    // ── Timers ──────────────────────────────────────────────────────────────

    function remainingSeconds(timer) {
      return timer.endAt ? (timer.endAt - Date.now()) / 1000 : timer.remaining;
    }

    // The step's timer for that time, if it was started (one each, so a
    // double tap can't stack copies; cancelling it offers it again).
    function timerFor(step, seconds) {
      return timers.find((timer) => timer.step === step && timer.offer === seconds);
    }

    function startTimer(seconds, step) {
      if (timerFor(step, seconds)) return;
      unlockAudio();
      timers.push({ id: nextTimerId++, step, offer: seconds, seconds, endAt: Date.now() + seconds * 1000, remaining: seconds, done: false });
      ensureTicking();
      render();
    }

    function ensureTicking() {
      if (tickId === null && timers.length) tickId = window.setInterval(tick, 1000);
    }

    function tick() {
      if (!recipe) return;
      for (const timer of timers) {
        if (!timer.done && timer.endAt && remainingSeconds(timer) <= 0) {
          timer.done = true;
          if (!ringing) {
            ringing = timer;
            startAlarm();
            render();
          }
        }
      }
      // Only the clocks change between renders.
      container.querySelectorAll("[data-timer-clock]").forEach((clock) => {
        const timer = timers.find((item) => item.id === Number(clock.dataset.timerClock));
        if (timer) clock.textContent = formatClock(remainingSeconds(timer));
      });
      if (!timers.length) stopTicking();
    }

    function stopTicking() {
      if (tickId !== null) window.clearInterval(tickId);
      tickId = null;
    }

    function togglePause(id) {
      const timer = timers.find((item) => item.id === id);
      if (!timer || timer.done) return;
      if (timer.endAt) {
        timer.remaining = remainingSeconds(timer);
        timer.endAt = null;
      } else {
        timer.endAt = Date.now() + timer.remaining * 1000;
      }
      render();
    }

    function removeTimer(id) {
      timers = timers.filter((item) => item.id !== id);
      if (ringing && ringing.id === id) ringNext();
      render();
    }

    // After an alert is answered: another timer may have finished meanwhile.
    function ringNext() {
      ringing = timers.find((item) => item.done) || null;
      if (ringing) startAlarm();
      else stopAlarm();
    }

    function snooze(id) {
      const timer = timers.find((item) => item.id === id);
      if (!timer) return;
      timer.done = false;
      timer.endAt = Date.now() + 60 * 1000;
      timer.seconds += 60;
      ringNext();
      render();
    }

    // ── Alarm: beeps (Web Audio, unlocked by the tap that started a timer) and
    // vibration where the phone supports it. ────────────────────────────────

    function unlockAudio() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!audio && AudioContextClass) audio = new AudioContextClass();
        if (audio && audio.state === "suspended") void audio.resume();
      } catch (_error) {
        audio = null;
      }
    }

    function beep() {
      if (audio) {
        try {
          [0, 0.25, 0.5].forEach((offset) => {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, audio.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + offset + 0.18);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(audio.currentTime + offset);
            oscillator.stop(audio.currentTime + offset + 0.2);
          });
        } catch (_error) {
          /* no sound; the screen still shows the alert */
        }
      }
      if (typeof navigator.vibrate === "function") navigator.vibrate([300, 150, 300]);
    }

    function startAlarm() {
      stopAlarm();
      beep();
      alarmId = window.setInterval(beep, 1500);
    }

    function stopAlarm() {
      if (alarmId !== null) window.clearInterval(alarmId);
      alarmId = null;
      if (typeof navigator.vibrate === "function") navigator.vibrate(0);
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    const ICONS = {
      close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      list: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
      timer: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>',
      pause: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
      play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
      bell: '<svg viewBox="0 0 24 24" width="72" height="72" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'
    };

    function timerBarsHtml() {
      return timers
        .map((timer) => {
          const label = t("cook.timerLabel", { step: timer.step + 1, time: formatDuration(timer.seconds) });
          const paused = !timer.endAt && !timer.done;
          return `<div class="cooking-timer${timer.done ? " cooking-timer--done" : ""}">
            ${ICONS.timer}
            <div class="cooking-timer__text">
              <span class="cooking-timer__label">${escapeHtml(label)}${paused ? ` · ${escapeHtml(t("cook.paused"))}` : ""}</span>
              <span class="cooking-timer__clock" data-timer-clock="${timer.id}">${formatClock(remainingSeconds(timer))}</span>
            </div>
            ${timer.done
              ? ""
              : `<button type="button" class="cooking-mode__round" data-cook="pause" data-timer="${timer.id}" aria-label="${escapeHtml(t(paused ? "cook.resumeTimer" : "cook.pauseTimer"))}">${paused ? ICONS.play : ICONS.pause}</button>`}
            <button type="button" class="cooking-mode__round" data-cook="cancel" data-timer="${timer.id}" aria-label="${escapeHtml(t("cook.cancelTimer"))}">${ICONS.close}</button>
          </div>`;
        })
        .join("");
    }

    function ingredientsSheetHtml() {
      const lines = scaleIngredientList(recipe.ingredients || "", originalServes || 1, serves || originalServes || 1);
      const items = lines
        .map((line, index) => {
          const isHeading = line.text.endsWith(":") && line.text.length <= 60;
          if (isHeading) return `<p class="cooking-sheet__heading">${escapeHtml(line.text)}</p>`;
          return `<label class="cooking-sheet__item${checked.has(index) ? " is-checked" : ""}">
            <input type="checkbox" data-cook="check" data-index="${index}"${checked.has(index) ? " checked" : ""} />
            <span>${escapeHtml(line.text)}</span>
          </label>`;
        })
        .join("");
      return `<div class="cooking-sheet" role="dialog" aria-modal="true" aria-labelledby="cookingSheetTitle">
        <div class="cooking-sheet__panel">
          <div class="cooking-sheet__head">
            <h2 id="cookingSheetTitle">${escapeHtml(t("detail.ingredients"))}</h2>
            <button type="button" class="cooking-mode__pill" data-cook="close-sheet">${escapeHtml(t("cook.close"))}</button>
          </div>
          ${originalServes
            ? `<div class="cooking-sheet__servings">
                <button type="button" class="cooking-mode__round" data-cook="servings-down" aria-label="${escapeHtml(t("detail.scaleDown"))}"${serves <= 2 ? " disabled" : ""}>&minus;</button>
                <span class="cooking-sheet__servings-value" aria-live="polite">${escapeHtml(t("cook.forServings", { n: serves }))}</span>
                <button type="button" class="cooking-mode__round" data-cook="servings-up" aria-label="${escapeHtml(t("detail.scaleUp"))}"${serves >= 98 ? " disabled" : ""}>&plus;</button>
              </div>`
            : ""}
          <div class="cooking-sheet__list">${items}</div>
        </div>
      </div>`;
    }

    function alertHtml() {
      return `<div class="cooking-alert" role="alertdialog" aria-modal="true" aria-labelledby="cookingAlertTitle">
        <div class="cooking-alert__card">
          ${ICONS.bell}
          <h2 id="cookingAlertTitle">${escapeHtml(t("cook.timesUp"))}</h2>
          <p>${escapeHtml(t("cook.timerLabel", { step: ringing.step + 1, time: formatDuration(ringing.seconds) }))}</p>
          <p class="cooking-alert__note">${escapeHtml(t("cook.alarmNote"))}</p>
        </div>
        <div class="cooking-mode__nav">
          <button type="button" class="cooking-mode__secondary" data-cook="snooze" data-timer="${ringing.id}">${escapeHtml(t("cook.plusMinute"))}</button>
          <button type="button" class="cooking-mode__light" data-cook="dismiss" data-timer="${ringing.id}">${escapeHtml(t("cook.done"))}</button>
        </div>
      </div>`;
    }

    function render() {
      if (!recipe) return;
      const text = steps[stepIndex] || "";
      const times = findTimes(text);
      const amountsScaled = scaleAmountsInText(text, servingsRatio()).some((piece) => piece.scaled);
      const last = stepIndex === steps.length - 1;
      const tips = last && recipe.notes ? String(recipe.notes).trim() : "";
      const offers = times
        .filter((time, index, all) => all.findIndex((other) => other.seconds === time.seconds) === index)
        .map(
          (time) => {
            const started = Boolean(timerFor(stepIndex, time.seconds));
            const label = t(started ? "cook.timerStarted" : "cook.startTimer", { time: formatDuration(time.seconds) });
            return `<button type="button" class="cooking-mode__offer" data-cook="start-timer" data-seconds="${time.seconds}"${started ? " disabled" : ""}>
              ${ICONS.timer}<span>${escapeHtml(label)}</span>
            </button>`;
          }
        )
        .join("");
      const progress = steps
        .map((_step, index) => `<span class="${index <= stepIndex ? "is-done" : ""}"></span>`)
        .join("");

      container.innerHTML = `
        <div class="cooking-mode__top">
          <button type="button" class="cooking-mode__pill" data-cook="exit">${ICONS.close}<span>${escapeHtml(t("cook.exit"))}</span></button>
          <p class="cooking-mode__count" id="cookingStepLabel">${escapeHtml(t("cook.stepOf", { n: stepIndex + 1, total: steps.length }))}</p>
          <button type="button" class="cooking-mode__pill" data-cook="open-sheet">${ICONS.list}<span>${escapeHtml(t("detail.ingredients"))}</span></button>
        </div>
        <div class="cooking-mode__progress" style="grid-template-columns: repeat(${steps.length}, minmax(0, 1fr))" aria-hidden="true">${progress}</div>
        ${timers.length ? `<div class="cooking-mode__timers">${timerBarsHtml()}</div>` : ""}
        <div class="cooking-mode__body" data-cook-swipe>
          <p class="cooking-mode__step" tabindex="-1" aria-live="polite">${stepHtml(text)}</p>
          ${amountsScaled ? `<p class="cooking-mode__scaled-note">${escapeHtml(t("cook.amountsFor", { n: serves }))}</p>` : ""}
          ${offers ? `<div class="cooking-mode__offers">${offers}</div>` : ""}
          ${tips
            ? `<div class="cooking-mode__tip"><p class="cooking-mode__tip-label">${escapeHtml(t("cook.tip"))}</p><p>${escapeHtml(tips).replace(/\n/g, "<br />")}</p></div>`
            : ""}
        </div>
        ${steps.length > 1 ? `<p class="cooking-mode__hint">${escapeHtml(t("cook.swipeHint"))}</p>` : ""}
        <div class="cooking-mode__nav">
          <button type="button" class="cooking-mode__secondary" data-cook="prev"${stepIndex === 0 ? " disabled" : ""}>${escapeHtml(t("cook.previous"))}</button>
          ${last
            ? `<button type="button" class="cooking-mode__finish" data-cook="finish">${escapeHtml(t("cook.finish"))}</button>`
            : `<button type="button" class="cooking-mode__primary" data-cook="next">${escapeHtml(t("cook.next"))}</button>`}
        </div>
        ${sheetOpen ? ingredientsSheetHtml() : ""}
        ${ringing ? alertHtml() : ""}`;
    }

    // ── Opening, moving, closing ────────────────────────────────────────────

    function goTo(index) {
      const next = Math.max(0, Math.min(steps.length - 1, index));
      if (next === stepIndex) return;
      stepIndex = next;
      render();
      container.querySelector(".cooking-mode__step")?.focus({ preventScroll: true });
    }

    // options: { serves, originalServes } from the recipe page's scaler.
    function open(nextRecipe, options = {}) {
      recipe = nextRecipe;
      steps = splitSteps(recipe.method);
      if (!steps.length) {
        recipe = null;
        return false;
      }
      originalServes = Number.parseInt(options.originalServes, 10) || 0;
      serves = Number.parseInt(options.serves, 10) || originalServes;
      stepIndex = 0;
      timers = [];
      checked = new Set();
      sheetOpen = false;
      ringing = null;
      container.classList.remove("hidden");
      document.body.classList.add("is-cooking");
      // The page underneath can't be reached with Tab or a screen reader.
      for (const element of document.body.children) {
        if (element !== container && element.tagName !== "SCRIPT") element.inert = true;
      }
      onOpenChange?.(true, { recipeId: recipe.id });
      render();
      container.querySelector(".cooking-mode__step")?.focus({ preventScroll: true });
      return true;
    }

    // Stops every timer and forgets the step and ticks. viaBack: closed by the
    // browser's Back button (which already left the history entry cooking mode
    // added).
    function close({ finished = false, viaBack = false } = {}) {
      if (!recipe) return;
      stopTicking();
      stopAlarm();
      timers = [];
      ringing = null;
      checked = new Set();
      const recipeId = recipe.id;
      recipe = null;
      container.classList.add("hidden");
      container.innerHTML = "";
      document.body.classList.remove("is-cooking");
      for (const element of document.body.children) element.inert = false;
      onOpenChange?.(false, { recipeId, viaBack, finished });
    }

    function hasRunningTimers() {
      return timers.some((timer) => !timer.done);
    }

    // Leaving stops the timers, so ask first while one is still counting.
    function confirmLeave() {
      return !hasRunningTimers() || window.confirm(t("cook.exitWithTimers"));
    }

    function exit() {
      if (confirmLeave()) close();
    }

    function changeServings(direction) {
      const next = nextServings(serves || originalServes, direction);
      if (next === serves) return;
      serves = next;
      render();
      container.querySelector(`[data-cook='servings-${direction > 0 ? "up" : "down"}']`)?.focus();
      onServingsChange?.(serves);
    }

    // ── Events ──────────────────────────────────────────────────────────────

    container.addEventListener("click", (event) => {
      if (!recipe) return;
      const target = event.target.closest("[data-cook]");
      if (!target) {
        // A tap on the left or right half of the step goes back or forward,
        // like a swipe (not while selecting text).
        const onStep = event.target.closest(".cooking-mode__body");
        if (onStep && !event.target.closest("a, button, input, label") && !String(window.getSelection?.() || "")) {
          goTo(stepIndex + (event.clientX < window.innerWidth / 2 ? -1 : 1));
        }
        return;
      }
      const action = target.dataset.cook;
      const timerId = Number(target.dataset.timer);
      if (action === "next") goTo(stepIndex + 1);
      else if (action === "prev") goTo(stepIndex - 1);
      else if (action === "exit") exit();
      else if (action === "finish") close({ finished: true });
      else if (action === "start-timer") startTimer(Number(target.dataset.seconds), stepIndex);
      else if (action === "pause") togglePause(timerId);
      else if (action === "cancel" || action === "dismiss") removeTimer(timerId);
      else if (action === "snooze") snooze(timerId);
      else if (action === "servings-up") changeServings(1);
      else if (action === "servings-down") changeServings(-1);
      else if (action === "open-sheet") {
        sheetOpen = true;
        render();
        container.querySelector("[data-cook='close-sheet']")?.focus();
      } else if (action === "close-sheet") {
        sheetOpen = false;
        render();
      }
    });

    container.addEventListener("change", (event) => {
      const box = event.target.closest("[data-cook='check']");
      if (!box) return;
      const index = Number(box.dataset.index);
      if (box.checked) checked.add(index);
      else checked.delete(index);
      box.closest(".cooking-sheet__item")?.classList.toggle("is-checked", box.checked);
    });

    // Swipe left/right on the step to move between steps.
    let touchStart = null;
    container.addEventListener("touchstart", (event) => {
      if (!event.target.closest("[data-cook-swipe]") || event.touches.length !== 1) return;
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    container.addEventListener("touchend", (event) => {
      if (!touchStart || !recipe) return;
      const dx = event.changedTouches[0].clientX - touchStart.x;
      const dy = event.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5 || sheetOpen || ringing) return;
      goTo(stepIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });

    // Keyboard: arrows move, Escape closes the panel, then cooking mode.
    document.addEventListener("keydown", (event) => {
      if (!recipe || event.altKey || event.ctrlKey || event.metaKey) return;
      if (ringing) return;
      // A highlighted time is a button for the keyboard too.
      if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("mark[data-cook]")) {
        event.preventDefault();
        event.target.click();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (sheetOpen) {
          sheetOpen = false;
          render();
        } else {
          exit();
        }
      } else if (!sheetOpen && event.key === "ArrowRight") {
        event.preventDefault();
        goTo(stepIndex + 1);
      } else if (!sheetOpen && event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(stepIndex - 1);
      }
    });

    // Timers count against the clock, so after the phone wakes up they're
    // right at once (intervals don't run while the page is hidden).
    document.addEventListener("visibilitychange", () => {
      if (recipe && document.visibilityState === "visible") tick();
    });

    return {
      open,
      close,
      isOpen: () => Boolean(recipe),
      confirmLeave
    };
  }

  window.StorecipeCookingMode = { createCookingMode };
})();
