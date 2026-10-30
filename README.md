<p align="center">
  <img src="assets/icon-only.png" alt="Fern logo" width="128" height="128" />
</p>

<h1 align="center">Fern</h1>

<p align="center">
  <strong>Private, on-device AI chat for Android.</strong><br />
  Your prompts, your models, your device. Nothing leaves the phone.
</p>

<p align="center">
  <a href="#early-access">Early Access</a> ·
  <a href="#load-a-model">Load a model</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#support-development">Support</a>
</p>

---

## Fern

Fern is a local-first AI client. Inference runs entirely on-device through
[llama.cpp](https://github.com/ggml-org/llama.cpp), so you can chat with open
`.gguf` models offline, with no account, no cloud, and no telemetry.

- **100% local inference** — no server round-trips, no data collection.
- **Bring your own model** — load any compatible `.gguf` file.
- **Persistent chat** — conversations stay on your device, scoped per model.
- **Built for Android** — tuned for phones and tablets, with a fast, minimal UI.

## Early Access

Fern is launching as a **100% free Early Access release**. The goal is simple:
earn your trust by shipping a genuinely private, useful local AI client before
asking for anything in return.

- No paywalls, trials, or locked features during Early Access.
- No ads and no tracking.
- Donations are always optional and never unlock extra functionality.

Early Access is a promise: the core app stays free, open, and local. If Fern
earns a place on your device, you can support development voluntarily.

## Load a model

Fern does not bundle model weights. Download a `.gguf` model separately and
import it into the app.

1. Download a compatible model file (`.gguf`) to your device. Good starting
   points are small quantized models such as `Q4_K_M` variants that fit your
   available RAM.
2. Open Fern and tap the model / load button.
3. Pick the `.gguf` file with the system file picker.
4. Wait for the import to finish, then select the model to start chatting.

Tips:

- Prefer `Q4_K_M` (or smaller) quantizations on phones with limited memory.
- Larger models and higher context sizes need more RAM and load more slowly.
- Model files and chats are stored in the app's private storage.
- Removing a model from the Model Manager deletes its local file.

## Privacy

Fern has **zero telemetry** and stores everything locally. See
[PRIVACY.md](PRIVACY.md) for the full policy.

## Support development

Fern is free during Early Access. If you would like to support ongoing work,
crypto donations are welcome and entirely optional:

| Network          | Address |
| ---------------- | ------- |
| TRON (TRC20)     | `TY7Tf1LaoQPE9dQK6HNx3pYDEiir5n349i` |
| BNB Smart Chain  | `0xdCE4bAEcCA99B8239A02111E8a354eF1Af1494c6` |
| Solana           | `HDnhGVB3JGBjnYy8acuhohTPUNgMHRKv3p4CsK7T1dCK` |

You can also copy these addresses from **Settings → Support Development** inside
the app.

## License

[MIT](LICENSE)
