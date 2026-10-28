// Cooking mode's view of a recipe: the method as separate steps, and the times
// mentioned in a step ("simmer for 10 minutes") so each can become a timer.
// English and Russian. Pure functions, no DOM.
(() => {
  // ── Steps ──────────────────────────────────────────────────────────────────

  // "1. Heat…", "2) Add…", "Step 3: Stir…", "Шаг 4. …" → the step's own text.
  const NUMBERING_RE = /^\s*(?:(?:step|шаг)\s*)?\d{1,2}\s*[.):-]?\s+/iu;

  // A paragraph is split after ". ", "! " or "? "; pieces this short (an
  // abbreviation like "approx. 5") are joined back onto the previous step.
  const MIN_SENTENCE_CHARS = 25;

  function splitSentences(text) {
    const pieces = text.split(/(?<=[.!?])\s+/u).map((s) => s.trim()).filter(Boolean);
    const steps = [];
    for (const piece of pieces) {
      if (steps.length && (piece.length < MIN_SENTENCE_CHARS || steps[steps.length - 1].length < MIN_SENTENCE_CHARS)) {
        steps[steps.length - 1] += ` ${piece}`;
      } else {
        steps.push(piece);
      }
    }
    return steps;
  }

  // The method as a list of steps: one per line, or, for a method written as
  // one paragraph, one per sentence.
  function splitSteps(method) {
    const lines = String(method ?? "")
      .split("\n")
      .map((line) => line.replace(NUMBERING_RE, "").trim())
      .filter(Boolean);
    if (lines.length === 1) return splitSentences(lines[0]);
    return lines;
  }

  // ── Times ──────────────────────────────────────────────────────────────────

  const FRACTIONS = { "\u00BC": 0.25, "\u00BD": 0.5, "\u00BE": 0.75 };
  const NUM = "\\d+(?:[.,]\\d+)?(?:\\s*[\u00BC-\u00BE])?|[\u00BC-\u00BE]";
  const RANGE = "\\s*(?:-|\u2013|\u2014|to|or|до|или)\\s*";
  const UNITS = [
    { seconds: 3600, re: "hours?|hrs?|h|часов|часа|час|ч" },
    { seconds: 60, re: "minutes?|mins?|минуты|минуту|минут|мин" },
    { seconds: 1, re: "seconds?|secs?|секунды|секунду|секунд|сек" }
  ];
  const AMOUNT_RE = new RegExp(
    `(?<![\\p{L}\\d])(${NUM})(?:${RANGE}(${NUM}))?\\s*(${UNITS.map((u) => u.re).join("|")})(?![\\p{L}\\d])`,
    "giu"
  );
  // Times written as words.
  const WORDS = [
    { re: /\bhalf an hour\b|\bhalf hour\b/giu, seconds: 1800 },
    { re: /(?<![\p{L}])полчаса(?![\p{L}])/giu, seconds: 1800 },
    { re: /\ban hour\b/giu, seconds: 3600 }
  ];
  const MAX_SECONDS = 48 * 3600;

  function readNumber(text) {
    const s = String(text).trim();
    const fraction = Object.keys(FRACTIONS).find((char) => s.includes(char));
    if (fraction) {
      const whole = s.split(fraction)[0].trim();
      return (whole ? Number(whole.replace(",", ".")) || 0 : 0) + FRACTIONS[fraction];
    }
    return Number(s.replace(",", "."));
  }

  function unitSeconds(word) {
    const unit = UNITS.find((u) => new RegExp(`^(?:${u.re})$`, "iu").test(word));
    return unit ? unit.seconds : 0;
  }

  // Times in a step: [{ start, end, seconds }], `start`/`end` being the
  // matched text's position (to highlight it). A range ("8–10 minutes") gives
  // the longer time; "1 hour 30 minutes" is one time.
  function findTimes(text) {
    const source = String(text ?? "");
    const found = [];
    for (const match of source.matchAll(AMOUNT_RE)) {
      const low = readNumber(match[1]);
      const high = match[2] !== undefined ? readNumber(match[2]) : low;
      const seconds = Math.round(Math.max(low, high) * unitSeconds(match[3]));
      if (seconds > 0) found.push({ start: match.index, end: match.index + match[0].length, seconds, unit: unitSeconds(match[3]) });
    }
    for (const word of WORDS) {
      for (const match of source.matchAll(word.re)) {
        const start = match.index;
        const end = start + match[0].length;
        if (!found.some((f) => start < f.end && end > f.start)) found.push({ start, end, seconds: word.seconds, unit: 3600 });
      }
    }
    found.sort((a, b) => a.start - b.start);

    // "1 hour 30 minutes", "1 h and 30 min", "1 час 30 минут" → one time.
    const merged = [];
    for (const time of found) {
      const previous = merged[merged.length - 1];
      const between = previous ? source.slice(previous.end, time.start) : "";
      if (previous && previous.unit > time.unit && /^\s*(?:,|and|и)?\s*$/iu.test(between)) {
        previous.end = time.end;
        previous.seconds += time.seconds;
        previous.unit = time.unit;
      } else {
        merged.push({ ...time });
      }
    }
    return merged
      .filter((time) => time.seconds <= MAX_SECONDS)
      .map(({ start, end, seconds }) => ({ start, end, seconds }));
  }

  window.StorecipeCookingSteps = { splitSteps, findTimes };
})();
