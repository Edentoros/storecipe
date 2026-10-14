const _config = window.StorecipeConfig || {};
const SUPABASE_URL = _config.SUPABASE_URL || "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = _config.SUPABASE_PUBLISHABLE_KEY || "YOUR_SUPABASE_PUBLISHABLE_KEY";
const SUPABASE_URL_PLACEHOLDER = "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_KEY_PLACEHOLDER = "YOUR_SUPABASE_PUBLISHABLE_KEY";
const NETWORK_TIMEOUT_MS = 45000;
const IMAGE_RESOLVE_TIMEOUT_MS = 8000;
const IMAGE_SIGN_TIMEOUT_MS = 1500;
const BUCKET = "recipes";
const LOCAL_RECIPES_KEY = "recipes_local_data_v1";
const THEME_PREFERENCES_TABLE = "user_preferences";
const PROFILES_TABLE = "profiles";
const FRIENDSHIPS_TABLE = "friendships";
const DEFAULT_THEME = "light";
const DEFAULT_DIFFICULTY = 4;
const THEME_LOCAL_KEY_PREFIX = "storecipe_theme_";
const DEFAULT_LANGUAGE = "en";
const LANGUAGE_LOCAL_KEY_PREFIX = "storecipe_language_";
const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ru", label: "Русский", flag: "🇷🇺" }
];
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
const RECIPE_IMPORT_FUNCTION = "recipe-import";

const RECIPE_CATEGORIES = [
  "Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Drinks", "Other"
];

window.StorecipeConstants = {
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
  RECIPE_CATEGORIES
};
