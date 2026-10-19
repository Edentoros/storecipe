(() => {
  function createThemeManager({ dom, state, config, helpers, supabaseServices, setAppStatus, i18n }) {
    const { themeOptions, sunsetInfoText } = dom;
    const { DEFAULT_THEME, THEME_LOCAL_KEY_PREFIX, THEME_PREFERENCES_TABLE } = config;
    const { normalizeTheme } = helpers;
    const { hasSupabaseConfig, fetchThemePreferenceViaRest, upsertThemePreferenceViaRest } = supabaseServices;
    const t = i18n ? (k, p) => i18n.t(k, p) : (k) => k;

    function getThemeStorageKey(userId) {
      return `${THEME_LOCAL_KEY_PREFIX}${userId}`;
    }

    const SUNSET_START_HOUR = 19;
    const SUNSET_END_HOUR = 7;
    let sunsetTimerId = null;

    function isSunsetDark() {
      const hour = new Date().getHours();
      return hour >= SUNSET_START_HOUR || hour < SUNSET_END_HOUR;
    }

    function formatHour(h) {
      return `${String(h).padStart(2, "0")}:00`;
    }

    // Sunset follows the clock, so say when it goes dark.
    function updateSunsetInfo() {
      if (!sunsetInfoText) return;
      const isSunset = state.currentTheme === "sunset";
      sunsetInfoText.textContent = t("theme.sunsetInfoBody", {
        start: formatHour(SUNSET_START_HOUR),
        end: formatHour(SUNSET_END_HOUR)
      });
      sunsetInfoText.classList.toggle("hidden", !isSunset);
    }

    function updateThemeToggleUi() {
      if (themeOptions) {
        themeOptions.querySelectorAll("[data-theme]").forEach((option) => {
          const isSelected = option.dataset.theme === state.currentTheme;
          option.setAttribute("aria-checked", isSelected ? "true" : "false");
          option.tabIndex = isSelected ? 0 : -1;
        });
      }
      updateSunsetInfo();
    }

    const ANONYMOUS_THEME_KEY = `${THEME_LOCAL_KEY_PREFIX}anonymous`;
    // The theme last shown on this device, whoever was signed in. Used while
    // the app starts (before it knows who is signed in) and when signed out,
    // so a dark-theme user never sees the light default flash up. bootTheme.js
    // reads it too.
    const DEVICE_THEME_KEY = `${THEME_LOCAL_KEY_PREFIX}device`;
    function readDeviceTheme() {
      try {
        const remembered = window.localStorage.getItem(DEVICE_THEME_KEY);
        if (remembered) return remembered;
        // Before this was remembered: any signed-in user's choice on this device.
        const userKey = Object.keys(window.localStorage).find(
          (key) => key.startsWith(THEME_LOCAL_KEY_PREFIX) && key !== ANONYMOUS_THEME_KEY && key !== DEVICE_THEME_KEY
        );
        return userKey ? window.localStorage.getItem(userKey) : null;
      } catch (_error) {
        return null;
      }
    }

    function applySunsetCheck() {
      const shouldBeDark = isSunsetDark();
      document.body.classList.toggle("theme-dark", shouldBeDark);
    }

    function startSunsetTimer() {
      stopSunsetTimer();
      applySunsetCheck();
      sunsetTimerId = window.setInterval(() => {
        if (state.currentTheme === "sunset") {
          applySunsetCheck();
        }
      }, 60 * 1000);
    }

    function stopSunsetTimer() {
      if (sunsetTimerId !== null) {
        window.clearInterval(sunsetTimerId);
        sunsetTimerId = null;
      }
    }

    function setTheme(theme, options = {}) {
      const { persistForCurrentUser = true } = options;
      const normalizedTheme = normalizeTheme(theme);
      state.currentTheme = normalizedTheme;

      if (normalizedTheme === "sunset") {
        startSunsetTimer();
      } else {
        stopSunsetTimer();
        document.body.classList.toggle("theme-dark", normalizedTheme === "dark");
      }
      updateThemeToggleUi();
      // The real theme is on: drop the early dark paint (bootTheme.js).
      document.documentElement.classList.remove("theme-dark-boot");
      try {
        window.localStorage.setItem(DEVICE_THEME_KEY, normalizedTheme);
      } catch (_error) {
        /* not remembered; the default is used next time */
      }

      if (persistForCurrentUser) {
        const key = state.currentUser?.id
          ? getThemeStorageKey(state.currentUser.id)
          : ANONYMOUS_THEME_KEY;
        window.localStorage.setItem(key, normalizedTheme);
      }
    }

    function isMissingThemePreferencesTable(error) {
      const message = String(error?.message || "").toLowerCase();
      return (
        message.includes(THEME_PREFERENCES_TABLE) &&
        (message.includes("relation") ||
          message.includes("table") ||
          message.includes("schema cache") ||
          message.includes("could not find"))
      );
    }

    async function loadThemePreference() {
      if (!state.currentUser) {
        const anonTheme = window.localStorage.getItem(ANONYMOUS_THEME_KEY) || readDeviceTheme();
        setTheme(anonTheme ? normalizeTheme(anonTheme) : DEFAULT_THEME, { persistForCurrentUser: false });
        return;
      }

      const userLocalTheme = window.localStorage.getItem(getThemeStorageKey(state.currentUser.id));
      const anonTheme = window.localStorage.getItem(ANONYMOUS_THEME_KEY);
      const localTheme = normalizeTheme(userLocalTheme || readDeviceTheme() || anonTheme);
      setTheme(localTheme, { persistForCurrentUser: false });

      if (!hasSupabaseConfig || !state.isThemePreferenceAvailable) {
        return;
      }

      try {
        const rows = await fetchThemePreferenceViaRest(state.currentUser.id);
        const serverTheme = rows[0]?.theme ? normalizeTheme(rows[0].theme) : null;
        if (serverTheme) {
          setTheme(serverTheme);
          return;
        }

        await upsertThemePreferenceViaRest(state.currentUser.id, state.currentTheme);
      } catch (error) {
        if (isMissingThemePreferencesTable(error)) {
          state.isThemePreferenceAvailable = false;
          setAppStatus("Theme prefs table missing. Run SQL setup to save theme per user.");
          return;
        }
      }
    }

    async function saveThemePreference(theme, options = {}) {
      const { quiet = false } = options;
      if (!state.currentUser || !hasSupabaseConfig || !state.isThemePreferenceAvailable) {
        return;
      }

      try {
        await upsertThemePreferenceViaRest(state.currentUser.id, theme);
      } catch (error) {
        if (isMissingThemePreferencesTable(error)) {
          state.isThemePreferenceAvailable = false;
          if (!quiet) {
            setAppStatus("Theme saved locally. Run SQL setup to sync theme to Supabase.");
          }
          return;
        }
        if (!quiet) {
          setAppStatus(`Theme save failed: ${error.message || "Unexpected error"}`);
        }
      }
    }

    return {
      updateThemeToggleUi,
      setTheme,
      loadThemePreference,
      saveThemePreference
    };
  }

  window.StorecipeThemeManager = { createThemeManager };
})();
