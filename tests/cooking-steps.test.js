// Tests for src/js/core/cookingSteps.js (cooking mode: steps and timers)
// Run with: node --test tests/cooking-steps.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function load() {
  const code = fs.readFileSync(path.resolve(__dirname, "../src/js/core/cookingSteps.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.StorecipeCookingSteps;
}

const { splitSteps, findTimes } = load();
const plain = (value) => JSON.parse(JSON.stringify(value));
const secondsIn = (text) => findTimes(text).map((t) => t.seconds);
const matched = (text) => findTimes(text).map((t) => text.slice(t.start, t.end));

describe("splitSteps", () => {
  it("uses one step per line and drops numbering", () => {
    assert.deepEqual(plain(splitSteps("1. Heat the oil.\n2) Add the onion.\n\nStep 3: Stir.\nШаг 4. Подавайте.")), [
      "Heat the oil.",
      "Add the onion.",
      "Stir.",
      "Подавайте."
    ]);
  });

  it("splits a one-paragraph method into sentences", () => {
    assert.deepEqual(
      plain(splitSteps("Почисти картошку и свари ее в подсоленной воде. потом пожарь на сковородке добавив лук. сервировать с петрушкой сверху")),
      ["Почисти картошку и свари ее в подсоленной воде.", "потом пожарь на сковородке добавив лук.", "сервировать с петрушкой сверху"]
    );
  });

  it("keeps short pieces such as abbreviations with their sentence", () => {
    assert.deepEqual(
      plain(splitSteps("Bake for approx. 25 minutes until golden on top. Leave to cool on a rack before slicing it.")),
      ["Bake for approx. 25 minutes until golden on top.", "Leave to cool on a rack before slicing it."]
    );
  });

  it("returns nothing for an empty method", () => {
    assert.deepEqual(plain(splitSteps("")), []);
  });
});

describe("findTimes", () => {
  it("finds minutes, hours and seconds", () => {
    assert.deepEqual(plain(secondsIn("Simmer for 10 minutes.")), [600]);
    assert.deepEqual(plain(secondsIn("Bake 1 hour")), [3600]);
    assert.deepEqual(plain(secondsIn("Rest 30 seconds")), [30]);
    assert.deepEqual(plain(secondsIn("Cook 5 mins, then 2 hrs")), [300, 7200]);
  });

  it("takes the longer end of a range", () => {
    assert.deepEqual(plain(secondsIn("cook for 8–10 minutes until browned")), [600]);
    assert.deepEqual(plain(secondsIn("cook 8-10 min")), [600]);
    assert.deepEqual(plain(secondsIn("roast 1 to 2 hours")), [7200]);
  });

  it("reads fractions and decimal commas", () => {
    assert.deepEqual(plain(secondsIn("Braise for 1½ hours")), [5400]);
    assert.deepEqual(plain(secondsIn("Тушите 1,5 часа")), [5400]);
  });

  it("joins hours and minutes into one time", () => {
    assert.deepEqual(plain(secondsIn("Roast for 1 hour 30 minutes")), [5400]);
    assert.deepEqual(plain(secondsIn("Roast for 1 h and 15 min")), [4500]);
    assert.deepEqual(plain(secondsIn("Запекайте 1 час 30 минут")), [5400]);
    assert.deepEqual(plain(matched("Roast for 1 hour 30 minutes.")), ["1 hour 30 minutes"]);
  });

  it("understands times written as words", () => {
    assert.deepEqual(plain(secondsIn("Leave to rise for half an hour")), [1800]);
    assert.deepEqual(plain(secondsIn("Варите полчаса")), [1800]);
    assert.deepEqual(plain(secondsIn("Chill for an hour")), [3600]);
  });

  it("finds Russian times", () => {
    assert.deepEqual(plain(secondsIn("Варите 10 минут")), [600]);
    assert.deepEqual(plain(secondsIn("жарьте 5–7 мин")), [420]);
    assert.deepEqual(plain(secondsIn("Тушите 2 часа")), [7200]);
  });

  it("marks exactly the time in the text", () => {
    const text = "Add the mince and cook for 8–10 minutes until browned.";
    assert.deepEqual(plain(matched(text)), ["8–10 minutes"]);
  });

  it("ignores amounts and temperatures that aren't times", () => {
    assert.deepEqual(plain(secondsIn("Add 200 g flour and bake at 180°C")), []);
    assert.deepEqual(plain(secondsIn("Use 2 hmm 3 cups")), []);
    assert.deepEqual(plain(secondsIn("Add 2 minced garlic cloves")), []);
  });
});
