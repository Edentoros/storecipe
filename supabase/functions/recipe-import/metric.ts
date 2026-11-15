// The metric check that runs on every import and Tidy up, after the AI: any
// pounds, ounces, cups, pints, sticks of butter, inches or °F the AI left
// become grams, millilitres, centimetres and °C, and an oven at "400°C" (an
// American 400°F with the letter swapped) becomes 200°C. Teaspoons and
// tablespoons stay. Also refuses recipes with things in them that aren't food.

import type { ImportedRecipe } from "./lib.ts";

const FRACTIONS: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const FRACTION_CHARS = "¼½¾⅓⅔⅛";
// "2", "1.5", "1,5", "1/2", "1 1/2", "½", "1½"
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`;

function readNumber(text: string): number | null {
  const s = text.trim();
  let match = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (match) return Number(match[1]) + Number(match[2]) / Number(match[3]);
  match = /^(\d+)\/(\d+)$/.exec(s);
  if (match) return Number(match[2]) ? Number(match[1]) / Number(match[2]) : null;
  const fraction = [...s].find((char) => FRACTIONS[char] !== undefined);
  if (fraction) {
    const whole = s.replace(fraction, "").trim();
    return (whole ? Number(whole.replace(",", ".")) || 0 : 0) + FRACTIONS[fraction];
  }
  const value = Number(s.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

// ── Writing metric amounts ──────────────────────────────────────────────────

const UNIT_NAMES: Record<string, Record<string, string>> = {
  en: { g: "g", kg: "kg", ml: "ml", l: "l", cm: "cm" },
  ru: { g: "г", kg: "кг", ml: "мл", l: "л", cm: "см" }
};

// Grams and millilitres the way a cook writes them: 15 g, 225 g, 900 g, 1.4 kg.
function roundMetric(value: number): number {
  const step = value < 10 ? 1 : value < 250 ? 5 : value < 1000 ? 25 : 50;
  return Math.max(step, Math.round(value / step) * step);
}

function metricNumbers(values: number[], small: "g" | "ml", language: string): string {
  const names = UNIT_NAMES[language] || UNIT_NAMES.en;
  const rounded = values.map(roundMetric);
  const big = rounded[0] >= 1000;
  const comma = language === "ru";
  const write = (value: number) => {
    const text = String(big ? Math.round(value / 100) / 10 : value);
    return comma ? text.replace(".", ",") : text;
  };
  const unit = big ? names[small === "g" ? "kg" : "l"] : names[small];
  return `${rounded.map(write).join("–")} ${unit}`;
}

// ── Cups and pints: by what's measured ──────────────────────────────────────

// Grams in a US cup of common solid ingredients (first match wins, so more
// specific names come first). Liquids become millilitres.
const CUP_GRAMS: Array<[RegExp, number]> = [
  [/cream cheese/i, 225],
  [/sour cream|cr[eè]me fra[iî]che/i, 230],
  [/peanut butter|nut butter|almond butter|tahini/i, 250],
  [/yog(?:h)?urt/i, 245],
  [/mayo(?:nnaise)?/i, 220],
  [/honey/i, 340],
  [/coconut milk|coconut cream/i, 0],
  [/(?:icing|powdered|confectioners'?) sugar/i, 120],
  [/brown sugar/i, 220],
  [/sugar/i, 200],
  [/corn ?starch|corn ?flour|starch/i, 120],
  [/flour/i, 125],
  [/buttermilk/i, 0],
  [/butter/i, 225],
  [/cocoa/i, 85],
  [/oats|oatmeal/i, 90],
  [/rice/i, 185],
  [/quinoa|couscous|bulgh?ur/i, 175],
  [/lentils/i, 190],
  [/chick ?peas|beans/i, 170],
  [/bread ?crumbs|panko/i, 60],
  [/parmesan|parmigiano|pecorino|grana padano/i, 100],
  [/ricotta|cottage cheese/i, 245],
  [/feta/i, 150],
  [/cheese|cheddar|mozzarella|gruy[eè]re|monterey/i, 110],
  [/chocolate/i, 170],
  [/nuts|almonds|walnuts|pecans|cashews|peanuts|pistachios|hazelnuts/i, 130],
  [/raisins|sultanas|cranberries|apricots|dates|dried fruit/i, 150],
  [/coconut/i, 85],
  [/seeds/i, 140],
  [/cabbage/i, 90],
  [/spinach|arugula|rocket|lettuce|kale|greens/i, 30],
  [/basil|parsley|cilantro|coriander|mint|dill|chives|herbs/i, 25],
  [/tomato/i, 180],
  [/berries|cherries|grapes/i, 150],
  [/corn/i, 165],
  [/peas/i, 145],
  [/onions?\b/i, 160],
  [/celery/i, 100],
  [/carrots?/i, 130],
  [/mushrooms/i, 70],
  [/potato/i, 150],
  [/pasta|macaroni|penne|orzo|fusilli/i, 100],
  [/noodles/i, 80],
  [/salt/i, 290]
];
const LIQUIDS = /water|milk|cream|stock|broth|\boil\b|juice|wine|vinegar|beer|coffee|\btea\b|sauce|syrup|molasses|liquor|rum|brandy|vodka|passata|liquid/i;
const CUP_ML = 240;
const PINT_ML = 475;
// A US "pint" of cherry tomatoes, berries or mushrooms is a punnet: about 300 g.
const PUNNET = /tomato|berr|cherries|grapes|mushrooms/i;
const PUNNET_GRAMS = 300;

function cupGrams(what: string): number | null {
  if (LIQUIDS.test(what) && !/cream cheese|sour cream|peanut butter|butter(?!milk)/i.test(what)) return null;
  for (const [pattern, grams] of CUP_GRAMS) {
    if (pattern.test(what)) return grams || null;
  }
  return null;
}

// ── Units ───────────────────────────────────────────────────────────────────

type Unit = "floz" | "lb" | "oz" | "gallon" | "quart" | "pint" | "cup" | "stick";
const UNITS: Array<[Unit, string]> = [
  ["floz", "fl\\.?\\s*oz\\.?|fluid\\s+ounces?"],
  ["lb", "lbs?\\.?|pounds?|фунт(?:а|ов)?"],
  ["oz", "oz\\.?|ounces?|унци(?:я|и|й)"],
  ["gallon", "gallons?|gal\\.?"],
  ["quart", "quarts?|qts?\\.?"],
  ["pint", "pints?|pts?\\.?|пинт(?:а|ы)?"],
  ["cup", "cups?"],
  ["stick", "sticks?"]
];
const AMOUNT_RE = new RegExp(
  `(?<![\\p{L}\\d.,/])(${NUM})(?:\\s*(?:-|–|to)\\s*(${NUM}))?\\s*-?\\s*(${UNITS.map(([, re]) => re).join("|")})(?![\\p{L}])`,
  "giu"
);

function unitOf(word: string): Unit {
  for (const [unit, re] of UNITS) {
    if (new RegExp(`^(?:${re})$`, "iu").test(word)) return unit;
  }
  return "cup";
}

function convertAmounts(text: string, language: string): string {
  return text.replace(AMOUNT_RE, (whole, low: string, high: string | undefined, word: string, offset: number) => {
    const values = [readNumber(low), high === undefined ? null : readNumber(high)].filter((v): v is number => v !== null);
    if (!values.length) return whole;
    // What's being measured: the rest of the line.
    const rest = text.slice(offset + whole.length, offset + whole.length + 60).split("\n")[0];
    const unit = unitOf(word);
    const grams = (factor: number) => metricNumbers(values.map((v) => v * factor), "g", language);
    const ml = (factor: number) => metricNumbers(values.map((v) => v * factor), "ml", language);
    switch (unit) {
      case "lb":
        return grams(453.6);
      case "oz":
        return grams(28.35);
      case "floz":
        return ml(29.57);
      case "gallon":
        return ml(3785);
      case "quart":
        return ml(946);
      case "pint":
        return PUNNET.test(rest) && !LIQUIDS.test(rest) ? grams(PUNNET_GRAMS) : ml(PINT_ML);
      case "stick":
        return /^\s*(?:of\s+)?(?:\w+\s+)?butter/i.test(rest) ? grams(113) : whole;
      default: {
        const perCup = cupGrams(rest);
        return perCup ? grams(perCup) : ml(CUP_ML);
      }
    }
  });
}

// ── Temperatures and lengths ────────────────────────────────────────────────

// To the nearest 10, the way recipes write oven temperatures (400°F = 200°C).
const fahrenheitToCelsius = (f: number) => Math.round(((f - 32) * 5) / 9 / 10) * 10;
// A Celsius oven in a home kitchen tops out around 250-275°C; "400°C" is a
// Fahrenheit temperature whose letter was swapped.
const looksLikeFahrenheit = (value: number) => value >= 300 && value <= 550 && value % 5 === 0;

function convertTemperatures(text: string): string {
  return text
    .replace(/(\d{2,3})\s*(?:°|º|˚)\s*F\b|(\d{2,3})\s*(?:degrees?\s*)?(?:F\b|Fahrenheit\b)/gi, (_w, a, b) => `${fahrenheitToCelsius(Number(a ?? b))}°C`)
    .replace(/(\d{3})\s*(?:°|º|˚)\s*C\b/g, (whole, value) =>
      looksLikeFahrenheit(Number(value)) ? `${fahrenheitToCelsius(Number(value))}°C` : whole
    )
    .replace(/(\d{2,3})\s*degrees?\b(?!\s*(?:C|F|Celsius|Fahrenheit)\b)/gi, (_w, value) => {
      const number = Number(value);
      return `${number >= 250 ? fahrenheitToCelsius(number) : number}°C`;
    })
    // "200°C/200°C", "200°C (200°C)" after converting "400°F/200°C"
    .replace(/(\d+°C)\s*(?:\/|or)\s*\1/g, "$1")
    .replace(/(\d+°C)\s*\(\1\)/g, "$1");
}

function centimetres(inches: number, language: string): string {
  const cm = inches * 2.54;
  const value = cm < 5 ? Math.round(cm * 2) / 2 : Math.round(cm);
  const text = String(value);
  return `${language === "ru" ? text.replace(".", ",") : text} ${(UNIT_NAMES[language] || UNIT_NAMES.en).cm}`;
}

function convertLengths(text: string, language: string): string {
  return text
    .replace(
      new RegExp(`(${NUM})\\s*(?:x|×|by)\\s*(${NUM})\\s*-?\\s*(?:inch(?:es)?|in\\.|["”])`, "giu"),
      (whole, a, b) => {
        const [w, h] = [readNumber(a), readNumber(b)];
        if (w === null || h === null) return whole;
        return `${centimetres(w, language).split(" ")[0]}×${centimetres(h, language)}`;
      }
    )
    .replace(new RegExp(`(?<![\\p{L}\\d.,/])(${NUM})\\s*-?\\s*inch(?:es)?\\b`, "giu"), (whole, a) => {
      const value = readNumber(a);
      return value === null ? whole : centimetres(value, language);
    });
}

