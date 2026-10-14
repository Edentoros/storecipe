// Tests for src/js/core/helpers.js
// Run with: node --test tests/helpers.test.js
// Requires Node 18+ (built-in test runner)

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadHelpers() {
  const code = fs.readFileSync(path.resolve(__dirname, "../src/js/core/helpers.js"), "utf8");
  const sandbox = { window: {}, document: { createElement: () => ({ set textContent(v) { this._t = v; }, get innerHTML() { return this._t; } }) }, URL };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.StorecipeHelpers;
}

const helpers = loadHelpers();

// --- formatDuration ---
describe("formatDuration", () => {
  it("returns empty string for zero or negative", () => {
    assert.equal(helpers.formatDuration(0), "");
    assert.equal(helpers.formatDuration(-5), "");
  });

  it("formats minutes only", () => {
    assert.equal(helpers.formatDuration(30), "30 mins");
    assert.equal(helpers.formatDuration(1), "1 min");
  });

  it("formats hours only", () => {
    assert.equal(helpers.formatDuration(60), "1 hour");
    assert.equal(helpers.formatDuration(120), "2 hours");
  });

  it("formats hours and minutes", () => {
    assert.equal(helpers.formatDuration(90), "1 hour 30 mins");
    assert.equal(helpers.formatDuration(121), "2 hours 1 min");
  });
});

// --- parseDurationText ---
// Results come from the vm sandbox, whose objects have a different prototype;
// copy them into this realm so deepEqual compares values only.
const parseDuration = (value) => ({ ...helpers.parseDurationText(value) });
describe("parseDurationText", () => {
  it("returns empty for blank input", () => {
    assert.deepEqual(parseDuration(""), { hours: "", minutes: "" });
    assert.deepEqual(parseDuration(null), { hours: "", minutes: "" });
  });

  it("parses colon format", () => {
    assert.deepEqual(parseDuration("1:30"), { hours: "1", minutes: "30" });
  });

  it("parses h/m format", () => {
    assert.deepEqual(parseDuration("2h 15m"), { hours: "2", minutes: "15" });
  });

  it("parses minutes-only number", () => {
    assert.deepEqual(parseDuration("45"), { hours: "0", minutes: "45" });
  });

  it("parses Russian units", () => {
    assert.deepEqual(parseDuration("1 час"), { hours: "1", minutes: "0" });
    assert.deepEqual(parseDuration("1 час 15 минут"), { hours: "1", minutes: "15" });
    assert.deepEqual(parseDuration("40 мин"), { hours: "0", minutes: "40" });
  });

  it("parses two numbers as hours and minutes", () => {
    assert.deepEqual(parseDuration("1 30"), { hours: "1", minutes: "30" });
  });
});

// --- normalizeDifficulty ---
describe("normalizeDifficulty", () => {
  it("clamps below 1 to 1", () => {
    assert.equal(helpers.normalizeDifficulty(0, 4), 1);
    assert.equal(helpers.normalizeDifficulty(-5, 4), 1);
  });

  it("clamps above 10 to 10", () => {
    assert.equal(helpers.normalizeDifficulty(15, 4), 10);
  });

  it("returns default for non-integer", () => {
    assert.equal(helpers.normalizeDifficulty("abc", 4), 4);
    assert.equal(helpers.normalizeDifficulty(NaN, 7), 7);
  });

  it("accepts valid values", () => {
    assert.equal(helpers.normalizeDifficulty(5, 4), 5);
    assert.equal(helpers.normalizeDifficulty(1, 4), 1);
    assert.equal(helpers.normalizeDifficulty(10, 4), 10);
  });
});

// --- normalizeStoragePath ---
describe("normalizeStoragePath", () => {
  const bucket = "recipes";

  it("returns null for empty input", () => {
    assert.equal(helpers.normalizeStoragePath("", bucket), null);
    assert.equal(helpers.normalizeStoragePath(null, bucket), null);
  });

  it("strips bucket prefix", () => {
    assert.equal(helpers.normalizeStoragePath("recipes/user1/image.jpg", bucket), "user1/image.jpg");
  });

  it("strips leading slashes", () => {
    assert.equal(helpers.normalizeStoragePath("/user1/image.jpg", bucket), "user1/image.jpg");
  });

  it("extracts path from public URL", () => {
    const url = "https://example.supabase.co/storage/v1/object/public/recipes/user1/img.jpg";
    assert.equal(helpers.normalizeStoragePath(url, bucket), "user1/img.jpg");
  });

  it("returns null for unrelated URL", () => {
    assert.equal(helpers.normalizeStoragePath("https://example.com/image.jpg", bucket), null);
  });
});

