// Public page for a recipe shared by link (share.html?token=…). Anyone with the
// link can read it; "Save to my recipes" sends them to the app (?save=…), which
// signs them in if needed and saves a copy. The recipe comes from the
// shared-recipe edge function: the recipes table itself isn't readable here.
(() => {
  const config = window.StorecipeConfig || {};
  const SUPABASE_URL = config.SUPABASE_URL || "";
  const SUPABASE_KEY = config.SUPABASE_PUBLISHABLE_KEY || "";
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const helpers = window.StorecipeHelpers;
  const { scaleIngredientList } = window.StorecipeIngredientParser;
  const { escapeHtml, renderIngredientListHtml, renderMethodListHtml, parseDurationText, normalizeDifficulty } = helpers;

  // Same language and theme as the app, if this browser has used it.
  function storedPreference(prefix) {
    try {
      const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
      // A signed-in user's choice beats the signed-out one.
      const key = keys.find((k) => !k.endsWith("anonymous")) || keys[0];
      return key ? window.localStorage.getItem(key) : null;
    } catch (_error) {
      return null;
    }
  }
  const language = storedPreference("storecipe_language_") ||
    (String(navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en");
  const i18n = window.StorecipeI18n.createI18n({ defaultLocale: language === "ru" ? "ru" : "en" });
  const t = (key, params) => i18n.t(key, params);
  document.documentElement.lang = i18n.getLocale ? i18n.getLocale() : language;
  i18n.applyToDom(document);

  const theme = storedPreference("storecipe_theme_");
  const hour = new Date().getHours();
  const dark = theme === "dark" || (theme === "sunset" && (hour >= 19 || hour < 7));
  document.body.classList.toggle("theme-dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1622" : "#f8f5ee");

  // Signed in to Storecipe in this browser? (Only changes the button's wording;
  // the app checks properly.)
  function looksSignedIn() {
    try {
      return Object.keys(window.localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
    } catch (_error) {
      return false;
    }
  }

  const container = document.getElementById("sharedContent");
  const cta = document.getElementById("sharedCta");
  const token = new URLSearchParams(window.location.search).get("token") || "";

  function showMessage(title, body) {
    container.innerHTML = `
      <div class="shared-page__message">
        <h2>${escapeHtml(title)}</h2>
        ${body ? `<p>${escapeHtml(body)}</p>` : ""}
        <a class="button" href="./">${escapeHtml(t("share.page.openApp"))}</a>
      </div>`;
  }

  function minutesOf(text) {
    const parsed = parseDurationText(text || "");
    return Number(parsed.hours || 0) * 60 + Number(parsed.minutes || 0);
  }

  function metaHtml(recipe) {
    const prep = minutesOf(recipe.prep_time);
    const cook = minutesOf(recipe.cooking_time);
    const total = minutesOf(recipe.total_time) || prep + cook;
    const difficulty = normalizeDifficulty(recipe.difficulty, 4);
    const bars = Array.from({ length: 10 }, (_, i) => `<span${i < difficulty ? ' class="is-on"' : ""}></span>`).join("");
    const items = [
      [t("detail.metaPrep"), prep ? escapeHtml(i18n.formatDuration(prep)) : ""],
      [t("detail.metaCook"), cook ? escapeHtml(i18n.formatDuration(cook)) : ""],
      [t("detail.metaTotal"), total ? escapeHtml(i18n.formatDuration(total)) : ""],
      [t("detail.metaServes"), recipe.serves ? escapeHtml(String(recipe.serves)) : ""],
      [t("detail.metaDifficulty"), recipe.difficulty
        ? `${escapeHtml(i18n.getDifficultyLabel(difficulty))}<span class="difficulty-meter" aria-hidden="true">${bars}</span>`
        : ""]
    ].filter(([, value]) => value);
    if (!items.length) return "";
    return `<div class="recipe-detail-card__meta" aria-label="${escapeHtml(t("detail.metaLabel"))}">${items
      .map(([label, value]) => `<p class="recipe-detail-card__meta-item"><span class="recipe-stat"><span class="recipe-stat__label">${escapeHtml(label)}</span><span class="recipe-stat__value">${value}</span></span></p>`)
      .join("")}</div>`;
  }

  function sourceHtml(recipe) {
    try {
      const url = recipe.source_url ? new URL(String(recipe.source_url)) : null;
      if (!url || !/^https?:$/.test(url.protocol)) return "";
      const site = url.hostname.replace(/^www\./, "");
      return ` <a class="recipe-detail-card__source" href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("detail.source", { site }))} ↗</a>`;
    } catch (_error) {
      return "";
    }
  }

  function render({ recipe, photoUrl, sharedBy }) {
    document.title = `${recipe.title || "Storecipe"} – Storecipe`;
    const serves = Number.parseInt(recipe.serves, 10) || 0;
    const saveHref = `./?save=${encodeURIComponent(token)}`;
    const saveLabel = looksSignedIn() ? t("share.page.save") : t("share.page.signInToSave");
    const image = photoUrl
      ? `<div class="recipe-detail-card__image-wrap" style="--detail-img: url('${escapeHtml(photoUrl)}')"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(recipe.title || "")}" /></div>`
      : `<div class="recipe-detail-card__image recipe-detail-card__image--placeholder" data-category="${escapeHtml(recipe.category || "other")}" aria-hidden="true"></div>`;
    const category = recipe.category
      ? `<span class="recipe-detail-card__category-badge">${escapeHtml(i18n.formatCategory(recipe.category))}</span>`
      : "";

    container.innerHTML = `
      <article class="recipe-detail-card shared-recipe">
        ${image}
        <div class="recipe-detail-card__header">
          <div class="recipe-detail-card__title-row"><h2>${escapeHtml(recipe.title || "")}</h2></div>
          <p class="recipe-detail-card__date">${sharedBy ? `${escapeHtml(t("share.page.sharedBy", { name: sharedBy }))} ` : ""}${category}${sourceHtml(recipe)}</p>
          ${recipe.description ? `<p class="recipe-detail-card__description">${escapeHtml(recipe.description).replace(/\n/g, "<br />")}</p>` : ""}
          <a class="button shared-recipe__save" href="${escapeHtml(saveHref)}">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            <span>${escapeHtml(saveLabel)}</span>
          </a>
        </div>
        ${metaHtml(recipe)}
        <div class="recipe-detail-card__columns">
          <section class="recipe-detail-card__section" data-field="ingredients">
            <h3 class="recipe-detail-card__editable-title"><span>${escapeHtml(t("detail.ingredients"))}</span></h3>
            ${serves ? `<div class="serving-scaler">
              <button type="button" class="serving-scaler__btn" data-action="scale-down" aria-label="${escapeHtml(t("detail.scaleDown"))}">&minus;</button>
              <span class="serving-scaler__value" data-scale-display>${serves}</span>
              <span class="serving-scaler__label">${escapeHtml(t("detail.servings"))}</span>
              <button type="button" class="serving-scaler__btn" data-action="scale-up" aria-label="${escapeHtml(t("detail.scaleUp"))}">&plus;</button>
              <button type="button" class="serving-scaler__reset button--ghost hidden" data-action="scale-reset">${escapeHtml(t("detail.scaleReset"))}</button>
            </div>` : ""}
            <div class="recipe-detail-card__editable recipe-detail-card__editable--readonly" data-ingredients>${renderIngredientListHtml(recipe.ingredients)}</div>
            ${serves ? `<p class="scale-note hidden" data-scale-note="ingredients"></p>` : ""}
          </section>
          <section class="recipe-detail-card__section" data-field="method">
            <h3 class="recipe-detail-card__editable-title"><span>${escapeHtml(t("detail.method"))}</span></h3>
            <div class="recipe-detail-card__editable recipe-detail-card__editable--readonly">${renderMethodListHtml(recipe.method)}</div>
            ${serves ? `<p class="scale-note hidden" data-scale-note="method"></p>` : ""}
          </section>
        </div>
        ${recipe.notes
          ? `<section class="recipe-detail-card__section" data-field="notes">
              <h3 class="recipe-detail-card__editable-title"><span>${escapeHtml(t("detail.notes"))}</span></h3>
              <div class="recipe-detail-card__editable recipe-detail-card__editable--readonly">${escapeHtml(recipe.notes).replace(/\n/g, "<br />")}</div>
            </section>`
          : ""}
      </article>`;

    if (serves) attachScaler(recipe.ingredients || "", serves);
    if (!looksSignedIn()) cta.classList.remove("hidden");
  }

  // Same behaviour as the app's scaler (steps of 1, greyed lines it can't adjust).
  function attachScaler(ingredients, original) {
    const card = container.querySelector(".shared-recipe");
    const display = card.querySelector("[data-scale-display]");
    card.querySelector(".serving-scaler").addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      let current = Number(display.textContent) || original;
      if (action === "scale-down" && current > 1) current -= 1;
      else if (action === "scale-up" && current < 99) current += 1;
      else if (action === "scale-reset") current = original;
      display.textContent = String(current);
      const changed = current !== original;
      card.querySelector("[data-action='scale-reset']").classList.toggle("hidden", !changed);
      const lines = scaleIngredientList(ingredients, original, current);
      const unadjusted = lines.map((line) => changed && line.status === "unadjusted");
      card.querySelector("[data-ingredients]").innerHTML = renderIngredientListHtml(lines.map((line) => line.text).join("\n"), unadjusted);
      const ingredientsNote = card.querySelector("[data-scale-note='ingredients']");
      ingredientsNote.textContent = t("detail.scaleUnadjusted");
      ingredientsNote.classList.toggle("hidden", !unadjusted.some(Boolean));
      const methodNote = card.querySelector("[data-scale-note='method']");
      methodNote.textContent = t("detail.scaleMethodNote", { serves: original });
      methodNote.classList.toggle("hidden", !changed);
    });
  }

  async function load() {
    if (!TOKEN_RE.test(token)) {
      showMessage(t("share.page.notFound"), t("share.page.notFoundBody"));
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      showMessage(t("share.page.error"));
      return;
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/shared-recipe`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404 || data?.code === "not_found") {
        showMessage(t("share.page.notFound"), t("share.page.notFoundBody"));
        return;
      }
      if (!response.ok || !data?.recipe) throw new Error(data?.error || `status ${response.status}`);
      render(data);
    } catch (error) {
      console.error("shared recipe: load failed", error);
      showMessage(t("share.page.error"));
    }
  }

  void load();
})();
