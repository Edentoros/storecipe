(() => {
  // The panel under the import link box: progress while a recipe is imported,
  // and a clear warning when it can't be.
  const PROGRESS_STEPS = ["opening", "reading", "tidying", "saving"];
  // The server does the first three steps in one request, so they advance on
  // a timer; "tidying" then waits for the reply, and "saving" is real.
  const STEP_DELAYS_MS = { reading: 1200, tidying: 3500 };
  const SLOW_AFTER_MS = 15000;

  // Which problems the user can fix by changing the link, and which are worth retrying.
  const ERROR_TONES = {
    invalid_url: "warning",
    not_recipe: "warning",
    not_html: "warning",
    no_readable_text: "warning",
    url_blocked: "warning",
    fetch_failed: "warning",
    quota_exceeded: "warning",
    not_recipe_text: "warning",
    not_recipe_photo: "warning",
    invalid_text: "warning",
    invalid_image: "warning"
  };
  const RETRYABLE = new Set(["fetch_failed", "ai_failed", "service_unreachable", "server_error"]);
  const NO_NEW_LINK = new Set([
    "quota_exceeded", "unauthenticated", "ai_unavailable", "quota_unavailable", "not_deployed", "busy",
    "not_recipe_photo", "invalid_image"
  ]);
  // Several server codes mean the same thing to the user.
  const CODE_ALIASES = { quota_unavailable: "ai_unavailable", not_deployed: "ai_unavailable", invalid_request: "server_error" };

  const ICONS = {
    warning:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5 2.5 20h19L12 3.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.2" fill="currentColor"/></svg>',
    error:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.3" r="1.2" fill="currentColor"/></svg>'
  };

  function createImportNotice({ container, input, wrapper, i18n, onRetry, onManual }) {
    const t = i18n ? (k, p) => i18n.t(k, p) : (k) => k;
    let timers = [];

    function clearTimers() {
      timers.forEach((id) => window.clearTimeout(id));
      timers = [];
    }

    function setInputInvalid(isInvalid) {
      if (!input) return;
      input.classList.toggle("is-invalid", isInvalid);
      if (isInvalid) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", container.id);
      } else {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    }

    function render(node, state) {
      container.replaceChildren(node);
      container.classList.remove("hidden");
      if (wrapper) {
        wrapper.classList.toggle("recipe-import-tools--busy", state === "progress");
        wrapper.classList.toggle("recipe-import-tools--has-error", state === "error");
      }
    }

    function clear() {
      clearTimers();
      container.replaceChildren();
      container.classList.add("hidden");
      setInputInvalid(false);
      if (wrapper) wrapper.classList.remove("recipe-import-tools--busy", "recipe-import-tools--has-error");
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    // kind: "url" (a link), "text" or "photo". Text and photos have no page
    // to open, so they start at "reading".
    function showProgress(site, kind = "url") {
      clear();
      const card = el("div", "import-notice import-notice--progress");
      card.setAttribute("role", "status");

      const steps = kind === "url" ? PROGRESS_STEPS : PROGRESS_STEPS.slice(1);
      const title = kind === "url" ? t("import.progress.title", { site }) : t(`import.progress.title.${kind}`);
      const head = el("div", "import-notice__head");
      head.append(el("span", "import-notice__spinner"), el("strong", "import-notice__title", title));

      const list = el("ol", "import-notice__steps");
      const items = steps.map((step) => {
        const item = el("li", "import-notice__step");
        item.dataset.step = step;
        const label = kind !== "url" && step === "reading" ? t(`import.progress.reading.${kind}`) : t(`import.progress.${step}`);
        item.append(el("span", "import-notice__step-mark"), el("span", "", label));
        list.append(item);
        return item;
      });

      const foot = el("p", "import-notice__foot", t("import.progress.wait"));
      card.append(head, list, foot);
      render(card, "progress");

      const setStep = (step) => {
        const index = steps.indexOf(step);
        if (index === -1) return;
        items.forEach((item, i) => {
          item.classList.toggle("is-done", i < index);
          item.classList.toggle("is-active", i === index);
        });
      };
      setStep(steps[0]);
      timers.push(window.setTimeout(() => setStep("reading"), STEP_DELAYS_MS.reading));
      timers.push(window.setTimeout(() => setStep("tidying"), STEP_DELAYS_MS.tidying));
      timers.push(window.setTimeout(() => (foot.textContent = t("import.progress.slow")), SLOW_AFTER_MS));

      // Called when the page has been read and the recipe is being saved.
      return {
        saving() {
          clearTimers();
          setStep("saving");
          foot.textContent = t("import.progress.wait");
        }
      };
    }

    // code: an import error code (see import.notice.* in i18n), or "save_failed".
    function showError({ code, site, message }) {
      clearTimers();
      const key = CODE_ALIASES[code] || code;
      const known = t(`import.notice.${key}.title`) !== `import.notice.${key}.title`;
      const noticeKey = known ? key : "unknown";
      const tone = ERROR_TONES[key] || (key === "save_failed" ? "warning" : "error");

      const card = el("div", `import-notice import-notice--${tone}`);
      card.setAttribute("role", "alert");
      const icon = el("span", "import-notice__icon");
      icon.innerHTML = ICONS[tone];

      const body = el("div", "import-notice__body");
      body.append(
        el("strong", "import-notice__title", t(`import.notice.${noticeKey}.title`)),
        el("p", "import-notice__text", t(`import.notice.${noticeKey}.body`, { site: site || "", error: message || "" }))
      );

      const actions = el("div", "import-notice__actions");
      const addAction = (label, handler, primary) => {
        const button = el("button", `import-notice__action${primary ? " import-notice__action--primary" : ""}`, label);
        button.type = "button";
        button.addEventListener("click", handler);
        actions.append(button);
      };
      if (key !== "save_failed") {
        if (RETRYABLE.has(key)) {
          addAction(t("import.notice.retry"), () => onRetry?.(), true);
        }
        if (!NO_NEW_LINK.has(key)) {
          addAction(
            t("import.notice.newLink"),
            () => {
              clear();
              if (input) {
                input.value = "";
                input.focus();
              }
            },
            !RETRYABLE.has(key)
          );
        }
        addAction(t("import.notice.manual"), () => {
          clear();
          onManual?.();
        });
      }
      if (actions.childElementCount) body.append(actions);

      card.append(icon, body);
      render(card, "error");
      // Only blame the link when the link is the problem.
      setInputInvalid(tone === "warning" && key !== "quota_exceeded" && key !== "save_failed");
    }

    // Editing the link means the user is acting on the warning: clear it.
    if (input) {
      input.addEventListener("input", () => {
        if (wrapper?.classList.contains("recipe-import-tools--has-error")) clear();
      });
    }

    return { showProgress, showError, clear };
  }

  // Finds the link in whatever was pasted: a bare address ("bbcgoodfood.com/…"),
  // or a link inside shared text ("Look at this! https://…").
  function extractImportUrl(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return "";
    const trimPunctuation = (url) => url.replace(/[)\].,;:!?'"»]+$/, "");
    const found = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (found) return trimPunctuation(found[0]);
    const www = raw.match(/\bwww\.[a-z0-9-]+(\.[a-z0-9-]+)+[^\s<>"']*/i);
    if (www) return `https://${trimPunctuation(www[0])}`;
    // A bare address needs a real top-level domain, so "1.5" isn't taken for one.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(raw)) return `https://${trimPunctuation(raw)}`;
    return raw;
  }

  window.StorecipeImportNotice = { createImportNotice, extractImportUrl };
})();
