// Tests for src/js/core/ingredientParser.js (servings scaler, shopping list)
// Run with: node --test tests/ingredient-parser.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadParser() {
  const code = fs.readFileSync(path.resolve(__dirname, "../src/js/core/ingredientParser.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.StorecipeIngredientParser;
}

const P = loadParser();
const scale = (line, from, to) => P.scaleIngredientLine(line, to / from);

describe("scaleIngredientLine", () => {
  const cases = [
    // [line, from, to, expected]
    ["2 eggs", 2, 4, "4 eggs"],
    ["1 kg potatoes", 2, 4, "2 kg potatoes"],
    ["1kg potatoes", 2, 4, "2kg potatoes"],
    ["200g flour", 2, 3, "300g flour"],
    ["1,5 кг картофеля", 2, 4, "3 кг картофеля"],
    ["1.5 kg potatoes", 2, 4, "3 kg potatoes"],
    ["2 стручка петрушки", 2, 4, "4 стручка петрушки"],
    ["2-3 cloves garlic", 2, 4, "4-6 cloves garlic"],
    ["2 – 3 cloves garlic", 2, 4, "4 – 6 cloves garlic"],
    ["½ cup milk", 2, 3, "¾ cup milk"],
    ["1 1/2 tbsp oil", 2, 4, "3 tbsp oil"],
    ["5 tbsp soy sauce", 4, 2, "2½ tbsp soy sauce"],
    ["1 tsp chili flakes", 4, 3, "¾ tsp chili flakes"],
    ["2 ст. л. сахара", 2, 3, "3 ст. л. сахара"],
    ["1 ч.л. соли", 2, 4, "2 ч.л. соли"],
    ["5 g fresh ginger, sliced", 2, 4, "10 g fresh ginger, sliced"],
    ["1 x 400g can tomatoes", 2, 4, "2 x 400g can tomatoes"]
  ];
  for (const [line, from, to, expected] of cases) {
    it(`${line} (${from} → ${to})`, () => {
      const result = scale(line, from, to);
      assert.equal(result.text, expected);
      assert.equal(result.status, "scaled");
    });
  }

  it("scales every ingredient on a line with several", () => {
    assert.equal(
      scale("1kg of potatoes, 2 big onions, 2 стручка петрушки", 2, 4).text,
      "2kg of potatoes, 4 big onions, 4 стручка петрушки"
    );
  });

  it("switches between g and kg, ml and l", () => {
    assert.equal(scale("500 g mince", 2, 6).text, "1.5 kg mince");
    assert.equal(scale("500 г фарша", 2, 6).text, "1,5 кг фарша");
    assert.equal(scale("1 kg potatoes", 2, 1).text, "500 g potatoes");
    assert.equal(scale("1,5 кг картофеля", 4, 2).text, "750 г картофеля");
    assert.equal(scale("750 ml stock", 2, 4).text, "1.5 l stock");
  });

  it("rounds metric amounts to a sensible step", () => {
    assert.equal(scale("333 ml milk", 3, 4).text, "440 ml milk");
    assert.equal(scale("15 g butter", 3, 4).text, "20 g butter");
    assert.equal(scale("7 g yeast", 2, 3).text, "11 g yeast");
    assert.equal(scale("3 g salt", 2, 3).text, "4.5 g salt");
  });

  it("rounds counted items to whole numbers or halves", () => {
    assert.equal(scale("3 eggs", 2, 3).text, "5 eggs");
    assert.equal(scale("1 large onion", 2, 3).text, "1½ large onion");
    assert.equal(scale("1 egg", 4, 1).text, "½ egg");
  });

  it("leaves lines without an amount alone", () => {
    assert.deepEqual({ ...scale("Salt to taste", 2, 4) }, { text: "Salt to taste", status: "plain" });
    assert.deepEqual({ ...scale("For the sauce:", 2, 4) }, { text: "For the sauce:", status: "plain" });
  });

  it("flags lines with a number it can't place", () => {
    assert.deepEqual({ ...scale("Juice of 2 lemons", 2, 4) }, { text: "Juice of 2 lemons", status: "unadjusted" });
  });

  it("doesn't treat a number glued to a word as an amount", () => {
    assert.equal(scale("3rd jar of pickles", 2, 4).status, "unadjusted");
  });

  it("returns lines unchanged at the original servings", () => {
    assert.equal(scale("2 eggs", 4, 4).text, "2 eggs");
  });
});

describe("scaleIngredientList", () => {
  it("drops blank lines and scales the rest", () => {
    const lines = P.scaleIngredientList("2 eggs\n\nSalt\n", 2, 4);
    assert.deepEqual([...lines.map((l) => l.text)], ["4 eggs", "Salt"]);
  });

  it("returns lines unchanged for missing servings", () => {
    assert.equal(P.scaleIngredients("2 eggs", 0, 4), "2 eggs");
  });
});

describe("parseIngredientLine", () => {
  it("reads quantity, unit and name", () => {
    const parsed = P.parseIngredientLine("1kg potatoes");
    assert.equal(parsed.quantity, 1);
    assert.equal(parsed.unit, "kg");
    assert.equal(parsed.name, "potatoes");
  });

  it("reads decimal commas", () => {
    assert.equal(P.parseIngredientLine("1,5 кг картофеля").quantity, 1.5);
  });

  it("returns no quantity for plain lines", () => {
    assert.equal(P.parseIngredientLine("Salt").quantity, null);
  });
});

describe("splitIngredientsLine", () => {
  it("splits several ingredients with amounts", () => {
    assert.deepEqual(
      [...P.splitIngredientsLine("1kg of potatoes, 2 big onions, 2 стручка петрушки")],
      ["1kg of potatoes", "2 big onions", "2 стручка петрушки"]
    );
  });

  it("keeps a preparation note after a comma", () => {
    assert.deepEqual([...P.splitIngredientsLine("5 g ginger, sliced")], ["5 g ginger, sliced"]);
  });
});

describe("nextServings", () => {
  it("moves through even numbers", () => {
    assert.equal(P.nextServings(2, 1), 4);
    assert.equal(P.nextServings(4, 1), 6);
    assert.equal(P.nextServings(6, -1), 4);
  });

  it("snaps an odd count to the next even number either way", () => {
    assert.equal(P.nextServings(3, 1), 4);
    assert.equal(P.nextServings(3, -1), 2);
    assert.equal(P.nextServings(1, 1), 2);
  });

  it("stays between 2 and 98", () => {
    assert.equal(P.nextServings(2, -1), 2);
    assert.equal(P.nextServings(1, -1), 2);
    assert.equal(P.nextServings(98, 1), 98);
  });
});

describe("decimalToFraction", () => {
  it("writes kitchen fractions", () => {
    assert.equal(P.decimalToFraction(0.5), "½");
    assert.equal(P.decimalToFraction(1.25), "1¼");
    assert.equal(P.decimalToFraction(2), "2");
  });
});

describe("scaleAmountsInText", () => {
  const scaled = (text, ratio) =>
    P.scaleAmountsInText(text, ratio).map((piece) => (piece.scaled ? `[${piece.text}]` : piece.text)).join("");

  it("scales weights, volumes and spoons in a method step", () => {
    assert.equal(scaled("Add 500 g of the mince and 2 tbsp oil.", 2), "Add [1 kg] of the mince and [4 tbsp] oil.");
    assert.equal(scaled("Pour in 400ml stock and 1 1/2 cups water", 2), "Pour in [800ml] stock and [3 cups] water");
    assert.equal(scaled("Добавьте 1,5 кг картошки и 2 ст. л. масла", 0.5), "Добавьте [750 г] картошки и [1 ст. л.] масла");
  });

  it("leaves times, temperatures and plain numbers alone", () => {
    const text = "Cut into 4 pieces, add 2 eggs and bake for 8–10 minutes at 180°C, gas mark 6.";
    assert.equal(scaled(text, 2), text);
  });

  it("changes nothing at the original servings", () => {
    assert.equal(scaled("Add 500 g mince", 1), "Add 500 g mince");
  });
});
