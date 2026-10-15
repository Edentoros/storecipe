// Email confirmation page: finishes sign-up from the link in the email.
document.addEventListener("DOMContentLoaded", async () => {
  const pendingEl = document.getElementById("confirmPending");
  const successEl = document.getElementById("confirmSuccess");
  const errorEl = document.getElementById("confirmError");
  const errorMsgEl = document.getElementById("confirmErrorMessage");

  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token")) return;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const errorDescription = params.get("error_description");

  if (errorDescription) {
    pendingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    errorMsgEl.textContent = decodeURIComponent(errorDescription);
    return;
  }

  if (!accessToken) return;

  try {
    const config = window.StorecipeConfig || {};
    const url = config.SUPABASE_URL;
    const key = config.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key || url.includes("YOUR_PROJECT_ID")) {
      throw new Error("Supabase is not configured.");
    }

    const client = window.supabase.createClient(url, key);
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error) throw error;

    pendingEl.classList.add("hidden");
    successEl.classList.remove("hidden");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  } catch (err) {
    pendingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    errorMsgEl.textContent = err.message || "Could not verify your email. Please try again.";
  }
});