/** A text with every imperial or US measure written in metric. */
export function toMetricText(text: string, language = "en"): string {
  if (!text) return text;
  return convertLengths(convertAmounts(convertTemperatures(text), language), language);
}

export function toMetricRecipe<T extends Pick<ImportedRecipe, "ingredients" | "method" | "notes">>(recipe: T, language = "en"): T {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((line) => toMetricText(line, language)),
    method: recipe.method.map((step) => toMetricText(step, language)),
    notes: recipe.notes ? toMetricText(recipe.notes, language) : recipe.notes
  };
}

// ── Not food ────────────────────────────────────────────────────────────────

// Things that are never an ingredient, however the AI was talked into it
// ("1 cup petrol"). Words with food uses (lye for pretzels, paraffin wax,
// tobacco onions, "until it looks like sand") aren't on the list.
const NOT_FOOD =
  /\b(petrol|gasoline|diesel|kerosene|lighter fluid|motor oil|engine oil|antifreeze|bleach|detergent|washing[- ]up liquid|dish ?soap|laundry|soap|shampoo|glue|paint|varnish|turpentine|white spirit|acetone|nail polish|drain cleaner|rat poison|poison|pesticide|insecticide|weed ?killer|fertili[sz]er|cement|toothpaste|hand sanitiser|hand sanitizer|rubbing alcohol|isopropyl|methanol)\b|(?<![\p{L}])(бензин|керосин|дизел|солярк|отбеливател|моющ\p{L}* средств|мыл[оа]\b|шампун|клей|клея|краск|растворител|ацетон|антифриз|удобрени|яд\b|цемент)/iu;
// "Edible paint", "food-grade", "пищевая краска" are food.
const FOOD_EXCEPTIONS = /edible|food[- ]grade|food colou?r|пищев/i;

/** The first ingredient that isn't food, or null. */
export function findNotFood(ingredients: string[]): string | null {
  for (const line of ingredients) {
    if (FOOD_EXCEPTIONS.test(line)) continue;
    const match = NOT_FOOD.exec(line);
    if (match) return (match[1] || match[2]).toLowerCase();
  }
  return null;
}
