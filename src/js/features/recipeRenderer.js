function createRecipeRenderer({
  dom,
  state,
  hasSupabaseConfig,
  helpers,
  getSignedImageUrl,
  setDetailOpen,
  logSupabaseError,
  i18n
}) {
  const { recipeList, detailContent, recipeDetail } = dom;
  const {
    formatDate,
    escapeHtml,
    normalizeDifficulty,
    parseDurationText,
    formatDuration,
    getDisplayImageUrl,
    getDirectImageUrl,
    scaleIngredients
  } = helpers;
  const t = i18n ? (key, params) => i18n.t(key, params) : (key) => key;
  const tCategory = i18n && i18n.formatCategory ? (v) => i18n.formatCategory(v) : (v) => {
    const s = String(v || "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  };
  const tDifficulty = i18n && i18n.getDifficultyLabel ? (n) => i18n.getDifficultyLabel(n) : (helpers.getDifficultyLabel || ((n) => String(n)));
  const tFormatDuration = i18n && i18n.formatDuration ? (m) => i18n.formatDuration(m) : formatDuration;

  const svgIcon = (paths) =>
    `<svg class="recipe-card__chip-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  const META_ICONS = {
    time: svgIcon('<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.4 1.6"/>'),
    serves: svgIcon('<path d="M2.25 7.4h11.5a5.75 5.75 0 0 1-11.5 0Z"/><path d="M6 4.9c0-1 1-1.3 1-2.3M9.2 4.9c0-1 1-1.3 1-2.3"/>'),
    difficulty: svgIcon('<path d="M3 13.2V9.6"/><path d="M8 13.2V6.2"/><path d="M13 13.2V2.8"/>')
  };

  function patchRecipeCardImage(recipe) {
    if (!recipe?.id || !recipe?._resolvedImageUrl) return;
    const card = recipeList.querySelector(`article.recipe-card[data-id="${recipe.id}"]`);
    if (!card) return;

    const existingImage = card.querySelector("img");
    if (existingImage) {
      if (existingImage.src !== recipe._resolvedImageUrl) {
        existingImage.src = recipe._resolvedImageUrl;
      }
      return;
    }

    const placeholder = card.querySelector(".recipe-card__image--placeholder");
    if (!placeholder) return;

    const image = document.createElement("img");
    image.src = recipe._resolvedImageUrl;
    image.alt = String(recipe.title ?? t("card.untitled"));
    image.loading = "lazy";
    image.dataset.action = "view";
    image.dataset.id = recipe.id;
    placeholder.replaceWith(image);
  }

  function patchOpenDetailImage(recipe) {
    if (!recipe?.id || !recipe?._resolvedImageUrl) return;
    const openedDeleteButton = detailContent.querySelector("button[data-action='delete']");
    if (openedDeleteButton?.dataset?.id !== recipe.id) return;

    const existingImage = detailContent.querySelector(".recipe-detail-card img");
    if (existingImage) {
      if (existingImage.src !== recipe._resolvedImageUrl) {
        existingImage.src = recipe._resolvedImageUrl;
      }
      return;
    }

    const placeholder = detailContent.querySelector(".recipe-detail-card__image--placeholder");
    if (!placeholder) return;

    const image = document.createElement("img");
    image.src = recipe._resolvedImageUrl;
    image.alt = String(recipe.title ?? t("card.untitled"));
    placeholder.replaceWith(image);
  }

  async function hydrateImagesInBackground(items) {
    await Promise.all(
      items.map(async (item) => {
        if (!item.image_url) return;
        try {
          const resolvedImageUrl = await getSignedImageUrl(item.image_url);
          if (!resolvedImageUrl) return;
          if (item._resolvedImageUrl === resolvedImageUrl) return;
          item._resolvedImageUrl = resolvedImageUrl;
          patchRecipeCardImage(item);
          patchOpenDetailImage(item);
        } catch (error) {
          if (logSupabaseError) logSupabaseError("image hydration", error);
        }
      })
    );
  }

  function durationToMinutes(durationText) {
    const parsed = parseDurationText(String(durationText ?? ""));
    return Number(parsed.hours || 0) * 60 + Number(parsed.minutes || 0);
  }

  function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function sortRecipes(items, sortBy) {
    const [sortField, sortDir] = (sortBy || "created_at_desc").split(/_(?=asc$|desc$)/);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      if (sortField === "title") {
        return dir * String(a.title || "").toLowerCase().localeCompare(String(b.title || "").toLowerCase());
      }
      if (sortField === "difficulty") {
        return dir * ((Number(a.difficulty) || 0) - (Number(b.difficulty) || 0));
      }
      const aVal = new Date(a.created_at || 0).getTime();
      const bVal = new Date(b.created_at || 0).getTime();
      return dir * (aVal - bVal);
    });
  }

  function renderList(query = "", { category = "", favouritesOnly = false, sortBy = "created_at_desc" } = {}) {
    try {
      const safeQuery = String(query ?? "").toLowerCase();
      let filtered = (Array.isArray(state.recipes) ? state.recipes : []).filter((item) =>
        String(item?.title ?? "")
          .toLowerCase()
          .includes(safeQuery)
      );

      if (category) {
        filtered = filtered.filter((item) => (item.category || "") === category);
      }
      if (favouritesOnly) {
        filtered = filtered.filter((item) => item.is_favourite);
      }
      filtered = sortRecipes(filtered, sortBy);

      recipeList.replaceChildren();

      if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = state.currentUser || !hasSupabaseConfig ? t("list.empty") : t("list.signInPrompt");
        recipeList.appendChild(empty);
      } else {
        filtered.forEach((recipe) => {
          const safeImageUrl = getDisplayImageUrl(recipe);
          const title = String(recipe.title ?? t("card.untitled"));

          const article = document.createElement("article");
          article.className = "recipe-card";
          article.dataset.id = recipe.id || "";
          // The whole card is the click target — no separate "View" button needed.
          article.dataset.action = "view";
          article.tabIndex = 0;
          article.setAttribute("role", "button");
          article.setAttribute("aria-label", title);

          const favButton = document.createElement("button");
          favButton.className = "recipe-card__fav-button" + (recipe.is_favourite ? " recipe-card__fav-button--active" : "");
          favButton.type = "button";
          favButton.dataset.action = "toggle-fav";
          favButton.dataset.id = recipe.id || "";
          favButton.setAttribute("aria-label", recipe.is_favourite ? t("card.removeFav") : t("card.addFav"));
          favButton.innerHTML = recipe.is_favourite ? "&#9829;" : "&#9825;";
          article.appendChild(favButton);

          if (safeImageUrl) {
            const image = document.createElement("img");
            image.src = safeImageUrl;
            image.alt = title;
            image.loading = "lazy";
            image.dataset.action = "view";
            image.dataset.id = recipe.id || "";
            article.appendChild(image);
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "recipe-card__image recipe-card__image--placeholder";
            placeholder.setAttribute("aria-hidden", "true");
            placeholder.dataset.action = "view";
            placeholder.dataset.id = recipe.id || "";
            article.appendChild(placeholder);
          }

          const body = document.createElement("div");
          body.className = "recipe-card__body";

          const heading = document.createElement("h3");
          heading.textContent = title;
          heading.dataset.action = "view";
          heading.dataset.id = recipe.id || "";
          heading.classList.add("recipe-card__title-link");
          body.appendChild(heading);

          if (recipe.description) {
            const descriptionEl = document.createElement("p");
            descriptionEl.className = "recipe-card__description";
            descriptionEl.textContent = recipe.description;
            descriptionEl.dataset.action = "view";
            descriptionEl.dataset.id = recipe.id || "";
            body.appendChild(descriptionEl);
          }

          if (recipe.category) {
            const badge = document.createElement("span");
            badge.className = "recipe-card__category-badge";
            badge.textContent = tCategory(recipe.category);
            body.appendChild(badge);
          }

          const prepTimeValue = String(recipe.prep_time ?? recipe.prepTime ?? "").trim();
          const cookingTimeValue = String(recipe.cooking_time ?? recipe.cookingTime ?? "").trim();
          const prepParsed = parseDurationText(prepTimeValue);
          const cookParsed = parseDurationText(cookingTimeValue);
          const totalMinutes =
            Number(prepParsed.hours || 0) * 60 +
            Number(prepParsed.minutes || 0) +
            Number(cookParsed.hours || 0) * 60 +
            Number(cookParsed.minutes || 0);
          const storedTotalTime = String(recipe.total_time ?? recipe.totalTime ?? "").trim();
          const totalTimeValue = totalMinutes > 0 ? tFormatDuration(totalMinutes) : storedTotalTime;
          const servesValue = String(recipe.serves ?? recipe.servings ?? "").trim();
          const difficultyNum = normalizeDifficulty(recipe.difficulty, 4);
          const metaItems = [
            { icon: META_ICONS.time, label: t("card.totalTime"), value: totalTimeValue },
            { icon: META_ICONS.serves, label: t("card.serves"), value: servesValue },
            { icon: META_ICONS.difficulty, label: t("card.difficulty"), value: tDifficulty(difficultyNum) }
          ].filter((item) => Boolean(item.value));

          if (metaItems.length) {
            const meta = document.createElement("div");
            meta.className = "recipe-card__meta";
            meta.innerHTML = metaItems
              .map(
                (item) =>
                  `<span class="recipe-card__chip">${item.icon}<span class="sr-only">${escapeHtml(item.label)}: </span>${escapeHtml(String(item.value))}</span>`
              )
              .join("");
            body.appendChild(meta);
          }

          article.appendChild(body);
          recipeList.appendChild(article);
        });
      }

    } catch (error) {
      recipeList.innerHTML = `<p class="empty">${escapeHtml(t("list.renderError"))}</p>`;
    }
  }

  function showDetail(recipe, options = {}) {
    const { scrollToDetail = true } = options;
    const renderDetail = (resolvedImageUrl) => {
      const currentUserId = state.currentUser?.id;
      // Owner of the recipe = the signed-in user is the recipe's user_id. When
      // there's no user_id on the row (demo mode / local recipes) we treat the
      // current user as owner.
      const isOwner = !recipe.user_id || (currentUserId && recipe.user_id === currentUserId);
      const toMetaText = (value) => {
        const text = value == null ? "" : String(value).trim();
        return text ? escapeHtml(text) : "";
      };
      const prepTimeRaw = recipe.prep_time ?? recipe.prepTime ?? "";
      const cookingTimeRaw = recipe.cooking_time ?? recipe.cookingTime ?? "";
      const prepParsed = parseDurationText(prepTimeRaw);
      const cookParsed = parseDurationText(cookingTimeRaw);
      const prepMinutesTotal = Number(prepParsed.hours || 0) * 60 + Number(prepParsed.minutes || 0);
      const cookMinutesTotal = Number(cookParsed.hours || 0) * 60 + Number(cookParsed.minutes || 0);
      // Reformat saved durations through i18n so old recipes (saved with English
      // "1 hour 30 mins") display in the current language.
      const prepTime = prepMinutesTotal > 0 ? tFormatDuration(prepMinutesTotal) : String(prepTimeRaw || "").trim();
      const cookingTime = cookMinutesTotal > 0 ? tFormatDuration(cookMinutesTotal) : String(cookingTimeRaw || "").trim();
      const computedTotalTime =
        prepMinutesTotal > 0 || cookMinutesTotal > 0 ? tFormatDuration(prepMinutesTotal + cookMinutesTotal) : "";
      const totalTimeRaw = recipe.total_time ?? recipe.totalTime ?? "";
      const totalTimeParsed = parseDurationText(totalTimeRaw);
      const totalTimeMin = Number(totalTimeParsed.hours || 0) * 60 + Number(totalTimeParsed.minutes || 0);
      const totalTime = totalTimeMin > 0
        ? tFormatDuration(totalTimeMin)
        : (computedTotalTime || String(totalTimeRaw || "").trim());
      const serves = recipe.serves ?? recipe.servings ?? "";
      const difficultyNum = normalizeDifficulty(recipe.difficulty, 4);
      const difficulty = `${difficultyNum} — ${tDifficulty(difficultyNum)}`;
      const metaItems = [
        { label: t("detail.metaPrep"), value: toMetaText(prepTime), field: "prep_time", editable: true, editAria: t("detail.editPrepTime") },
        { label: t("detail.metaCook"), value: toMetaText(cookingTime), field: "cooking_time", editable: true, editAria: t("detail.editCookingTime") },
        { label: t("detail.metaTotal"), value: toMetaText(totalTime) },
        { label: t("detail.metaServes"), value: toMetaText(serves) },
        { label: t("detail.metaDifficulty"), value: toMetaText(difficulty), field: "difficulty", editable: true, editAria: t("detail.editDifficulty") }
      ].filter((item) => Boolean(item.value));
      const renderMetaItem = (item) => {
        if (isOwner && item.editable && item.field) {
          const ariaLabel = item.editAria || item.label;
          return `<p class="recipe-detail-card__meta-item recipe-detail-card__meta-item--editable"><button class="inline-edit-trigger" data-action="inline-edit-field" data-field="${item.field}" type="button" aria-label="${escapeHtml(ariaLabel)}"><strong>${escapeHtml(item.label)}:</strong> <span data-field-content="${item.field}">${item.value}</span></button></p>`;
        }
        return `<p class="recipe-detail-card__meta-item"><strong>${escapeHtml(item.label)}:</strong> ${item.value}</p>`;
      };
      const metaHtml = metaItems.length
        ? `
        <div class="recipe-detail-card__meta" aria-label="${escapeHtml(t("detail.metaLabel"))}">
          ${metaItems.map((item) => renderMetaItem(item)).join("")}
        </div>`
        : "";
      const imageHtml = resolvedImageUrl
        ? `<button type="button" class="recipe-detail-card__image-wrap" data-action="open-image-fullview" data-image-url="${escapeHtml(resolvedImageUrl)}" data-image-alt="${escapeHtml(recipe.title)}" aria-label="${escapeHtml(t("detail.fullImage"))}" style="--detail-img: url('${escapeHtml(resolvedImageUrl)}')"><img src="${escapeHtml(resolvedImageUrl)}" alt="${escapeHtml(recipe.title)}" /></button>`
        : '<div class="recipe-detail-card__image recipe-detail-card__image--placeholder" aria-hidden="true"></div>';

      const categoryHtml = recipe.category
        ? `<span class="recipe-detail-card__category-badge">${escapeHtml(tCategory(recipe.category))}</span>`
        : "";
      const favActive = recipe.is_favourite;
      const favHeart = favActive ? "&#9829;" : "&#9825;";
      const favLabel = favActive ? t("card.removeFav") : t("card.addFav");
      const favClass = "recipe-detail-card__fav-button" + (favActive ? " recipe-detail-card__fav-button--active" : "");
      const dateLine =
        recipe.updated_at && recipe.updated_at !== recipe.created_at
          ? t("detail.addedUpdated", { added: formatDate(recipe.created_at), updated: formatDate(recipe.updated_at) })
          : t("detail.added", { date: formatDate(recipe.created_at) });

      detailContent.innerHTML = `
      <article class="recipe-detail-card">
        ${imageHtml}
        <div class="recipe-detail-card__header">
          <div class="recipe-detail-card__title-row">
            <h2>${escapeHtml(recipe.title)}</h2>
            ${isOwner ? `<button class="${favClass}" type="button" data-action="toggle-fav" data-id="${recipe.id}" aria-label="${escapeHtml(favLabel)}">${favHeart}</button>` : ""}
          </div>
          <p class="recipe-detail-card__date">${escapeHtml(dateLine)} ${categoryHtml}</p>
          ${recipe.description
            ? (isOwner
                ? `<button class="inline-edit-trigger recipe-detail-card__description" data-action="inline-edit-field" data-field="description" data-field-content="description" type="button" aria-label="${escapeHtml(t("detail.editDescription"))}">${escapeHtml(recipe.description).replace(/\n/g, "<br />")}</button>`
                : `<p class="recipe-detail-card__description">${escapeHtml(recipe.description).replace(/\n/g, "<br />")}</p>`)
            : (isOwner ? `<button class="button button--ghost recipe-detail-card__add-description" type="button" data-action="inline-edit-field" data-field="description" data-id="${recipe.id}">${escapeHtml(t("detail.addDescription"))}</button>` : "")}
        </div>
        ${metaHtml}

        <section class="recipe-detail-card__section" data-field="ingredients">
          <h3 class="recipe-detail-card__editable-title">
            ${isOwner ? `<button class="inline-edit-trigger" data-action="inline-edit-field" data-field="ingredients" type="button" aria-label="${escapeHtml(t("detail.editIngredients"))}">${escapeHtml(t("detail.ingredients"))}</button>` : `<span>${escapeHtml(t("detail.ingredients"))}</span>`}
          </h3>
          ${serves ? `<div class="serving-scaler" data-original-serves="${escapeHtml(String(serves))}" data-original-ingredients="${escapeHtml(recipe.ingredients)}">
            <button type="button" class="serving-scaler__btn" data-action="scale-down" aria-label="${escapeHtml(t("detail.scaleDown"))}">&minus;</button>
            <span class="serving-scaler__value" data-scale-display>${escapeHtml(String(serves))}</span>
            <span class="serving-scaler__label">${escapeHtml(t("detail.servings"))}</span>
            <button type="button" class="serving-scaler__btn" data-action="scale-up" aria-label="${escapeHtml(t("detail.scaleUp"))}">&plus;</button>
            <button type="button" class="serving-scaler__reset button--ghost" data-action="scale-reset">${escapeHtml(t("detail.scaleReset"))}</button>
          </div>` : ""}
          ${isOwner
            ? `<button class="inline-edit-trigger recipe-detail-card__editable" data-action="inline-edit-field" data-field="ingredients" data-field-content="ingredients" type="button" aria-label="${escapeHtml(t("detail.editIngredients"))}">${escapeHtml(recipe.ingredients).replace(/\n/g, "<br />")}</button>`
            : `<div class="recipe-detail-card__editable recipe-detail-card__editable--readonly">${escapeHtml(recipe.ingredients).replace(/\n/g, "<br />")}</div>`}
        </section>

        <section class="recipe-detail-card__section" data-field="method">
          <h3 class="recipe-detail-card__editable-title">
            ${isOwner ? `<button class="inline-edit-trigger" data-action="inline-edit-field" data-field="method" type="button" aria-label="${escapeHtml(t("detail.editMethod"))}">${escapeHtml(t("detail.method"))}</button>` : `<span>${escapeHtml(t("detail.method"))}</span>`}
          </h3>
          ${isOwner
            ? `<button class="inline-edit-trigger recipe-detail-card__editable" data-action="inline-edit-field" data-field="method" data-field-content="method" type="button" aria-label="${escapeHtml(t("detail.editMethod"))}">${escapeHtml(recipe.method).replace(/\n/g, "<br />")}</button>`
            : `<div class="recipe-detail-card__editable recipe-detail-card__editable--readonly">${escapeHtml(recipe.method).replace(/\n/g, "<br />")}</div>`}
        </section>

        ${recipe.notes
          ? `<section class="recipe-detail-card__section" data-field="notes">
              <h3 class="recipe-detail-card__editable-title">
                ${isOwner ? `<button class="inline-edit-trigger" data-action="inline-edit-field" data-field="notes" type="button" aria-label="${escapeHtml(t("detail.editNotes"))}">${escapeHtml(t("detail.notes"))}</button>` : `<span>${escapeHtml(t("detail.notes"))}</span>`}
              </h3>
              ${isOwner
                ? `<button class="inline-edit-trigger recipe-detail-card__editable" data-action="inline-edit-field" data-field="notes" data-field-content="notes" type="button" aria-label="${escapeHtml(t("detail.editNotes"))}">${escapeHtml(recipe.notes).replace(/\n/g, "<br />")}</button>`
                : `<div class="recipe-detail-card__editable recipe-detail-card__editable--readonly">${escapeHtml(recipe.notes).replace(/\n/g, "<br />")}</div>`}
            </section>`
          : (isOwner ? `<button class="button button--ghost recipe-detail-card__add-notes" type="button" data-action="inline-edit-field" data-field="notes" data-id="${recipe.id}">${escapeHtml(t("detail.addNotes"))}</button>` : "")}

        <div class="recipe-detail-card__actions">
          ${isOwner ? `
          <button class="button button--secondary" type="button" data-action="edit" data-id="${recipe.id}">
            ${escapeHtml(t("detail.edit"))}
          </button>
          <button class="button button--secondary hidden" type="button" data-action="duplicate" data-id="${recipe.id}">
            ${escapeHtml(t("detail.duplicate"))}
          </button>
          <button class="button button--secondary hidden" type="button" data-action="share" data-id="${recipe.id}">
            ${escapeHtml(t("detail.share"))}
          </button>
          <button class="button button--secondary recipe-detail-card__print-button" type="button" onclick="window.print()">
            ${escapeHtml(t("detail.print"))}
          </button>
          <button class="button button--secondary" type="button" data-action="add-to-shopping" data-id="${recipe.id}">
            ${escapeHtml(t("detail.addToShopping"))}
          </button>
          <button class="button button--danger" type="button" data-action="delete" data-id="${recipe.id}">
            ${escapeHtml(t("detail.delete"))}
          </button>` : `
          <button class="button" type="button" data-action="save-from-friend" data-id="${recipe.id}">
            ${escapeHtml(t("friends.saveToMine"))}
          </button>
          <button class="button button--secondary recipe-detail-card__print-button" type="button" onclick="window.print()">
            ${escapeHtml(t("detail.print"))}
          </button>
          <button class="button button--secondary" type="button" data-action="add-to-shopping" data-id="${recipe.id}">
            ${escapeHtml(t("detail.addToShopping"))}
          </button>`}
        </div>
      </article>
    `;
    };

    const immediateImageUrl = getDisplayImageUrl(recipe);
    renderDetail(immediateImageUrl);
    setDetailOpen(true);
    if (scrollToDetail) {
      recipeDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (!immediateImageUrl && recipe.image_url) {
      getSignedImageUrl(recipe.image_url)
        .then((signedUrl) => {
          if (!signedUrl) return;
          recipe._resolvedImageUrl = signedUrl;
          const current = state.recipes.find((item) => item.id === recipe.id);
          if (current) {
            current._resolvedImageUrl = signedUrl;
          }

          const openedDeleteButton = detailContent.querySelector("button[data-action='delete']");
          const openedRecipeId = openedDeleteButton?.dataset?.id;
          if (openedRecipeId === recipe.id) {
            renderDetail(signedUrl);
          }
        })
        .catch((error) => {
          if (logSupabaseError) logSupabaseError("image hydration", error);
        });
    }
  }

  function normalizeLoadedRecipes(items, defaultDifficulty) {
    return (items || []).map((item) => ({
      ...item,
      difficulty: normalizeDifficulty(item?.difficulty, defaultDifficulty),
      _resolvedImageUrl: null
    }));
  }

  return {
    patchRecipeCardImage,
    patchOpenDetailImage,
    hydrateImagesInBackground,
    renderList,
    showDetail,
    normalizeLoadedRecipes
  };
}

window.StorecipeRecipeRenderer = {
  createRecipeRenderer
};
