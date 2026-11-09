<p align="center">
  <img src="assets/icon-only.png" alt="Fern logo" width="112" height="112" />
</p>

<h1 align="center">Fern</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.android.com/"><img src="https://img.shields.io/badge/platform-Android-green.svg" alt="Platform: Android" /></a>
  <img src="https://img.shields.io/badge/version-1.0.1-orange.svg" alt="Version: 1.0.1" />
</p>

<p align="center">
  A local-first AI chat client for Android. Every prompt runs entirely on your
  device through llama.cpp, with no cloud, no account, and no telemetry.
</p>

---

## Features

- **100% offline inference** — prompts and responses never leave the phone; the app works with no network at all after the model is loaded.
- **GGUF support** — load any compatible `.gguf` model directly from device storage, with built-in download links for popular open-weight models.
- **Multi-model management** — keep several models installed, switch between them instantly, and chat with separate histories per model.
- **Custom personalities** — override the default system prompt per session to shape how the assistant behaves.
- **Fast, minimal UI** — a lightweight interface tuned for phones, with streaming responses and instant stop.

## Screenshots

> Screenshots are coming with the first release. Placeholder paths below.

| Chat | Model manager |
| ---- | ------------- |
| ![Chat screen placeholder](docs/screenshots/chat.png) | ![Model manager placeholder](docs/screenshots/models.png) |

## Installation

1. Download the latest APK from the [Releases](https://github.com/swiss9/fern/releases) page.
2. On your device, open the APK and allow installation from your browser/file manager if prompted.
3. Launch Fern and load a model:
   - Pick a `.gguf` file with the built-in model catalog (downloads when selected), or
   - Import a `.gguf` file you already have with the system file picker.
4. Start chatting — everything runs on-device.

Model recommendations: `Llama-3.2-1B (Q5_K_M)` or `Qwen2.5-1.5B (Q4_K_M)` on
phones with ~4 GB of free memory; larger models need more RAM.

## Building from Source

Requirements: Android Studio (or the Android SDK + Gradle), Node.js 18+, and
JDK 17.

```bash
git clone https://github.com/swiss9/fern.git
cd fern
npm install
npx cap sync android
```

- **Android Studio:** open the `android/` directory and run the app target.
- **CLI:** `npx cap copy android && cd android && ./gradlew assembleDebug`

The debug APK is output to `android/app/build/outputs/apk/debug/`.

## Early Access

Fern is currently in Early Access and is **100% free**. There are no ads, paywalls, or locked features.

If you find the app useful and want to support its development, you can send a donation to one of the crypto addresses below. Donations are entirely optional and go directly toward keeping the project alive.

| Network          | Address |
| ---------------- | ------- |
| TRON (TRC20)     | `TY7Tf1LaoQPE9dQK6HNx3pYDEiir5n349i` |
| BNB Smart Chain  | `0xdCE4bAEcCA99B8239A02111E8a354eF1Af1494c6` |
| Solana           | `HDnhGVB3JGBjnYy8acuhohTPUNgMHRKv3p4CsK7T1dCK` |

## License

Distributed under the [MIT License](LICENSE).
