(() => {
  function createViewManager({ dom, state, config, callbacks, i18n }) {
    const {
      searchPanel, listPanel, addRecipeSection, recipeDetail, detailContent,
      searchInput, toggleAddRecipe, recipeForm
    } = dom;
    const { hasSupabaseConfig } = config;
    const { resetRecipeFormState, resetRecipeListLoadingState } = callbacks;
    const t = i18n ? (k, p) => i18n.t(k, p) : (k) => k;

    function isRecipeUiAvailable() {
      return Boolean(state.currentUser);
    }

    function setToggleAddRecipeState(isOpen) {
      toggleAddRecipe.textContent = isOpen ? "x" : t("list.addNew");
      toggleAddRecipe.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggleAddRecipe.setAttribute("aria-label", isOpen ? t("list.hideAdd") : t("list.showAdd"));
      toggleAddRecipe.classList.toggle("icon-button--text", !isOpen);
    }

    function setRecipeUiEnabled(enabled) {
      if (searchPanel) {
        searchPanel.classList.toggle("hidden", !enabled);
      }
      if (listPanel) {
        listPanel.classList.toggle("hidden", !enabled);
      }
      if (!enabled) {
        addRecipeSection.classList.add("hidden");
        recipeDetail.classList.add("hidden");
        detailContent.innerHTML = "";
        resetRecipeListLoadingState();
      }

      searchInput.disabled = !enabled;
      toggleAddRecipe.disabled = !enabled;
      recipeForm.querySelectorAll("input, textarea, button").forEach((el) => {
        el.disabled = !enabled;
      });
      if (!enabled) {
        addRecipeSection.classList.add("hidden");
        setToggleAddRecipeState(false);
      }
    }

    function showListView() {
      if (searchPanel) {
        searchPanel.classList.remove("hidden");
      }
      if (listPanel) {
        listPanel.classList.remove("hidden");
      }
      addRecipeSection.classList.add("hidden");
      recipeDetail.classList.add("hidden");
      detailContent.innerHTML = "";
      setToggleAddRecipeState(false);
    }

    function setAddRecipeOpen(isOpen) {
      if (isOpen) {
        if (searchPanel) {
          searchPanel.classList.add("hidden");
        }
        if (listPanel) {
          listPanel.classList.add("hidden");
        }
        recipeDetail.classList.add("hidden");
        detailContent.innerHTML = "";
        addRecipeSection.classList.remove("hidden");
        setToggleAddRecipeState(true);
        addRecipeSection.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      if (state.editingRecipeId) {
        resetRecipeFormState();
      }

      if (isRecipeUiAvailable()) {
        showListView();
      } else {
        addRecipeSection.classList.add("hidden");
        setToggleAddRecipeState(false);
        setRecipeUiEnabled(false);
      }
    }

    function setDetailOpen(isOpen) {
      if (isOpen) {
        if (searchPanel) {
          searchPanel.classList.add("hidden");
        }
        if (listPanel) {
          listPanel.classList.add("hidden");
        }
        addRecipeSection.classList.add("hidden");
        setToggleAddRecipeState(false);
        recipeDetail.classList.remove("hidden");
        return;
      }

      if (isRecipeUiAvailable()) {
        showListView();
      } else {
        recipeDetail.classList.add("hidden");
        detailContent.innerHTML = "";
        setRecipeUiEnabled(false);
      }
    }

    return {
      isRecipeUiAvailable,
      getClosedAddLabel,
      setToggleAddRecipeState,
      setRecipeUiEnabled,
      showListView,
      setAddRecipeOpen,
      setDetailOpen
    };
  }

  window.StorecipeViewManager = { createViewManager };
})();
