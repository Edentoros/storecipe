(() => {
  function createInlineEditManager({ dom, state, config, helpers, supabaseServices, callbacks, i18n }) {
    const { detailContent, searchInput } = dom;
    const { DEFAULT_DIFFICULTY, hasSupabaseConfig } = config;
    const t = i18n ? (k, p) => i18n.t(k, p) : (k) => k;
    const {
      parseDurationText, formatDuration: formatDurationHelper, sanitizeDigits, parseTimePair,
      normalizeOptionalText, getDirectImageUrl, normalizeDifficulty
    } = helpers;
    const { updateRecipeViaRest } = supabaseServices;
    const { setAppStatus, logSupabaseError, showDetail, renderList, saveLocalRecipes, isMissingRecipeMetaColumns } = callbacks;
    const formatDuration = i18n && i18n.formatDuration ? (m) => i18n.formatDuration(m) : formatDurationHelper;

    function normalizeInlineEditableField(field) {
      const normalized = String(field || "").trim().toLowerCase();
      if (
        normalized === "ingredients" ||
        normalized === "method" ||
        normalized === "notes" ||
        normalized === "description" ||
        normalized === "prep_time" ||
        normalized === "cooking_time" ||
        normalized === "difficulty"
      ) {
        return normalized;
      }
      return null;
    }

    function getInlineFieldLabel(field) {
      switch (field) {
        case "ingredients":
          return t("inlineEdit.field.ingredients");
        case "method":
          return t("inlineEdit.field.method");
        case "notes":
          return t("inlineEdit.field.notes");
        case "description":
          return t("inlineEdit.field.description");
        case "prep_time":
          return t("inlineEdit.field.prepTime");
        case "cooking_time":
          return t("inlineEdit.field.cookingTime");
        case "difficulty":
          return t("inlineEdit.field.difficulty");
        default:
          return t("inlineEdit.field.field");
      }
    }

    function getOpenDetailRecipe() {
      const openedDeleteButton = detailContent.querySelector("button[data-action='delete']");
      const openedRecipeId = openedDeleteButton?.dataset?.id || null;
      if (!openedRecipeId) return null;
      return state.recipes.find((item) => item.id === openedRecipeId) || null;
    }

    function autoSizeInlineTextarea(textarea) {
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function isInlineTimeField(field) {
      return field === "prep_time" || field === "cooking_time";
    }

    function isInlineMetaField(field) {
      return isInlineTimeField(field) || field === "difficulty";
    }

    function getInlineTimeLabel(field) {
      return field === "prep_time" ? "Prep time" : "Cooking time";
    }

    function durationTextToMinutes(value) {
      const parsed = parseDurationText(value);
      const hours = Number(parsed.hours || 0);
      const minutes = Number(parsed.minutes || 0);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
      return hours * 60 + minutes;
    }

    function setInlineTimeEditorValidation(editorRoot, field) {
      const hoursInput = editorRoot.querySelector(".recipe-inline-editor__time-hours");
      const minutesInput = editorRoot.querySelector(".recipe-inline-editor__time-minutes");
      const warning = editorRoot.querySelector(".recipe-inline-editor__warning");
      if (!(hoursInput instanceof HTMLInputElement) || !(minutesInput instanceof HTMLInputElement)) {
        return null;
      }

      const sanitizedHours = sanitizeDigits(hoursInput.value);
      const sanitizedMinutes = sanitizeDigits(minutesInput.value);
      if (hoursInput.value !== sanitizedHours) {
        hoursInput.value = sanitizedHours;
      }
      if (minutesInput.value !== sanitizedMinutes) {
        minutesInput.value = sanitizedMinutes;
      }

      const validation = parseTimePair(hoursInput.value, minutesInput.value, getInlineTimeLabel(field));
      hoursInput.classList.toggle("field-error", Boolean(validation.hoursError));
      minutesInput.classList.toggle("field-error", Boolean(validation.minutesError));

      if (warning) {
        warning.textContent = validation.message || "";
        warning.classList.toggle("hidden", !validation.message);
      }

      return validation;
    }

    function startInlineDetailFieldEdit(field) {
      const normalizedField = normalizeInlineEditableField(field);
      if (!normalizedField) return;
      if (isInlineMetaField(normalizedField) && !state.hasRecipeMetaColumns) {
        setAppStatus(t("inlineEdit.migrationNeeded"));
        return;
      }

      const recipe = getOpenDetailRecipe();
      if (!recipe) return;

      const existingEditor = detailContent.querySelector(".recipe-inline-editor");
      if (existingEditor instanceof HTMLElement) {
        const existingField = normalizeInlineEditableField(existingEditor.dataset.field || "");
        if (existingField === normalizedField) {
          const existingInput = existingEditor.querySelector(".recipe-inline-editor__focus-target");
          if (existingInput instanceof HTMLElement) {
            existingInput.focus();
          }
          return;
        }
        showDetail(recipe, { scrollToDetail: false });
      }

      const fieldContent = detailContent.querySelector(`[data-field-content='${normalizedField}']`);
      const addButton = !fieldContent ? detailContent.querySelector(`[data-action='inline-edit-field'][data-field='${normalizedField}']`) : null;
      if (!(fieldContent instanceof HTMLElement) && !(addButton instanceof HTMLElement)) return;
      const target = fieldContent ? (fieldContent.closest(".recipe-detail-card__meta-item") || fieldContent) : addButton;

      const editor = document.createElement("div");
      editor.className = "recipe-inline-editor";
      editor.dataset.field = normalizedField;
      let focusTarget = null;

      if (
        normalizedField === "ingredients" ||
        normalizedField === "method" ||
        normalizedField === "notes" ||
        normalizedField === "description"
      ) {
        const textarea = document.createElement("textarea");
        textarea.className = "recipe-inline-editor__input recipe-inline-editor__focus-target";
        textarea.value = String(recipe[normalizedField] ?? "");
        textarea.rows = normalizedField === "ingredients" ? 6 : normalizedField === "description" ? 3 : 10;
        textarea.setAttribute("aria-label", `Edit ${getInlineFieldLabel(normalizedField)}`);
        textarea.addEventListener("input", () => {
          autoSizeInlineTextarea(textarea);
        });
        editor.append(textarea);
        autoSizeInlineTextarea(textarea);
        focusTarget = textarea;
      } else if (isInlineTimeField(normalizedField)) {
        const sourceText = String(recipe[normalizedField] ?? "").trim();
        const parsed = parseDurationText(sourceText);

        const row = document.createElement("div");
        row.className = "recipe-inline-editor__time-row";

        const hoursInput = document.createElement("input");
        hoursInput.type = "text";
        hoursInput.inputMode = "numeric";
        hoursInput.pattern = "[0-9]*";
        hoursInput.placeholder = "Hours";
        hoursInput.className = "recipe-inline-editor__time-input recipe-inline-editor__time-hours recipe-inline-editor__focus-target";
        hoursInput.value = parsed.hours;
        hoursInput.setAttribute("aria-label", `${getInlineTimeLabel(normalizedField)} hours`);

        const minutesInput = document.createElement("input");
        minutesInput.type = "text";
        minutesInput.inputMode = "numeric";
        minutesInput.pattern = "[0-9]*";
        minutesInput.placeholder = "Minutes";
        minutesInput.className = "recipe-inline-editor__time-input recipe-inline-editor__time-minutes";
        minutesInput.value = parsed.minutes;
        minutesInput.setAttribute("aria-label", `${getInlineTimeLabel(normalizedField)} minutes`);

        row.append(hoursInput, minutesInput);
        editor.append(row);

        const warning = document.createElement("p");
        warning.className = "recipe-inline-editor__warning hidden";
        warning.setAttribute("aria-live", "polite");
        editor.append(warning);

        const sync = () => {
          setInlineTimeEditorValidation(editor, normalizedField);
        };
        hoursInput.addEventListener("input", sync);
        minutesInput.addEventListener("input", sync);
        hoursInput.addEventListener("blur", sync);
        minutesInput.addEventListener("blur", sync);
        sync();
        focusTarget = hoursInput;
      } else if (normalizedField === "difficulty") {
        const row = document.createElement("div");
        row.className = "recipe-inline-editor__difficulty-row";

        const difficultyInputInline = document.createElement("input");
        difficultyInputInline.type = "range";
        difficultyInputInline.min = "1";
        difficultyInputInline.max = "10";
        difficultyInputInline.step = "1";
        difficultyInputInline.value = String(normalizeDifficulty(recipe.difficulty, DEFAULT_DIFFICULTY));
        difficultyInputInline.className = "recipe-inline-editor__difficulty-input recipe-inline-editor__focus-target";
        difficultyInputInline.setAttribute("aria-label", "Difficulty from 1 to 10");

        const difficultyValueInline = document.createElement("span");
        difficultyValueInline.className = "recipe-inline-editor__difficulty-value";
        difficultyValueInline.textContent = difficultyInputInline.value;

        let isDifficultySanitizing = false;
        difficultyInputInline.addEventListener("input", () => {
          if (isDifficultySanitizing) return;
          isDifficultySanitizing = true;
          const normalized = normalizeDifficulty(difficultyInputInline.value, DEFAULT_DIFFICULTY);
          difficultyInputInline.value = String(normalized);
          difficultyValueInline.textContent = String(normalized);
          isDifficultySanitizing = false;
        });

        row.append(difficultyInputInline, difficultyValueInline);
        editor.append(row);
        focusTarget = difficultyInputInline;
      }

      const actions = document.createElement("div");
      actions.className = "recipe-inline-editor__actions";

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "button button--secondary";
      saveButton.dataset.action = "inline-save-field";
      saveButton.dataset.field = normalizedField;
      saveButton.textContent = t("inlineEdit.save");

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "button button--ghost";
      cancelButton.dataset.action = "inline-cancel-field";
      cancelButton.dataset.field = normalizedField;
      cancelButton.textContent = t("inlineEdit.cancel");

      actions.append(saveButton, cancelButton);
      editor.append(actions);
      target.replaceWith(editor);

      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
      }
      if (focusTarget instanceof HTMLTextAreaElement) {
        focusTarget.setSelectionRange(focusTarget.value.length, focusTarget.value.length);
      }
      setAppStatus(t("inlineEdit.editing", { label: getInlineFieldLabel(normalizedField) }));
    }

    async function saveInlineDetailField(field) {
      const normalizedField = normalizeInlineEditableField(field);
      if (!normalizedField) return false;
      if (isInlineMetaField(normalizedField) && !state.hasRecipeMetaColumns) {
        setAppStatus(t("inlineEdit.migrationNeeded"));
        return false;
      }

      const recipe = getOpenDetailRecipe();
      if (!recipe) return false;
      const editor = detailContent.querySelector(`.recipe-inline-editor[data-field='${normalizedField}']`);
      if (!(editor instanceof HTMLElement)) return false;

      const label = getInlineFieldLabel(normalizedField);
      let payload = {};
      let hasChanges = false;

      if (
        normalizedField === "ingredients" ||
        normalizedField === "method" ||
        normalizedField === "notes" ||
        normalizedField === "description"
      ) {
        const valueInput = editor.querySelector(".recipe-inline-editor__input");
        if (!(valueInput instanceof HTMLTextAreaElement)) return false;
        const value = String(valueInput.value ?? "").trim();
        const allowEmpty = normalizedField === "notes" || normalizedField === "description";
        if (!value && !allowEmpty) {
          setAppStatus(t("inlineEdit.pleaseAdd", { label }));
          return false;
        }
        payload = { [normalizedField]: value || (allowEmpty ? null : "") };
        hasChanges = (value || "") !== String(recipe[normalizedField] ?? "").trim();
      } else if (isInlineTimeField(normalizedField)) {
        const validation = setInlineTimeEditorValidation(editor, normalizedField);
        if (!validation) return false;
        if (validation.message) {
          setAppStatus(validation.message);
          return false;
        }

        const nextTimeText = validation.totalMinutes == null ? null : formatDuration(validation.totalMinutes);
        const currentTimeText = normalizeOptionalText(recipe[normalizedField] ?? "");

        const prepMinutes =
          normalizedField === "prep_time"
            ? validation.totalMinutes || 0
            : durationTextToMinutes(recipe.prep_time ?? recipe.prepTime ?? "");
        const cookMinutes =
          normalizedField === "cooking_time"
            ? validation.totalMinutes || 0
            : durationTextToMinutes(recipe.cooking_time ?? recipe.cookingTime ?? "");
        const nextTotalText = prepMinutes + cookMinutes > 0 ? formatDuration(prepMinutes + cookMinutes) : null;
        const currentTotalText = normalizeOptionalText(recipe.total_time ?? recipe.totalTime ?? "");

        payload = {
          [normalizedField]: nextTimeText,
          total_time: nextTotalText
        };
        hasChanges = nextTimeText !== currentTimeText || nextTotalText !== currentTotalText;
      } else if (normalizedField === "difficulty") {
        const difficultyInputInline = editor.querySelector(".recipe-inline-editor__difficulty-input");
        if (!(difficultyInputInline instanceof HTMLInputElement)) return false;
        const nextDifficulty = normalizeDifficulty(difficultyInputInline.value, DEFAULT_DIFFICULTY);
        const currentDifficulty = normalizeDifficulty(recipe.difficulty, DEFAULT_DIFFICULTY);
        difficultyInputInline.value = String(nextDifficulty);
        payload = { difficulty: nextDifficulty };
        hasChanges = nextDifficulty !== currentDifficulty;
      }

      if (!hasChanges) {
        showDetail(recipe, { scrollToDetail: false });
        setAppStatus(t("inlineEdit.noChanges", { label }));
        return true;
      }

      if (!hasSupabaseConfig) {
        const updatedLocalRecipe = { ...recipe, ...payload, updated_at: new Date().toISOString() };
        state.recipes = state.recipes.map((item) => (item.id === recipe.id ? updatedLocalRecipe : item));
        saveLocalRecipes(state.recipes);
        renderList();
        showDetail(updatedLocalRecipe, { scrollToDetail: false });
        setAppStatus(t("inlineEdit.fieldUpdated", { label: label.charAt(0).toUpperCase() + label.slice(1) }));
        return true;
      }

      if (!state.currentUser) {
        setAppStatus(t("status.signInToUpdate"));
        return false;
      }

      try {
        const updatedRows = await updateRecipeViaRest(recipe.id, state.currentUser.id, { ...payload, updated_at: new Date().toISOString() });
        const updatedRecipe = Array.isArray(updatedRows) ? updatedRows[0] : null;
        if (!updatedRecipe) {
          throw new Error("Update succeeded but no row was returned.");
        }

        const hydratedUpdatedRecipe = {
          ...recipe,
          ...updatedRecipe,
          _resolvedImageUrl: recipe._resolvedImageUrl || getDirectImageUrl(updatedRecipe.image_url)
        };
        state.recipes = state.recipes.map((item) => (item.id === recipe.id ? hydratedUpdatedRecipe : item));
        renderList();
        showDetail(hydratedUpdatedRecipe, { scrollToDetail: false });
        setAppStatus(t("inlineEdit.fieldUpdated", { label: label.charAt(0).toUpperCase() + label.slice(1) }));
        return true;
      } catch (error) {
        if (isInlineMetaField(normalizedField) && state.hasRecipeMetaColumns && isMissingRecipeMetaColumns(error)) {
          state.hasRecipeMetaColumns = false;
          setAppStatus(t("inlineEdit.updateFailedMigration"));
          return false;
        }
        logSupabaseError("inline update recipe field", error);
        setAppStatus(t("inlineEdit.updateFailed", { error: error.message || "Unexpected error" }));
        return false;
      }
    }

    function attachListeners() {
      detailContent.addEventListener("click", async (event) => {
        const inlineSaveButton = event.target.closest("button[data-action='inline-save-field']");
        if (inlineSaveButton) {
          if (state.isInlineFieldSaveInProgress) return;
          const field = inlineSaveButton.dataset.field || "";
          const normalizedField = normalizeInlineEditableField(field);
          if (!normalizedField) return;
          const editor = detailContent.querySelector(`.recipe-inline-editor[data-field='${normalizedField}']`);
          if (!(editor instanceof HTMLElement)) return;
          const inlineCancelButton = editor.querySelector("button[data-action='inline-cancel-field']");

          state.isInlineFieldSaveInProgress = true;
          inlineSaveButton.disabled = true;
          if (inlineCancelButton instanceof HTMLButtonElement) {
            inlineCancelButton.disabled = true;
          }
          setAppStatus(t("inlineEdit.updating", { label: getInlineFieldLabel(normalizedField) }));
          try {
            await saveInlineDetailField(normalizedField);
          } finally {
            state.isInlineFieldSaveInProgress = false;
            inlineSaveButton.disabled = false;
            if (inlineCancelButton instanceof HTMLButtonElement) {
              inlineCancelButton.disabled = false;
            }
          }
          return;
        }

        const inlineCancelButton = event.target.closest("button[data-action='inline-cancel-field']");
        if (inlineCancelButton) {
          const recipe = getOpenDetailRecipe();
          if (recipe) {
            showDetail(recipe, { scrollToDetail: false });
          }
          setAppStatus(t("inlineEdit.canceled"));
          return;
        }

        const inlineTrigger = event.target.closest("[data-action='inline-edit-field']");
        if (inlineTrigger) {
          startInlineDetailFieldEdit(inlineTrigger.dataset.field || "");
          return;
        }
      });

      detailContent.addEventListener("keydown", (event) => {
        const targetElement = event.target instanceof HTMLElement ? event.target : null;
        if (!targetElement) return;

        // Ingredients/method/notes bodies are div[role=button] (a <button> can't
        // legally contain a list), so they need Enter/Space wired up by hand.
        if (event.key === "Enter" || event.key === " ") {
          const trigger = targetElement.closest("[data-action='inline-edit-field'][role='button']");
          if (trigger instanceof HTMLElement && targetElement === trigger) {
            event.preventDefault();
            startInlineDetailFieldEdit(trigger.dataset.field || "");
            return;
          }
        }

        const inlineEditor = targetElement.closest(".recipe-inline-editor");
        if (!(inlineEditor instanceof HTMLElement)) return;

        if (event.key === "Escape") {
          event.preventDefault();
          const recipe = getOpenDetailRecipe();
          if (recipe) {
            showDetail(recipe, { scrollToDetail: false });
          }
          setAppStatus(t("inlineEdit.canceled"));
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          const field = normalizeInlineEditableField(inlineEditor.dataset.field || "");
          if (!field) return;
          const saveButton = detailContent.querySelector(`button[data-action='inline-save-field'][data-field='${field}']`);
          if (saveButton instanceof HTMLButtonElement) {
            saveButton.click();
          }
        }
      });
    }

    return {
      startInlineDetailFieldEdit,
      saveInlineDetailField,
      attachListeners
    };
  }

  window.StorecipeInlineEditManager = { createInlineEditManager };
})();
