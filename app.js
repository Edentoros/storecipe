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
    RECIPE_IMPORT_PROMPT_LOCAL_KEY_PREFIX,
    RECIPE_IMPORT_PROMPT_DEFAULT_KEY,
    DEFAULT_RECIPE_IMPORT_PROMPT,
    RECIPE_CATEGORIES
  } = window.StorecipeConstants;
  const { getDomRefs } = window.StorecipeDomRefs;
  const {
    formatDate,
    escapeHtml,
    normalizeDifficulty: normalizeDifficultyCore,
    getDifficultyLabel,
    normalizeTheme,
    normalizeLanguage,
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
    debounce
  } = window.StorecipeHelpers;
  const { scaleIngredients } = window.StorecipeIngredientParser;
  const { createImportPromptManager } = window.StorecipeImportPromptManager;
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
    themeToggleButton,
    sunsetInfoButton,
    sunsetInfoText,
    languageSelector,
    languageToggleButton,
    languageMenu,
    signedInEmail,
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
    listPanel,
    addRecipeSection,
    recipeFormHeading,
    toggleAddRecipe,
    saveRecipeButton,
    cancelEditButton,
    imageInput,
    imageUrlInput,
    recipeImportUrlInput,
    importRecipeButton,
    recipeImportPromptInput,
    resetImportPromptButton,
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
    recipeListHeading,
    shareWithFriendsRow,
    shareWithFriendsInput,
    addButtonWideQuery
  } = getDomRefs();

  const state = createAppState({ DEFAULT_THEME, DEFAULT_LANGUAGE });
  const i18n = createI18n({ defaultLocale: DEFAULT_LANGUAGE });
  const t = (key, params) => i18n.t(key, params);
  // Apply initial DOM translations as soon as the DOM is parsed (defer scripts run after).
  i18n.applyToDom(document);

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
  const getSignedOutPrompt = () => t("auth.signInPrompt");
  const SIGNED_OUT_PROMPT = getSignedOutPrompt();
  const DRAFT_LOCAL_KEY = "storecipe_recipe_draft";
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
      getDirectImageUrl
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

  const importPromptManager = createImportPromptManager({
    inputElement: recipeImportPromptInput,
    defaultPrompt: DEFAULT_RECIPE_IMPORT_PROMPT,
    localKeyPrefix: RECIPE_IMPORT_PROMPT_LOCAL_KEY_PREFIX,
    defaultKey: RECIPE_IMPORT_PROMPT_DEFAULT_KEY,
    getCurrentUserId: () => state.currentUser?.id || null
  });
  const normalizeImportPrompt = importPromptManager.normalizeImportPrompt;
  const setImportPromptUi = importPromptManager.setImportPromptUi;
  const persistImportPrompt = importPromptManager.persistImportPrompt;
  const loadImportPrompt = importPromptManager.loadImportPrompt;

  function updateImportButtonUi() {
    if (!importRecipeButton) return;
    importRecipeButton.disabled = state.isImportingRecipe;
    importRecipeButton.textContent = state.isImportingRecipe ? t("form.importing") : t("form.importButton");
  }

  function applyImportedRecipeToForm(recipe) {
    if (!recipe || !recipeForm) return;

    const title = normalizeImportedText(recipe.title);
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
    if (ingredients) {
      recipeForm.elements.ingredients.value = ingredients;
    }
    if (method) {
      recipeForm.elements.method.value = method;
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
      signInButton, signUpButton, signOutButton, themeToggleButton, languageSelector, signedInEmail,
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
  const logSupabaseError = authUiManager.logSupabaseError;
  const setAuthUi = authUiManager.setAuthUi;

  const themeManager = createThemeManager({
    dom: { themeToggleButton, sunsetInfoButton, sunsetInfoText },
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
    dom: { languageSelector, languageToggleButton, languageMenu },
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
  const setLanguageMenuOpen = languageManager.setLanguageMenuOpen;
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
    if (shareWithFriendsInput) {
      shareWithFriendsInput.checked = Boolean(recipe.is_shared_with_friends);
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

  function resetRecipeFormState() {
    recipeForm.reset();
    syncDifficultyUi();
    recipeMetaManager.resetValidationUi();
    if (shareWithFriendsInput) shareWithFriendsInput.checked = false;
    setRecipeFormMode(null);
    hideEditImageTools();
    clearDraft();
  }

  function saveDraft() {
    if (addRecipeSection.classList.contains("hidden")) return;
    try {
      const draft = {
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
      window.localStorage.setItem(DRAFT_LOCAL_KEY, JSON.stringify(draft));
    } catch (_) { /* localStorage full or unavailable */ }
  }

  const saveDraftDebounced = debounce(saveDraft, 500);

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_LOCAL_KEY); } catch (_) {}
  }

  function loadDraft() {
    try {
      const raw = window.localStorage.getItem(DRAFT_LOCAL_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return null;
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      if (draft.savedAt && Date.now() - draft.savedAt > maxAge) {
        clearDraft();
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
        clearDraft();
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
    setAddRecipeOpen(true);
    setAppStatus(t("status.draftRestored"));
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
    dom: { authPanel, settingsBackdrop, settingsButton, themeToggleButton, signOutButton, authEmail },
    state
  });
  const getSettingsFocusableElements = settingsManager.getSettingsFocusableElements;
  const positionSettingsPanel = settingsManager.positionSettingsPanel;
  const setSettingsOpen = settingsManager.setSettingsOpen;

  const viewManager = createViewManager({
    dom: {
      searchPanel, listPanel, addRecipeSection, recipeDetail, detailContent,
      searchInput, toggleAddRecipe, recipeForm, addButtonWideQuery
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
      friendsList, friendsEmpty, toggleFriendsFeed, recipeListHeading,
      shareWithFriendsRow, shareWithFriendsInput
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
      scaleIngredients
    },
    getSignedImageUrl,
    setDetailOpen,
    logSupabaseError,
    i18n
  });
  const renderList = recipeRenderer.renderList;
  const rawShowDetail = recipeRenderer.showDetail;
  const hydrateImagesInBackground = recipeRenderer.hydrateImagesInBackground;

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
    rawShowDetail(recipe, options);
    if (recipe && recipe.id) pushRecipeUrl(recipe.id);
  }

  function updateFilterVisibility() {
    const recipes = Array.isArray(state.recipes) ? state.recipes : [];
    const showFilters = recipes.length > 2;
    const uniqueCategories = new Set(recipes.map((r) => r.category).filter(Boolean));
    const showCategoryFilter = showFilters && uniqueCategories.size > 1;

    if (sortSelect) sortSelect.closest(".search-filters")?.classList.toggle("hidden", !showFilters);
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
        if (isMissingUserIdColumn(error)) {
          setAppStatus(t("status.dbMissingUserId"));
        } else {
          setAppStatus(t("status.loadFailed", { error: error.message }));
        }
        return;
      }

      state.recipes = recipeRenderer.normalizeLoadedRecipes(data, DEFAULT_DIFFICULTY);
      rerenderList();

      void hydrateImagesInBackground(state.recipes);
      if (!state.recipes.length) {
        setAppStatus(t("status.noRecipesForAccount"));
      }
    } finally {
      endRecipeListLoad();
    }
  }

  async function addRecipe(formData) {
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
      if (!imageUrlValue && image instanceof File && image.size > 0) {
        localRecipe.image_url = await readFileAsDataUrl(image);
      }
      state.recipes = [localRecipe, ...state.recipes];
      saveLocalRecipes(state.recipes);
      resetRecipeFormState();
      rerenderList();
      showDetail(localRecipe);
      return;
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
        setAppStatus(t("status.imageFetchFailed", { error: error.message || "Unexpected error" }));
        return;
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
    if (state.isFriendsAvailable && shareWithFriendsInput) {
      basePayload.is_shared_with_friends = Boolean(shareWithFriendsInput.checked);
    }
    const catFavFields = state.hasCategoryFavColumns ? { category, is_favourite: false } : {};
    const payload = state.hasRecipeMetaColumns ? { ...basePayload, ...recipeMeta, ...catFavFields } : { ...basePayload, ...catFavFields };

    try {
      let insertedRows;
      let metaWarning = "";

      try {
        insertedRows = await insertRecipeViaRest(payload);
      } catch (error) {
        if (state.hasRecipeMetaColumns && isMissingRecipeMetaColumns(error)) {
          state.hasRecipeMetaColumns = false;
          metaWarning = "Recipe saved, but timing/serves/difficulty fields need DB migration.";
          insertedRows = await insertRecipeViaRest(basePayload);
        } else {
          throw error;
        }
      }

      setAppStatus(metaWarning || t("status.recipeSaved"));
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
    if (state.isFriendsAvailable && shareWithFriendsInput) {
      basePayload.is_shared_with_friends = Boolean(shareWithFriendsInput.checked);
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

  async function deleteRecipe(id) {
    const confirmed = window.confirm(t("status.confirmDelete"));
    if (!confirmed) return;

    if (!hasSupabaseConfig) {
      state.recipes = state.recipes.filter((item) => item.id !== id);
      saveLocalRecipes(state.recipes);
      recipeDetail.classList.add("hidden");
      detailContent.innerHTML = "";
      rerenderList();
      return;
    }

    if (!state.currentUser) {
      setAppStatus(t("status.signInToDelete"));
      return;
    }

    const recipe = state.recipes.find((item) => item.id === id);
    if (recipe) {
      const imagePathToDelete = normalizeStoragePath(recipe.image_url);
      if (imagePathToDelete) {
        await client.storage.from(BUCKET).remove([imagePathToDelete]);
      }
    }

    const { error } = await client.from("recipes").delete().eq("id", id).eq("user_id", state.currentUser.id);
    if (error) {
      setAppStatus(t("status.deleteFailed", { error: error.message }));
      return;
    }

    setAppStatus(t("status.recipeDeleted"));
    setDetailOpen(false);
    clearRecipeUrl();
    await loadRecipes();
  }

  function isEmailNotConfirmedError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("email not confirmed") || msg.includes("email_not_confirmed");
  }

  async function resendConfirmation(email) {
    setAuthLoading(true, t("auth.resending"));
    try {
      const siteUrl = window.location.origin;
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${siteUrl}/confirm.html` }
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

  async function signIn(email, password) {
    setAuthLoading(true, t("auth.signingIn"));
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
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
      signUpButton.textContent = enabled ? "Create Account" : "Sign Up";
    }
    if (authPassword) {
      authPassword.autocomplete = enabled ? "new-password" : "current-password";
    }
    if (enabled) {
      updatePasswordRequirementsUi();
    }
  }

  async function signUp(email, password) {
    setAuthLoading(true, t("auth.signingUp"));
    try {
      const siteUrl = window.location.origin;
      const { error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${siteUrl}/confirm.html` }
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

  async function runRecipeImport() {
    if (state.isImportingRecipe) return;

    const url = recipeImportUrlInput?.value?.trim() || "";
    if (!isValidHttpUrl(url)) {
      setAppStatus(t("status.invalidImportUrl"));
      return;
    }

    const prompt = recipeImportPromptInput?.value || importPromptManager.getCurrentImportPrompt();
    setImportPromptUi(prompt);
    persistImportPrompt(prompt);

    state.isImportingRecipe = true;
    updateImportButtonUi();
    setAppStatus(t("status.importing"));

    try {
      const data = await importRecipeFromUrlViaFunction(url, prompt);
      const importedRecipe = data?.recipe && typeof data.recipe === "object" ? data.recipe : null;
      if (!importedRecipe) {
        throw new Error("Import response did not include recipe data.");
      }

      applyImportedRecipeToForm(importedRecipe);
      const source = normalizeImportedText(importedRecipe.source_url) || url;
      setAppStatus(t("status.importedFrom", { source }));
    } catch (error) {
      const message = String(error?.message || "Unexpected error");
      if (message.includes("404")) {
        setAppStatus(t("status.importFailed", { error: 'deploy the Supabase function "recipe-import" first' }));
      } else {
        setAppStatus(t("status.importFailed", { error: message }));
      }
    } finally {
      state.isImportingRecipe = false;
      updateImportButtonUi();
    }
  }

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

    await signUp(email, password);
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

  if (recipeImportPromptInput) {
    recipeImportPromptInput.addEventListener("input", () => {
      importPromptManager.setCurrentImportPrompt(recipeImportPromptInput.value);
      persistImportPrompt(recipeImportPromptInput.value);
    });
  }

  if (resetImportPromptButton) {
    resetImportPromptButton.addEventListener("click", () => {
      setImportPromptUi(DEFAULT_RECIPE_IMPORT_PROMPT);
      persistImportPrompt(DEFAULT_RECIPE_IMPORT_PROMPT);
      setAppStatus(t("status.importPromptReset"));
    });
  }

  if (themeToggleButton) {
    themeToggleButton.addEventListener("click", async () => {
      const cycle = { light: "dark", dark: "sunset", sunset: "light" };
      const nextTheme = cycle[state.currentTheme] || "light";
      setTheme(nextTheme);
      if (state.currentUser) {
        themeToggleButton.disabled = true;
        await saveThemePreference(nextTheme);
        themeToggleButton.disabled = false;
        updateThemeToggleUi();
      }
    });
  }

  if (languageToggleButton) {
    languageToggleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setLanguageMenuOpen(!state.isLanguageMenuOpen);
    });
  }

  if (languageMenu) {
    languageMenu.addEventListener("click", async (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-lang]") : null;
      if (!(target instanceof HTMLElement)) return;
      const nextLanguage = target.dataset.lang || "en";
      if (nextLanguage === state.currentLanguage) {
        setLanguageMenuOpen(false);
        return;
      }
      setLanguage(nextLanguage);
      setLanguageMenuOpen(false);
      if (state.currentUser) {
        if (languageToggleButton) languageToggleButton.disabled = true;
        await saveLanguagePreference(nextLanguage);
        if (languageToggleButton) languageToggleButton.disabled = false;
        updateLanguageButtonUi();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!state.isLanguageMenuOpen) return;
    const target = event.target instanceof Node ? event.target : null;
    if (languageSelector && target && languageSelector.contains(target)) return;
    setLanguageMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.isLanguageMenuOpen) {
      setLanguageMenuOpen(false);
      languageToggleButton?.focus();
    }
  });

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

  recipeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hasInlineMetaWarning = Boolean(
      (prepTimeWarning && !prepTimeWarning.classList.contains("hidden")) ||
        (cookTimeWarning && !cookTimeWarning.classList.contains("hidden")) ||
        (servesWarning && !servesWarning.classList.contains("hidden"))
    );
    if (!recipeForm.checkValidity()) {
      recipeForm.reportValidity();
      if (!hasInlineMetaWarning) {
        setAppStatus(t("status.fillAllRequired"));
      }
      return;
    }

    setAppStatus(state.editingRecipeId ? t("status.updating") : t("status.saving"));
    const formData = new FormData(recipeForm);

    try {
      if (state.editingRecipeId) {
        await updateRecipe(formData);
      } else {
        await addRecipe(formData);
      }
    } catch (error) {
      setAppStatus(t("status.saveFailed", { error: error.message || "Unexpected error" }));
    }
  });

  recipeForm.addEventListener(
    "invalid",
    () => {
      setAppStatus(t("status.fillAllRequired"));
    },
    true
  );

  recipeForm.addEventListener("input", saveDraftDebounced);
  recipeForm.addEventListener("change", saveDraftDebounced);

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

  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", () => {
      const isEditing = Boolean(state.editingRecipeId);
      const recipeId = state.editingRecipeId;
      const recipe = recipeId ? state.recipes.find((item) => item.id === recipeId) : null;

      resetRecipeFormState();

      if (recipe) {
        showDetail(recipe);
      } else if (isRecipeUiAvailable()) {
        showListView();
      } else {
        setAddRecipeOpen(false);
      }

      setAppStatus(isEditing ? t("status.editCanceled") : t("status.addCanceled"));
    });
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

  const handleAddButtonViewportChange = () => {
    const isOpen = !addRecipeSection.classList.contains("hidden");
    setToggleAddRecipeState(isOpen);
  };
  if (typeof addButtonWideQuery.addEventListener === "function") {
    addButtonWideQuery.addEventListener("change", handleAddButtonViewportChange);
  } else if (typeof addButtonWideQuery.addListener === "function") {
    addButtonWideQuery.addListener(handleAddButtonViewportChange);
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

  async function toggleShareRecipe(recipeId) {
    const recipe = state.recipes.find((item) => item.id === recipeId);
    if (!recipe) return;

    if (!hasSupabaseConfig || !state.currentUser) {
      setAppStatus(t("status.sharingRequiresAuth"));
      return;
    }

    const makePublic = !recipe.is_public;
    try {
      const data = await toggleRecipePublicViaRest(recipeId, state.currentUser.id, makePublic);
      const updated = Array.isArray(data) ? data[0] : data;
      if (updated) {
        recipe.is_public = updated.is_public;
        recipe.share_token = updated.share_token;
      }
      if (recipe.is_public && recipe.share_token) {
        const url = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}share.html?token=${recipe.share_token}`;
        try { await navigator.clipboard.writeText(url); } catch (_) { /* ignore */ }
        setAppStatus(t("status.shareLinkCopied"));
      } else {
        setAppStatus(t("status.shareDisabled"));
      }
    } catch (error) {
      if (error?.message?.includes("column") || error?.message?.includes("is_public") || error?.message?.includes("share_token")) {
        state.hasShareColumns = false;
        setAppStatus(t("status.sharingDbMissing"));
      } else {
        logSupabaseError("toggle share", error);
        setAppStatus(t("status.couldNotShare"));
      }
    }
    showDetail(recipe, { scrollToDetail: false });
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
      is_shared_with_friends: false
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
      resetRecipeFormState();
    }
    setAddRecipeOpen(shouldShow);
  });

  recipeList.addEventListener("click", (event) => {
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
    const scaleBtn = event.target.closest("[data-action='scale-down'], [data-action='scale-up'], [data-action='scale-reset']");
    if (scaleBtn) {
      const scaler = scaleBtn.closest(".serving-scaler");
      if (!scaler) return;
      const origServes = Number(scaler.dataset.originalServes) || 1;
      const origIngredients = scaler.dataset.originalIngredients || "";
      const display = scaler.querySelector("[data-scale-display]");
      if (!display) return;
      let current = Number(display.textContent) || origServes;
      const action = scaleBtn.dataset.action;
      if (action === "scale-down" && current > 2) current -= 2;
      else if (action === "scale-up" && current < 98) current += 2;
      else if (action === "scale-reset") current = origServes;
      display.textContent = String(current);
      const section = scaler.closest("[data-field='ingredients']");
      const contentEl = section?.querySelector("[data-field-content='ingredients']");
      if (contentEl) {
        const scaled = scaleIngredients(origIngredients, origServes, current);
        contentEl.innerHTML = scaled.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const safe = l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return safe;
        }).join("<br />");
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
      const recipeId = shareButton.dataset.id;
      if (recipeId) await toggleShareRecipe(recipeId);
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
    setDetailOpen(false);
    clearRecipeUrl();
  });

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
        setDetailOpen(false);
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
      if (justSignedOut || switchedUser || authEvent === "SIGNED_OUT") {
        state.isSettingsOpen = false;
        resetRecipeFormState();
        setTheme(DEFAULT_THEME, { persistForCurrentUser: false });
        setLanguage(DEFAULT_LANGUAGE, { persistForCurrentUser: false });
        mealPlannerWeekOffset = 0;
        state.shoppingListRecipeIds = [];
        friendsManager.resetForSignOut();
      }
      loadImportPrompt();
    } else if (justSignedIn || switchedUser || authEvent === "USER_UPDATED" || authEvent === "INITIAL_SESSION") {
      await loadThemePreference();
      await loadLanguagePreference();
      loadImportPrompt();
      // Friends: profile + friendships load in background; failures degrade gracefully.
      friendsManager.loadMyProfile().then(() => {
        friendsManager.updateHeaderButtonVisibility();
        friendsManager.updateShareToggleVisibility();
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

      const draft = loadDraft();
      if (draft && state.currentUser) {
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
      loadImportPrompt();
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
