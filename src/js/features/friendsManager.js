(() => {
  /**
   * One-sided follow model: state.friends = array of friendship rows where the
   * current user is the follower. Each row carries the followee's profile.
   */
  function createFriendsManager({
    dom,
    state,
    helpers,
    supabaseServices,
    setAppStatus,
    logSupabaseError,
    i18n
  }) {
    const {
      friendsModal,
      openFriends,
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
    } = dom;
    const { escapeHtml } = helpers;
    const {
      hasSupabaseConfig,
      fetchMyProfileViaRest,
      lookupProfileByEmailViaRest,
      lookupProfileByInviteCodeViaRest,
      fetchFriendshipsViaRest,
      addFriendshipViaRest,
      setFriendshipMutedViaRest,
      deleteFriendshipViaRest,
      fetchFriendRecipesViaRest
    } = supabaseServices;

    const t = i18n ? (k, p) => i18n.t(k, p) : (k) => k;

    // Internal state for the modal — kept simple, not on global state.
    let currentAddMode = "code"; // "code" | "email"
    let isAdding = false;

    function isInfraMissingError(error) {
      const message = String(error?.message || "").toLowerCase();
      return (
        message.includes("profiles") ||
        message.includes("friendships") ||
        message.includes("relation") ||
        message.includes("schema cache") ||
        message.includes("could not find the table")
      );
    }

    function markUnavailable(err) {
      state.isFriendsAvailable = false;
      if (openFriends) openFriends.classList.add("hidden");
      if (toggleFriendsFeed) toggleFriendsFeed.classList.add("hidden");
      setAppStatus(t("friends.featureUnavailable"));
      if (err && logSupabaseError) logSupabaseError("friends infra", err);
    }

    function getFriendDisplayName(profile) {
      if (!profile) return "(unknown)";
      return profile.display_name || profile.email || profile.invite_code || "(no name)";
    }

    function updateHeaderButtonVisibility() {
      if (!openFriends) return;
      const show = Boolean(state.currentUser) && state.isFriendsAvailable;
      openFriends.classList.toggle("hidden", !show);
    }


    function updateFeedToggleVisibility() {
      if (!toggleFriendsFeed) return;
      const visibleFriends = (state.friends || []).filter((f) => !f.is_muted);
      const show = Boolean(state.currentUser) && state.isFriendsAvailable && visibleFriends.length > 0;
      toggleFriendsFeed.classList.toggle("hidden", !show);
      toggleFriendsFeed.setAttribute("aria-pressed", state.isFriendsFeedActive ? "true" : "false");
      toggleFriendsFeed.textContent = state.isFriendsFeedActive
        ? t("friends.backToMine")
        : t("friends.viewFeed");
      if (recipeListHeading) {
        recipeListHeading.textContent = state.isFriendsFeedActive
          ? t("friends.feedTitle")
          : t("list.title");
      }
    }

    function renderFriendsList() {
      if (!friendsList) return;
      const friends = Array.isArray(state.friends) ? state.friends : [];
      if (!friends.length) {
        friendsList.innerHTML = "";
        if (friendsEmpty) friendsEmpty.classList.remove("hidden");
        return;
      }
      if (friendsEmpty) friendsEmpty.classList.add("hidden");

      friendsList.innerHTML = friends
        .map((friendship) => {
          const profile = friendship.profile || {};
          const name = getFriendDisplayName(profile);
          const subtitle = profile.email && profile.email !== name ? profile.email : "";
          const isMuted = Boolean(friendship.is_muted);
          const muteLabel = isMuted ? t("friends.unmute") : t("friends.mute");
          return `<li class="friend-row${isMuted ? " friend-row--muted" : ""}" data-friendship-id="${escapeHtml(friendship.id)}">
            <div class="friend-row__info">
              <span class="friend-row__name">${escapeHtml(name)}</span>
              ${subtitle ? `<span class="friend-row__sub">${escapeHtml(subtitle)}</span>` : ""}
            </div>
            <div class="friend-row__actions">
              <button type="button" class="button button--ghost friend-row__mute" data-action="toggle-mute">${escapeHtml(muteLabel)}</button>
              <button type="button" class="button button--ghost friend-row__remove" data-action="remove">${escapeHtml(t("friends.remove"))}</button>
            </div>
          </li>`;
        })
        .join("");
    }

    function renderInviteCode() {
      if (!myInviteCode) return;
      const code = state.myProfile?.invite_code;
      myInviteCode.textContent = code || "—";
    }

    function setAddMode(mode) {
      currentAddMode = mode === "email" ? "email" : "code";
      if (addFriendTabCode) {
        const active = currentAddMode === "code";
        addFriendTabCode.classList.toggle("friends-add__tab--active", active);
        addFriendTabCode.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (addFriendTabEmail) {
        const active = currentAddMode === "email";
        addFriendTabEmail.classList.toggle("friends-add__tab--active", active);
        addFriendTabEmail.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (addFriendInput) {
        addFriendInput.placeholder = currentAddMode === "email"
          ? t("friends.emailPlaceholder")
          : t("friends.codePlaceholder");
        addFriendInput.setAttribute(
          "data-i18n-placeholder",
          currentAddMode === "email" ? "friends.emailPlaceholder" : "friends.codePlaceholder"
        );
        addFriendInput.type = currentAddMode === "email" ? "email" : "text";
        addFriendInput.value = "";
      }
    }

    function openModal() {
      if (!friendsModal) return;
      friendsModal.classList.remove("hidden");
      friendsModal.setAttribute("aria-hidden", "false");
      state.isFriendsModalOpen = true;
      // Refresh on open so the list is current.
      void loadFriends({ refreshUi: true });
    }

    function closeModal() {
      if (!friendsModal) return;
      friendsModal.classList.add("hidden");
      friendsModal.setAttribute("aria-hidden", "true");
      state.isFriendsModalOpen = false;
    }

    async function loadMyProfile() {
      if (!state.currentUser || !hasSupabaseConfig || !state.isFriendsAvailable) return;
      try {
        const profile = await fetchMyProfileViaRest(state.currentUser.id);
        state.myProfile = profile;
        renderInviteCode();
      } catch (error) {
        if (isInfraMissingError(error)) markUnavailable(error);
        else if (logSupabaseError) logSupabaseError("fetch profile", error);
      }
    }

    async function loadFriends({ refreshUi = true } = {}) {
      if (!state.currentUser || !hasSupabaseConfig || !state.isFriendsAvailable) return;
      try {
        const rows = await fetchFriendshipsViaRest(state.currentUser.id);
        state.friends = Array.isArray(rows) ? rows : [];
        if (refreshUi) {
          renderFriendsList();
          updateFeedToggleVisibility();
        }
      } catch (error) {
        if (isInfraMissingError(error)) markUnavailable(error);
        else if (logSupabaseError) logSupabaseError("fetch friendships", error);
      }
    }

    async function reloadFriendRecipesIfNeeded() {
      if (!state.isFriendsFeedActive) return;
      const ids = (state.friends || []).filter((f) => !f.is_muted).map((f) => f.followee_id);
      if (!ids.length) {
        state.friendRecipes = [];
        return;
      }
      try {
        state.friendRecipes = await fetchFriendRecipesViaRest(ids);
      } catch (error) {
        state.friendRecipes = [];
        const msg = error?.message || "Unexpected error";
        setAppStatus(t("friends.loadFailed", { error: msg }));
        if (logSupabaseError) logSupabaseError("fetch friend recipes", error);
      }
    }

    async function handleAddFriend() {
      if (!state.currentUser || isAdding) return;
      const raw = (addFriendInput?.value || "").trim();
      if (!raw) return;
      isAdding = true;
      if (addFriendButton) {
        addFriendButton.disabled = true;
        addFriendButton.textContent = t("friends.adding");
      }
      try {
        const kindLabel = currentAddMode === "email" ? t("friends.kindEmail") : t("friends.kindCode");
        let target = null;
        if (currentAddMode === "email") {
          target = await lookupProfileByEmailViaRest(raw);
        } else {
          target = await lookupProfileByInviteCodeViaRest(raw);
        }
        if (!target) {
          setAppStatus(t("friends.notFound", { kind: kindLabel }));
          return;
        }
        if (target.id === state.currentUser.id) {
          setAppStatus(t("friends.cantFollowSelf", { kind: kindLabel }));
          return;
        }
        const existing = (state.friends || []).find((f) => f.followee_id === target.id);
        if (existing) {
          setAppStatus(t("friends.alreadyFriends", { name: getFriendDisplayName(target) }));
          return;
        }
        await addFriendshipViaRest(state.currentUser.id, target.id);
        await loadFriends({ refreshUi: true });
        setAppStatus(t("friends.added", { name: getFriendDisplayName(target) }));
        if (addFriendInput) addFriendInput.value = "";
      } catch (error) {
        if (isInfraMissingError(error)) {
          markUnavailable(error);
        } else {
          const msg = error?.message || "Unexpected error";
          setAppStatus(`${t("friends.notFound", { kind: "" })} (${msg})`);
          if (logSupabaseError) logSupabaseError("add friend", error);
        }
      } finally {
        isAdding = false;
        if (addFriendButton) {
          addFriendButton.disabled = false;
          addFriendButton.textContent = t("friends.addButton");
        }
      }
    }

    async function handleListAction(event) {
      const row = event.target.closest(".friend-row");
      const actionEl = event.target.closest("[data-action]");
      if (!row || !actionEl) return;
      const friendshipId = row.dataset.friendshipId;
      const action = actionEl.dataset.action;
      const friendship = (state.friends || []).find((f) => String(f.id) === String(friendshipId));
      if (!friendship) return;
      const friendName = getFriendDisplayName(friendship.profile);

      if (action === "toggle-mute") {
        const nextMuted = !friendship.is_muted;
        try {
          await setFriendshipMutedViaRest(friendshipId, nextMuted);
          friendship.is_muted = nextMuted;
          renderFriendsList();
          updateFeedToggleVisibility();
          setAppStatus(nextMuted ? t("friends.muted", { name: friendName }) : t("friends.unmuted", { name: friendName }));
        } catch (error) {
          if (logSupabaseError) logSupabaseError("mute friend", error);
        }
      } else if (action === "remove") {
        try {
          await deleteFriendshipViaRest(friendshipId);
          state.friends = (state.friends || []).filter((f) => String(f.id) !== String(friendshipId));
          renderFriendsList();
          updateFeedToggleVisibility();
          setAppStatus(t("friends.removed", { name: friendName }));
        } catch (error) {
          if (logSupabaseError) logSupabaseError("remove friend", error);
        }
      }
    }

    async function copyInviteCodeToClipboard() {
      const code = state.myProfile?.invite_code;
      if (!code) {
        setAppStatus(t("friends.profileMissing"));
        return;
      }
      try {
        await navigator.clipboard.writeText(code);
        setAppStatus(t("friends.codeCopied"));
      } catch (_err) {
        setAppStatus(t("friends.codeCopyFailed"));
      }
    }

    function attachListeners() {
      if (openFriends) {
        openFriends.addEventListener("click", openModal);
      }
      if (closeFriends) {
        closeFriends.addEventListener("click", closeModal);
      }
      if (friendsModal) {
        friendsModal.addEventListener("click", (e) => {
          if (e.target === friendsModal) closeModal();
        });
      }
      if (addFriendTabCode) addFriendTabCode.addEventListener("click", () => setAddMode("code"));
      if (addFriendTabEmail) addFriendTabEmail.addEventListener("click", () => setAddMode("email"));
      if (addFriendButton) addFriendButton.addEventListener("click", handleAddFriend);
      if (addFriendInput) {
        addFriendInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAddFriend();
          }
        });
      }
      if (friendsList) friendsList.addEventListener("click", handleListAction);
      if (copyInviteCode) copyInviteCode.addEventListener("click", copyInviteCodeToClipboard);
    }

    function resetForSignOut() {
      state.myProfile = null;
      state.friends = [];
      state.friendRecipes = [];
      state.isFriendsFeedActive = false;
      state.isFriendsAvailable = true;
      if (friendsList) friendsList.innerHTML = "";
      if (friendsEmpty) friendsEmpty.classList.remove("hidden");
      closeModal();
      updateHeaderButtonVisibility();
      updateFeedToggleVisibility();
    }

    return {
      attachListeners,
      setAddMode,
      openModal,
      closeModal,
      loadMyProfile,
      loadFriends,
      reloadFriendRecipesIfNeeded,
      renderFriendsList,
      renderInviteCode,
      updateHeaderButtonVisibility,
      updateFeedToggleVisibility,
      resetForSignOut,
      getFriendDisplayName,
      get isAvailable() { return state.isFriendsAvailable; }
    };
  }

  window.StorecipeFriendsManager = { createFriendsManager };
})();
