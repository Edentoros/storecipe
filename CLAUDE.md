# Storecipe

Vanilla HTML/JS/SCSS recipe app on Supabase, published by Netlify from `main`
(https://storecipe.netlify.app, built by `build.sh`).

## Workflow

- After committing and pushing to the working branch, merge to `main` and push
  without asking: the owner wants every finished change live.
- Before merging, load the built site in a headless browser and check for
  script errors: a startup error leaves the app stuck on "Loading Storecipe...",
  and `npm test` does not catch that.

## Notes

- Styles: edit `scss/style.scss`, then `npm run build:css`, and commit
  `dist/style.css` too. Drop the `sourceMappingURL` line sass adds (the
  committed CSS has none) and don't commit `dist/style.css.map`.
- Later rules in `style.scss` override earlier ones for the same elements;
  read every rule for an element before changing it.
- Every `<button>` has a default `margin-top: 1rem`; reset it on positioned or
  icon buttons.
- Tests: `npm test` (Node's built-in runner).
