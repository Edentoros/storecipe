(() => {
  function createSettingsManager({ dom, state }) {
    const { authPanel, settingsBackdrop, settingsButton, languageOptions, signOutButton, authEmail } = dom;

    function getSettingsFocusableElements() {
      if (!authPanel) return [];
      const selectors = "button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])";
      return Array.from(authPanel.querySelectorAll(selectors)).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hasAttribute("disabled")) return false;
        if (element.classList.contains("hidden")) return false;
        if (element.offsetParent === null) return false;
        return true;
      });
    }

    function positionSettingsPanel() {
      if (!authPanel || !settingsButton || !state.isSettingsOpen || !state.currentUser) return;

      const buttonRect = settingsButton.getBoundingClientRect();
      const panelRect = authPanel.getBoundingClientRect();
      const gap = 8;
      const viewportPadding = 8;

      const preferredLeft = buttonRect.right - panelRect.width;
      const maxLeft = window.innerWidth - panelRect.width - viewportPadding;
      const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));

      let top = buttonRect.bottom + gap;
      const maxTop = window.innerHeight - panelRect.height - viewportPadding;
      if (top > maxTop) {
        top = Math.max(viewportPadding, buttonRect.top - panelRect.height - gap);
      }

      authPanel.style.top = `${Math.round(top)}px`;
      authPanel.style.left = `${Math.round(left)}px`;
    }

    function setSettingsOpen(nextOpen, options = {}) {
      const { returnFocus = true } = options;
      const canOpenPopup = Boolean(state.currentUser);
      const shouldOpen = canOpenPopup && Boolean(nextOpen);

      if (shouldOpen && !state.isSettingsOpen) {
        state.lastFocusedBeforeSettings = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }

      state.isSettingsOpen = shouldOpen;

      if (authPanel) {
        authPanel.classList.toggle("hidden", canOpenPopup ? !shouldOpen : false);
      }
      if (settingsBackdrop) {
        settingsBackdrop.classList.toggle("hidden", !shouldOpen);
      }

      if (settingsButton) {
        settingsButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      }

      if (shouldOpen) {
        window.requestAnimationFrame(() => {
          positionSettingsPanel();
          const preferred =
            languageOptions?.querySelector("[aria-checked='true']") ||
            (!signOutButton.classList.contains("hidden") ? signOutButton : authEmail);
          preferred?.focus();
        });
        return;
      }

      if (authPanel) {
        authPanel.style.removeProperty("top");
        authPanel.style.removeProperty("left");
      }

      if (!returnFocus) return;
      const fallback = settingsButton || null;
      const target =
        state.lastFocusedBeforeSettings instanceof HTMLElement && document.contains(state.lastFocusedBeforeSettings)
          ? state.lastFocusedBeforeSettings
          : fallback;
      target?.focus();
      state.lastFocusedBeforeSettings = null;
    }

    return {
      getSettingsFocusableElements,
      positionSettingsPanel,
      setSettingsOpen
    };
  }

  window.StorecipeSettingsManager = { createSettingsManager };
})();
