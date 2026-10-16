function createSupabaseServices({ config, state, helpers }) {
  const {
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
  } = config;

  const { withTimeout, normalizeStoragePath, getDirectImageUrl, shrinkImageForUpload } = helpers;
  // Anything still bigger than this after resizing (an unshrinkable GIF, say) is refused.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  async function debugFetch(input, init = {}, { retries = 1 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
      try {
        return await window.fetch(input, { ...init, signal: controller.signal });
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }

  const hasSupabaseConfig =
    Boolean(window.supabase) &&
    SUPABASE_URL !== SUPABASE_URL_PLACEHOLDER &&
    SUPABASE_PUBLISHABLE_KEY !== SUPABASE_KEY_PLACEHOLDER;
  const client = hasSupabaseConfig
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: { fetch: debugFetch }
      })
    : null;

  function getAccessToken() {
    const accessToken = state.currentSession?.access_token;
    if (!accessToken) {
      throw new Error("No access token found. Sign out and sign in again.");
    }
    return accessToken;
  }

  async function parseResponse(response, fallback) {
    const rawText = await response.text();
    try {
      return rawText ? JSON.parse(rawText) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  async function fetchThemePreferenceViaRest(userId) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "theme",
      user_id: `eq.${userId}`,
      limit: "1"
    });
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/${THEME_PREFERENCES_TABLE}?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Theme fetch failed with status ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(data) ? data : [];
  }

  async function upsertThemePreferenceViaRest(userId, theme) {
    const accessToken = getAccessToken();
    const t = String(theme).toLowerCase();
    const normalizedTheme = t === "dark" ? "dark" : t === "sunset" ? "sunset" : "light";
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/${THEME_PREFERENCES_TABLE}?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([{ user_id: userId, theme: normalizedTheme }])
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Theme upsert failed with status ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(data) ? data : [];
  }

  async function fetchLanguagePreferenceViaRest(userId) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "language",
      user_id: `eq.${userId}`,
      limit: "1"
    });
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/${THEME_PREFERENCES_TABLE}?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Language fetch failed with status ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(data) ? data : [];
  }

  async function upsertLanguagePreferenceViaRest(userId, language) {
    const accessToken = getAccessToken();
    const l = String(language).toLowerCase();
    const normalizedLanguage = l === "ru" ? "ru" : "en";
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/${THEME_PREFERENCES_TABLE}?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([{ user_id: userId, language: normalizedLanguage }])
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Language upsert failed with status ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(data) ? data : [];
  }

  // ───────────────────────────── Friends ────────────────────────────────

  function getProfilesTable() {
    return PROFILES_TABLE || "profiles";
  }
  function getFriendshipsTable() {
    return FRIENDSHIPS_TABLE || "friendships";
  }

  async function fetchMyProfileViaRest(userId) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "id,email,invite_code,display_name",
      id: `eq.${userId}`,
      limit: "1"
    });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/${getProfilesTable()}?${query.toString()}`,
      { method: "GET", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Profile fetch failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data[0] || null : null;
  }

  // Finding someone needs their exact email or invite code; the database
  // function returns that one person (or nobody) and can't list everyone.
  async function findProfileViaRpc(lookup) {
    const accessToken = getAccessToken();
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/rpc/find_profile`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ lookup: String(lookup || "").trim() })
    });
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Profile lookup failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data[0] || null : null;
  }

  async function lookupProfileByEmailViaRest(email) {
    return findProfileViaRpc(email);
  }

  async function fetchProfilesByIdsViaRest(ids) {
    const cleanIds = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (!cleanIds.length) return [];
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "id,email,invite_code,display_name",
      id: `in.(${cleanIds.join(",")})`
    });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/${getProfilesTable()}?${query.toString()}`,
      { method: "GET", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Profile bulk fetch failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data : [];
  }

  async function lookupProfileByInviteCodeViaRest(code) {
    return findProfileViaRpc(String(code || "").trim().toUpperCase());
  }

  async function fetchFriendshipsViaRest(userId) {
    // Two-step query: friendships where I am the follower, then the followee profiles.
    // Done in JS to avoid PostgREST FK-embed quirks across auth.users.
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "id,followee_id,is_muted,created_at",
      follower_id: `eq.${userId}`,
      order: "created_at.desc"
    });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/${getFriendshipsTable()}?${query.toString()}`,
      { method: "GET", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Friends fetch failed ${response.status}`;
      throw new Error(message);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return [];

    const followeeIds = rows.map((r) => r.followee_id).filter(Boolean);
    let profiles = [];
    try {
      profiles = await fetchProfilesByIdsViaRest(followeeIds);
    } catch (_err) {
      // If profiles fetch fails, return rows without profile embed; UI will fall
      // back to invite_code/email fields being undefined and show "(no name)".
    }
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, profile: profileById.get(r.followee_id) || null }));
  }

  // Following goes through the database function, which checks the email or
  // invite code again (following someone by id alone isn't allowed).
  async function addFriendshipViaRest(_followerId, _followeeId, lookup) {
    const accessToken = getAccessToken();
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/rpc/follow_profile`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ lookup: String(lookup || "").trim() })
    });
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Add friend failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data[0] || null : null;
  }

  async function setFriendshipMutedViaRest(friendshipId, isMuted) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({ id: `eq.${friendshipId}` });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/${getFriendshipsTable()}?${query.toString()}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ is_muted: Boolean(isMuted) })
      }
    );
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Mute failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data[0] || null : null;
  }

  async function deleteFriendshipViaRest(friendshipId) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({ id: `eq.${friendshipId}` });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/${getFriendshipsTable()}?${query.toString()}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: "return=minimal"
        }
      }
    );
    if (!response.ok) {
      const data = await parseResponse(response, {});
      const message = typeof data === "object" && data && "message" in data ? data.message : `Remove friend failed ${response.status}`;
      throw new Error(message);
    }
    return true;
  }

  async function fetchFriendRecipesViaRest(followeeIds) {
    const ids = (Array.isArray(followeeIds) ? followeeIds : []).filter(Boolean);
    if (!ids.length) return [];
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "*",
      is_shared_with_friends: "eq.true",
      user_id: `in.(${ids.join(",")})`,
      order: "created_at.desc"
    });
    const response = await debugFetch(
      `${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`,
      { method: "GET", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` } }
    );
    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message = typeof data === "object" && data && "message" in data ? data.message : `Friend recipes fetch failed ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) ? data : [];
  }

  async function insertRecipeViaRest(payload) {
    const accessToken = getAccessToken();
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/recipes`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseResponse(response, null);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `REST insert failed with status ${response.status}`;
      throw new Error(message);
    }

    return data;
  }

  async function updateRecipeViaRest(recipeId, userId, payload) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      id: `eq.${recipeId}`,
      user_id: `eq.${userId}`
    });
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseResponse(response, null);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `REST update failed with status ${response.status}`;
      throw new Error(message);
    }

    return data;
  }

  async function fetchRecipesViaRest(userId) {
    const accessToken = getAccessToken();
    const query = new URLSearchParams({
      select: "*",
      user_id: `eq.${userId}`,
      order: "created_at.desc"
    });

    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `REST fetch failed with status ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(data) ? data : [];
  }

  async function callRecipeImportFunction(body) {
    if (!hasSupabaseConfig) {
      throw new Error("Recipe import needs a configured Supabase project.");
    }
    let accessToken;
    try {
      accessToken = getAccessToken();
    } catch (authError) {
      const error = new Error(String(authError?.message || "Not signed in"));
      error.code = "unauthenticated";
      throw error;
    }

    let response;
    try {
      response = await debugFetch(`${SUPABASE_URL}/functions/v1/${RECIPE_IMPORT_FUNCTION}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, { retries: 0 });
    } catch (networkError) {
      // The browser only says "Failed to fetch" here. That includes the function
      // not being deployed: Supabase's 404 for a missing function fails the CORS
      // preflight, so we never get to see the 404 itself.
      const error = new Error(String(networkError?.message || "Network error"));
      error.code = "service_unreachable";
      throw error;
    }

    const data = await parseResponse(response, {});
    if (!response.ok) {
      const error = new Error(
        typeof data === "object" && data && data.error ? data.error : `Recipe import failed with status ${response.status}`
      );
      // A 404 with no error code means the edge function isn't deployed yet.
      error.code = data?.code || (response.status === 404 ? "not_deployed" : null);
      error.remaining = data?.remaining;
      throw error;
    }
    return data;
  }

  // The prompt is owned by the server; the browser only ever sends the link.
  function importRecipeFromUrlViaFunction(url, language) {
    return callRecipeImportFunction({ url, language });
  }

  // Recipe text the user typed or pasted (also the form's "Tidy up").
  function importRecipeFromTextViaFunction(text, language) {
    return callRecipeImportFunction({ text, language });
  }

  // A photo or screenshot of a recipe, as a data: URL.
  function importRecipeFromImageViaFunction(image, language) {
    return callRecipeImportFunction({ image, language });
  }

  // Your display name. The profile row normally exists (created at sign-up);
  // if it doesn't, it's created here.
  async function updateMyDisplayNameViaRest(userId, email, displayName) {
    const accessToken = getAccessToken();
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
    const value = displayName || null;
    const query = new URLSearchParams({ id: `eq.${userId}` });
    let response = await debugFetch(`${SUPABASE_URL}/rest/v1/profiles?${query}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ display_name: value })
    });
    let data = await parseResponse(response, []);
    if (response.ok && Array.isArray(data) && data.length === 0) {
      response = await debugFetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: userId, email, display_name: value })
      });
      data = await parseResponse(response, []);
    }
    if (!response.ok) {
      throw new Error(data?.message || `Saving your name failed with status ${response.status}`);
    }
    return Array.isArray(data) ? data[0] : data;
  }

  // "Save to my recipes" for a recipe shared by link (shared-recipe function).
  async function saveSharedRecipeViaFunction(token) {
    let accessToken;
    try {
      accessToken = getAccessToken();
    } catch (_authError) {
      const error = new Error("Not signed in");
      error.code = "unauthenticated";
      throw error;
    }
    const response = await debugFetch(`${SUPABASE_URL}/functions/v1/shared-recipe`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "save", token })
    }, { retries: 0 });
    const data = await parseResponse(response, {});
    if (!response.ok) {
      const error = new Error(data?.error || `Saving the shared recipe failed with status ${response.status}`);
      error.code = data?.code || null;
      throw error;
    }
    return data;
  }

  function fetchImportQuotaViaFunction() {
    return callRecipeImportFunction({ action: "quota" });
  }

  async function fetchExternalImageAsFile(imageUrl) {
    if (!hasSupabaseConfig) {
      throw new Error("Image preservation needs a configured Supabase project.");
    }
    const trimmed = String(imageUrl || "").trim();
    if (!trimmed) throw new Error("Missing image URL.");

    const accessToken = getAccessToken();
    const response = await debugFetch(`${SUPABASE_URL}/functions/v1/image-proxy`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: trimmed })
    });

    if (!response.ok) {
      let message = `Image fetch failed with status ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data === "object") {
          if ("error" in data && data.error) message = String(data.error);
          else if ("message" in data && data.message) message = String(data.message);
          else if ("msg" in data && data.msg) message = String(data.msg);
        }
      } catch (_error) {
        // ignore
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const contentType = (blob.type || "image/jpeg").toLowerCase();
    const extensionMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg"
    };
    const extension = extensionMap[contentType] || "jpg";
    const fileName = `imported-${Date.now()}.${extension}`;
    return new File([blob], fileName, { type: contentType });
  }

  async function uploadImage(originalFile, userId) {
    const file = shrinkImageForUpload ? await shrinkImageForUpload(originalFile) : originalFile;
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max size: 5 MB.`);
    }
    const extension = file.name.split(".").pop() || "jpg";
    const filePath = `${userId}/${crypto.randomUUID()}.${extension}`;

    // Each upload gets a new random name and is never changed, so browsers can
    // keep it for a long time.
    const { error } = await client.storage.from(BUCKET).upload(filePath, file, {
      cacheControl: "31536000",
      contentType: file.type || undefined,
      upsert: false
    });

    if (error) throw error;
    return filePath;
  }

  async function readFileAsDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function getSignedImageUrl(path) {
    evictExpiredCacheEntries();
    if (!path || !hasSupabaseConfig) return null;

    const rawValue = String(path).trim();
    if (!rawValue) return null;

    const normalizedPath = normalizeStoragePath(rawValue, BUCKET);
    if (!normalizedPath) return getDirectImageUrl(rawValue);
    const cached = state.signedImageUrlByPath[normalizedPath];
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    let downloadResult;
    try {
      downloadResult = await withTimeout(
        client.storage.from(BUCKET).download(normalizedPath),
        IMAGE_RESOLVE_TIMEOUT_MS,
        "storage.download"
      );
    } catch (timeoutError) {
      downloadResult = { data: null, error: timeoutError };
    }
    const { data: blobData, error: downloadError } = downloadResult;
    if (!downloadError && blobData) {
      const objectUrl = URL.createObjectURL(blobData);
      state.signedImageUrlByPath[normalizedPath] = { url: objectUrl, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      return objectUrl;
    }

    let signResult;
    try {
      signResult = await withTimeout(
        client.storage.from(BUCKET).createSignedUrl(normalizedPath, 3600),
        IMAGE_SIGN_TIMEOUT_MS,
        "createSignedUrl"
      );
    } catch (error) {
      signResult = { data: null, error };
    }

    const { data, error } = signResult;
    if (!error && data?.signedUrl) {
      state.signedImageUrlByPath[normalizedPath] = { url: data.signedUrl, expiresAt: Date.now() + 50 * 60 * 1000 };
      return data.signedUrl;
    }

    const { data: publicData } = client.storage.from(BUCKET).getPublicUrl(normalizedPath);
    if (publicData?.publicUrl) {
      state.signedImageUrlByPath[normalizedPath] = { url: publicData.publicUrl, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      return publicData.publicUrl;
    }

    return null;
  }

  let lastEvictionTime = 0;
  const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

  function evictExpiredCacheEntries() {
    const now = Date.now();
    if (now - lastEvictionTime < EVICTION_INTERVAL_MS) return;
    lastEvictionTime = now;
    for (const key of Object.keys(state.signedImageUrlByPath)) {
      const entry = state.signedImageUrlByPath[key];
      if (entry && entry.expiresAt <= now) {
        if (entry.url && entry.url.startsWith("blob:")) {
          try { URL.revokeObjectURL(entry.url); } catch (_e) { /* ignore */ }
        }
        delete state.signedImageUrlByPath[key];
      }
    }
  }

  function randomShareToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
  }

  async function toggleRecipePublicViaRest(recipeId, userId, makePublic) {
    const accessToken = getAccessToken();
    // 16 URL-safe characters (96 random bits): short, and can't be guessed.
    const shareToken = makePublic ? randomShareToken() : null;
    const query = new URLSearchParams({
      id: `eq.${recipeId}`,
      user_id: `eq.${userId}`
    });
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ is_public: makePublic, share_token: shareToken })
    });

    const data = await parseResponse(response, null);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Share toggle failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  async function fetchPublicRecipeViaRest(shareToken) {
    const query = new URLSearchParams({
      select: "*",
      share_token: `eq.${shareToken}`,
      is_public: "eq.true",
      limit: "1"
    });
    const response = await debugFetch(`${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY
      }
    });

    const data = await parseResponse(response, []);
    if (!response.ok) {
      const message =
        typeof data === "object" && data && "message" in data
          ? data.message
          : `Public recipe fetch failed with status ${response.status}`;
      throw new Error(message);
    }
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  return {
    hasSupabaseConfig,
    client,
    debugFetch,
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
  };
}

window.StorecipeSupabaseServices = {
  createSupabaseServices
};