// --- parseTimePair ---
describe("parseTimePair", () => {
  it("returns empty result for blank inputs", () => {
    const result = helpers.parseTimePair("", "", "Prep");
    assert.equal(result.isEmpty, true);
    assert.equal(result.totalMinutes, null);
  });

  it("calculates total minutes", () => {
    const result = helpers.parseTimePair("1", "30", "Prep");
    assert.equal(result.isEmpty, false);
    assert.equal(result.totalMinutes, 90);
    assert.equal(result.message, "");
  });

  it("rejects hours > 10", () => {
    const result = helpers.parseTimePair("11", "0", "Prep");
    assert.ok(result.message.includes("hours"));
    assert.equal(result.totalMinutes, null);
  });

  it("rejects minutes > 60", () => {
    const result = helpers.parseTimePair("0", "61", "Cook");
    assert.ok(result.message.includes("minutes"));
    assert.equal(result.totalMinutes, null);
  });

  it("rejects 0h 0m", () => {
    const result = helpers.parseTimePair("0", "0", "Prep");
    assert.ok(result.message.includes("greater than 0"));
  });
});

// --- validateServesValue ---
describe("validateServesValue", () => {
  it("accepts empty as optional", () => {
    const result = helpers.validateServesValue("");
    assert.equal(result.message, "");
    assert.equal(result.value, null);
  });

  it("accepts valid number", () => {
    const result = helpers.validateServesValue("4");
    assert.equal(result.message, "");
    assert.equal(result.value, "4");
  });

  it("rejects non-numeric", () => {
    const result = helpers.validateServesValue("abc");
    assert.ok(result.message);
    assert.equal(result.value, null);
  });

  it("rejects out of range", () => {
    assert.ok(helpers.validateServesValue("0").message);
    assert.ok(helpers.validateServesValue("16").message);
  });
});

// --- validateImageFile ---
describe("validateImageFile", () => {
  const maxSize = 5 * 1024 * 1024;
  const allowed = ["image/jpeg", "image/png"];

  it("returns null for valid file", () => {
    const file = { type: "image/jpeg", size: 1000 };
    assert.equal(helpers.validateImageFile(file, maxSize, allowed), null);
  });

  it("rejects wrong type", () => {
    const file = { type: "application/pdf", size: 1000 };
    const msg = helpers.validateImageFile(file, maxSize, allowed);
    assert.ok(msg.includes("Unsupported"));
  });

  it("rejects oversized file", () => {
    const file = { type: "image/png", size: 10 * 1024 * 1024 };
    const msg = helpers.validateImageFile(file, maxSize, allowed);
    assert.ok(msg.includes("too large"));
  });

  it("returns null for null file", () => {
    assert.equal(helpers.validateImageFile(null, maxSize, allowed), null);
  });
});

// --- isValidHttpUrl ---
describe("isValidHttpUrl", () => {
  it("accepts http", () => assert.equal(helpers.isValidHttpUrl("http://example.com"), true));
  it("accepts https", () => assert.equal(helpers.isValidHttpUrl("https://example.com"), true));
  it("rejects ftp", () => assert.equal(helpers.isValidHttpUrl("ftp://example.com"), false));
  it("rejects empty", () => assert.equal(helpers.isValidHttpUrl(""), false));
  it("rejects null", () => assert.equal(helpers.isValidHttpUrl(null), false));
});

// --- normalizeOptionalText ---
describe("normalizeOptionalText", () => {
  it("returns null for empty", () => assert.equal(helpers.normalizeOptionalText(""), null));
  it("returns null for null", () => assert.equal(helpers.normalizeOptionalText(null), null));
  it("trims whitespace", () => assert.equal(helpers.normalizeOptionalText("  hello  "), "hello"));
});

// --- sanitizeDigits ---
describe("sanitizeDigits", () => {
  it("strips non-digits", () => assert.equal(helpers.sanitizeDigits("12abc34"), "12"));
  it("respects maxLength", () => assert.equal(helpers.sanitizeDigits("12345", 3), "123"));
  it("handles null", () => assert.equal(helpers.sanitizeDigits(null), ""));
});
