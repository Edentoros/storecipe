(() => {
  const {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL_PLACEHOLDER,
    SUPABASE_KEY_PLACEHOLDER,
    NETWORK_TIMEOUT_MS,
    IMAGE_RESOLVE_TIMEOUT_MS,
    IMAGE_SIGN_TIMEOUT_MS,
    BUCKET,
    LOCAL_RECIPES_KEY,
    THEME_PREFERENCES_TABLE,
    PROFILES_TABLE,
    FRIENDSHIPS_TABLE,
    DEFAULT_THEME,
    DEFAULT_DIFFICULTY,
    THEME_LOCAL_KEY_PREFIX,
    DEFAULT_LANGUAGE,
    LANGUAGE_LOCAL_KEY_PREFIX,
    SUPPORTED_LANGUAGES,
    IMAGE_MAX_SIZE_BYTES,
    IMAGE_ALLOWED_TYPES,
    RECIPE_IMPORT_FUNCTION,
    RECIPE_CATEGORIES,
    FEATURES
  } = window.StorecipeConstants;
  const { getDomRefs } = window.StorecipeDomRefs;
  const {
    formatDate,
    escapeHtml,
    normalizeDifficulty: normalizeDifficultyCore,
    getDifficultyLabel,
    normalizeTheme,
    normalizeLanguage,
    renderIngredientListHtml,
    renderMethodListHtml,
    withTimeout,
    getDirectImageUrl,
    isValidHttpUrl,
    getDisplayImageUrl,
    normalizeStoragePath: normalizeStoragePathCore,
    normalizeOptionalText,
    sanitizeDigits,
    formatDuration,
    parseDurationText,
    parseTimePair,
    validateServesValue,
    normalizeImportedText,
    parseOptionalBoundedInteger,
    validateImageFile,
    shrinkImageForUpload,
    debounce
  } = window.StorecipeHelpers;
  const { scaleIngredientList } = window.StorecipeIngredientParser;
  const { createRecipeMetaManager } = window.StorecipeRecipeMetaManager;
  const { createRecipeRenderer } = window.StorecipeRecipeRenderer;
  const { createSupabaseServices } = window.StorecipeSupabaseServices;
  const { createAppState } = window.StorecipeAppState;
  const { createI18n } = window.StorecipeI18n;
  const { createImageManager } = window.StorecipeImageManager;
  const { createSettingsManager } = window.StorecipeSettingsManager;
  const { createAuthUiManager } = window.StorecipeAuthUiManager;
  const { createThemeManager } = window.StorecipeThemeManager;
  const { createLanguageManager } = window.StorecipeLanguageManager;
  const { createFriendsManager } = window.StorecipeFriendsManager;
  const { createViewManager } = window.StorecipeViewManager;
  const { createImportNotice, extractImportUrl } = window.StorecipeImportNotice;
  const { createInlineEditManager } = window.StorecipeInlineEditManager;

  const {
    toastContainer,
    appRoot,
    startupLoader,
    authForm,
    authPanel,
    settingsBackdrop,
    settingsButton,
    closeSettingsButton,
    authEmail,
    authPassword,
    authStatus,
    authLoading,
    authLoadingText,
    appStatus,
    signInButton,
    signUpButton,
    themeOptions,
    sunsetInfoText,
    languageOptions,
    signedInEmail,
    settingsAvatar,
    homeLink,
    draftNotice,
    discardDraft,
    downloadBackup,
    captchaBox,
    signOutButton,
    authConfirmPassword,
    authConfirmPasswordLabel,
    passwordRequirements,
    authEmailLabel,
    authPasswordLabel,
    recipeForm,
    recipeListLoading,
    recipeList,
    searchInput,
    categoryFilter,
    favouritesFilter,
    sortSelect,
    searchPanel,
    toggleFilters,
    searchFilters,
    activeFilterCount,
    showManualForm,
    listPanel,
    addRecipeSection,
    recipeFormHeading,
    toggleAddRecipe,
    saveRecipeButton,
    cancelEditButton,
    closeRecipeForm,
    imageInput,
    imageUrlInput,
    recipeImportUrlInput,
    importRecipeButton,
    recipeImportTools,
    importQuotaInfo,
    importNotice: importNoticeEl,
    prepHoursInput,
    prepMinutesInput,
    prepTimeWarning,
    cookHoursInput,
    cookMinutesInput,
    cookTimeWarning,
    totalTimeInput,
    servesInput,
    servesWarning,
    difficultyInput,
    difficultyValue,
    editImageTools,
    editImagePreview,
    editImageEmpty,
    chooseImageButton,
    clearImageButton,
    undoImageButton,
    recipeDetail,
    detailContent,
    closeDetail,
    openShoppingList,
    floatingShoppingList,
    floatingShoppingCount,
    shoppingListModal,
    closeShoppingList,
    shoppingListEmpty,
    shoppingListRecipes,
    shoppingListItems,
    clearShoppingList,
    copyShoppingList,
    openMealPlanner,
    mealPlannerModal,
    closeMealPlanner,
    mealPlannerPrevWeek,
    mealPlannerNextWeek,
    mealPlannerWeekLabel,
    mealPlannerGrid,
    clearMealPlanner,
    openFriends,
    friendsModal,
    closeFriends,
    myInviteCode,
    copyInviteCode,
    addFriendTabCode,
    addFriendTabEmail,
    addFriendInput,
    addFriendButton,
    friendsList,
    friendsEmpty,
    toggleFriendsFeed,
    recipeListHeading
  } = getDomRefs();

  const state = createAppState({ DEFAULT_THEME, DEFAULT_LANGUAGE });
  const i18n = createI18n({ defaultLocale: DEFAULT_LANGUAGE });
  const t = (key, params) => i18n.t(key, params);
  // Apply initial DOM translations as soon as the DOM is parsed (defer scripts run after).
  i18n.applyToDom(document);

  // Switched-off features are hidden by CSS, so the many places that show/hide
  // these controls don't each need to know about the switch.
  Object.entries(FEATURES).forEach(([name, enabled]) => {
    document.body.classList.toggle(`feature-off-${name}`, !enabled);
  });

  // Supabase restores the persisted session asynchronously. onAuthStateChange
  // fires INITIAL_SESSION on its own schedule and its handler is not awaited by
  // init(), so without this signal init() can hide the startup loader while the
  // auth UI is still showing its signed-out default — that's the login-form
  // flash on refresh. applyAuthSession resolves this as soon as it has painted
  // the correct shell (before recipes finish loading).
  let markAuthUiReady = () => {};
  const authUiReady = new Promise((resolve) => {
    markAuthUiReady = resolve;
  });
  const AUTH_UI_READY_TIMEOUT_MS = 8000;
  function waitForAuthUiReady() {
    return Promise.race([
      authUiReady,
      new Promise((resolve) => window.setTimeout(resolve, AUTH_UI_READY_TIMEOUT_MS))
    ]);
  }

  function setStartupLoading(isLoading) {
    state.isStartupLoading = Boolean(isLoading);
    if (startupLoader) {
      startupLoader.classList.toggle("hidden", !isLoading);
    }
    if (appRoot) {
      appRoot.hidden = Boolean(isLoading);
      appRoot.setAttribute("aria-hidden", isLoading ? "true" : "false");
      appRoot.setAttribute("aria-busy", isLoading ? "true" : "false");
      // Fade is a one-shot animation, not a transition from opacity:0, so the
      // app stays visible even if this class never lands (background tab, etc).
      appRoot.classList.toggle("app--ready", !isLoading);
    }
    if (!isLoading && state.activeRecipeLoadCount > 0) {
      // Recipes are still in flight as we reveal — show the list skeleton so the
      // user never sees an empty list settle into a populated one.
      authUiManager.setRecipeListLoading(true);
    }
  }
  const normalizeDifficulty = (value) => normalizeDifficultyCore(value, DEFAULT_DIFFICULTY);
  const normalizeStoragePath = (value) => normalizeStoragePathCore(value, BUCKET);
  // Dynamic, so it re-evaluates on language change.
  // "Save to my recipes" on a shared recipe page links to ?save=<token>. The
  // token is kept until the visitor is signed in (through sign-up and email
  // confirmation too), then the recipe is saved and opened.
  const PENDING_SHARED_SAVE_KEY = "storecipe_pending_shared_save";
  const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
  function readPendingSharedSave() {
    try {
      return window.localStorage.getItem(PENDING_SHARED_SAVE_KEY) || "";
    } catch (_error) {
      return "";
    }
  }
  function clearPendingSharedSave() {
    try {
      window.localStorage.removeItem(PENDING_SHARED_SAVE_KEY);
    } catch (_error) {
      /* nothing to clear */
    }
  }
  (() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("save");
    if (!token) return;
    if (SHARE_TOKEN_RE.test(token)) {
      try {
        window.localStorage.setItem(PENDING_SHARED_SAVE_KEY, token);
      } catch (_error) {
        /* private mode: saved below if already signed in */
      }
    }
    params.delete("save");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  })();

  const getSignedOutPrompt = () => t(readPendingSharedSave() ? "share.signInToSaveNotice" : "auth.signInPrompt");
  const SIGNED_OUT_PROMPT = getSignedOutPrompt;
  const DRAFT_LOCAL_KEY = "storecipe_recipe_draft";
  const EDIT_DRAFT_LOCAL_KEY = "storecipe_recipe_edit_draft";
  const supabaseServices = createSupabaseServices({
    config: {
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_URL_PLACEHOLDER,
      SUPABASE_KEY_PLACEHOLDER,
      NETWORK_TIMEOUT_MS,
      IMAGE_RESOLVE_TIMEOUT_MS,
      IMAGE_SIGN_TIMEOUT_MS,
      BUCKET,
      THEME_PREFERENCES_TABLE,
      PROFILES_TABLE,
      FRIENDSHIPS_TABLE,
      RECIPE_IMPORT_FUNCTION
    },
    state: {
      get currentSession() {
        return state.currentSession;
      },
      signedImageUrlByPath: state.signedImageUrlByPath
    },
    helpers: {
      withTimeout,
      normalizeStoragePath: normalizeStoragePathCore,
      getDirectImageUrl,
      shrinkImageForUpload
    }
  });
  const {
    hasSupabaseConfig,
    client,
    fetchThemePreferenceViaRest,
    upsertThemePreferenceViaRest,
    fetchLanguagePreferenceViaRest,
    upsertLanguagePreferenceViaRest,
    fetchMyProfileViaRest,
    lookupProfileByEmailViaRest,
    lookupProfileByInviteCodeViaRest,
    fetchFriendshipsViaRest,
    addFriendshipViaRest,
    setFriendshipMutedViaRest,
    deleteFriendshipViaRest,
    fetchFriendRecipesViaRest,
    insertRecipeViaRest,
    updateRecipeViaRest,
    fetchRecipesViaRest,
    importRecipeFromUrlViaFunction,
    importRecipeFromTextViaFunction,
    importRecipeFromImageViaFunction,
    saveSharedRecipeViaFunction,
    updateMyDisplayNameViaRest,
    fetchImportQuotaViaFunction,
    uploadImage,
    fetchExternalImageAsFile,
    readFileAsDataUrl,
    getSignedImageUrl,
    toggleRecipePublicViaRest,
    fetchPublicRecipeViaRest
  } = supabaseServices;
  const durationDigitInputs = [prepHoursInput, prepMinutesInput, cookHoursInput, cookMinutesInput].filter(Boolean);

  const demoRecipes = [
    {
      id: "demo-omelette",
      title: "Simple Veggie Omelette",
      ingredients: "2 eggs\n1/4 cup chopped onion\n1/4 cup chopped bell pepper\nSalt and pepper",
      method:
        "1. Whisk eggs with salt and pepper.\n2. Saute onion and pepper for 2 minutes.\n3. Add eggs and cook until set.",
      image_url: null,
      difficulty: DEFAULT_DIFFICULTY,
      created_at: "2026-02-10T10:30:00.000Z"
    },
    {
      id: "demo-pasta",
      title: "Quick Garlic Pasta",
      ingredients: "200g spaghetti\n3 garlic cloves\n2 tbsp olive oil\nChili flakes\nSalt",
      method:
        "1. Cook spaghetti in salted water.\n2. Saute sliced garlic in olive oil.\n3. Toss pasta with garlic oil and chili flakes.",
      image_url: null,
      difficulty: DEFAULT_DIFFICULTY,
      created_at: "2026-02-09T18:00:00.000Z"
    }
  ];

  function getLocalRecipes() {
    const stored = window.localStorage.getItem(LOCAL_RECIPES_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.map((item) => ({ ...item, difficulty: normalizeDifficulty(item?.difficulty) }));
        }
      } catch (_error) {
      }
    }

    window.localStorage.setItem(LOCAL_RECIPES_KEY, JSON.stringify(demoRecipes));
    return [...demoRecipes];
  }

  function saveLocalRecipes(nextRecipes) {
    window.localStorage.setItem(LOCAL_RECIPES_KEY, JSON.stringify(nextRecipes));
  }

  function updateImportButtonUi() {
    if (!importRecipeButton) return;
    const busy = Boolean(state.isImportingRecipe);
    importRecipeButton.disabled = busy;
    importRecipeButton.classList.toggle("is-busy", busy);
    importRecipeButton.setAttribute("aria-busy", busy ? "true" : "false");
    const label = document.createElement("span");
    label.textContent = busy ? t("form.importing") : t("form.importButton");
    if (busy) {
      const spinner = document.createElement("span");
      spinner.className = "button-spinner";
      spinner.setAttribute("aria-hidden", "true");
      importRecipeButton.replaceChildren(spinner, label);
    } else {
      importRecipeButton.replaceChildren(label);
    }
    if (recipeImportUrlInput) recipeImportUrlInput.readOnly = busy;
  }

  function applyImportedRecipeToForm(recipe) {
    if (!recipe || !recipeForm) return;

    const title = normalizeImportedText(recipe.title);
    const description = normalizeImportedText(recipe.description);
    const category = normalizeImportedText(recipe.category);
    const ingredients = normalizeImportedText(recipe.ingredients);
    const method = normalizeImportedText(recipe.method);
    const prepHours = parseOptionalBoundedInteger(recipe.prep_hours, 0, 10);
    const prepMinutes = parseOptionalBoundedInteger(recipe.prep_minutes, 0, 60);
    const cookHours = parseOptionalBoundedInteger(recipe.cook_hours, 0, 10);
    const cookMinutes = parseOptionalBoundedInteger(recipe.cook_minutes, 0, 60);
    const serves = parseOptionalBoundedInteger(recipe.serves, 1, 15);
    const difficulty = parseOptionalBoundedInteger(recipe.difficulty, 1, 10) ?? DEFAULT_DIFFICULTY;

    if (title) {
      recipeForm.elements.title.value = title;
    }
    if (description && recipeForm.elements.description) {
      recipeForm.elements.description.value = description;
    }
    if (category && recipeForm.elements.category) {
      const select = recipeForm.elements.category;
      if ([...select.options].some((option) => option.value === category)) {
        select.value = category;
      }
    }
    if (ingredients) {
      recipeForm.elements.ingredients.value = ingredients;
    }
    if (method) {
      recipeForm.elements.method.value = method;
    }
    const notes = normalizeImportedText(recipe.notes);
    if (notes && recipeForm.elements.notes) {
      recipeForm.elements.notes.value = notes;
    }

    if (prepHoursInput) prepHoursInput.value = prepHours == null ? "" : String(prepHours);
    if (prepMinutesInput) prepMinutesInput.value = prepMinutes == null ? "" : String(prepMinutes);
    if (cookHoursInput) cookHoursInput.value = cookHours == null ? "" : String(cookHours);
    if (cookMinutesInput) cookMinutesInput.value = cookMinutes == null ? "" : String(cookMinutes);
    if (servesInput) servesInput.value = serves == null ? "" : String(serves);
    if (difficultyInput) {
      difficultyInput.value = String(difficulty);
      syncDifficultyUi();
    }

    const importedImageUrl = normalizeImportedText(recipe.image_url);
    if (importedImageUrl && isValidHttpUrl(importedImageUrl)) {
      state.pendingImageAction = "replace_url";
      state.pendingImageUrl = importedImageUrl;
      state.pendingImageFile = null;
      clearEditPreviewObjectUrl();
      if (imageInput) {
        imageInput.value = "";
      }
      if (imageUrlInput) {
        imageUrlInput.value = importedImageUrl;
      }
    }

    const editingRecipe = state.editingRecipeId ? state.recipes.find((item) => item.id === state.editingRecipeId) || null : null;
    void refreshEditImageTools(editingRecipe);
    getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
  }

  const authUiManager = createAuthUiManager({
    dom: {
      authStatus, authLoading, authLoadingText, authEmail, authPassword,
      signInButton, signUpButton, signOutButton, signedInEmail, settingsAvatar,
      authEmailLabel, authPasswordLabel, authPanel, settingsButton, openShoppingList, openMealPlanner, closeSettingsButton,
      settingsBackdrop, recipeListLoading, recipeList, appStatus, toastContainer
    },
    state,
    config: { hasSupabaseConfig, SIGNED_OUT_PROMPT },
    callbacks: {
      setSettingsOpen: (...args) => setSettingsOpen(...args),
      updateThemeToggleUi: () => updateThemeToggleUi()
    }
  });
  const setAuthStatus = authUiManager.setAuthStatus;
  const setAuthLoading = authUiManager.setAuthLoading;
  const beginRecipeListLoad = authUiManager.beginRecipeListLoad;
  const endRecipeListLoad = authUiManager.endRecipeListLoad;
  const resetRecipeListLoadingState = authUiManager.resetRecipeListLoadingState;
  const setAppStatus = authUiManager.setAppStatus;
  const showToast = authUiManager.showToast;

  const importNotice = importNoticeEl
    ? createImportNotice({
        container: importNoticeEl,
        input: recipeImportUrlInput,
        wrapper: recipeImportTools,
        i18n,
        onRetry: () => void runRecipeImport(lastImportRequest),
        onManual: () => showManualRecipeFields({ focus: true })
      })
    : null;

  const logSupabaseError = authUiManager.logSupabaseError;
  const setAuthUi = authUiManager.setAuthUi;

  const themeManager = createThemeManager({
    dom: { themeOptions, sunsetInfoText },
    state,
    config: { DEFAULT_THEME, THEME_LOCAL_KEY_PREFIX, THEME_PREFERENCES_TABLE },
    helpers: { normalizeTheme },
    supabaseServices: { hasSupabaseConfig, fetchThemePreferenceViaRest, upsertThemePreferenceViaRest },
    setAppStatus,
    i18n
  });
  const updateThemeToggleUi = themeManager.updateThemeToggleUi;
  const setTheme = themeManager.setTheme;
  const loadThemePreference = themeManager.loadThemePreference;
  const saveThemePreference = themeManager.saveThemePreference;

  const languageManager = createLanguageManager({
    dom: { languageOptions },
    state,
    config: {
      DEFAULT_LANGUAGE,
      LANGUAGE_LOCAL_KEY_PREFIX,
      THEME_PREFERENCES_TABLE,
      SUPPORTED_LANGUAGES
    },
    helpers: { normalizeLanguage },
    supabaseServices: {
      hasSupabaseConfig,
      fetchLanguagePreferenceViaRest,
      upsertLanguagePreferenceViaRest
    },
    setAppStatus,
    i18n,
    onLanguageChange: () => {
      // Re-render dynamic views so their dynamic strings pick up the new locale.
      try { rerenderList(); } catch (_e) {}
      try { renderShoppingList(); } catch (_e) {}
      try { renderMealPlanner(); } catch (_e) {}
      const openId = new URLSearchParams(window.location.search).get("recipe");
      if (openId) {
        const pool = state.isFriendsFeedActive ? (state.friendRecipes || []) : state.recipes;
        const openRecipe = Array.isArray(pool) ? pool.find((item) => String(item.id) === String(openId)) : null;
        if (openRecipe) {
          try { showDetail(openRecipe, { scrollToDetail: false }); } catch (_e) {}
        }
      }
      // Sync UI controls that hold dynamic text.
      try { updateThemeToggleUi(); } catch (_e) {}
      try { updateImportButtonUi(); } catch (_e) {}
      try { setToggleAddRecipeState(!addRecipeSection.classList.contains("hidden")); } catch (_e) {}
      try { setRecipeFormMode(state.editingRecipeId); } catch (_e) {}
      try { syncDifficultyUi(); } catch (_e) {}
    }
  });
  const updateLanguageButtonUi = languageManager.updateLanguageButtonUi;
  const setLanguage = languageManager.setLanguage;
  const loadLanguagePreference = languageManager.loadLanguagePreference;
  const saveLanguagePreference = languageManager.saveLanguagePreference;

  const imageManager = createImageManager({
    dom: { editImageTools, editImagePreview, editImageEmpty, imageUrlInput, clearImageButton, undoImageButton },
    state,
    helpers: { isValidHttpUrl, getDisplayImageUrl },
    getSignedImageUrl,
    i18n
  });
  const clearEditPreviewObjectUrl = imageManager.clearEditPreviewObjectUrl;
  const hideEditImageTools = imageManager.hideEditImageTools;
  const refreshEditImageTools = imageManager.refreshEditImageTools;

  function setRecipeFormMode(recipe = null) {
    state.editingRecipeId = recipe?.id || null;
    if (recipeFormHeading) {
      recipeFormHeading.textContent = state.editingRecipeId ? t("form.editTitle") : t("form.addTitle");
    }
    if (saveRecipeButton) {
      saveRecipeButton.textContent = state.editingRecipeId ? t("form.update") : t("form.save");
    }
    if (cancelEditButton) {
      cancelEditButton.classList.remove("hidden");
      cancelEditButton.textContent = state.editingRecipeId ? t("form.cancel") : t("form.cancelShort");
    }
    if (!state.editingRecipeId) {
      hideEditImageTools();
    }
    if (recipeImportTools) {
      recipeImportTools.classList.toggle("hidden", Boolean(state.editingRecipeId));
    }
    // A new recipe starts as just the link box; editing shows the full form.
    recipeForm.classList.toggle("recipe-form--import-only", !state.editingRecipeId);
  }

  function showManualRecipeFields({ focus = false } = {}) {
    recipeForm.classList.remove("recipe-form--import-only");
    if (focus) recipeForm.elements.title?.focus();
  }

  function startEditRecipe(recipe) {
    if (!recipe) return;
    clearEditPreviewObjectUrl();
    state.pendingImageAction = "keep";
    state.pendingImageFile = null;
    state.pendingImageUrl = "";
    setRecipeFormMode(recipe);
    recipeForm.elements.title.value = recipe.title || "";
    if (recipeForm.elements.category) {
      recipeForm.elements.category.value = recipe.category || "";
    }
    if (recipeForm.elements.description) {
      recipeForm.elements.description.value = recipe.description || "";
    }
    recipeForm.elements.ingredients.value = recipe.ingredients || "";
    recipeForm.elements.method.value = recipe.method || "";
    if (recipeForm.elements.notes) {
      recipeForm.elements.notes.value = recipe.notes || "";
    }
    const prepParsed = parseDurationText(recipe.prep_time ?? recipe.prepTime ?? "");
    const cookParsed = parseDurationText(recipe.cooking_time ?? recipe.cookingTime ?? "");
    if (prepHoursInput) {
      prepHoursInput.value = prepParsed.hours;
    }
    if (prepMinutesInput) {
      prepMinutesInput.value = prepParsed.minutes;
    }
    if (cookHoursInput) {
      cookHoursInput.value = cookParsed.hours;
    }
    if (cookMinutesInput) {
      cookMinutesInput.value = cookParsed.minutes;
    }
    if (totalTimeInput) {
      totalTimeInput.value = normalizeOptionalText(recipe.total_time ?? recipe.totalTime ?? "") || "";
    }
    if (recipeForm.elements.serves) {
      recipeForm.elements.serves.value = recipe.serves ?? recipe.servings ?? "";
    }
    if (difficultyInput) {
      difficultyInput.value = String(normalizeDifficulty(recipe.difficulty));
      syncDifficultyUi();
    }
    recipeForm.elements.image.value = "";
    if (imageUrlInput) {
      imageUrlInput.value = "";
    }
    getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
    setAddRecipeOpen(true);
    void refreshEditImageTools(recipe);
    setAppStatus(t("status.editingRecipe"));
    saveDraft();
  }

  // keepDraft: empty the form but leave the saved draft for next time (closing
  // the form). Without it the draft goes too (after saving, or discarding).
  function resetRecipeFormState({ keepDraft = false } = {}) {
    if (keepDraft && !state.editingRecipeId) {
      // Only a form that's on screen holds the draft; a hidden one is empty.
      if (!addRecipeSection.classList.contains("hidden")) saveDraft({ formOpen: false });
    } else if (state.editingRecipeId) {
      clearDraft(EDIT_DRAFT_LOCAL_KEY);
    } else {
      clearDraft(DRAFT_LOCAL_KEY);
    }
    recipeForm.reset();
    state.pendingImportSourceUrl = "";
    syncDifficultyUi();
    recipeMetaManager.resetValidationUi();
    setRecipeFormMode(null);
    hideEditImageTools();
    importNotice?.clear();
    if (draftNotice) draftNotice.classList.add("hidden");
    document.getElementById("ingredientsSplitHint")?.classList.add("hidden");
  }

  // Saved from the first character typed. formOpen remembers whether the form
  // was on screen, so a page refresh reopens it but a deliberate close doesn't.
  function saveDraft({ formOpen = true } = {}) {
    if (formOpen && addRecipeSection.classList.contains("hidden")) return;
    const key = state.editingRecipeId ? EDIT_DRAFT_LOCAL_KEY : DRAFT_LOCAL_KEY;
    try {
      const draft = {
        formOpen,
        editingRecipeId: state.editingRecipeId || null,
        title: recipeForm.elements.title?.value || "",
        description: recipeForm.elements.description?.value || "",
        ingredients: recipeForm.elements.ingredients?.value || "",
        method: recipeForm.elements.method?.value || "",
        notes: recipeForm.elements.notes?.value || "",
        prepHours: prepHoursInput?.value || "",
        prepMinutes: prepMinutesInput?.value || "",
        cookHours: cookHoursInput?.value || "",
        cookMinutes: cookMinutesInput?.value || "",
        category: recipeForm.elements.category?.value || "",
        serves: recipeForm.elements.serves?.value || "",
        difficulty: difficultyInput?.value || "",
        imageUrl: imageUrlInput?.value || "",
        savedAt: Date.now()
      };
      if (!draftHasContent(draft)) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(draft));
    } catch (_) { /* localStorage full or unavailable */ }
  }

  // Difficulty always has a value, so it doesn't count as something typed.
  function draftHasContent(draft) {
    return ["title", "description", "ingredients", "method", "notes", "serves", "imageUrl", "prepHours", "prepMinutes", "cookHours", "cookMinutes", "category"]
      .some((field) => String(draft?.[field] ?? "").trim() !== "");
  }

  const saveDraftDebounced = debounce(saveDraft, 500);

  function clearDraft(key = DRAFT_LOCAL_KEY) {
    try { window.localStorage.removeItem(key); } catch (_) {}
  }

  function loadDraft(key = DRAFT_LOCAL_KEY) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object" || !draftHasContent(draft)) return null;
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      if (draft.savedAt && Date.now() - draft.savedAt > maxAge) {
        clearDraft(key);
        return null;
      }
      return draft;
    } catch (_) {
      return null;
    }
  }

  function restoreDraft(draft) {
    if (!draft) return false;
    if (draft.editingRecipeId) {
      const recipe = state.recipes.find((r) => r.id === draft.editingRecipeId);
      if (!recipe) {
        clearDraft(EDIT_DRAFT_LOCAL_KEY);
        return false;
      }
      startEditRecipe(recipe);
    } else {
      setRecipeFormMode(null);
    }
    if (recipeForm.elements.title) recipeForm.elements.title.value = draft.title || "";
    if (recipeForm.elements.description) recipeForm.elements.description.value = draft.description || "";
    if (recipeForm.elements.category) recipeForm.elements.category.value = draft.category || "";
    if (recipeForm.elements.ingredients) recipeForm.elements.ingredients.value = draft.ingredients || "";
    if (recipeForm.elements.method) recipeForm.elements.method.value = draft.method || "";
    if (recipeForm.elements.notes) recipeForm.elements.notes.value = draft.notes || "";
    if (prepHoursInput) prepHoursInput.value = draft.prepHours || "";
    if (prepMinutesInput) prepMinutesInput.value = draft.prepMinutes || "";
    if (cookHoursInput) cookHoursInput.value = draft.cookHours || "";
    if (cookMinutesInput) cookMinutesInput.value = draft.cookMinutes || "";
    if (recipeForm.elements.serves) recipeForm.elements.serves.value = draft.serves || "";
    if (difficultyInput) {
      difficultyInput.value = draft.difficulty || String(DEFAULT_DIFFICULTY);
      syncDifficultyUi();
    }
    if (imageUrlInput && draft.imageUrl) imageUrlInput.value = draft.imageUrl;
    getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
    showManualRecipeFields();
    setAddRecipeOpen(true);
    // A new-recipe draft says it's back and can be thrown away. The link box
    // stays hidden meanwhile, so an import can't overwrite the draft.
    if (draftNotice) draftNotice.classList.toggle("hidden", Boolean(draft.editingRecipeId));
    if (!draft.editingRecipeId && recipeImportTools) recipeImportTools.classList.add("hidden");
    saveDraft();
    return true;
  }

  const hasCoreUi =
    Boolean(recipeForm) &&
    Boolean(toggleAddRecipe) &&
    Boolean(recipeList) &&
    Boolean(searchInput) &&
    Boolean(addRecipeSection);
  if (!hasCoreUi) {
    setAppStatus(t("status.uiMismatch"));
    return;
  }

  recipeForm.noValidate = true;

  function isMissingUserIdColumn(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("user_id") && message.includes("column");
  }

  const recipeMetaManager = createRecipeMetaManager({
    recipeForm,
    prepHoursInput,
    prepMinutesInput,
    prepTimeWarning,
    cookHoursInput,
    cookMinutesInput,
    cookTimeWarning,
    totalTimeInput,
    servesInput,
    servesWarning,
    difficultyInput,
    difficultyValue,
    defaultDifficulty: DEFAULT_DIFFICULTY,
    helpers: {
      normalizeDifficulty: normalizeDifficultyCore,
      getDifficultyLabel,
      parseTimePair,
      validateServesValue,
      formatDuration
    },
    i18n
  });
  const syncDifficultyUi = recipeMetaManager.syncDifficultyUi;
  const getRecipeMetaFromFormData = recipeMetaManager.getRecipeMetaFromFormData;

  function isMissingRecipeMetaColumns(error) {
    const message = String(error?.message || "").toLowerCase();
    const mentionsMetaColumn =
      message.includes("prep_time") ||
      message.includes("cooking_time") ||
      message.includes("total_time") ||
      message.includes("serves") ||
      message.includes("difficulty");
    return mentionsMetaColumn && (message.includes("column") || message.includes("schema cache"));
  }

  const settingsManager = createSettingsManager({
    dom: { authPanel, settingsBackdrop, settingsButton, languageOptions, signOutButton, authEmail },
    state
  });
  const getSettingsFocusableElements = settingsManager.getSettingsFocusableElements;
  const positionSettingsPanel = settingsManager.positionSettingsPanel;
  const setSettingsOpen = settingsManager.setSettingsOpen;

  const viewManager = createViewManager({
    dom: {
      searchPanel, listPanel, addRecipeSection, recipeDetail, detailContent,
      searchInput, toggleAddRecipe, recipeForm
    },
    state,
    config: { hasSupabaseConfig },
    callbacks: {
      resetRecipeFormState: () => resetRecipeFormState(),
      resetRecipeListLoadingState
    },
    i18n
  });
  const isRecipeUiAvailable = viewManager.isRecipeUiAvailable;
  const setToggleAddRecipeState = viewManager.setToggleAddRecipeState;
  const setRecipeUiEnabled = viewManager.setRecipeUiEnabled;
  const showListView = viewManager.showListView;
  const setAddRecipeOpen = viewManager.setAddRecipeOpen;
  const setDetailOpen = viewManager.setDetailOpen;

  const friendsManager = createFriendsManager({
    dom: {
      friendsModal, openFriends, closeFriends, myInviteCode, copyInviteCode,
      addFriendTabCode, addFriendTabEmail, addFriendInput, addFriendButton,
      friendsList, friendsEmpty, toggleFriendsFeed, recipeListHeading
    },
    state,
    helpers: { escapeHtml },
    supabaseServices: {
      hasSupabaseConfig,
      fetchMyProfileViaRest,
      lookupProfileByEmailViaRest,
      lookupProfileByInviteCodeViaRest,
      fetchFriendshipsViaRest,
      addFriendshipViaRest,
      setFriendshipMutedViaRest,
      deleteFriendshipViaRest,
      fetchFriendRecipesViaRest
    },
    setAppStatus,
    logSupabaseError,
    i18n
  });
  friendsManager.attachListeners();
  friendsManager.setAddMode("code");

  const recipeRenderer = createRecipeRenderer({
    dom: { recipeList, detailContent, recipeDetail },
    state: {
      get recipes() {
        // When the friends feed is on, the list shows friend-owned shared recipes.
        // The current recipe's user_id is checked downstream to render read-only
        // actions for non-owned cards in the detail view.
        return state.isFriendsFeedActive ? (state.friendRecipes || []) : state.recipes;
      },
      get currentUser() {
        return state.currentUser;
      },
      get isFriendsFeedActive() {
        return state.isFriendsFeedActive;
      },
      get keepScreenOn() {
        return state.keepScreenOn;
      }
    },
    hasSupabaseConfig,
    helpers: {
      formatDate,
      escapeHtml,
      normalizeDifficulty: normalizeDifficultyCore,
      getDifficultyLabel,
      parseDurationText,
      formatDuration,
      getDisplayImageUrl,
      getDirectImageUrl,
      renderIngredientListHtml,
      renderMethodListHtml
    },
    getSignedImageUrl,
    setDetailOpen,
    logSupabaseError,
    i18n
  });
  const renderList = recipeRenderer.renderList;
  const rawShowDetail = recipeRenderer.showDetail;
  const hydrateImagesInBackground = recipeRenderer.hydrateImagesInBackground;

  // The app restores the list position itself (see returnToList); the browser's
  // own restoration would fight it, putting Back at the top of the list.
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

  let suppressUrlUpdate = false;
  function pushRecipeUrl(recipeId) {
    if (suppressUrlUpdate || !recipeId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("recipe") === String(recipeId)) return;
    params.set("recipe", String(recipeId));
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.pushState({ recipeId: String(recipeId) }, "", newUrl);
  }
  function clearRecipeUrl() {
    if (suppressUrlUpdate) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("recipe")) return;
    params.delete("recipe");
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? "?" + query : ""}${window.location.hash}`;
    window.history.pushState({ recipeId: null }, "", newUrl);
  }
  function showDetail(recipe, options = {}) {
    const isOpeningFromList = listPanel && !listPanel.classList.contains("hidden");
    if (isOpeningFromList) {
      state.listScrollY = window.scrollY;
      state.lastOpenedRecipeId = recipe?.id || null;
    }
    rawShowDetail(recipe, { ...options, scrollToDetail: false });
    // Keyboard and screen-reader users land on the recipe, not back at the top.
    if (isOpeningFromList) detailContent.querySelector("h2")?.focus({ preventScroll: true });
    // A recipe opens at the top of the page with the header in view, without an
    // animated scroll. Re-renders (inline edits, photo loading) keep the position.
    if (options.scrollToDetail !== false) window.scrollTo({ top: 0, behavior: "instant" });
    if (recipe && recipe.id) pushRecipeUrl(recipe.id);
  }

  // Back to the list at the spot it was left.
  function returnToList() {
    setDetailOpen(false);
    window.scrollTo({ top: state.listScrollY || 0, behavior: "instant" });
    // ...and back on the card they opened.
    const id = state.lastOpenedRecipeId;
    if (id) recipeList.querySelector(`.recipe-card[data-id="${CSS.escape(String(id))}"]`)?.focus({ preventScroll: true });
  }

  // Escape closes an open recipe, unless something on top of it handled the key
  // first (an edit in progress, settings, the full-size photo).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (recipeDetail.classList.contains("hidden") || state.isSettingsOpen) return;
    if (detailContent.querySelector(".recipe-inline-editor") || document.querySelector(".image-fullview-overlay")) return;
    returnToList();
    clearRecipeUrl();
  });

  // "Keep screen on" while a recipe is open, so the phone doesn't lock mid-cook.
  // Browsers drop the lock whenever the page is hidden, so it's taken again on return.
  const KEEP_SCREEN_ON_KEY = "storecipe_keep_screen_on";
  try {
    state.keepScreenOn = window.localStorage.getItem(KEEP_SCREEN_ON_KEY) === "1";
  } catch (_error) {
    state.keepScreenOn = false;
  }
  let screenWakeLock = null;
  async function updateScreenWakeLock() {
    if (!("wakeLock" in navigator)) return;
    const wanted = state.keepScreenOn && !recipeDetail.classList.contains("hidden") && document.visibilityState === "visible";
    if (wanted && !screenWakeLock) {
      try {
        screenWakeLock = await navigator.wakeLock.request("screen");
        screenWakeLock.addEventListener("release", () => {
          screenWakeLock = null;
        });
      } catch (_error) {
        screenWakeLock = null; // e.g. battery saver, or the browser refused
        return false;
      }
    } else if (!wanted && screenWakeLock) {
      const lock = screenWakeLock;
      screenWakeLock = null;
      lock.release().catch(() => {});
    }
    return true;
  }
  new MutationObserver(() => void updateScreenWakeLock()).observe(recipeDetail, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", () => void updateScreenWakeLock());
  detailContent.addEventListener("change", (event) => {
    const toggle = event.target.closest?.("[data-action='toggle-keep-screen-on']");
    if (!toggle) return;
    state.keepScreenOn = toggle.checked;
    try {
      window.localStorage.setItem(KEEP_SCREEN_ON_KEY, state.keepScreenOn ? "1" : "0");
    } catch (_error) {
      /* the choice still applies until the page is closed */
    }
    void updateScreenWakeLock().then((ok) => {
      if (state.keepScreenOn && ok === false) showToast(t("detail.keepScreenOnFailed"), "info", 5000);
    });
  });

  // The browser's address bar follows the light or dark theme.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    const syncThemeColor = () =>
      themeColorMeta.setAttribute("content", document.body.classList.contains("theme-dark") ? "#0b1622" : "#f8f5ee");
    syncThemeColor();
    new MutationObserver(syncThemeColor).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // Installable app + offline use (see sw.js).
  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((registration) => {
          // Files loaded before the worker took over, so they're kept for offline too.
          const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
          urls.push(window.location.origin + window.location.pathname);
          registration.active?.postMessage({ type: "cache-urls", urls });
        })
        .catch(() => {
          /* the app works the same without it, just not offline */
        });
    });
  }

  // The logo goes home: the recipe list, from wherever you are.
  function goHome() {
    if (state.isSettingsOpen) setSettingsOpen(false, { returnFocus: false });
    if (state.currentUser) {
      if (!addRecipeSection.classList.contains("hidden")) resetRecipeFormState({ keepDraft: true });
      showListView();
      clearRecipeUrl();
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function setFiltersOpen(isOpen) {
    if (searchFilters) searchFilters.classList.toggle("hidden", !isOpen);
    if (toggleFilters) toggleFilters.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  if (toggleFilters && searchFilters) {
    toggleFilters.addEventListener("click", () => setFiltersOpen(searchFilters.classList.contains("hidden")));
  }

  function updateFilterVisibility() {
    const recipes = Array.isArray(state.recipes) ? state.recipes : [];
    const showFilters = recipes.length > 2;
    const uniqueCategories = new Set(recipes.map((r) => r.category).filter(Boolean));
    const showCategoryFilter = showFilters && uniqueCategories.size > 1;

    if (searchPanel) {
      searchPanel.classList.toggle("recipe-search--empty", !recipes.length && !state.isFriendsFeedActive);
    }
    // Filters sit behind the Filters button, offered once there's enough to filter.
    if (toggleFilters) toggleFilters.classList.toggle("hidden", !showFilters);
    if (!showFilters) setFiltersOpen(false);
    if (activeFilterCount) {
      const active =
        (state.activeCategory ? 1 : 0) +
        (state.showFavouritesOnly ? 1 : 0) +
        (state.sortBy && state.sortBy !== "created_at_desc" ? 1 : 0);
      activeFilterCount.textContent = String(active);
      activeFilterCount.classList.toggle("hidden", active === 0);
    }
    if (categoryFilter) categoryFilter.classList.toggle("hidden", !showCategoryFilter);
    if (favouritesFilter) favouritesFilter.classList.toggle("hidden", !showFilters);
    if (sortSelect) sortSelect.classList.toggle("hidden", !showFilters);
  }

  function rerenderList() {
    updateFilterVisibility();
    renderList(searchInput.value.trim().toLowerCase(), {
      category: state.activeCategory || "",
      favouritesOnly: state.showFavouritesOnly,
      sortBy: state.sortBy
    });
  }

  const OFFLINE_RECIPES_PREFIX = "storecipe_offline_recipes_";

  function saveOfflineRecipes(userId, recipes) {
    if (!userId) return;
    try {
      const plain = recipes.map((recipe) => {
        const copy = { ...recipe };
        Object.keys(copy).forEach((key) => {
          if (key.startsWith("_")) delete copy[key];
        });
        return copy;
      });
      window.localStorage.setItem(OFFLINE_RECIPES_PREFIX + userId, JSON.stringify(plain));
    } catch (_error) {
      /* storage full or unavailable: offline copy is a nice-to-have */
    }
  }

  function loadOfflineRecipes(userId) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(OFFLINE_RECIPES_PREFIX + userId) || "null");
      return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function isConnectionError(error) {
    if (!navigator.onLine) return true;
    const text = `${error?.name || ""} ${error?.message || ""}`.toLowerCase();
    return /typeerror|aborterror|failed to fetch|networkerror|load failed|timed out|timeout/.test(text);
  }

  async function loadRecipes() {
    beginRecipeListLoad();
    try {
      if (!hasSupabaseConfig || !state.currentUser) {
        state.recipes = [];
        rerenderList();
        return;
      }

      let data;
      try {
        data = await fetchRecipesViaRest(state.currentUser.id);
      } catch (error) {
        logSupabaseError("load recipes", error);
        const offlineCopy = isConnectionError(error) ? loadOfflineRecipes(state.currentUser.id) : null;
        if (offlineCopy) {
          state.recipes = recipeRenderer
            .normalizeLoadedRecipes(offlineCopy, DEFAULT_DIFFICULTY)
            .filter((item) => !pendingDeletes.has(item.id));
          rerenderList();
          void hydrateImagesInBackground(state.recipes);
          showToast(t("status.offlineRecipes"), "info", 6000);
          return;
        }
        if (isMissingUserIdColumn(error)) {
          setAppStatus(t("status.dbMissingUserId"));
        } else {
          setAppStatus(t("status.loadFailed", { error: error.message }));
        }
        return;
      }

      state.recipes = recipeRenderer
        .normalizeLoadedRecipes(data, DEFAULT_DIFFICULTY)
        .filter((item) => !pendingDeletes.has(item.id));
      rerenderList();
      saveOfflineRecipes(state.currentUser.id, state.recipes);

      // An empty account gets the welcome card in the list, not a pop-up.
      void hydrateImagesInBackground(state.recipes);
      void savePendingSharedRecipe();
      void loadMyDisplayName();
    } finally {
      endRecipeListLoad();
    }
  }

  // source_url needs sql/recipe-source-url-migration.sql; until it's run, save
  // the recipe without it rather than failing.
  async function insertRecipeWithOptionalSource(payload) {
    try {
      return await insertRecipeViaRest(payload);
    } catch (error) {
      if (!("source_url" in payload) || !String(error?.message || "").includes("source_url")) throw error;
      state.hasSourceUrlColumn = false;
      const { source_url: _omitted, ...withoutSource } = payload;
      return insertRecipeViaRest(withoutSource);
    }
  }

  async function addRecipe(formData, options = {}) {
    const title = formData.get("title")?.toString().trim();
    const description = formData.get("description")?.toString().trim() || null;
    const ingredients = formData.get("ingredients")?.toString().trim();
    const method = formData.get("method")?.toString().trim();
    const notes = formData.get("notes")?.toString().trim() || null;
    const category = formData.get("category")?.toString().trim() || null;
    const recipeMeta = getRecipeMetaFromFormData(formData);
    if (recipeMeta.error) {
      return;
    }
    const formImage = formData.get("image");
    const image =
      state.pendingImageAction === "replace_file" && state.pendingImageFile instanceof File ? state.pendingImageFile : formImage;
    const imageUrlValue =
      state.pendingImageAction === "replace_url" && isValidHttpUrl(state.pendingImageUrl) ? state.pendingImageUrl : null;

    if (!title || !ingredients || !method) {
      setAppStatus(t("status.fillTIM"));
      return;
    }

    if (!hasSupabaseConfig) {
      const localRecipe = {
        id: crypto.randomUUID(),
        title,
        description,
        ingredients,
        method,
        notes,
        category,
        is_favourite: false,
        ...recipeMeta,
        image_url: imageUrlValue,
        created_at: new Date().toISOString()
      };
      if (state.pendingImportSourceUrl) {
        localRecipe.source_url = state.pendingImportSourceUrl;
      }
      if (!imageUrlValue && image instanceof File && image.size > 0) {
        localRecipe.image_url = await readFileAsDataUrl(image);
      }
      state.recipes = [localRecipe, ...state.recipes];
      saveLocalRecipes(state.recipes);
      resetRecipeFormState();
      rerenderList();
      showDetail(localRecipe);
      return true;
    }

    if (!state.currentUser) {
      setAppStatus(t("status.signInToAdd"));
      return;
    }

    let imagePath = null;
    if (imageUrlValue) {
      try {
        setAppStatus(t("status.fetchingImage"));
        const fetchedFile = await fetchExternalImageAsFile(imageUrlValue);
        imagePath = await uploadImage(fetchedFile, state.currentUser.id);
      } catch (error) {
        logSupabaseError("image url fetch", error);
        if (!options.skipImageOnError) {
          setAppStatus(t("status.imageFetchFailed", { error: error.message || "Unexpected error" }));
          return false;
        }
        // An import shouldn't be lost just because the site's photo wouldn't download.
        imagePath = null;
        options.onImageSkipped?.();
      }
    } else if (image instanceof File && image.size > 0) {
      try {
        imagePath = await uploadImage(image, state.currentUser.id);
      } catch (error) {
        logSupabaseError("image upload", error);
        setAppStatus(t("status.imageUploadFailed", { error: error.message || "Unexpected error" }));
        return;
      }
    }

    const basePayload = {
      title,
      description,
      ingredients,
      method,
      notes,
      image_url: imagePath,
      user_id: state.currentUser.id
    };
    // Every recipe is visible to friends; there's no per-recipe choice.
    if (state.isFriendsAvailable) {
      basePayload.is_shared_with_friends = true;
    }
    if (state.pendingImportSourceUrl && state.hasSourceUrlColumn) {
      basePayload.source_url = state.pendingImportSourceUrl;
    }
    const catFavFields = state.hasCategoryFavColumns ? { category, is_favourite: false } : {};
    const payload = state.hasRecipeMetaColumns ? { ...basePayload, ...recipeMeta, ...catFavFields } : { ...basePayload, ...catFavFields };

    try {
      let insertedRows;
      let metaWarning = "";

      try {
        insertedRows = await insertRecipeWithOptionalSource(payload);
      } catch (error) {
        if (state.hasRecipeMetaColumns && isMissingRecipeMetaColumns(error)) {
          state.hasRecipeMetaColumns = false;
          metaWarning = "Recipe saved, but timing/serves/difficulty fields need DB migration.";
          insertedRows = await insertRecipeWithOptionalSource(basePayload);
        } else {
          throw error;
        }
      }

      // An import announces its own save, naming the recipe and site.
      if (!options.quiet || metaWarning) setAppStatus(metaWarning || t("status.recipeSaved"));
      resetRecipeFormState();
      const insertedRecipe = Array.isArray(insertedRows) ? insertedRows[0] : null;
      if (insertedRecipe) {
        const hydratedInsertedRecipe = {
          ...insertedRecipe,
          _resolvedImageUrl: await getSignedImageUrl(insertedRecipe.image_url)
        };
        state.recipes = [hydratedInsertedRecipe, ...state.recipes.filter((item) => item.id !== hydratedInsertedRecipe.id)];
        rerenderList();
        showDetail(hydratedInsertedRecipe);
      } else {
        setAddRecipeOpen(false);
      }

      await loadRecipes();
      if (!insertedRecipe) {
        const fallbackRecipe = state.recipes[0];
        if (fallbackRecipe) {
          showDetail(fallbackRecipe);
        }
      }
      return true;
    } catch (error) {
      logSupabaseError("insert recipe", error);
      if (isMissingUserIdColumn(error)) {
        setAppStatus(t("status.dbMissingUserId"));
      } else {
        setAppStatus(t("status.saveFailed", { error: error.message }));
      }
    }
  }

  async function updateRecipe(formData) {
    if (!state.editingRecipeId) {
      await addRecipe(formData);
      return;
    }

    const existingRecipe = state.recipes.find((item) => item.id === state.editingRecipeId);
    if (!existingRecipe) {
      setAppStatus(t("status.couldNotEdit"));
      return;
    }

    const title = formData.get("title")?.toString().trim();
    const description = formData.get("description")?.toString().trim() || null;
    const ingredients = formData.get("ingredients")?.toString().trim();
    const method = formData.get("method")?.toString().trim();
    const notes = formData.get("notes")?.toString().trim() || null;
    const category = formData.get("category")?.toString().trim() || null;
    const recipeMeta = getRecipeMetaFromFormData(formData);
    if (recipeMeta.error) {
      return;
    }
    const selectedImageFile = state.pendingImageAction === "replace_file" ? state.pendingImageFile : null;
    const selectedImageUrl =
      state.pendingImageAction === "replace_url" && isValidHttpUrl(state.pendingImageUrl) ? state.pendingImageUrl : null;
    const removeCurrentImage = state.pendingImageAction === "remove";

    if (!title || !ingredients || !method) {
      setAppStatus(t("status.fillTIM"));
      return;
    }

    if (!hasSupabaseConfig) {
      let nextImageUrl = existingRecipe.image_url;
      if (selectedImageFile instanceof File && selectedImageFile.size > 0) {
        nextImageUrl = await readFileAsDataUrl(selectedImageFile);
      } else if (selectedImageUrl) {
        nextImageUrl = selectedImageUrl;
      } else if (removeCurrentImage) {
        nextImageUrl = null;
      }
      const updatedLocalRecipe = {
        ...existingRecipe,
        title,
        description,
        ingredients,
        method,
        notes,
        category,
        ...recipeMeta,
        image_url: nextImageUrl,
        updated_at: new Date().toISOString()
      };
      state.recipes = state.recipes.map((item) => (item.id === state.editingRecipeId ? updatedLocalRecipe : item));
      saveLocalRecipes(state.recipes);
      resetRecipeFormState();
      rerenderList();
      showDetail(updatedLocalRecipe);
      setAppStatus(t("status.recipeUpdated"));
      return;
    }

    if (!state.currentUser) {
      setAppStatus(t("status.signInToUpdate"));
      return;
    }

    let nextImagePath = existingRecipe.image_url;
    let uploadedNewImage = false;
    if (selectedImageFile instanceof File && selectedImageFile.size > 0) {
      try {
        nextImagePath = await uploadImage(selectedImageFile, state.currentUser.id);
        uploadedNewImage = true;
      } catch (error) {
        logSupabaseError("image upload", error);
        setAppStatus(t("status.imageUploadFailed", { error: error.message || "Unexpected error" }));
        return;
      }
    } else if (selectedImageUrl) {
      try {
        setAppStatus(t("status.fetchingImage"));
        const fetchedFile = await fetchExternalImageAsFile(selectedImageUrl);
        nextImagePath = await uploadImage(fetchedFile, state.currentUser.id);
        uploadedNewImage = true;
      } catch (error) {
        logSupabaseError("image url fetch", error);
        setAppStatus(t("status.imageFetchFailed", { error: error.message || "Unexpected error" }));
        return;
      }
    } else if (removeCurrentImage) {
      nextImagePath = null;
    }

    const basePayload = {
      title,
      description,
      ingredients,
      method,
      notes,
      image_url: nextImagePath,
      updated_at: new Date().toISOString()
    };
    // Every recipe is visible to friends; there's no per-recipe choice.
    if (state.isFriendsAvailable) {
      basePayload.is_shared_with_friends = true;
    }
    const catFavFields = state.hasCategoryFavColumns ? { category } : {};
    const payload = state.hasRecipeMetaColumns ? { ...basePayload, ...recipeMeta, ...catFavFields } : { ...basePayload, ...catFavFields };

    try {
      let updatedRows;
      let metaWarning = "";

      try {
        updatedRows = await updateRecipeViaRest(state.editingRecipeId, state.currentUser.id, payload);
      } catch (error) {
        if (state.hasRecipeMetaColumns && isMissingRecipeMetaColumns(error)) {
          state.hasRecipeMetaColumns = false;
          metaWarning = "Recipe updated, but timing/serves/difficulty fields need DB migration.";
          updatedRows = await updateRecipeViaRest(state.editingRecipeId, state.currentUser.id, basePayload);
        } else {
          throw error;
        }
      }
      const updatedRecipe = Array.isArray(updatedRows) ? updatedRows[0] : null;
      if (!updatedRecipe) {
        throw new Error("Update succeeded but no row was returned.");
      }

      if (uploadedNewImage || selectedImageUrl) {
        const oldPath = normalizeStoragePath(existingRecipe.image_url);
        const newPath = normalizeStoragePath(nextImagePath);
        if (oldPath && oldPath !== newPath) {
          const { error: removeError } = await client.storage.from(BUCKET).remove([oldPath]);
          if (removeError) {
            logSupabaseError("remove old image", removeError);
          }
        }
      } else if (removeCurrentImage) {
        const oldPath = normalizeStoragePath(existingRecipe.image_url);
        if (oldPath) {
          const { error: removeError } = await client.storage.from(BUCKET).remove([oldPath]);
          if (removeError) {
            logSupabaseError("remove old image", removeError);
          }
        }
      }

      let resolvedImageUrl = existingRecipe._resolvedImageUrl || null;
      if (!updatedRecipe.image_url) {
        resolvedImageUrl = null;
      } else if (updatedRecipe.image_url !== existingRecipe.image_url || !resolvedImageUrl) {
        resolvedImageUrl = await getSignedImageUrl(updatedRecipe.image_url);
      }
      const hydratedUpdatedRecipe = {
        ...updatedRecipe,
        _resolvedImageUrl: resolvedImageUrl || getDirectImageUrl(updatedRecipe.image_url)
      };

      state.recipes = state.recipes.map((item) => (item.id === state.editingRecipeId ? hydratedUpdatedRecipe : item));
      resetRecipeFormState();
      rerenderList();
      showDetail(hydratedUpdatedRecipe);
      setAppStatus(metaWarning || t("status.recipeUpdated"));
    } catch (error) {
      logSupabaseError("update recipe", error);
      setAppStatus(t("status.updateFailed", { error: error.message || "Unexpected error" }));
    }
  }

  const UNDO_DELETE_MS = 8000;
  const pendingDeletes = new Map();

  async function deleteRecipe(id) {
    if (hasSupabaseConfig && !state.currentUser) {
      setAppStatus(t("status.signInToDelete"));
      return;
    }
    const index = state.recipes.findIndex((item) => item.id === id);
    if (index === -1) return;
    const recipe = state.recipes[index];

    state.recipes = state.recipes.filter((item) => item.id !== id);
    const timerId = window.setTimeout(() => void commitDelete(id), UNDO_DELETE_MS);
    const pending = { recipe, index, timerId, userId: state.currentUser?.id || null, dismissToast: null };
    pendingDeletes.set(id, pending);

    returnToList();
    clearRecipeUrl();
    rerenderList();
    pending.dismissToast = showToast(t("status.recipeDeletedUndo", { title: recipe.title || t("card.untitled") }), "info", UNDO_DELETE_MS, {
      actionLabel: t("common.undo"),
      onAction: () => undoDelete(id)
    });
  }

  function restorePendingRecipe(pending) {
    if (state.recipes.some((item) => item.id === pending.recipe.id)) return;
    state.recipes.splice(Math.min(pending.index, state.recipes.length), 0, pending.recipe);
    rerenderList();
  }

  function undoDelete(id) {
    const pending = pendingDeletes.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pendingDeletes.delete(id);
    restorePendingRecipe(pending);
    showToast(t("status.deleteUndone", { title: pending.recipe.title || t("card.untitled") }), "success", 3000);
  }

  async function commitDelete(id) {
    const pending = pendingDeletes.get(id);
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pendingDeletes.delete(id);
    // Its Undo would no longer work.
    pending.dismissToast?.();

    if (!hasSupabaseConfig) {
      saveLocalRecipes(state.recipes);
      return;
    }
    // The row first: if that fails, the recipe comes back with its photo intact.
    const { error } = await client.from("recipes").delete().eq("id", id).eq("user_id", pending.userId);
    if (error) {
      restorePendingRecipe(pending);
      setAppStatus(t("status.deleteFailed", { error: error.message }));
      return;
    }
    const imagePathToDelete = normalizeStoragePath(pending.recipe.image_url);
    if (imagePathToDelete) {
      const { error: storageError } = await client.storage.from(BUCKET).remove([imagePathToDelete]);
      if (storageError) logSupabaseError("delete recipe image", storageError);
    }
  }

  // Leaving the page ends the undo window: delete now rather than never (and take
  // the Undo away, since it would no longer work).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    Array.from(pendingDeletes.keys()).forEach((id) => void commitDelete(id));
  });

  function isEmailNotConfirmedError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("email not confirmed") || msg.includes("email_not_confirmed");
  }

  async function resendConfirmation(email) {
    const captcha = takeCaptchaToken();
    if (captcha === null) return;
    setAuthLoading(true, t("auth.resending"));
    try {
      const siteUrl = window.location.origin;
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${siteUrl}/confirm.html`, captchaToken: captcha }
      });
      if (error) {
        setAppStatus(t("status.couldNotResend", { error: error.message }));
      } else {
        setAppStatus(t("status.confirmEmail"));
      }
    } finally {
      setAuthLoading(false);
    }
  }

  function showEmailNotConfirmedUi(email) {
    setAuthStatus(t("auth.emailNotConfirmed"));
    setAppStatus("");
    const existing = document.getElementById("resendConfirmRow");
    if (existing) existing.remove();

    const row = document.createElement("div");
    row.id = "resendConfirmRow";
    row.className = "auth-confirm-prompt";
    row.innerHTML = `
      <p>Check your inbox for a confirmation link, or request a new one.</p>
      <button id="resendConfirmButton" class="button button--secondary" type="button">Resend confirmation email</button>
    `;
    authForm.appendChild(row);

    document.getElementById("resendConfirmButton").addEventListener("click", () => {
      resendConfirmation(email);
    });
  }

  // CAPTCHA (Cloudflare Turnstile) on sign-in, sign-up and resending the
  // confirmation email, so scripts can't mass-create accounts. Active only when
  // TURNSTILE_SITE_KEY is set in config.js (from the Netlify environment) and
  // must be switched on in Supabase (Authentication → Attack Protection) at the
  // same time: Supabase then rejects auth requests without a token.
  const TURNSTILE_SITE_KEY = String(window.StorecipeConfig?.TURNSTILE_SITE_KEY || "").trim();
  let captchaWidgetId = null;
  let captchaToken = "";
  let turnstileLoading = null;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
      turnstileLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing")));
        script.onerror = () => {
          turnstileLoading = null;
          reject(new Error("Turnstile failed to load"));
        };
        document.head.appendChild(script);
      });
    }
    return turnstileLoading;
  }

  async function ensureCaptcha() {
    if (!TURNSTILE_SITE_KEY || !captchaBox || captchaWidgetId !== null) return;
    try {
      const turnstile = await loadTurnstile();
      if (captchaWidgetId !== null) return;
      captchaBox.classList.remove("hidden");
      captchaWidgetId = turnstile.render(captchaBox, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
        language: state.currentLanguage || "auto",
        callback: (token) => {
          captchaToken = token;
        },
        "expired-callback": () => {
          captchaToken = "";
        },
        "error-callback": () => {
          captchaToken = "";
        }
      });
    } catch (_error) {
      setAuthStatus(t("auth.captchaUnavailable"), { isError: true });
    }
  }

  // A token works once: hand it over and get the widget ready for the next try.
  // Returns null when the check is needed but not done yet.
  function takeCaptchaToken() {
    if (!TURNSTILE_SITE_KEY) return undefined;
    const token = captchaToken;
    if (!token) {
      void ensureCaptcha();
      setAuthStatus(t("auth.captchaNeeded"), { isError: true });
      return null;
    }
    captchaToken = "";
    if (captchaWidgetId !== null) window.turnstile?.reset(captchaWidgetId);
    return token;
  }

  if (TURNSTILE_SITE_KEY && authForm) {
    authForm.addEventListener("focusin", () => void ensureCaptcha());
  }

  async function signIn(email, password) {
    const captcha = takeCaptchaToken();
    if (captcha === null) return;
    setAuthLoading(true, t("auth.signingIn"));
    try {
      const { error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: captcha } });
      if (error) {
        if (isEmailNotConfirmedError(error)) {
          showEmailNotConfirmedUi(email);
          return;
        }
        setAuthStatus(t("auth.signInFailedShort", { error: error.message }), { isError: true });
        setAppStatus(t("status.signInFailed", { error: error.message }));
        return;
      }
      const existing = document.getElementById("resendConfirmRow");
      if (existing) existing.remove();
      setAppStatus(t("status.signedInShort"));
    } finally {
      setAuthLoading(false);
      setAuthUi();
    }
  }

  let isSignUpMode = false;

  function getPasswordErrors(password) {
    const errors = [];
    if (password.length < 8) errors.push("At least 8 characters");
    if (!/[A-Z]/.test(password)) errors.push("One uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("One lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("One number");
    return errors;
  }

  function updatePasswordRequirementsUi() {
    if (!passwordRequirements || !isSignUpMode) return;
    const password = authPassword.value;
    const confirmPassword = authConfirmPassword ? authConfirmPassword.value : "";
    const errors = getPasswordErrors(password);
    const mismatch = password && confirmPassword && password !== confirmPassword;

    const items = [
      { text: "At least 8 characters", ok: password.length >= 8 },
      { text: "One uppercase letter", ok: /[A-Z]/.test(password) },
      { text: "One lowercase letter", ok: /[a-z]/.test(password) },
      { text: "One number", ok: /[0-9]/.test(password) }
    ];

    if (confirmPassword) {
      items.push({ text: "Passwords match", ok: password === confirmPassword });
    }

    passwordRequirements.innerHTML = items
      .map((item) => `<span class="password-req ${item.ok ? "password-req--pass" : "password-req--fail"}">${item.ok ? "\u2713" : "\u2717"} ${item.text}</span>`)
      .join("");
  }

  function setSignUpMode(enabled) {
    isSignUpMode = enabled;
    const authName = document.getElementById("authName");
    if (authName) {
      authName.classList.toggle("hidden", !enabled);
      authName.required = enabled;
      document.querySelector("label[for='authName']")?.classList.toggle("hidden", !enabled);
    }
    if (authConfirmPassword) {
      authConfirmPassword.classList.toggle("hidden", !enabled);
      authConfirmPassword.required = enabled;
      if (!enabled) authConfirmPassword.value = "";
    }
    if (authConfirmPasswordLabel) {
      authConfirmPasswordLabel.classList.toggle("hidden", !enabled);
    }
    if (passwordRequirements) {
      passwordRequirements.classList.toggle("hidden", !enabled);
      if (!enabled) passwordRequirements.innerHTML = "";
    }
    if (signInButton) {
      signInButton.classList.toggle("hidden", enabled);
    }
    if (signUpButton) {
      signUpButton.textContent = enabled ? t("auth.createAccount") : t("auth.signUp");
    }
    if (authPassword) {
      authPassword.autocomplete = enabled ? "new-password" : "current-password";
    }
    if (enabled) {
      updatePasswordRequirementsUi();
    }
  }

  async function signUp(email, password, name) {
    const captcha = takeCaptchaToken();
    if (captcha === null) return;
    setAuthLoading(true, t("auth.signingUp"));
    try {
      const siteUrl = window.location.origin;
      const { error } = await client.auth.signUp({
        email,
        password,
        // The display name is copied into the profile by the sign-up trigger
        // (sql/display-names.sql).
        options: { emailRedirectTo: `${siteUrl}/confirm.html`, captchaToken: captcha, data: name ? { display_name: name } : {} }
      });
      if (error) {
        setAuthStatus(t("auth.signUpFailedShort", { error: error.message }), { isError: true });
        setAppStatus(t("status.signUpFailed", { error: error.message }));
        return;
      }
      window.location.href = "confirm.html";
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    setAuthLoading(true, t("auth.signingOut"));
    try {
      const { error } = await client.auth.signOut();
      if (error) {
        setAuthStatus(t("auth.signOutFailedShort", { error: error.message }), { isError: true });
        setAppStatus(t("status.signOutFailed", { error: error.message }));
        return;
      }
      setAppStatus("");
    } finally {
      setAuthLoading(false);
      setAuthUi();
    }
  }

  function showImportQuota(payload) {
    if (!importQuotaInfo) return;
    // null = unlimited user; undefined = this response didn't say, so keep what we show.
    if (payload?.unlimited || payload?.remaining === null) {
      importQuotaInfo.classList.add("hidden");
      return;
    }
    const remaining = payload?.remaining;
    if (typeof remaining !== "number") return;
    importQuotaInfo.textContent = remaining > 0 ? t("import.remaining", { count: remaining }) : t("import.noneLeft");
    importQuotaInfo.classList.toggle("recipe-import-tools__quota--empty", remaining === 0);
    importQuotaInfo.classList.remove("hidden");
  }

  async function refreshImportQuota() {
    if (!hasSupabaseConfig || !state.currentUser || !importQuotaInfo) return;
    try {
      showImportQuota(await fetchImportQuotaViaFunction());
    } catch (_error) {
      // Not deployed yet or offline; an actual import attempt will explain why.
    }
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_error) {
      return url;
    }
  }

  // Pasted text with no link in it, long enough to be a recipe (e.g. a recipe
  // copied out of a chat), is imported as text.
  function looksLikeRecipeText(text) {
    const raw = String(text || "").trim();
    return raw.length >= 20 && /\s/.test(raw);
  }

  // Error codes for a text or photo import (or Tidy up). An import service
  // that only knows links answers "invalid_url": it hasn't been updated yet.
  function textOrPhotoErrorCode(code, kind) {
    if (code === "invalid_url") return "ai_unavailable";
    if (code === "not_recipe") return `not_recipe_${kind}`;
    return code;
  }

  // What to retry if the last import failed.
  let lastImportRequest = {};

  // request: {} to import what's in the link box (a link, or recipe text), or
  // { photo: dataUrl } for a photo or screenshot.
  async function runRecipeImport(request = {}) {
    if (state.isImportingRecipe) return;

    let kind;
    let site = "";
    let call;
    const language = state.currentLanguage;
    if (request.photo) {
      kind = "photo";
      call = () => importRecipeFromImageViaFunction(request.photo, language);
    } else {
      const rawInput = recipeImportUrlInput?.value || "";
      const url = extractImportUrl(rawInput);
      if (isValidHttpUrl(url)) {
        kind = "url";
        // Show the tidied-up link (e.g. "https://" added, surrounding text dropped).
        if (recipeImportUrlInput) recipeImportUrlInput.value = url;
        site = hostnameOf(url);
        call = () => importRecipeFromUrlViaFunction(url, language);
      } else if (looksLikeRecipeText(rawInput)) {
        kind = "text";
        call = () => importRecipeFromTextViaFunction(rawInput.trim(), language);
      } else {
        importNotice?.showError({ code: "invalid_url" });
        recipeImportUrlInput?.focus();
        return;
      }
    }
    lastImportRequest = request;

    state.isImportingRecipe = true;
    updateImportButtonUi();
    const progress = importNotice?.showProgress(site, kind);

    try {
      const data = await call();
      const importedRecipe = data?.recipe && typeof data.recipe === "object" ? data.recipe : null;
      if (!importedRecipe) {
        throw new Error("Import response did not include recipe data.");
      }

      applyImportedRecipeToForm(importedRecipe);
      state.pendingImportSourceUrl = isValidHttpUrl(importedRecipe.source_url) ? importedRecipe.source_url : "";
      showImportQuota(data);
      const title = normalizeImportedText(importedRecipe.title);
      progress?.saving();

      // Save straight away; the recipe page is where it's checked and edited.
      let photoSkipped = false;
      const saved = await submitRecipeForm({
        quiet: true,
        skipImageOnError: true,
        onImageSkipped: () => {
          photoSkipped = true;
        }
      });
      if (saved) {
        importNotice?.clear();
        if (recipeImportUrlInput) recipeImportUrlInput.value = "";
        if (kind !== "url") {
          showToast(t(kind === "photo" ? "status.importedSavedPhoto" : "status.importedSavedText", { title }), "success", 5000);
          return;
        }
        // tidied === false: the AI wasn't available, so this is the site's raw data.
        const caveat = data?.tidied === false ? "untidied" : photoSkipped ? "noPhoto" : "";
        const key = caveat === "untidied" ? "status.importedSavedUntidied" : caveat === "noPhoto" ? "status.importedSavedNoPhoto" : "status.importedSaved";
        // Name the site the recipe really came from (the link may have redirected).
        const source = hostnameOf(normalizeImportedText(importedRecipe.source_url) || site);
        showToast(t(key, { source, title }), caveat ? "info" : "success", caveat ? 8000 : 5000);
      } else {
        // Keep the filled-in form on screen so nothing is lost.
        importNotice?.showError({ code: "save_failed", site });
        showManualRecipeFields();
      }
    } catch (error) {
      showImportQuota(error);
      const code = kind === "url" ? error?.code : textOrPhotoErrorCode(error?.code, kind);
      importNotice?.showError({ code, site, message: error?.message });
    } finally {
      state.isImportingRecipe = false;
      updateImportButtonUi();
    }
  }

  // ── Import from a photo or screenshot ──────────────────────────────────────
  // Shrunk in the browser first (like recipe photos), so it uploads quickly.
  const IMPORT_PHOTO_MAX_BYTES = 2.8 * 1024 * 1024;
  const importPhotoInput = document.getElementById("importPhotoInput");
  document.getElementById("importPhotoButton")?.addEventListener("click", () => {
    if (!state.isImportingRecipe) importPhotoInput?.click();
  });
  importPhotoInput?.addEventListener("change", async () => {
    const file = importPhotoInput.files?.[0];
    importPhotoInput.value = "";
    if (!file) return;
    try {
      const shrunk = await shrinkImageForUpload(file);
      if (!/^image\/(jpeg|png|webp)$/.test(shrunk.type) || shrunk.size > IMPORT_PHOTO_MAX_BYTES) {
        importNotice?.showError({ code: "invalid_image" });
        return;
      }
      await runRecipeImport({ photo: await readFileAsDataUrl(shrunk) });
    } catch (_error) {
      importNotice?.showError({ code: "invalid_image" });
    }
  });

  // ── Tidy up: the AI editor for a recipe typed into the form ────────────────
  const tidyUpButton = document.getElementById("tidyUpButton");

  const TIDY_FIELDS = ["title", "description", "category", "ingredients", "method", "notes"];
  function snapshotRecipeForm() {
    const snapshot = {};
    for (const name of TIDY_FIELDS) snapshot[name] = recipeForm.elements[name]?.value || "";
    snapshot.prepHours = prepHoursInput?.value || "";
    snapshot.prepMinutes = prepMinutesInput?.value || "";
    snapshot.cookHours = cookHoursInput?.value || "";
    snapshot.cookMinutes = cookMinutesInput?.value || "";
    snapshot.serves = servesInput?.value || "";
    snapshot.difficulty = difficultyInput?.value || "";
    return snapshot;
  }

  function restoreRecipeForm(snapshot) {
    for (const name of TIDY_FIELDS) {
      if (recipeForm.elements[name]) recipeForm.elements[name].value = snapshot[name];
    }
    if (prepHoursInput) prepHoursInput.value = snapshot.prepHours;
    if (prepMinutesInput) prepMinutesInput.value = snapshot.prepMinutes;
    if (cookHoursInput) cookHoursInput.value = snapshot.cookHours;
    if (cookMinutesInput) cookMinutesInput.value = snapshot.cookMinutes;
    if (servesInput) servesInput.value = snapshot.serves;
    if (difficultyInput && snapshot.difficulty) {
      difficultyInput.value = snapshot.difficulty;
      syncDifficultyUi();
    }
    recipeForm.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // The form as plain text, labelled so the AI keeps each part where it belongs.
  function recipeFormAsText(snapshot) {
    const time = (hours, minutes) =>
      [hours && `${hours} h`, minutes && `${minutes} min`].filter(Boolean).join(" ");
    const parts = [
      ["Title", snapshot.title],
      ["Description", snapshot.description],
      ["Category", snapshot.category],
      ["Serves", snapshot.serves],
      ["Prep time", time(snapshot.prepHours, snapshot.prepMinutes)],
      ["Cook time", time(snapshot.cookHours, snapshot.cookMinutes)],
      ["Ingredients", snapshot.ingredients],
      ["Method", snapshot.method],
      ["Notes", snapshot.notes]
    ];
    return parts
      .filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `${label}:\n${String(value).trim()}`)
      .join("\n\n");
  }

  function setTidyUpBusy(busy) {
    if (!tidyUpButton) return;
    tidyUpButton.disabled = busy;
    tidyUpButton.setAttribute("aria-busy", busy ? "true" : "false");
    const label = tidyUpButton.querySelector("[data-tidy-label]");
    if (label) label.textContent = t(busy ? "tidy.busy" : "tidy.button");
    tidyUpButton.querySelector(".button-spinner")?.remove();
    if (busy) {
      const spinner = document.createElement("span");
      spinner.className = "button-spinner";
      spinner.setAttribute("aria-hidden", "true");
      tidyUpButton.prepend(spinner);
    }
  }

  async function runTidyUp() {
    if (state.isImportingRecipe) return;
    const before = snapshotRecipeForm();
    if (!before.ingredients.trim() && !before.method.trim()) {
      showToast(t("tidy.needMore"), "info", 5000);
      recipeForm.elements.ingredients?.focus();
      return;
    }
    state.isImportingRecipe = true;
    updateImportButtonUi();
    setTidyUpBusy(true);
    try {
      const data = await importRecipeFromTextViaFunction(recipeFormAsText(before), state.currentLanguage);
      if (!data?.recipe || typeof data.recipe !== "object") throw new Error("Tidy up did not return a recipe.");
      // Keep what the AI left out (it never removes a photo or adds a link).
      applyImportedRecipeToForm(data.recipe);
      if (!normalizeImportedText(data.recipe.category) && recipeForm.elements.category) {
        recipeForm.elements.category.value = before.category;
      }
      recipeForm.dispatchEvent(new Event("input", { bubbles: true }));
      updateIngredientsSplitHint();
      showImportQuota(data);
      showToast(t("tidy.done"), "success", 10000, {
        actionLabel: t("tidy.undo"),
        onAction: () => restoreRecipeForm(before)
      });
    } catch (error) {
      showImportQuota(error);
      const code = textOrPhotoErrorCode(error?.code, "text");
      if (code === "ai_unavailable") {
        showToast(t("tidy.unavailable"), "info", 8000);
        return;
      }
      const key = t(`import.notice.${code}.title`) !== `import.notice.${code}.title` ? code : "server_error";
      showToast(`${t(`import.notice.${key}.title`)}. ${t(`import.notice.${key}.body`, { site: "", error: "" })}`, "info", 8000);
    } finally {
      state.isImportingRecipe = false;
      updateImportButtonUi();
      setTidyUpBusy(false);
    }
  }
  tidyUpButton?.addEventListener("click", () => void runTidyUp());

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!hasSupabaseConfig) return;

    if (isSignUpMode) {
      setSignUpMode(false);
      setAuthStatus(getSignedOutPrompt());
    }

    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || !password) return;
    await signIn(email, password);
  });

  signUpButton.addEventListener("click", async () => {
    if (!hasSupabaseConfig) return;

    if (!isSignUpMode) {
      setSignUpMode(true);
      setAuthStatus(t("auth.createPrompt"));
      if (authPassword) authPassword.focus();
      return;
    }

    if (!authForm.reportValidity()) return;

    const email = authEmail.value.trim();
    const password = authPassword.value;
    const confirmPassword = authConfirmPassword ? authConfirmPassword.value : "";

    if (!email || !password) {
      setAppStatus(t("status.signUpEnterCreds"));
      return;
    }

    const passwordErrors = getPasswordErrors(password);
    if (passwordErrors.length > 0) {
      setAppStatus(t("status.passwordReq", { errors: passwordErrors.join(", ").toLowerCase() }));
      return;
    }

    if (password !== confirmPassword) {
      setAppStatus(t("status.passwordsDoNotMatch"));
      if (authConfirmPassword) authConfirmPassword.focus();
      return;
    }

    await signUp(email, password, cleanDisplayName(document.getElementById("authName")?.value));
  });

  if (authPassword) {
    authPassword.addEventListener("input", updatePasswordRequirementsUi);
  }
  if (authConfirmPassword) {
    authConfirmPassword.addEventListener("input", updatePasswordRequirementsUi);
  }

  signOutButton.addEventListener("click", async () => {
    if (!hasSupabaseConfig) return;
    await signOut();
  });

  if (importRecipeButton) {
    importRecipeButton.addEventListener("click", () => {
      void runRecipeImport();
    });
  }

  if (recipeImportUrlInput) {
    recipeImportUrlInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void runRecipeImport();
    });
  }

  // Arrow keys move between the options of a choice group, like radio buttons.
  function handleSegmentedKeys(group, attribute) {
    group.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const options = Array.from(group.querySelectorAll(`[${attribute}]`));
      const index = options.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const next = options[(index + step + options.length) % options.length];
      next.focus();
      next.click();
    });
  }

  if (themeOptions) {
    themeOptions.addEventListener("click", async (event) => {
      const option = event.target.closest("[data-theme]");
      if (!option || option.dataset.theme === state.currentTheme) return;
      setTheme(option.dataset.theme);
      if (state.currentUser) {
        await saveThemePreference(option.dataset.theme);
        updateThemeToggleUi();
      }
    });
    handleSegmentedKeys(themeOptions, "data-theme");
  }

  if (languageOptions) {
    languageOptions.addEventListener("click", async (event) => {
      const option = event.target.closest("[data-lang]");
      if (!option || option.dataset.lang === state.currentLanguage) return;
      setLanguage(option.dataset.lang);
      if (state.currentUser) {
        await saveLanguagePreference(option.dataset.lang);
        updateLanguageButtonUi();
      }
    });
    handleSegmentedKeys(languageOptions, "data-lang");
  }

  if (settingsButton && authPanel) {
    settingsButton.addEventListener("click", () => {
      if (!state.currentUser) return;
      setSettingsOpen(!state.isSettingsOpen);
    });
  }

  if (closeSettingsButton) {
    closeSettingsButton.addEventListener("click", () => {
      setSettingsOpen(false);
    });
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", () => {
      setSettingsOpen(false);
    });
  }

  window.addEventListener("resize", () => {
    if (!state.isSettingsOpen) return;
    positionSettingsPanel();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!state.isSettingsOpen) return;
      positionSettingsPanel();
    },
    true
  );

  document.addEventListener("keydown", (event) => {
    if (!state.isSettingsOpen || !state.currentUser) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setSettingsOpen(false);
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = getSettingsFocusableElements();
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Returns true once a new recipe is saved. Import calls this directly to save
  // straight away, without the user pressing Save.
  async function submitRecipeForm(options = {}) {
    const hasInlineMetaWarning = Boolean(
      (prepTimeWarning && !prepTimeWarning.classList.contains("hidden")) ||
        (cookTimeWarning && !cookTimeWarning.classList.contains("hidden")) ||
        (servesWarning && !servesWarning.classList.contains("hidden"))
    );
    if (!recipeForm.checkValidity()) {
      // The fields may be hidden behind the link box; show them so the
      // browser can point at what's missing.
      showManualRecipeFields();
      recipeForm.reportValidity();
      if (!hasInlineMetaWarning) {
        setAppStatus(t("status.fillAllRequired"));
      }
      return false;
    }

    setAppStatus(state.editingRecipeId ? t("status.updating") : t("status.saving"));
    const formData = new FormData(recipeForm);

    try {
      if (state.editingRecipeId) {
        await updateRecipe(formData);
        return true;
      }
      return Boolean(await addRecipe(formData, options));
    } catch (error) {
      setAppStatus(t("status.saveFailed", { error: error.message || "Unexpected error" }));
      return false;
    }
  }

  recipeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitRecipeForm();
  });

  recipeForm.addEventListener(
    "invalid",
    () => {
      setAppStatus(t("status.fillAllRequired"));
    },
    true
  );

  // The link box sits inside the form but isn't recipe content: typing a URL
  // there shouldn't save an empty draft that reopens the full form on refresh.
  const saveDraftUnlessImportField = (event) => {
    if (event.target === recipeImportUrlInput) return;
    saveDraftDebounced();
  };
  recipeForm.addEventListener("input", saveDraftUnlessImportField);

  // "1kg potatoes, 2 onions, 2 carrots" on one line: offer to split it, so the
  // list reads well and the servings scaler can handle each ingredient.
  const ingredientsSplitHint = document.getElementById("ingredientsSplitHint");
  const { splitIngredientsLine } = window.StorecipeIngredientParser;
  function splitIngredientsText(text) {
    return String(text || "")
      .split("\n")
      .flatMap((line) => {
        const items = splitIngredientsLine(line);
        return items.length > 1 ? items : [line];
      })
      .join("\n");
  }
  function updateIngredientsSplitHint() {
    const field = recipeForm.elements.ingredients;
    if (!ingredientsSplitHint || !field) return;
    const value = field.value || "";
    ingredientsSplitHint.classList.toggle("hidden", splitIngredientsText(value) === value);
  }
  if (recipeForm.elements.ingredients) {
    recipeForm.elements.ingredients.addEventListener("input", updateIngredientsSplitHint);
    recipeForm.elements.ingredients.addEventListener("focus", updateIngredientsSplitHint);
  }
  document.getElementById("splitIngredientsButton")?.addEventListener("click", () => {
    const field = recipeForm.elements.ingredients;
    field.value = splitIngredientsText(field.value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  });
  recipeForm.addEventListener("change", saveDraftUnlessImportField);

  if (showManualForm) {
    showManualForm.addEventListener("click", () => showManualRecipeFields({ focus: true }));
  }

  if (saveRecipeButton) {
    saveRecipeButton.addEventListener("click", () => {
      const hasInlineMetaWarning = Boolean(
        (prepTimeWarning && !prepTimeWarning.classList.contains("hidden")) ||
          (cookTimeWarning && !cookTimeWarning.classList.contains("hidden")) ||
          (servesWarning && !servesWarning.classList.contains("hidden"))
      );
      if (!recipeForm.checkValidity()) {
        if (!hasInlineMetaWarning) {
          setAppStatus(t("status.fillAllRequired"));
        }
      }
    });
  }

  // Shared by the bottom Cancel and the header Close: discard the form and return
  // to wherever the user came from (the recipe being edited, or the list).
  function closeRecipeFormView() {
    const isEditing = Boolean(state.editingRecipeId);
    const recipeId = state.editingRecipeId;
    const recipe = recipeId ? state.recipes.find((item) => item.id === recipeId) : null;

    const keptDraft = !isEditing && Boolean(collectDraftHasContent());
    resetRecipeFormState({ keepDraft: true });

    if (recipe) {
      showDetail(recipe);
    } else if (isRecipeUiAvailable()) {
      showListView();
    } else {
      setAddRecipeOpen(false);
    }

    setAppStatus(isEditing ? t("status.editCanceled") : keptDraft ? t("status.draftKept") : t("status.addCanceled"));
  }

  function collectDraftHasContent() {
    const read = (name) => recipeForm.elements[name]?.value || "";
    return draftHasContent({
      title: read("title"), description: read("description"), ingredients: read("ingredients"),
      method: read("method"), notes: read("notes"), serves: read("serves"), category: read("category"),
      imageUrl: imageUrlInput?.value || "", prepHours: prepHoursInput?.value || "", prepMinutes: prepMinutesInput?.value || "",
      cookHours: cookHoursInput?.value || "", cookMinutes: cookMinutesInput?.value || ""
    });
  }

  if (discardDraft) {
    discardDraft.addEventListener("click", () => {
      resetRecipeFormState();
      recipeImportUrlInput?.focus();
    });
  }

  // Leaving the page (closing the tab, switching apps) saves straight away rather
  // than waiting for the half-second pause after typing.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveDraft();
  });
  window.addEventListener("pagehide", () => saveDraft());

  if (closeRecipeForm) {
    closeRecipeForm.addEventListener("click", closeRecipeFormView);
  }

  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", closeRecipeFormView);
  }

  if (durationDigitInputs.length) {
    const syncTimeFields = () => {
      getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
    };

    durationDigitInputs.forEach((input) => {
      let isSanitizing = false;
      input.addEventListener("input", () => {
        if (isSanitizing) return;
        const sanitized = sanitizeDigits(input.value);
        if (input.value !== sanitized) {
          isSanitizing = true;
          input.value = sanitized;
          isSanitizing = false;
        }
        syncTimeFields();
      });
      input.addEventListener("blur", syncTimeFields);
    });
  }

  if (servesInput) {
    let isServesSanitizing = false;
    const syncServesField = () => {
      if (isServesSanitizing) return;
      const sanitized = String(servesInput.value ?? "")
        .replace(/[^\d].*$/, "")
        .slice(0, 2);
      if (servesInput.value !== sanitized) {
        isServesSanitizing = true;
        servesInput.value = sanitized;
        isServesSanitizing = false;
      }
      getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
    };

    servesInput.addEventListener("input", syncServesField);
    servesInput.addEventListener("blur", syncServesField);
  }

  if (difficultyInput) {
    difficultyInput.addEventListener("input", () => {
      syncDifficultyUi();
    });
    syncDifficultyUi();
  }

  if (chooseImageButton && imageInput) {
    chooseImageButton.addEventListener("click", () => {
      imageInput.click();
    });
  }

  if (imageInput) {
    imageInput.addEventListener("change", () => {
      const file = imageInput.files?.[0];
      if (!file) {
        state.pendingImageFile = null;
        if (state.pendingImageAction === "replace_file") {
          state.pendingImageAction = "keep";
        }
      } else {
        const validationError = validateImageFile(file, IMAGE_MAX_SIZE_BYTES, IMAGE_ALLOWED_TYPES);
        if (validationError) {
          setAppStatus(validationError);
          imageInput.value = "";
          return;
        }
        state.pendingImageFile = file;
        state.pendingImageAction = "replace_file";
        state.pendingImageUrl = "";
        if (imageUrlInput) {
          imageUrlInput.value = "";
        }
        clearEditPreviewObjectUrl();
        state.localEditPreviewObjectUrl = URL.createObjectURL(file);
      }

      const recipe = state.recipes.find((item) => item.id === state.editingRecipeId) || null;
      void refreshEditImageTools(recipe);
    });
  }

  if (imageUrlInput) {
    imageUrlInput.addEventListener("input", () => {
      const value = imageUrlInput.value.trim();
      if (!value) {
        state.pendingImageUrl = "";
        if (state.pendingImageAction === "replace_url") {
          state.pendingImageAction = "keep";
        }
      } else if (isValidHttpUrl(value)) {
        state.pendingImageAction = "replace_url";
        state.pendingImageUrl = value;
        state.pendingImageFile = null;
        if (imageInput) {
          imageInput.value = "";
        }
        clearEditPreviewObjectUrl();
      } else {
        state.pendingImageAction = "keep";
        state.pendingImageUrl = "";
        setAppStatus(t("status.invalidImageUrl"));
      }

      const recipe = state.recipes.find((item) => item.id === state.editingRecipeId) || null;
      void refreshEditImageTools(recipe);
    });
  }

  if (clearImageButton && imageInput) {
    clearImageButton.addEventListener("click", () => {
      clearEditPreviewObjectUrl();
      state.pendingImageFile = null;
      state.pendingImageUrl = "";
      imageInput.value = "";
      if (imageUrlInput) {
        imageUrlInput.value = "";
      }

      if (state.editingRecipeId) {
        state.pendingImageAction = "remove";
      } else {
        state.pendingImageAction = "keep";
      }

      const recipe = state.recipes.find((item) => item.id === state.editingRecipeId) || null;
      void refreshEditImageTools(recipe);
    });
  }

  if (undoImageButton && imageInput) {
    undoImageButton.addEventListener("click", () => {
      clearEditPreviewObjectUrl();
      state.pendingImageAction = "keep";
      state.pendingImageFile = null;
      state.pendingImageUrl = "";
      imageInput.value = "";
      if (imageUrlInput) {
        imageUrlInput.value = "";
      }

      const recipe = state.recipes.find((item) => item.id === state.editingRecipeId) || null;
      void refreshEditImageTools(recipe);
      setAppStatus(t("status.imageUndone"));
    });
  }

  searchInput.addEventListener("input", debounce(() => {
    rerenderList();
  }, 200));

  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      state.activeCategory = categoryFilter.value;
      rerenderList();
    });
  }

  if (favouritesFilter) {
    favouritesFilter.addEventListener("click", () => {
      state.showFavouritesOnly = !state.showFavouritesOnly;
      favouritesFilter.setAttribute("aria-pressed", String(state.showFavouritesOnly));
      favouritesFilter.classList.toggle("button--ghost", !state.showFavouritesOnly);
      favouritesFilter.classList.toggle("button--fav-active", state.showFavouritesOnly);
      favouritesFilter.innerHTML = (state.showFavouritesOnly ? "&#9829;" : "&#9825;") + " Favourites";
      rerenderList();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.sortBy = sortSelect.value;
      rerenderList();
    });
  }

  async function toggleFavourite(recipeId) {
    const recipe = state.recipes.find((item) => item.id === recipeId);
    if (!recipe) return;
    const newValue = !recipe.is_favourite;
    recipe.is_favourite = newValue;

    if (hasSupabaseConfig && state.currentUser) {
      try {
        await updateRecipeViaRest(recipeId, state.currentUser.id, { is_favourite: newValue });
      } catch (error) {
        recipe.is_favourite = !newValue;
        if (error?.message?.includes("column") || error?.message?.includes("is_favourite")) {
          state.hasCategoryFavColumns = false;
        }
        logSupabaseError("toggle favourite", error);
      }
    } else {
      saveLocalRecipes(state.recipes);
    }

    rerenderList();
    const openedDeleteButton = detailContent.querySelector("button[data-action='delete']");
    if (openedDeleteButton?.dataset?.id === recipeId) {
      showDetail(recipe, { scrollToDetail: false });
    }
  }

  // ── Sharing by link ────────────────────────────────────────────────────────
  // The first Share creates the link (is_public + a random token); after that
  // Share just shares it. Stop sharing removes the token, so the old link dies.
  function shareUrlFor(token) {
    return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}share.html?token=${encodeURIComponent(token)}`;
  }

  async function setRecipeShared(recipe, makePublic) {
    if (!hasSupabaseConfig || !state.currentUser) {
      showToast(t("status.sharingRequiresAuth"), "info", 5000);
      return false;
    }
    try {
      const data = await toggleRecipePublicViaRest(recipe.id, state.currentUser.id, makePublic);
      const updated = Array.isArray(data) ? data[0] : data;
      if (!updated) throw new Error("Share update returned no recipe.");
      recipe.is_public = updated.is_public;
      recipe.share_token = updated.share_token;
      return true;
    } catch (error) {
      const message = String(error?.message || "");
      if (/is_public|share_token|column/i.test(message)) {
        state.hasShareColumns = false;
        showToast(t("share.dbMissing"), "info", 8000);
      } else {
        logSupabaseError("toggle share", error);
        showToast(t("share.failed"), "info", 6000);
      }
      return false;
    }
  }

  async function copyShareLink(recipe) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(recipe.share_token));
      showToast(t("share.copied"), "success", 5000);
    } catch (_error) {
      // No clipboard access: show the link so it can be copied by hand.
      window.prompt(t("share.copyPrompt"), shareUrlFor(recipe.share_token));
    }
  }

  async function shareRecipe(recipeId) {
    const recipe = state.recipes.find((item) => String(item.id) === String(recipeId));
    if (!recipe) return;
    if (!recipe.is_public || !recipe.share_token) {
      if (!(await setRecipeShared(recipe, true))) return;
      showDetail(recipe, { scrollToDetail: false });
    }
    const url = shareUrlFor(recipe.share_token);
    const title = recipe.title || "";
    const name = state.myDisplayName;
    const text = name ? t("share.textFrom", { name, title }) : t("share.text", { title });
    // Phones: the system share sheet (WhatsApp, Messages, Copy…). Elsewhere: copy.
    const canShareSheet = typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (canShareSheet) {
      try {
        await navigator.share({ title, text, url });
      } catch (error) {
        if (error?.name !== "AbortError") await copyShareLink(recipe);
      }
    } else {
      await copyShareLink(recipe);
    }
    nudgeForDisplayName();
  }

  // ── Your name (profiles.display_name) ──────────────────────────────────────
  // Shown on recipes you share ("Shared by Dima") and in the share message.
  function cleanDisplayName(value) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  async function loadMyDisplayName() {
    if (!state.currentUser || !hasSupabaseConfig) return;
    try {
      const profile = await fetchMyProfileViaRest(state.currentUser.id);
      state.myDisplayName = cleanDisplayName(profile?.display_name);
    } catch (_error) {
      // No profiles table yet (sql/friends-migration.sql): no name to show.
      state.myDisplayName = "";
    }
    const field = document.getElementById("settingsName");
    if (field && document.activeElement !== field) field.value = state.myDisplayName || "";
  }

  async function saveMyDisplayName() {
    const field = document.getElementById("settingsName");
    if (!field || !state.currentUser) return;
    const name = cleanDisplayName(field.value);
    field.value = name;
    try {
      await updateMyDisplayNameViaRest(state.currentUser.id, state.currentUser.email, name);
      state.myDisplayName = name;
      showToast(t(name ? "settings.nameSaved" : "settings.nameCleared"), "success", 4000);
    } catch (error) {
      logSupabaseError("save display name", error);
      showToast(t("settings.nameFailed"), "info", 6000);
    }
  }

  document.getElementById("saveSettingsName")?.addEventListener("click", () => void saveMyDisplayName());
  document.getElementById("settingsName")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void saveMyDisplayName();
  });

  // Sharing without a name: suggest adding one, once per visit.
  let hasNudgedForName = false;
  function nudgeForDisplayName() {
    if (state.myDisplayName || hasNudgedForName) return;
    hasNudgedForName = true;
    window.setTimeout(() => {
      showToast(t("share.addNameNudge"), "info", 9000, {
        actionLabel: t("share.addName"),
        onAction: () => {
          setSettingsOpen(true);
          window.setTimeout(() => document.getElementById("settingsName")?.focus(), 400);
        }
      });
    }, 1200);
  }

  async function stopSharingRecipe(recipeId) {
    const recipe = state.recipes.find((item) => String(item.id) === String(recipeId));
    if (!recipe) return;
    if (await setRecipeShared(recipe, false)) {
      showToast(t("share.stopped"), "info", 6000);
      showDetail(recipe, { scrollToDetail: false });
    }
  }

  // Saves the shared recipe the visitor came from (see PENDING_SHARED_SAVE_KEY).
  let isSavingSharedRecipe = false;
  async function savePendingSharedRecipe() {
    const token = readPendingSharedSave();
    if (!token || isSavingSharedRecipe || !state.currentUser) return;
    isSavingSharedRecipe = true;
    try {
      const result = await saveSharedRecipeViaFunction(token);
      clearPendingSharedSave();
      let recipe = state.recipes.find((item) => String(item.id) === String(result?.id));
      if (!recipe) {
        await loadRecipes();
        recipe = state.recipes.find((item) => String(item.id) === String(result?.id));
      }
      const title = recipe?.title || "";
      const key = result?.status === "yours" ? "share.isYours" : result?.status === "already_saved" ? "share.alreadySaved" : "share.savedToYours";
      showToast(t(key, { title }), "success", 6000);
      if (recipe) showDetail(recipe);
    } catch (error) {
      // Signed out mid-way: keep it for the next sign-in. Anything else: drop it,
      // so it isn't retried on every load (the link still works).
      if (error?.code !== "unauthenticated") clearPendingSharedSave();
      showToast(t(error?.code === "not_found" ? "share.page.notFound" : "share.saveFailed"), "info", 8000);
    } finally {
      isSavingSharedRecipe = false;
    }
  }

  /* ─── Friends feed + save-from-friend ─── */

  async function saveFriendRecipeToMine(recipeId) {
    if (!state.currentUser) {
      setAppStatus(t("status.signInToAdd"));
      return;
    }
    // Source: prefer state.friendRecipes (when feed active), else search state.recipes.
    const source = (state.friendRecipes || []).find((r) => String(r.id) === String(recipeId))
      || (state.recipes || []).find((r) => String(r.id) === String(recipeId));
    if (!source) {
      setAppStatus(t("status.recipeNotFound"));
      return;
    }

    const payload = {
      title: source.title || "",
      description: source.description || null,
      ingredients: source.ingredients || "",
      method: source.method || "",
      notes: source.notes || null,
      image_url: source.image_url || null,
      user_id: state.currentUser.id,
      is_shared_with_friends: true
    };
    if (state.hasRecipeMetaColumns) {
      payload.prep_time = source.prep_time ?? source.prepTime ?? null;
      payload.cooking_time = source.cooking_time ?? source.cookingTime ?? null;
      payload.total_time = source.total_time ?? source.totalTime ?? null;
      payload.serves = source.serves ?? source.servings ?? null;
      payload.difficulty = source.difficulty ?? null;
    }
    if (state.hasCategoryFavColumns) {
      payload.category = source.category || null;
      payload.is_favourite = false;
    }
    // Attribution columns (set if migration ran; will fail silently if not).
    payload.copied_from_recipe_id = source.id || null;
    payload.copied_from_user_id = source.user_id || null;

    try {
      let insertedRows;
      try {
        insertedRows = await insertRecipeViaRest(payload);
      } catch (error) {
        // If the attribution columns aren't there yet, retry without them.
        const msg = String(error?.message || "").toLowerCase();
        if (msg.includes("copied_from")) {
          delete payload.copied_from_recipe_id;
          delete payload.copied_from_user_id;
          insertedRows = await insertRecipeViaRest(payload);
        } else {
          throw error;
        }
      }
      const inserted = Array.isArray(insertedRows) ? insertedRows[0] : null;
      if (inserted) {
        state.recipes.push(inserted);
      }
      // If we were in the friends feed, exit it so the user sees their newly saved recipe.
      if (state.isFriendsFeedActive) {
        state.isFriendsFeedActive = false;
        friendsManager.updateFeedToggleVisibility();
      }
      setDetailOpen(false);
      rerenderList();
      setAppStatus(t("friends.savedToMine", { title: source.title }));
    } catch (error) {
      const msg = error?.message || "Unexpected error";
      setAppStatus(t("friends.saveFailed", { error: msg }));
      logSupabaseError("save friend recipe", error);
    }
  }

  async function setFriendsFeedActive(nextActive) {
    state.isFriendsFeedActive = Boolean(nextActive);
    if (state.isFriendsFeedActive) {
      // Refresh friend recipes before rendering.
      await friendsManager.reloadFriendRecipesIfNeeded();
    }
    friendsManager.updateFeedToggleVisibility();
    // Close detail/add forms when switching modes — they belong to the other view.
    setDetailOpen(false);
    setAddRecipeOpen(false);
    rerenderList();
  }

  if (toggleFriendsFeed) {
    toggleFriendsFeed.addEventListener("click", () => {
      setFriendsFeedActive(!state.isFriendsFeedActive);
    });
  }

  /* ─── Shopping List ─── */

  function updateFloatingShoppingBadge() {
    const count = state.shoppingListRecipeIds.length;
    if (floatingShoppingList) {
      floatingShoppingList.classList.toggle("hidden", count === 0);
    }
    if (floatingShoppingCount) {
      floatingShoppingCount.textContent = String(count);
      floatingShoppingCount.classList.toggle("hidden", count === 0);
    }
  }

  function renderShoppingList() {
    const selectedRecipes = state.shoppingListRecipeIds
      .map((id) => state.recipes.find((r) => r.id === id))
      .filter(Boolean);

    updateFloatingShoppingBadge();

    if (!selectedRecipes.length) {
      shoppingListEmpty.classList.remove("hidden");
      shoppingListRecipes.classList.add("hidden");
      shoppingListItems.classList.add("hidden");
      return;
    }
    shoppingListEmpty.classList.add("hidden");
    shoppingListRecipes.classList.remove("hidden");
    shoppingListItems.classList.remove("hidden");

    shoppingListRecipes.innerHTML = selectedRecipes.map((r) =>
      `<div class="shopping-list__recipe-tag">
        <span>${escapeHtml(r.title)}</span>
        <button type="button" class="shopping-list__remove-recipe" data-id="${r.id}" aria-label="${escapeHtml(t("shopping.clear"))}">&times;</button>
      </div>`
    ).join("");

    const { parseIngredientLine } = window.StorecipeIngredientParser;
    const aggregated = new Map();

    for (const recipe of selectedRecipes) {
      const lines = String(recipe.ingredients || "").split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = parseIngredientLine(line);
        const key = `${(parsed.unit || "").toLowerCase()}|${parsed.name.toLowerCase()}`;
        if (aggregated.has(key)) {
          const existing = aggregated.get(key);
          if (parsed.quantity !== null && existing.quantity !== null) {
            existing.quantity += parsed.quantity;
          }
        } else {
          aggregated.set(key, { ...parsed });
        }
      }
    }

    const { decimalToFraction } = window.StorecipeIngredientParser;
    shoppingListItems.innerHTML = "";
    for (const [, item] of aggregated) {
      const li = document.createElement("li");
      const qtyText = item.quantity !== null && item.quantity > 0 ? decimalToFraction(item.quantity) : "";
      const unitText = item.unit ? escapeHtml(item.unit) : "";
      const nameText = escapeHtml(item.name);
      const hasMeta = Boolean(qtyText) || Boolean(unitText);
      li.className = "shopping-list__item" + (hasMeta ? "" : " shopping-list__item--no-meta");
      if (hasMeta) {
        li.innerHTML = `<label>
          <input type="checkbox" class="shopping-list__check" />
          <span class="shopping-list__qty">${escapeHtml(qtyText)}</span>
          <span class="shopping-list__unit">${unitText}</span>
          <span class="shopping-list__name">${nameText}</span>
        </label>`;
      } else {
        li.innerHTML = `<label>
          <input type="checkbox" class="shopping-list__check" />
          <span class="shopping-list__name">${nameText}</span>
        </label>`;
      }
      shoppingListItems.appendChild(li);
    }
  }

  function openShoppingListModal() {
    renderShoppingList();
    shoppingListModal.classList.remove("hidden");
    shoppingListModal.setAttribute("aria-hidden", "false");
  }

  function openImageFullView(imageUrl, altText) {
    if (!imageUrl) return;
    const overlay = document.createElement("div");
    overlay.className = "image-fullview-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image full view");
    overlay.innerHTML = `
      <button type="button" class="image-fullview-overlay__close" aria-label="Close">&times;</button>
      <img class="image-fullview-overlay__img" src="${imageUrl.replace(/"/g, "&quot;")}" alt="${(altText || "").replace(/"/g, "&quot;")}" />
    `;
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest(".image-fullview-overlay__close")) {
        close();
      }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  function closeShoppingListModal() {
    shoppingListModal.classList.add("hidden");
    shoppingListModal.setAttribute("aria-hidden", "true");
  }

  function addToShoppingList(recipeId) {
    if (!state.shoppingListRecipeIds.includes(recipeId)) {
      state.shoppingListRecipeIds.push(recipeId);
    }
    openShoppingListModal();
    setAppStatus(t("status.recipeAddedToShopping"));
  }

  if (openShoppingList) {
    openShoppingList.addEventListener("click", openShoppingListModal);
  }
  if (floatingShoppingList) {
    floatingShoppingList.addEventListener("click", openShoppingListModal);
  }
  if (closeShoppingList) {
    closeShoppingList.addEventListener("click", closeShoppingListModal);
  }
  if (shoppingListModal) {
    shoppingListModal.addEventListener("click", (e) => {
      if (e.target === shoppingListModal) closeShoppingListModal();
    });
  }
  if (clearShoppingList) {
    clearShoppingList.addEventListener("click", () => {
      state.shoppingListRecipeIds = [];
      renderShoppingList();
    });
  }
  if (copyShoppingList) {
    copyShoppingList.addEventListener("click", async () => {
      const items = shoppingListItems.querySelectorAll(".shopping-list__item");
      const lines = Array.from(items).map((li) => {
        const qty = li.querySelector(".shopping-list__qty")?.textContent?.trim() || "";
        const unit = li.querySelector(".shopping-list__unit")?.textContent?.trim() || "";
        const name = li.querySelector(".shopping-list__name")?.textContent?.trim() || "";
        const parts = [qty, unit, name].filter(Boolean).join(" ");
        return `- ${parts}`;
      });
      if (!lines.length) return;
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        setAppStatus(t("status.copiedClipboard"));
      } catch (_) {
        setAppStatus(t("status.copyFailed"));
      }
    });
  }
  if (shoppingListRecipes) {
    shoppingListRecipes.addEventListener("click", (e) => {
      const btn = e.target.closest(".shopping-list__remove-recipe");
      if (!btn) return;
      const id = btn.dataset.id;
      state.shoppingListRecipeIds = state.shoppingListRecipeIds.filter((rid) => rid !== id);
      renderShoppingList();
    });
  }

  /* ─── Meal Planner ─── */
  const MEAL_PLAN_KEY_PREFIX = "storecipe_meal_plan";
  function getMealPlanKey() {
    const uid = state.currentUser?.id || "local";
    return `${MEAL_PLAN_KEY_PREFIX}_${uid}`;
  }
  const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  let mealPlannerWeekOffset = 0;

  function getMondayOfWeek(offset) {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + offset * 7);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function getWeekKey(offset) {
    const mon = getMondayOfWeek(offset);
    return `${mon.getFullYear()}-W${String(Math.ceil(((mon - new Date(mon.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
  }

  function loadMealPlan() {
    try {
      return JSON.parse(localStorage.getItem(getMealPlanKey()) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveMealPlan(plan) {
    localStorage.setItem(getMealPlanKey(), JSON.stringify(plan));
  }

  function renderMealPlanner() {
    const monday = getMondayOfWeek(mealPlannerWeekOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekLocale = (state.currentLanguage === "ru") ? "ru-RU" : "en-GB";
    const fmt = (d) => d.toLocaleDateString(weekLocale, { day: "numeric", month: "short" });
    if (mealPlannerWeekLabel) {
      mealPlannerWeekLabel.textContent = `${fmt(monday)} – ${fmt(sunday)}`;
    }

    const weekKey = getWeekKey(mealPlannerWeekOffset);
    const plan = loadMealPlan();
    const weekPlan = plan[weekKey] || {};

    if (mealPlannerGrid) {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
      const recipeOptions = state.recipes
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.title || t("planner.untitled"))}</option>`)
        .join("");
      mealPlannerGrid.innerHTML = DAY_KEYS.map((dayKeySuffix, i) => {
        const dayName = t(`planner.day.${dayKeySuffix}`);
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        const dayKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
        const isToday = dayKey === todayKey;
        const localeForDate = (state.currentLanguage === "ru") ? "ru-RU" : "en-GB";
        const dateStr = dayDate.toLocaleDateString(localeForDate, { day: "numeric", month: "short" });
        const meals = weekPlan[i] || [];
        const mealsHtml = meals.map((recipeId, mealIdx) => {
          const recipe = state.recipes.find((r) => r.id === recipeId);
          const title = recipe ? escapeHtml(recipe.title) : escapeHtml(t("planner.unknownRecipe"));
          return `<div class="meal-planner__meal">
            <span class="meal-planner__meal-title">${title}</span>
            <button type="button" class="meal-planner__remove-meal" data-day="${i}" data-meal-idx="${mealIdx}" aria-label="${escapeHtml(t("planner.removeMeal"))}">&times;</button>
          </div>`;
        }).join("");
        const dayClasses = `meal-planner__day${isToday ? " meal-planner__day--today" : ""}`;
        const todayBadge = isToday ? `<span class="meal-planner__today-badge">${escapeHtml(t("planner.today"))}</span>` : "";
        const pickerHtml = state.recipes.length
          ? `<div class="meal-planner__picker hidden" data-picker-day="${i}">
              <select class="meal-planner__picker-select" aria-label="${escapeHtml(t("planner.chooseRecipeAria"))}">
                <option value="">${escapeHtml(t("planner.pickRecipe"))}</option>
                ${recipeOptions}
              </select>
              <div class="meal-planner__picker-actions">
                <button type="button" class="button button--secondary meal-planner__picker-confirm" data-day="${i}">${escapeHtml(t("planner.add"))}</button>
                <button type="button" class="button button--ghost meal-planner__picker-cancel" data-day="${i}">${escapeHtml(t("planner.cancel"))}</button>
              </div>
            </div>`
          : `<div class="meal-planner__picker hidden" data-picker-day="${i}">
              <p class="meal-planner__picker-empty">${escapeHtml(t("planner.noRecipes"))}</p>
              <div class="meal-planner__picker-actions">
                <button type="button" class="button button--ghost meal-planner__picker-cancel" data-day="${i}">${escapeHtml(t("planner.close"))}</button>
              </div>
            </div>`;
        return `<div class="${dayClasses}" data-day="${i}">
          <button type="button" class="meal-planner__day-header" data-action="toggle-picker" data-day="${i}">
            <strong>${escapeHtml(dayName)}${todayBadge}</strong> <small>${escapeHtml(dateStr)}</small>
            <span class="meal-planner__add-icon" aria-hidden="true">+</span>
          </button>
          <div class="meal-planner__day-meals" data-day="${i}">
            ${mealsHtml || `<span class="meal-planner__empty">${escapeHtml(t("planner.noMeals"))}</span>`}
          </div>
          ${pickerHtml}
        </div>`;
      }).join("");
    }
  }

  function openMealPlannerModal() {
    renderMealPlanner();
    mealPlannerModal.classList.remove("hidden");
    mealPlannerModal.setAttribute("aria-hidden", "false");
  }

  function closeMealPlannerModal() {
    mealPlannerModal.classList.add("hidden");
    mealPlannerModal.setAttribute("aria-hidden", "true");
  }

  if (openMealPlanner) {
    openMealPlanner.addEventListener("click", openMealPlannerModal);
  }
  if (closeMealPlanner) {
    closeMealPlanner.addEventListener("click", closeMealPlannerModal);
  }
  if (mealPlannerModal) {
    mealPlannerModal.addEventListener("click", (e) => {
      if (e.target === mealPlannerModal) closeMealPlannerModal();
    });
  }
  if (mealPlannerPrevWeek) {
    mealPlannerPrevWeek.addEventListener("click", () => {
      mealPlannerWeekOffset--;
      renderMealPlanner();
    });
  }
  if (mealPlannerNextWeek) {
    mealPlannerNextWeek.addEventListener("click", () => {
      mealPlannerWeekOffset++;
      renderMealPlanner();
    });
  }
  if (clearMealPlanner) {
    clearMealPlanner.addEventListener("click", () => {
      const weekKey = getWeekKey(mealPlannerWeekOffset);
      const plan = loadMealPlan();
      delete plan[weekKey];
      saveMealPlan(plan);
      renderMealPlanner();
    });
  }
  if (mealPlannerGrid) {
    mealPlannerGrid.addEventListener("click", (e) => {
      const removeBtn = e.target.closest(".meal-planner__remove-meal");
      if (removeBtn) {
        e.stopPropagation();
        const dayIdx = removeBtn.dataset.day;
        const mealIdx = Number(removeBtn.dataset.mealIdx);
        const weekKey = getWeekKey(mealPlannerWeekOffset);
        const plan = loadMealPlan();
        if (plan[weekKey]?.[dayIdx]) {
          plan[weekKey][dayIdx].splice(mealIdx, 1);
          if (!plan[weekKey][dayIdx].length) delete plan[weekKey][dayIdx];
          saveMealPlan(plan);
          renderMealPlanner();
        }
        return;
      }

      const cancelBtn = e.target.closest(".meal-planner__picker-cancel");
      if (cancelBtn) {
        const dayIdx = cancelBtn.dataset.day;
        const picker = mealPlannerGrid.querySelector(`.meal-planner__picker[data-picker-day="${dayIdx}"]`);
        const dayCard = mealPlannerGrid.querySelector(`.meal-planner__day[data-day="${dayIdx}"]`);
        picker?.classList.add("hidden");
        dayCard?.classList.remove("meal-planner__day--picking");
        return;
      }

      const confirmBtn = e.target.closest(".meal-planner__picker-confirm");
      if (confirmBtn) {
        const dayIdx = confirmBtn.dataset.day;
        const picker = mealPlannerGrid.querySelector(`.meal-planner__picker[data-picker-day="${dayIdx}"]`);
        const select = picker?.querySelector(".meal-planner__picker-select");
        const recipeId = select?.value;
        if (!recipeId) {
          setAppStatus(t("status.pickRecipeFirst"));
          return;
        }
        const weekKey = getWeekKey(mealPlannerWeekOffset);
        const plan = loadMealPlan();
        if (!plan[weekKey]) plan[weekKey] = {};
        if (!plan[weekKey][dayIdx]) plan[weekKey][dayIdx] = [];
        plan[weekKey][dayIdx].push(recipeId);
        saveMealPlan(plan);
        renderMealPlanner();
        return;
      }

      const headerBtn = e.target.closest("[data-action='toggle-picker']");
      if (headerBtn) {
        const dayIdx = headerBtn.dataset.day;
        const picker = mealPlannerGrid.querySelector(`.meal-planner__picker[data-picker-day="${dayIdx}"]`);
        const dayCard = mealPlannerGrid.querySelector(`.meal-planner__day[data-day="${dayIdx}"]`);
        if (!picker) return;
        const isHidden = picker.classList.contains("hidden");
        // close all other pickers first
        mealPlannerGrid.querySelectorAll(".meal-planner__picker").forEach((p) => p.classList.add("hidden"));
        mealPlannerGrid.querySelectorAll(".meal-planner__day--picking").forEach((d) => d.classList.remove("meal-planner__day--picking"));
        if (isHidden) {
          picker.classList.remove("hidden");
          dayCard?.classList.add("meal-planner__day--picking");
          picker.querySelector("select")?.focus();
        }
      }
    });
  }

  toggleAddRecipe.addEventListener("click", () => {
    const shouldShow = addRecipeSection.classList.contains("hidden");
    if (shouldShow && !state.editingRecipeId) {
      resetRecipeFormState({ keepDraft: true });
      const draft = loadDraft(DRAFT_LOCAL_KEY);
      if (draft) {
        restoreDraft(draft);
        void refreshImportQuota();
        return;
      }
    }
    setAddRecipeOpen(shouldShow);
    if (shouldShow && !state.editingRecipeId) {
      void refreshImportQuota();
    }
  });

  recipeList.addEventListener("click", (event) => {
    if (event.target.closest("[data-action='add-first']")) {
      toggleAddRecipe.click();
      return;
    }

    const favTrigger = event.target.closest("[data-action='toggle-fav']");
    if (favTrigger) {
      const recipeId = favTrigger.dataset.id;
      if (recipeId) toggleFavourite(recipeId);
      return;
    }

    const trigger = event.target.closest("[data-action='view']");
    if (!trigger) return;

    const recipeId = trigger.dataset.id || trigger.closest("article.recipe-card")?.dataset.id;
    if (!recipeId) return;

    const pool = state.isFriendsFeedActive ? (state.friendRecipes || []) : state.recipes;
    const recipe = pool.find((item) => String(item.id) === String(recipeId));
    if (recipe) showDetail(recipe);
  });

  // Cards are role="button" tabindex="0" — mirror click for keyboard users.
  recipeList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("article.recipe-card");
    if (!card || event.target !== card) return;
    event.preventDefault();
    card.click();
  });

  const inlineEditManager = createInlineEditManager({
    dom: { detailContent, searchInput },
    state,
    config: { DEFAULT_DIFFICULTY, hasSupabaseConfig },
    helpers: {
      parseDurationText, formatDuration, sanitizeDigits, parseTimePair,
      normalizeOptionalText, getDirectImageUrl, normalizeDifficulty: normalizeDifficultyCore
    },
    supabaseServices: { updateRecipeViaRest },
    callbacks: {
      setAppStatus,
      logSupabaseError,
      showDetail,
      renderList: rerenderList,
      saveLocalRecipes,
      isMissingRecipeMetaColumns
    },
    i18n
  });
  inlineEditManager.attachListeners();

  detailContent.addEventListener("click", async (event) => {
    if (event.target.closest("[data-action='print']")) {
      window.print();
      return;
    }
    const scaleBtn = event.target.closest("[data-action='scale-down'], [data-action='scale-up'], [data-action='scale-reset']");
    if (scaleBtn) {
      const scaler = scaleBtn.closest(".serving-scaler");
      if (!scaler) return;
      const origServes = Number.parseInt(scaler.dataset.originalServes, 10) || 1;
      const origIngredients = scaler.dataset.originalIngredients || "";
      const display = scaler.querySelector("[data-scale-display]");
      if (!display) return;
      let current = Number(display.textContent) || origServes;
      const action = scaleBtn.dataset.action;
      if (action === "scale-down" && current > 1) current -= 1;
      else if (action === "scale-up" && current < 99) current += 1;
      else if (action === "scale-reset") current = origServes;
      display.textContent = String(current);
      const changed = current !== origServes;
      scaler.querySelector("[data-action='scale-reset']")?.classList.toggle("hidden", !changed);

      const card = scaler.closest(".recipe-detail-card") || detailContent;
      const contentEl = card.querySelector("[data-field-content='ingredients']") ||
        scaler.closest("[data-field='ingredients']")?.querySelector(".recipe-detail-card__editable");
      const lines = scaleIngredientList(origIngredients, origServes, current);
      const unadjusted = lines.map((line) => changed && line.status === "unadjusted");
      if (contentEl) {
        // Must match the detail renderer's structure, or scaling would replace
        // the ingredient list with flat text.
        contentEl.innerHTML = renderIngredientListHtml(lines.map((line) => line.text).join("\n"), unadjusted);
      }
      const ingredientsNote = card.querySelector("[data-scale-note='ingredients']");
      if (ingredientsNote) {
        ingredientsNote.textContent = t("detail.scaleUnadjusted");
        ingredientsNote.classList.toggle("hidden", !unadjusted.some(Boolean));
      }
      const methodNote = card.querySelector("[data-scale-note='method']");
      if (methodNote) {
        methodNote.textContent = t("detail.scaleMethodNote", { serves: origServes });
        methodNote.classList.toggle("hidden", !changed);
      }
      return;
    }

    const favTrigger = event.target.closest("button[data-action='toggle-fav']");
    if (favTrigger) {
      const recipeId = favTrigger.dataset.id;
      if (recipeId) toggleFavourite(recipeId);
      return;
    }

    const editButton = event.target.closest("button[data-action='edit']");
    if (editButton) {
      const recipe = state.recipes.find((item) => item.id === editButton.dataset.id);
      if (recipe) {
        startEditRecipe(recipe);
      }
      return;
    }

    const dupButton = event.target.closest("button[data-action='duplicate']");
    if (dupButton) {
      const recipe = state.recipes.find((item) => item.id === dupButton.dataset.id);
      if (recipe) {
        resetRecipeFormState();
        recipeForm.elements.title.value = `Copy of ${recipe.title || ""}`;
        if (recipeForm.elements.category) recipeForm.elements.category.value = recipe.category || "";
        recipeForm.elements.ingredients.value = recipe.ingredients || "";
        recipeForm.elements.method.value = recipe.method || "";
        if (recipeForm.elements.notes) recipeForm.elements.notes.value = recipe.notes || "";
        const prepParsed = parseDurationText(recipe.prep_time ?? "");
        const cookParsed = parseDurationText(recipe.cooking_time ?? "");
        if (prepHoursInput) prepHoursInput.value = prepParsed.hours;
        if (prepMinutesInput) prepMinutesInput.value = prepParsed.minutes;
        if (cookHoursInput) cookHoursInput.value = cookParsed.hours;
        if (cookMinutesInput) cookMinutesInput.value = cookParsed.minutes;
        if (recipeForm.elements.serves) recipeForm.elements.serves.value = recipe.serves ?? "";
        if (difficultyInput) {
          difficultyInput.value = String(normalizeDifficulty(recipe.difficulty));
          syncDifficultyUi();
        }
        if (recipe.image_url && isValidHttpUrl(recipe.image_url)) {
          state.pendingImageAction = "replace_url";
          state.pendingImageUrl = recipe.image_url;
        }
        getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
        setAddRecipeOpen(true);
        setAppStatus(t("status.recipeDuplicated"));
      }
      return;
    }

    const fullViewBtn = event.target.closest("button[data-action='open-image-fullview']");
    if (fullViewBtn) {
      openImageFullView(fullViewBtn.dataset.imageUrl, fullViewBtn.dataset.imageAlt || "");
      return;
    }

    const shareButton = event.target.closest("button[data-action='share']");
    if (shareButton) {
      if (shareButton.dataset.id) await shareRecipe(shareButton.dataset.id);
      return;
    }
    const copyLinkButton = event.target.closest("button[data-action='copy-share-link']");
    if (copyLinkButton) {
      const recipe = state.recipes.find((item) => String(item.id) === String(copyLinkButton.dataset.id));
      if (recipe?.share_token) await copyShareLink(recipe);
      return;
    }
    const stopSharingButton = event.target.closest("button[data-action='stop-sharing']");
    if (stopSharingButton) {
      if (stopSharingButton.dataset.id) await stopSharingRecipe(stopSharingButton.dataset.id);
      return;
    }

    const shoppingButton = event.target.closest("button[data-action='add-to-shopping']");
    if (shoppingButton) {
      const recipeId = shoppingButton.dataset.id;
      if (recipeId) addToShoppingList(recipeId);
      return;
    }

    const saveFromFriendButton = event.target.closest("button[data-action='save-from-friend']");
    if (saveFromFriendButton) {
      const recipeId = saveFromFriendButton.dataset.id;
      if (recipeId) await saveFriendRecipeToMine(recipeId);
      return;
    }

    const button = event.target.closest("button[data-action='delete']");
    if (!button) return;

    await deleteRecipe(button.dataset.id);
  });

  closeDetail.addEventListener("click", () => {
    returnToList();
    clearRecipeUrl();
  });

  // Tapping anywhere outside an open recipe closes it, like Back. Only counts when
  // the press also started outside (so the tap that opened the recipe, or a text
  // selection dragged out of it, doesn't close it), and not on the logo or
  // header buttons, settings, overlays or toasts, or while a section is being
  // edited. Empty header space does count.
  const OUTSIDE_CLOSE_EXCLUDED =
    ".app__header a, .app__header button, #authPanel, #settingsBackdrop, .modal-overlay, .image-fullview-overlay, .toast-container";
  const isOutsideOpenRecipe = (target) =>
    !recipeDetail.classList.contains("hidden") &&
    target instanceof Element &&
    target.isConnected &&
    !recipeDetail.contains(target) &&
    !target.closest(OUTSIDE_CLOSE_EXCLUDED) &&
    !state.isSettingsOpen &&
    !detailContent.querySelector(".recipe-inline-editor");
  let pressStartedOutsideRecipe = false;
  document.addEventListener("pointerdown", (event) => {
    pressStartedOutsideRecipe = isOutsideOpenRecipe(event.target);
  });
  document.addEventListener("click", (event) => {
    const shouldClose = pressStartedOutsideRecipe && isOutsideOpenRecipe(event.target);
    pressStartedOutsideRecipe = false;
    if (!shouldClose) return;
    returnToList();
    clearRecipeUrl();
  });

  if (downloadBackup) {
    downloadBackup.addEventListener("click", () => {
      const recipes = (state.recipes || []).map((recipe) => {
        const copy = { ...recipe };
        Object.keys(copy).forEach((key) => {
          if (key.startsWith("_")) delete copy[key];
        });
        return copy;
      });
      const backup = { app: "Storecipe", exportedAt: new Date().toISOString(), count: recipes.length, recipes };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `storecipe-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      showToast(t("backup.done", { count: recipes.length }), "success", 4000);
    });
  }

  if (homeLink) {
    homeLink.addEventListener("click", (event) => {
      // Plain clicks stay in the app; Ctrl/Cmd-click still opens a new tab.
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      goHome();
    });
  }

  window.addEventListener("popstate", (event) => {
    const targetId = event.state?.recipeId
      || new URLSearchParams(window.location.search).get("recipe")
      || null;
    suppressUrlUpdate = true;
    try {
      if (targetId) {
        const recipe = state.recipes.find((item) => String(item.id) === String(targetId));
        if (recipe) {
          showDetail(recipe, { scrollToDetail: false });
        } else {
          setDetailOpen(false);
        }
      } else {
        returnToList();
      }
    } finally {
      suppressUrlUpdate = false;
    }
  });

  async function applyAuthSession(event, session) {
    const authEvent = event || "SESSION_SYNC";
    const previousUserId = state.currentUser?.id || null;
    const nextUser = session?.user ?? null;
    const nextUserId = nextUser?.id || null;
    const justSignedIn = !previousUserId && Boolean(nextUserId);
    const justSignedOut = Boolean(previousUserId) && !nextUserId;
    const switchedUser = Boolean(previousUserId && nextUserId && previousUserId !== nextUserId);
    const identityChanged = justSignedIn || justSignedOut || switchedUser;
    const isNonDisruptiveEvent = !identityChanged && (authEvent === "TOKEN_REFRESHED" || authEvent === "SIGNED_IN");

    state.currentSession = session ?? null;
    state.currentUser = nextUser;

    if (isNonDisruptiveEvent) {
      return;
    }

    if (!state.currentUser) {
      void ensureCaptcha();
      if (justSignedOut || switchedUser || authEvent === "SIGNED_OUT") {
        if (previousUserId) {
          try { window.localStorage.removeItem(OFFLINE_RECIPES_PREFIX + previousUserId); } catch (_error) { /* ignore */ }
        }
        if ("caches" in window) void caches.delete("storecipe-photos-v1").catch(() => {});
        state.isSettingsOpen = false;
        resetRecipeFormState();
        setTheme(DEFAULT_THEME, { persistForCurrentUser: false });
        setLanguage(DEFAULT_LANGUAGE, { persistForCurrentUser: false });
        mealPlannerWeekOffset = 0;
        state.shoppingListRecipeIds = [];
        friendsManager.resetForSignOut();
      }
    } else if (justSignedIn || switchedUser || authEvent === "USER_UPDATED" || authEvent === "INITIAL_SESSION") {
      await loadThemePreference();
      await loadLanguagePreference();
      // Friends: profile + friendships load in background; failures degrade gracefully.
      friendsManager.loadMyProfile().then(() => {
        friendsManager.updateHeaderButtonVisibility();
      });
      friendsManager.loadFriends({ refreshUi: true });
    }

    setAuthUi();
    if (identityChanged || authEvent === "SIGNED_OUT" || authEvent === "INITIAL_SESSION" || authEvent === "SESSION_SYNC") {
      setRecipeUiEnabled(Boolean(state.currentUser));
    }
    // Shell now reflects the real auth state — safe to reveal the app. Recipes
    // may still be loading below; the list skeleton covers that.
    markAuthUiReady();

    if (switchedUser) {
      showListView();
      recipeDetail.classList.add("hidden");
      detailContent.innerHTML = "";
      clearRecipeUrl();
    } else if (justSignedIn) {
      showListView();
      recipeDetail.classList.add("hidden");
      detailContent.innerHTML = "";
    }

    if (
      identityChanged ||
      authEvent === "SIGNED_OUT" ||
      authEvent === "USER_UPDATED" ||
      authEvent === "INITIAL_SESSION" ||
      authEvent === "SESSION_SYNC"
    ) {
      await loadRecipes();

      const draft = loadDraft(EDIT_DRAFT_LOCAL_KEY) || loadDraft(DRAFT_LOCAL_KEY);
      if (draft && draft.formOpen !== false && state.currentUser) {
        restoreDraft(draft);
      }

      const requestedRecipeId = new URLSearchParams(window.location.search).get("recipe");
      if (requestedRecipeId && state.currentUser) {
        const recipe = state.recipes.find((item) => String(item.id) === String(requestedRecipeId));
        if (recipe) {
          suppressUrlUpdate = true;
          try {
            showDetail(recipe, { scrollToDetail: false });
          } finally {
            suppressUrlUpdate = false;
          }
        }
      }
    }
  }

  async function init() {
    setStartupLoading(true);
    try {
      setRecipeFormMode(null);
      if (durationDigitInputs.length) {
        getRecipeMetaFromFormData(new FormData(recipeForm), { showStatus: false });
      }
      await loadThemePreference();
      await loadLanguagePreference();
      updateImportButtonUi();

      if (!hasSupabaseConfig) {
        setAuthUi();
        setRecipeUiEnabled(false);
        return;
      }

      client.auth.onAuthStateChange(async (event, session) => {
        if (event === "INITIAL_SESSION") {
          if (state.hasCompletedInitialAuthBootstrap) {
            return;
          }
          state.hasCompletedInitialAuthBootstrap = true;
        } else if (!state.hasCompletedInitialAuthBootstrap && (event === "SIGNED_IN" || event === "SIGNED_OUT")) {
          state.hasCompletedInitialAuthBootstrap = true;
        }

        try {
          await applyAuthSession(event, session);
        } catch (_error) {
          return;
        } finally {
          // Safety net: never strand the user on the spinner if the pass above
          // bailed before reaching applyAuthSession's own signal.
          markAuthUiReady();
        }
      });

      const { data, error } = await client.auth.getSession();
      void error;
      if (!state.hasCompletedInitialAuthBootstrap) {
        state.hasCompletedInitialAuthBootstrap = true;
        await applyAuthSession("SESSION_SYNC", data?.session ?? null);
      } else {
        // onAuthStateChange claimed the initial pass. Its handler runs detached
        // from this function, so wait for it rather than revealing the shell
        // mid-flight.
        await waitForAuthUiReady();
      }
      setToggleAddRecipeState(!addRecipeSection.classList.contains("hidden"));
    } finally {
      setStartupLoading(false);
    }
  }

  function isFormDirty() {
    if (addRecipeSection.classList.contains("hidden")) return false;
    const title = recipeForm.elements.title?.value?.trim() || "";
    const ingredients = recipeForm.elements.ingredients?.value?.trim() || "";
    const method = recipeForm.elements.method?.value?.trim() || "";
    return Boolean(title || ingredients || method);
  }

  window.addEventListener("beforeunload", (event) => {
    if (isFormDirty()) {
      event.preventDefault();
    }
  });

  init();
})();
