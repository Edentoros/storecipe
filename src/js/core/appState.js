(() => {
  function createAppState(defaults = {}) {
    return {
      recipes: [],
      currentUser: null,
      currentSession: null,
      editingRecipeId: null,
      signedImageUrlByPath: {},
      isSettingsOpen: false,
      lastFocusedBeforeSettings: null,
      localEditPreviewObjectUrl: null,
      pendingImageAction: "keep",
      pendingImageFile: null,
      pendingImageUrl: "",
      currentTheme: defaults.DEFAULT_THEME || "light",
      currentLanguage: defaults.DEFAULT_LANGUAGE || "en",
      isLanguagePreferenceAvailable: true,
      isLanguageMenuOpen: false,
      isImportingRecipe: false,
      isAuthLoading: false,
      isRecipeListLoading: false,
      isStartupLoading: false,
      isInlineFieldSaveInProgress: false,
      activeRecipeLoadCount: 0,
      recipeListLoaderTimerId: null,
      hasCompletedInitialAuthBootstrap: false,
      isThemePreferenceAvailable: true,
      hasRecipeMetaColumns: true,
      hasCategoryFavColumns: true,
      activeCategory: "",
      showFavouritesOnly: false,
      sortBy: "created_at_desc",
      hasShareColumns: true,
      shoppingListRecipeIds: [],
      // Original page of an imported recipe, saved with it on the next save.
      pendingImportSourceUrl: "",
      hasSourceUrlColumn: true,
      // Friends
      myProfile: null,
      friends: [],
      friendRecipes: [],
      isFriendsAvailable: true,
      isFriendsFeedActive: false,
      isFriendsModalOpen: false
    };
  }

  window.StorecipeAppState = { createAppState };
})();
