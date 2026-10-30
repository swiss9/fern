# Privacy Policy

Fern is a local-first application. This policy explains exactly what happens to
your data: in short, **nothing leaves your device**.

## Zero telemetry

Fern does **not** collect, transmit, or sell any telemetry, analytics, crash
reports, or usage data. There are no tracking SDKs, no advertising identifiers,
and no third-party analytics services embedded in the app.

## Local-only storage

All of the following are stored only in the app's private storage on your device:

- Chat sessions and message history
- Model files (`.gguf`) you import
- App settings, model aliases, and system prompts

Fern does not upload this data anywhere. It is not synced to a server and is not
shared with the developer or any third party.

## Network access

Fern requests the `INTERNET` permission because it is a WebView-based app and may
load local assets. Model inference itself runs entirely on-device via
`llama.cpp`; your prompts and responses are never sent to a remote server.

## Permissions

- **Storage (read only, Android 12 and below):** used to let you pick and import
  model files from your device.
- **Notifications / foreground service:** used only to show progress while
  downloading or importing a model, and to keep long-running local inference
  alive.
- **Wake lock:** used to keep the device awake during local generation.

Fern does not request write access to external storage.

## Backups

Android backup is disabled for Fern (`android:allowBackup="false"`), so app data
is not included in cloud or device backups.

## Children's privacy

Fern does not knowingly collect any personal information from anyone, including
children, because it does not collect personal information at all.

## Changes

If this policy changes, the updated version will be published in this repository.
Because Fern collects no data, any future change will preserve the core principle
of local-only operation.

## Contact

Questions about privacy? Open an issue at
[github.com/swiss9/fern](https://github.com/swiss9/fern).
