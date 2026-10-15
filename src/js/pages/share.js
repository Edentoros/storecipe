// Public page for a recipe shared by link (share.html?token=...).
document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const container = document.getElementById("sharedContent");

  if (!token) {
    container.innerHTML = '<p class="empty">No recipe token provided.</p>';
    return;
  }

  const _config = window.StorecipeConfig || {};
  const SUPABASE_URL = _config.SUPABASE_URL || "https://YOUR_PROJECT_ID.supabase.co";
  const SUPABASE_KEY = _config.SUPABASE_PUBLISHABLE_KEY || "YOUR_SUPABASE_PUBLISHABLE_KEY";

  if (SUPABASE_URL === "https://YOUR_PROJECT_ID.supabase.co") {
    container.innerHTML = '<p class="empty">Supabase not configured. Cannot load shared recipe.</p>';
    return;
  }

  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nl2br = (s) => esc(s).replace(/\n/g, "<br />");

  try {
    const query = new URLSearchParams({
      select: "*",
      share_token: `eq.${token}`,
      is_public: "eq.true",
      limit: "1"
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/recipes?${query.toString()}`, {
      method: "GET",
      headers: { apikey: SUPABASE_KEY }
    });

    if (!response.ok) throw new Error("Failed to load recipe.");

    const data = await response.json();
    const recipe = Array.isArray(data) && data.length > 0 ? data[0] : null;

    if (!recipe) {
      container.innerHTML = '<p class="empty">Recipe not found or is no longer shared.</p>';
      return;
    }

    const prepTime = recipe.prep_time || recipe.prepTime || "";
    const cookTime = recipe.cooking_time || recipe.cookingTime || "";
    const totalTime = recipe.total_time || "";
    const serves = recipe.serves || recipe.servings || "";
    const difficulty = recipe.difficulty || "";

    const metaItems = [
      prepTime ? `<p><strong>Prep:</strong> ${esc(prepTime)}</p>` : "",
      cookTime ? `<p><strong>Cook:</strong> ${esc(cookTime)}</p>` : "",
      totalTime ? `<p><strong>Total:</strong> ${esc(totalTime)}</p>` : "",
      serves ? `<p><strong>Serves:</strong> ${esc(serves)}</p>` : "",
      difficulty ? `<p><strong>Difficulty:</strong> ${esc(difficulty)}</p>` : ""
    ].filter(Boolean).join("\n");

    const categoryBadge = recipe.category
      ? `<span class="recipe-detail-card__category-badge">${esc(recipe.category.charAt(0).toUpperCase() + recipe.category.slice(1))}</span>`
      : "";

    let imageHtml = "";
    if (recipe.image_url) {
      const isUrl = /^https?:\/\//i.test(recipe.image_url);
      if (isUrl) {
        imageHtml = `<img class="recipe-detail-card__image" src="${esc(recipe.image_url)}" alt="${esc(recipe.title)}" />`;
      }
    }

    container.innerHTML = `
      <article class="recipe-detail-card">
        ${imageHtml}
        <div class="recipe-detail-card__header">
          <h2>${esc(recipe.title)}</h2>
          ${categoryBadge}
        </div>
        ${metaItems ? `<div class="recipe-detail-card__meta">${metaItems}</div>` : ""}
        <section class="recipe-detail-card__section">
          <h3>Ingredients</h3>
          <p>${nl2br(recipe.ingredients)}</p>
        </section>
        <section class="recipe-detail-card__section">
          <h3>Method</h3>
          <p>${nl2br(recipe.method)}</p>
        </section>
        ${recipe.notes ? `<section class="recipe-detail-card__section"><h3>Notes / Tips</h3><p>${nl2br(recipe.notes)}</p></section>` : ""}
        <p style="margin-top:1.5rem;color:#616e7c;font-size:0.85rem;">Shared via <a href="index.html">Storecipe</a></p>
      </article>
    `;

  } catch (error) {
    container.innerHTML = `<p class="empty">Error loading recipe: ${esc(error.message || "Unknown error")}</p>`;
  }
});
