function formatDate(value) {
  return new Date(value).toLocaleDateString();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function normalizeDifficulty(value, defaultDifficulty) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return defaultDifficulty;
  if (numeric < 1) return 1;
  if (numeric > 10) return 10;
  return numeric;
}

function getDifficultyLabel(value) {
  const n = Number(value);
  if (n <= 1) return "Very Easy";
  if (n <= 3) return "Easy";
  if (n <= 5) return "Medium";
  if (n <= 7) return "Hard";
  if (n <= 9) return "Very Hard";
  return "Expert";
}

function normalizeTheme(value) {
  const v = String(value).toLowerCase();
  if (v === "dark") return "dark";
  if (v === "sunset") return "sunset";
  return "light";
}

/**
 * Recipe bodies are stored as newline-separated plain text. These turn that into
 * real list markup so ingredients and steps are scannable while cooking.
 * Shared by the detail renderer and the serving scaler, which rewrites the
 * ingredient block in place and must emit identical structure.
 */
function renderIngredientListHtml(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const items = lines.map((line) => {
    // "For the sauce:" style group headings, not actual ingredients.
    const isSubhead = line.endsWith(":") && line.length <= 60;
    const cls = isSubhead ? "ingredient-list__subhead" : "ingredient-list__item";
    return `<li class="${cls}">${escapeHtml(line)}</li>`;
  });
  return `<ul class="ingredient-list">${items.join("")}</ul>`;
}

function renderMethodListHtml(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  // A single blob of prose isn't a step list — don't force a "1." onto it.
  if (lines.length === 1) {
    return `<p class="method-list__prose">${escapeHtml(lines[0])}</p>`;
  }
  const items = lines.map((line) => {
    // Strip stored numbering so the <ol> counter doesn't double up ("1. 1. Heat…").
    const cleaned = line.replace(/^\s*\d{1,2}\s*[.)]\s+/, "");
    return `<li class="method-list__step">${escapeHtml(cleaned)}</li>`;
  });
  return `<ol class="method-list">${items.join("")}</ol>`;
}

function normalizeLanguage(value) {
  const v = String(value || "").toLowerCase();
  if (v === "ru") return "ru";
  return "en";
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getDirectImageUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function getDisplayImageUrl(recipe) {
  return recipe?._resolvedImageUrl || getDirectImageUrl(recipe?.image_url);
}

function normalizeStoragePath(value, bucket) {
  if (!value) return null;
  const rawValue = String(value).trim();
  if (!rawValue) return null;

  let normalizedPath = rawValue.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(rawValue)) {
    try {
      const parsedUrl = new URL(rawValue);
      const publicPrefix = `/storage/v1/object/public/${bucket}/`;
      const signPrefix = `/storage/v1/object/sign/${bucket}/`;
      const pathname = parsedUrl.pathname;

      if (pathname.includes(publicPrefix)) {
        normalizedPath = decodeURIComponent(pathname.split(publicPrefix)[1] || "");
      } else if (pathname.includes(signPrefix)) {
        normalizedPath = decodeURIComponent(pathname.split(signPrefix)[1] || "");
      } else {
        return null;
      }
    } catch (_error) {
      return null;
    }
  }

  if (normalizedPath.startsWith(`${bucket}/`)) {
    normalizedPath = normalizedPath.slice(bucket.length + 1);
  }

  return normalizedPath || null;
}

function normalizeOptionalText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function sanitizeDigits(value, maxLength = 2) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, maxLength);
}

function formatDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minuteText = `${minutes} ${minutes === 1 ? "min" : "mins"}`;
  if (hours > 0 && minutes > 0) return `${hourText} ${minuteText}`;
  if (hours > 0) return hourText;
  return minuteText;
}

function parseDurationText(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return { hours: "", minutes: "" };

  let totalMinutes = null;

  const colonMatch = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colonMatch) {
    totalMinutes = Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
  } else {
    const hourMatch = raw.match(/(\d+)\s*h/);
    const minuteMatch = raw.match(/(\d+)\s*m/);
    if (hourMatch || minuteMatch) {
      totalMinutes = Number(hourMatch?.[1] || 0) * 60 + Number(minuteMatch?.[1] || 0);
    } else {
      const numbers = raw.match(/\d+/g) || [];
      if (numbers.length >= 2) {
        totalMinutes = Number(numbers[0]) * 60 + Number(numbers[1]);
      } else if (numbers.length === 1) {
        totalMinutes = Number(numbers[0]);
      }
    }
  }

  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return { hours: "", minutes: "" };
  }

  return {
    hours: String(Math.floor(totalMinutes / 60)),
    minutes: String(totalMinutes % 60)
  };
}

function parseTimePair(hoursRaw, minutesRaw, label, messages) {
  const hoursText = sanitizeDigits(hoursRaw);
  const minutesText = sanitizeDigits(minutesRaw);
  const msgs = messages || {};
  const hoursMaxTpl = msgs.hoursMax || "{label}: hours cannot be more than 10.";
  const minutesMaxTpl = msgs.minutesMax || "{label}: minutes cannot be more than 60.";
  const requiredTpl = msgs.required || "{label}: enter a valid value greater than 0.";
  const fmt = (tpl) => String(tpl).replace("{label}", label);

  if (!hoursText && !minutesText) {
    return {
      isEmpty: true,
      totalMinutes: null,
      message: "",
      hoursError: "",
      minutesError: "",
      pairError: ""
    };
  }

  const hours = Number(hoursText || 0);
  const minutes = Number(minutesText || 0);
  const hoursError = hours > 10 ? fmt(hoursMaxTpl) : "";
  const minutesError = minutes > 60 ? fmt(minutesMaxTpl) : "";
  const pairError =
    !hoursError && !minutesError && hours === 0 && minutes === 0
      ? fmt(requiredTpl)
      : "";
  const message = hoursError || minutesError || pairError;

  return {
    isEmpty: false,
    totalMinutes: message ? null : hours * 60 + minutes,
    message,
    hoursError: hoursError || pairError,
    minutesError: minutesError || pairError,
    pairError
  };
}

function validateServesValue(rawValue, messages) {
  const msgs = messages || {};
  const wholeNumbersMsg = msgs.wholeNumbers || "Serves: use whole numbers only.";
  const rangeMsg = msgs.range || "Serves: enter a whole number from 1 to 15.";
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return { message: "", value: null };
  }
  if (!/^\d+$/.test(value)) {
    return { message: wholeNumbersMsg, value: null };
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 15) {
    return { message: rangeMsg, value: null };
  }

  return { message: "", value: String(numeric) };
}

function normalizeImportedText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join("\n");
  }
  return String(value ?? "").trim();
}

function parseOptionalBoundedInteger(value, min, max) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function validateImageFile(file, maxSizeBytes, allowedTypes) {
  if (!file) return null;
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    const allowed = allowedTypes.map((t) => t.replace("image/", "")).join(", ");
    return `Unsupported image type "${file.type || "unknown"}". Allowed: ${allowed}.`;
  }
  if (file.size > maxSizeBytes) {
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return `Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max size: ${maxMb} MB.`;
  }
  return null;
}

function debounce(fn, delayMs) {
  let timerId;
  return function (...args) {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

window.StorecipeHelpers = {
  formatDate,
  escapeHtml,
  normalizeDifficulty,
  getDifficultyLabel,
  normalizeTheme,
  normalizeLanguage,
  renderIngredientListHtml,
  renderMethodListHtml,
  withTimeout,
  getDirectImageUrl,
  isValidHttpUrl,
  getDisplayImageUrl,
  normalizeStoragePath,
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
};
