// Reads amounts in ingredient lines and scales them for a different number of
// servings. Handles "1kg" and "1 kg", decimal commas ("1,5 кг"), fractions
// ("1½", "1 1/2"), ranges ("2-3"), English and Russian units, and several
// ingredients on one line ("1kg potatoes, 2 onions"). Results are rounded the
// way a cook would write them: grams to a sensible step, kg above 1000 g, eggs
// to whole or half, spoons and cups to kitchen fractions.
(() => {
  const FRACTION_MAP = {
    "¼": 0.25, "½": 0.5, "¾": 0.75,
    "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125,
    "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8
  };
  const FRACTION_CHARS = "¼-¾⅐-⅞";

  // One number: "2", "1.5", "1,5", "1/2", "½", "1½", "1 ½", "1 1/2".
  const NUM = `(?:\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTION_CHARS}]|\\s+\\d+\\s*\\/\\s*\\d+)?|\\d+\\s*\\/\\s*\\d+|[${FRACTION_CHARS}])`;
  // An optional range: "2-3", "2 – 3", "2 to 3", "2 до 3", "2 or 3".
  const RANGE_SEP = "(?:\\s*[-–—]\\s*|\\s+(?:to|or|до|или)\\s+)";

  // Units that change how a result is rounded or written. Anything else after
  // the number ("big onions", "зубчика чеснока") is part of the name, and the
  // amount is treated as a count.
  const UNITS = [
    { kind: "mass", size: "small", re: "grams?|gr|g|граммов|грамма|грамм|гр|г" },
    { kind: "mass", size: "big", re: "kilograms?|kilos?|kg|килограммов|килограмма|килограмм|кг" },
    { kind: "volume", size: "small", re: "millilit(?:re|er)s?|ml|миллилитров|миллилитра|миллилитр|мл" },
    { kind: "volume", size: "big", re: "lit(?:re|er)s?|l|литров|литра|литр|л" },
    {
      kind: "spoon",
      re: "tablespoons?|teaspoons?|tbsps?|tsps?|tbs|cups?|ст\\.?\\s?л\\.?|ч\\.?\\s?л\\.?|столов(?:ая|ые|ых)\\s+лож(?:ка|ки|ек)|чайн(?:ая|ые|ых)\\s+лож(?:ка|ки|ек)|стакан(?:а|ов)?"
    },
    { kind: "imperial", re: "ounces?|oz|pounds?|lbs?" },
    { kind: "count", re: "pcs|pieces?|шт\\.?|штук(?:и)?" }
  ];
  const UNIT_RE = new RegExp(
    `^(\\s*)(${UNITS.map((u) => u.re).join("|")})(?=[^\\p{L}]|$)`,
    "iu"
  );
  const AMOUNT_RE = new RegExp(`^(${NUM})(?:(${RANGE_SEP})(${NUM}))?`, "u");

  function fractionToDecimal(str) {
    const s = String(str).trim();
    if (FRACTION_MAP[s] !== undefined) return FRACTION_MAP[s];
    const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const den = Number(m[2]);
      return den !== 0 ? Number(m[1]) / den : null;
    }
    const n = Number(s.replace(",", "."));
    return isFinite(n) && s !== "" ? n : null;
  }

  // Reads one number in any of the NUM forms above.
  function parseQuantity(raw) {
    let s = String(raw).trim();
    if (!s) return null;
    for (const [char, val] of Object.entries(FRACTION_MAP)) {
      if (s.includes(char)) {
        const whole = s.split(char)[0].trim();
        return (whole ? Number(whole.replace(",", ".")) || 0 : 0) + val;
      }
    }
    const mixed = s.match(/^(\d+)\s+(\d+\s*\/\s*\d+)$/);
    if (mixed) {
      const frac = fractionToDecimal(mixed[2]);
      return frac !== null ? Number(mixed[1]) + frac : null;
    }
    // "2-3": the first number (kept for callers that only want one).
    const range = s.match(new RegExp(`^(${NUM})${RANGE_SEP}`, "u"));
    if (range) return parseQuantity(range[1]);
    return fractionToDecimal(s);
  }

  function decimalToFraction(n) {
    if (n === 0) return "0";
    const whole = Math.floor(n);
    const frac = n - whole;
    if (frac < 0.05) return String(whole || "0");
    if (frac > 0.95) return String(whole + 1);
    const fractions = [
      [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"],
      [0.375, "⅜"], [0.5, "½"], [5 / 8, "⅝"],
      [2 / 3, "⅔"], [0.75, "¾"], [7 / 8, "⅞"]
    ];
    let closest = null;
    let minDiff = Infinity;
    for (const [val, sym] of fractions) {
      const diff = Math.abs(frac - val);
      if (diff < minDiff) {
        minDiff = diff;
        closest = sym;
      }
    }
    if (minDiff < 0.05) {
      return whole > 0 ? `${whole}${closest}` : closest;
    }
    return String(Math.round(n * 100) / 100);
  }

  function findUnit(text) {
    const match = String(text).match(UNIT_RE);
    if (!match) return null;
    const word = match[2];
    const unit = UNITS.find((u) => new RegExp(`^(?:${u.re})$`, "iu").test(word));
    return { space: match[1], text: word, kind: unit.kind, size: unit.size || null, length: match[0].length };
  }

  // Reads the amount at the start of `text`, or null if it doesn't start with one.
  function readAmount(text) {
    const match = String(text).match(AMOUNT_RE);
    if (!match) return null;
    const low = parseQuantity(match[1]);
    if (low === null) return null;
    const high = match[3] !== undefined ? parseQuantity(match[3]) : null;
    if (match[3] !== undefined && high === null) return null;
    const afterNumber = text.slice(match[0].length);
    const unit = findUnit(afterNumber);
    // A number glued to a word that isn't a unit ("3rd", "2x") isn't an amount.
    if (!unit && /^\p{L}/u.test(afterNumber) && !/^[x×]\s/i.test(afterNumber)) return null;
    return {
      low,
      high,
      rangeSep: match[2] || "",
      decimalComma: /\d,\d/.test(match[0]),
      unit,
      rest: unit ? afterNumber.slice(unit.length) : afterNumber
    };
  }

  // ── Rounding and writing amounts ────────────────────────────────────────────

  function isCyrillic(text) {
    return /[Ѐ-ӿ]/.test(String(text || ""));
  }

  function formatDecimal(n, comma) {
    const text = String(Math.round(n * 100) / 100);
    return comma ? text.replace(".", ",") : text;
  }

  // Grams or millilitres: a step that keeps the amount within a few percent.
  function roundMetric(v) {
    const step = v < 10 ? 0.5 : v < 20 ? 1 : v < 100 ? 5 : v < 1000 ? 10 : 50;
    return Math.max(step, Math.round(v / step) * step);
  }

  // Eggs, onions, pieces: halves for small numbers, whole numbers above that.
  function roundCount(v) {
    return v < 3 ? Math.max(0.5, Math.round(v * 2) / 2) : Math.round(v);
  }

  const METRIC_NAMES = {
    mass: { small: ["g", "г"], big: ["kg", "кг"] },
    volume: { small: ["ml", "мл"], big: ["l", "л"] }
  };

  // Writes scaled amount(s) and returns { amount, unitText }.
  function formatScaled(values, amount) {
    const unit = amount.unit;
    const comma = amount.decimalComma;

    if (unit && (unit.kind === "mass" || unit.kind === "volume")) {
      // Work in grams/millilitres, then switch to kg/l at 1000 and back below 1.
      const toSmall = unit.size === "big" ? 1000 : 1;
      const small = values.map((v) => roundMetric(v * toSmall));
      const useBig = small[0] >= 1000;
      const nums = useBig ? small.map((v) => v / 1000) : small;
      const sameSize = (useBig ? "big" : "small") === unit.size;
      const ru = isCyrillic(unit.text);
      const unitText = sameSize ? unit.text : METRIC_NAMES[unit.kind][useBig ? "big" : "small"][ru ? 1 : 0];
      return { nums: nums.map((n) => formatDecimal(n, comma || ru)), unitText };
    }
    if (!unit || unit.kind === "count") {
      return { nums: values.map((v) => decimalToFraction(roundCount(v))), unitText: unit ? unit.text : "" };
    }
    // Spoons, cups, ounces, pounds: kitchen fractions.
    return { nums: values.map((v) => decimalToFraction(v)), unitText: unit.text };
  }

  function scaleAmount(amount, ratio) {
    const values = [amount.low * ratio];
    if (amount.high !== null) values.push(amount.high * ratio);
    const { nums, unitText } = formatScaled(values, amount);
    const number = nums.length === 2 ? `${nums[0]}${amount.rangeSep}${nums[1]}` : nums[0];
    const unitPart = amount.unit ? `${amount.unit.space}${unitText}` : "";
    return `${number}${unitPart}${amount.rest}`;
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  function isSubheading(line) {
    return line.endsWith(":") && line.length <= 60;
  }

  // Splits "1kg potatoes, 2 onions" into ingredients, keeping the separators.
  // Only ", " and "; " followed by a number start a new ingredient, so
  // "5 g ginger, sliced" stays one.
  function splitSegments(line) {
    return line.split(/((?:,|;)\s+)(?=[\d¼-¾⅐-⅞])/u);
  }

  // Scales one line. status: "scaled", "unadjusted" (it has a number we
  // couldn't place, e.g. "Juice of 2 lemons"), or "plain" (nothing to scale,
  // e.g. "Salt to taste" or a heading).
  function scaleIngredientLine(line, ratio) {
    const text = String(line).trim();
    if (!text || isSubheading(text) || ratio === 1) return { text, status: "plain" };
    const parts = splitSegments(text);
    let scaledAny = false;
    let missed = false;
    for (let i = 0; i < parts.length; i += 2) {
      const amount = readAmount(parts[i]);
      if (amount) {
        parts[i] = scaleAmount(amount, ratio);
        scaledAny = true;
      } else if (/\d/.test(parts[i])) {
        missed = true;
      }
    }
    if (missed) return { text, status: "unadjusted" };
    return { text: parts.join(""), status: scaledAny ? "scaled" : "plain" };
  }

  // The ingredient lines (blank lines dropped) scaled from one number of
  // servings to another.
  function scaleIngredientList(ingredientsText, originalServes, newServes) {
    const origNum = Number(originalServes);
    const newNum = Number(newServes);
    const ratio = origNum > 0 && newNum > 0 ? newNum / origNum : 1;
    return String(ingredientsText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => scaleIngredientLine(line, ratio));
  }

  // Amounts inside a sentence ("add 500 g of the mince and 2 tbsp oil") scaled
  // by `ratio`, for the method. Only amounts with a weight, volume or spoon
  // unit change: a bare number ("cut into 4", "180°C", "gas mark 6") or a time
  // is left alone. Returns the text in pieces: [{ text, scaled }].
  function scaleAmountsInText(text, ratio) {
    const source = String(text ?? "");
    if (ratio === 1 || !source) return [{ text: source, scaled: false }];
    const pieces = [];
    let at = 0;
    const starts = new RegExp(`(?<![\\p{L}\\d.,/${FRACTION_CHARS}])[\\d${FRACTION_CHARS}]`, "gu");
    for (const match of source.matchAll(starts)) {
      if (match.index < at) continue;
      const amount = readAmount(source.slice(match.index));
      if (!amount || !amount.unit || amount.unit.kind === "count") continue;
      const length = source.length - match.index - amount.rest.length;
      if (match.index > at) pieces.push({ text: source.slice(at, match.index), scaled: false });
      pieces.push({ text: scaleAmount({ ...amount, rest: "" }, ratio), scaled: true });
      at = match.index + length;
    }
    if (at < source.length) pieces.push({ text: source.slice(at), scaled: false });
    return pieces;
  }

  function scaleIngredients(ingredientsText, originalServes, newServes) {
    return scaleIngredientList(ingredientsText, originalServes, newServes).map((l) => l.text).join("\n");
  }

  // { quantity, unit, name, raw } for the shopping list.
  function parseIngredientLine(line) {
    const raw = String(line).trim();
    if (!raw) return { quantity: null, unit: null, name: "", raw };
    const amount = readAmount(raw);
    if (!amount) return { quantity: null, unit: null, name: raw, raw };
    return {
      quantity: amount.low,
      unit: amount.unit ? amount.unit.text.toLowerCase() : null,
      name: amount.rest.trim() || raw,
      raw
    };
  }

  // True when a single line holds several ingredients with their own amounts,
  // e.g. "1kg potatoes, 2 big onions, 2 стручка петрушки".
  function splitIngredientsLine(line) {
    const parts = splitSegments(String(line).trim());
    const items = [];
    for (let i = 0; i < parts.length; i += 2) items.push(parts[i].trim());
    return items.filter(Boolean);
  }

  // The servings scaler moves through even numbers (2, 4, 6…), from 2 to 98;
  // an odd count (a recipe for 3) moves to the next even one either way.
  function nextServings(current, direction) {
    const n = Math.round(Number(current)) || 2;
    if (direction > 0) return Math.min(98, n % 2 ? n + 1 : n + 2);
    return Math.max(2, n % 2 ? n - 1 : n - 2);
  }

  window.StorecipeIngredientParser = {
    nextServings,
    parseIngredientLine,
    parseQuantity,
    decimalToFraction,
    scaleIngredientLine,
    scaleIngredientList,
    scaleIngredients,
    scaleAmountsInText,
    splitIngredientsLine
  };
})();
