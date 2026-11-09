# Contributing to Fern

Thank you for considering a contribution. Fern is a small, focused app, so
most changes are best kept minimal and deliberate. Here's how to get started.

## Getting set up

1. Fork the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm install
   npx cap sync android
   ```
3. Open `android/` in Android Studio, or build from the CLI with
   `./gradlew assembleDebug`.

## Found a bug or have an idea?

- Search the [issue tracker](https://github.com/swiss9/fern/issues) first; if
  nothing matches, open a bug report or feature request using the provided
  templates.
- For larger features, open an issue to discuss the approach before writing
  code.

## Making a pull request

1. Create a branch from `main` with a short descriptive name,
   e.g. `fix/stop-button-race` or `feat/markdown-render`.
2. Keep the change scoped. One pull request per feature or fix.
3. Test on a real device if possible, ideally with the smallest model you have
   available (`Llama-3.2-1B` is a good baseline for AI behavior changes).
4. Clearly describe what the PR changes and why; note any device you tested
   on.

## Code style

- Plain ES2020 JavaScript in `www/app.js`; no bundler, no TypeScript, no
  frameworks. Keep it that way so the WebView loads directly.
- Prefer small, named functions over inline logic. Follow the existing naming
  and spacing conventions rather than introducing new ones.
- Comments explain *why*, not *what*. Skip them when the code is obvious.
- UI styling uses Tailwind utility classes in `www/index.html`; regenerate CSS
  with `npx tailwindcss -i ./src/input.css -o ./www/styles.css --minify` and
  run `npx cap copy android` before committing.
- Never add network calls, analytics, or new permissions. Fern's promise is
  zero telemetry — that constraint will not be traded away.

## License

By contributing, you agree that your changes are released under the project's
[MIT License](LICENSE).
