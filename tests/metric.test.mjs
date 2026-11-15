// Tests for supabase/functions/recipe-import/metric.ts (imperial → metric, not food)
// Run with: node --test tests/metric.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { toMetricText, toMetricRecipe, findNotFood } = await import(
  new URL("../supabase/functions/recipe-import/metric.ts", import.meta.url).href
);

describe("toMetricText", () => {
  const cases = [
    // The recipe that started it (badbatchbaking.com, feta tomato pasta).
    ["2 lb salmon fillets, skinless and boneless", "900 g salmon fillets, skinless and boneless"],
    ["8- ounce feta block", "225 g feta block"],
    ["2 pints cherry tomatoes", "600 g cherry tomatoes"],
    ["5 oz fresh baby spinach", "140 g fresh baby spinach"],
    ["1 cup fresh basil, chiffonade", "25 g fresh basil, chiffonade"],
    ["1/2 cup parmesan cheese, grated", "50 g parmesan cheese, grated"],
    ["Preheat the oven to 400°C.", "Preheat the oven to 200°C."],
    ["Reserve 1/2 cup pasta water before draining.", "Reserve 120 ml pasta water before draining."],
    // Others.
    ["2 cups all-purpose flour", "250 g all-purpose flour"],
    ["1 1/2 cups whole milk", "350 ml whole milk"],
    ["1 stick unsalted butter, softened", "115 g unsalted butter, softened"],
    ["1 (14-ounce) can coconut milk", "1 (400 g) can coconut milk"],
    ["3/4 cup brown sugar", "165 g brown sugar"],
    ["1 pint heavy cream", "475 ml heavy cream"],
    ["Preheat oven to 350°F (180°C).", "Preheat oven to 180°C."],
    ["Bake at 425 degrees F for 20 minutes.", "Bake at 220°C for 20 minutes."],
    ["Heat the oven to 400 degrees.", "Heat the oven to 200°C."],
    ["Grease a 9x13-inch pan.", "Grease a 23×33 cm pan."],
    ["Cut into 1-inch pieces.", "Cut into 2.5 cm pieces."]
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => assert.equal(toMetricText(input), expected));
  }

  it("leaves metric, spoons and plain counts alone", () => {
    for (const text of ["2 tbsp pesto", "1/2 tsp salt", "1 lemon, juice", "Roast at 200°C (180°C fan).", "Bake for 25 minutes.", "250 g flour", "Pizza at 250°C"]) {
      assert.equal(toMetricText(text), text);
    }
  });

  it("writes Russian units", () => {
    assert.equal(toMetricText("1 фунт говядины", "ru"), "450 г говядины");
    assert.equal(toMetricText("3 lb potatoes", "ru"), "1,4 кг potatoes");
  });

  it("converts the ingredients, the method and the notes", () => {
    const recipe = toMetricRecipe({ ingredients: ["1 lb pasta"], method: ["Bake at 375°F."], notes: "Use a 9-inch pan." });
    assert.deepEqual(recipe, { ingredients: ["450 g pasta"], method: ["Bake at 190°C."], notes: "Use a 23 cm pan." });
  });
});

describe("findNotFood", () => {
  it("finds things that aren't food", () => {
    assert.equal(findNotFood(["1 cup sugar", "2 tbsp petrol"]), "petrol");
    assert.equal(findNotFood(["100 ml бензина"]), "бензин");
    assert.equal(findNotFood(["a splash of bleach"]), "bleach");
  });

  it("leaves food alone, including words that only look alike", () => {
    assert.equal(findNotFood(["1 tsp edible gold paint", "1 tbsp soapberry", "tobacco onions", "sandwich bread", "1 glass red wine", "пищевая краска"]), null);
  });
});
