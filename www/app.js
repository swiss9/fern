console.log("App.js loaded");
window.onerror = function(msg, url, line, col, error) {
  console.error('JS Error:', msg, 'line', line, error);
  if (typeof showErrorOverlay === 'function') {
    showErrorOverlay('Unexpected error', msg + ' (line ' + line + ')');
  }
  return false;
};

// ============================================================
// 1. NATIVE PLUGINS (via window.Capacitor.Plugins — no bundler)
// ============================================================
// llama-cpp-pro exposes its JS API through a vendored no-bundler
// build loaded by index.html (vendor/llama-cpp-pro/plugin.js):
//   capacitorExports (<- vendor/capacitor.js),
//   tslib (<- vendor/tslib.js),
//   plugin.js -> window.capacitorLlamaCpp ({ initLlama, releaseAllLlama,
//   getAvailableModels, ... }).
const LlamaCppPluginName = 'LlamaCpp'; // @CapacitorPlugin(name = "LlamaCpp") on the native side

// Fallback wrapper over the standard Capacitor bridge. Native methods
// (LlamaCppPlugin.java): initContext, releaseAllContexts, releaseContext,
// chat, completion, getAvailableModels.
function createNativeLlamaBridge() {
  const native = window.Capacitor.Plugins[LlamaCppPluginName];
  if (!native) return null;
  let nextId = 1;

  const makeContext = (id) => ({
    id,
    async completion(params, callback) {
      let handle = null;
      if (callback) {
        handle = native.addListener(LlamaCppOnTokenEvent, (evt) => {
          if (!evt || evt.contextId !== id) return;
          callback(evt.tokenResult || evt);
        });
      }
      try {
        const nativeParams = {
          n_predict: params.n_predict,
          temperature: params.temperature,
          top_k: params.top_k,
          penalty_repeat: params.penalty_repeat,
          stop: Array.isArray(params.stop) ? params.stop : undefined,
          emit_partial_completion: !!callback,
        };
        if (params.prompt) {
          return await native.completion({
            contextId: id,
            params: Object.assign({}, nativeParams, { prompt: params.prompt }),
          });
        }
        return await native.chat({
          contextId: id,
          messages: params.messages || [],
          params: nativeParams,
        });
      } finally {
        try { await handle.remove(); } catch (e) {}
      }
    },
    async release() {
      try { await native.releaseContext({ contextId: id }); } catch (e) {}
    },
    async stopCompletion() {
      if (typeof native.stopCompletion === 'function') {
        await native.stopCompletion({ contextId: id });
      }
    },
  });

  return {
    async initLlama(params) {
      const id = nextId++;
      await native.initContext({ contextId: id, params });
      return makeContext(id);
    },
    async releaseAllLlama() {
      try { await native.releaseAllContexts(); } catch (e) {}
    },
    async getAvailableModels() {
      const result = await native.getAvailableModels();
      return (result && result.models) || [];
    },
  };
}

const LlamaCppOnTokenEvent = '@LlamaCpp_onToken';

const llamaCppPro = () => {
  // Prefer the official vendored bundle (initLlama, jinja chat formatting...);
  // fall back to the raw Capacitor bridge if the bundle failed to evaluate.
  if (typeof window.capacitorLlamaCpp !== 'undefined' && window.capacitorLlamaCpp) {
    return window.capacitorLlamaCpp;
  }
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[LlamaCppPluginName]) {
    console.warn('[Fern] llama-cpp-pro bundle missing; using native Capacitor bridge fallback');
    const bridged = createNativeLlamaBridge();
    if (bridged) {
      window.capacitorLlamaCpp = bridged;
      return bridged;
    }
  }
  return null;
};

const getPlugins = () => {
  if (!window.Capacitor || !window.Capacitor.Plugins) {
    throw new Error('Capacitor runtime not available');
  }
  return {
    FilePicker: window.Capacitor.Plugins.FilePicker,
    Filesystem: window.Capacitor.Plugins.Filesystem,
    FileTransfer: window.Capacitor.Plugins.FileTransfer,
    LocalNotifications: window.Capacitor.Plugins.LocalNotifications,
    Device: window.Capacitor.Plugins.Device,
    Preferences: window.Capacitor.Plugins.Preferences,
    KeepAwake: window.Capacitor.Plugins.KeepAwake,
    Share: window.Capacitor.Plugins.Share,
    ForegroundService: window.Capacitor.Plugins.ForegroundService,
    App: window.Capacitor.Plugins.App,
  };
};

// Filesystem.Directory enum values are not exposed on the global bridge.
const Directory = { Data: 'DATA', Cache: 'CACHE', External: 'EXTERNAL' };

// ============================================================
// 2. UI ELEMENTS
// ============================================================
const splashOverlay = document.getElementById('splash-overlay');
const chatContainer = document.getElementById('chat-container');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const overlay = document.getElementById('loading-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const cancelDownloadBtn = document.getElementById('cancel-download-btn');
const emptyState = document.getElementById('empty-state');
const emptyStateText = document.getElementById('empty-state-text');
const mainLoadBtn = document.getElementById('main-load-btn');
const settingsBtn = document.getElementById('settings-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const storageUsage = document.getElementById('storage-usage');
const storageLocationText = document.getElementById('storage-location-text');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const clearDataBtn = document.getElementById('clear-data-btn');
const errorOverlay = document.getElementById('error-overlay');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const errorDismissBtn = document.getElementById('error-dismiss-btn');
const ramWarningOverlay = document.getElementById('ram-warning-overlay');
const ramWarningMessage = document.getElementById('ram-warning-message');
const ramWarningProceedBtn = document.getElementById('ram-warning-proceed');
const ramWarningCancelBtn = document.getElementById('ram-warning-cancel');
const attachBtn = document.getElementById('attach-btn');
const temperatureSlider = document.getElementById('temperature-slider');
const temperatureValue = document.getElementById('temperature-value');
const maxTokensSlider = document.getElementById('max-tokens-slider');
const maxTokensValue = document.getElementById('max-tokens-value');
const repeatPenaltySlider = document.getElementById('repeat-penalty-slider');
const repeatPenaltyValue = document.getElementById('repeat-penalty-value');
const modelList = document.getElementById('model-list');
const modelListEmpty = document.getElementById('model-list-empty');
const modelSelectorList = document.getElementById('model-selector-list');
const deleteAllModelsBtn = document.getElementById('delete-all-models-btn');
const settingsStorageTotal = document.getElementById('settings-storage-total');
const appVersionEl = document.getElementById('app-version');
const sidebarVersionEl = document.getElementById('sidebar-version');
const chatNav = document.getElementById('chat-nav');
const chatSearchInput = document.getElementById('chat-search-input');
const exportChatBtn = document.getElementById('export-chat-btn');
const importChatBtn = document.getElementById('import-chat-btn');
const quickSettingsBtn = document.getElementById('quick-settings-btn');
const quickSettingsSheet = document.getElementById('quick-settings-sheet');
const quickSettingsBackdrop = document.getElementById('quick-settings-backdrop');
const closeQuickSettingsBtn = document.getElementById('close-quick-settings-btn');
const systemPromptInput = document.getElementById('system-prompt-input');
const systemPromptStatus = document.getElementById('system-prompt-status');
const advancedSettingsToggle = document.getElementById('advanced-settings-toggle');
const advancedSettingsPanel = document.getElementById('advanced-settings-panel');
const aliasModal = document.getElementById('alias-modal');
const aliasModalInput = document.getElementById('alias-modal-input');
const aliasModalFilename = document.getElementById('alias-modal-filename');
const aliasModalCancel = document.getElementById('alias-modal-cancel');
const aliasModalSave = document.getElementById('alias-modal-save');
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalDescription = document.getElementById('confirm-modal-description');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');
const confirmModalConfirm = document.getElementById('confirm-modal-confirm');
const SEND_ICON_HTML = sendBtn.innerHTML;
const STOP_ICON_HTML =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';

// ============================================================
// 3. STATE
// ============================================================
const DOWNLOAD_NOTIFICATION_ID = 1001;
const RESPONSE_NOTIFICATION_ID = 1002;
const SETTINGS_KEY = 'fern.settings';
const SESSIONS_KEY = 'fern.sessions';
const LEGACY_CHAT_HISTORY_KEY = 'chatHistory';
const ACTIVE_MODEL_KEY = 'activeModelName';
const MODEL_ALIASES_KEY = 'fern.modelAliases';
const IS_LEGACY_USER_KEY = 'fern.isLegacyUser';
const FIRST_LAUNCH_DATE_KEY = 'fern.firstLaunchDate';
const LICENSE_PUBLIC_KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const DEFAULT_SETTINGS = { temperature: 0.6, maxTokens: 512, repeatPenalty: 1.15 };
const MAX_SESSION_MESSAGES = 50;
const CONTEXT_TOKEN_LIMIT = 2048;
const HISTORY_TOKEN_BUDGET = 1500;
const CHARS_PER_TOKEN = 4;
const MIN_RECENT_MESSAGES = 6;
const MAX_RECENT_MESSAGES = 8;
const AUTO_SCROLL_THRESHOLD = 120;
let activeDownloadCancel = null;

const MODEL_CATALOG = [
  {
    id: 'qwen2.5-0.5b',
    display: 'qwen2.5-0.5b.gguf',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    size: '[400MB]',
    power: 1,
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-1b',
    display: 'llama-3.2-1b.gguf',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    size: '[780MB]',
    power: 2,
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'llama-3.2-3b',
    display: 'llama-3.2-3b.gguf',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    size: '[2.0GB]',
    power: 3,
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'qwen2.5-3b',
    display: 'qwen2.5-3b.gguf',
    file: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    size: '[2.0GB]',
    power: 4,
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
  },
];
let appSettings = { ...DEFAULT_SETTINGS };
let contextReady = false;
let isGenerating = false;
let generationAbortRequested = false;
let generationRunId = 0;
let activeTypewriter = null;
let activeTypewriterInterval = null;
let isModelLoading = false;
let sessions = {};
let activeSessionId = '';
let chatSearchQuery = '';
let modelName = '';
let modelDisplayName = '';
let modelAliases = {};
let customSystemPrompt = '';
let pendingLegacyMessages = null;
let activeContext = null;
let chatSaveChain = Promise.resolve();
let aliasTargetModel = '';
let confirmResolve = null;
let settingsSaveTimer = null;
let systemPromptSaveTimer = null;
let scrollFramePending = false;

function hideSplash() {
  if (!splashOverlay) return;
  splashOverlay.classList.add('opacity-0', 'pointer-events-none');
  splashOverlay.style.opacity = '0';
  setTimeout(() => {
    splashOverlay.style.display = 'none';
  }, 500);
}

function showOverlay(text) {
  progressText.classList.remove('text-red-400');
  progressText.innerText = text;
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
  overlay.style.pointerEvents = 'none';
}

function hideOverlay() {
  overlay.classList.add('hidden');
  overlay.style.display = 'none';
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
}

function showErrorOverlay(title, message) {
  errorTitle.innerText = title || 'Something went wrong';
  errorMessage.innerText = String(message || 'Unknown error');
  errorOverlay.classList.remove('hidden');
  errorOverlay.style.display = 'flex';
}

function closeErrorOverlay() {
  errorOverlay.classList.add('hidden');
  errorOverlay.style.display = 'none';
  hideOverlay();
  if (!modelName) {
    resetToNoModelState();
  } else {
    setSendEnabled(contextReady);
  }
}

let ramWarningResolve = null;

function showRamWarning(message) {
  if (!ramWarningOverlay) return Promise.resolve(false);
  ramWarningMessage.innerText = String(message || '');
  ramWarningOverlay.classList.remove('hidden');
  ramWarningOverlay.style.display = 'flex';
  return new Promise((resolve) => {
    ramWarningResolve = resolve;
  });
}

function resolveRamWarning(proceed) {
  if (!ramWarningOverlay) return;
  ramWarningOverlay.classList.add('hidden');
  ramWarningOverlay.style.display = 'none';
  const resolve = ramWarningResolve;
  ramWarningResolve = null;
  if (resolve) resolve(!!proceed);
}

async function keepScreenAwake() {
  try {
    const { KeepAwake } = getPlugins();
    if (KeepAwake && typeof KeepAwake.keepAwake === 'function') {
      await KeepAwake.keepAwake();
    }
  } catch (error) {
    console.warn('[Fern] KeepAwake.keepAwake failed:', error);
  }
}

async function allowScreenSleep() {
  try {
    const { KeepAwake } = getPlugins();
    if (KeepAwake && typeof KeepAwake.allowSleep === 'function') {
      await KeepAwake.allowSleep();
    }
  } catch (error) {
    console.warn('[Fern] KeepAwake.allowSleep failed:', error);
  }
}

const GENERATION_NOTIFICATION = {
  title: 'Fern is thinking...',
  body: 'Generating response locally',
  id: 1,
  smallIcon: 'ic_stat_fern',
};

async function startGenerationForegroundService() {
  try {
    const { ForegroundService } = getPlugins();
    if (!ForegroundService) return;
    if (typeof ForegroundService.startNotification === 'function') {
      await ForegroundService.startNotification(GENERATION_NOTIFICATION);
      return;
    }
    if (typeof ForegroundService.startForegroundService === 'function') {
      await ForegroundService.startForegroundService(GENERATION_NOTIFICATION);
    }
  } catch (error) {
    console.warn('[Fern] Could not start the generation foreground service:', error);
  }
}

async function stopGenerationForegroundService() {
  try {
    const { ForegroundService } = getPlugins();
    if (!ForegroundService || typeof ForegroundService.stopForegroundService !== 'function') return;
    await ForegroundService.stopForegroundService();
  } catch (error) {
    console.warn('[Fern] Could not stop the generation foreground service:', error);
  }
}

function resetToNoModelState() {
  contextReady = false;
  modelName = '';
  modelDisplayName = '';
  activeSessionId = '';
  setModelLabels('');
  setSendEnabled(false);
  setMultimodalSupport(false);
  renderSidebarSessions();
  messagesEl.innerHTML = '';
  showEmptyState();
  setEmptyStateMessage('No local model loaded.');
}

function isMultimodal(modelName) {
  return /(llava|vision|moondream)/i.test(modelName || '');
}

function setMultimodalSupport(enabled) {
  if (!attachBtn) return;
  attachBtn.classList.toggle('hidden', !enabled);
  attachBtn.classList.toggle('flex', !!enabled);
}

function setSendEnabled(enabled) {
  if (isGenerating) return;
  sendBtn.disabled = !enabled;
  if (enabled) {
    sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  } else {
    sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
}

// Gray out every model selector/manager row while a model is loading or the
// engine is generating, so a stray double tap cannot start a second load or
// yank the context mid-completion.
function setModelControlsLocked(locked) {
  if (locked) {
    document.body.classList.add('model-controls-locked');
  } else {
    document.body.classList.remove('model-controls-locked');
  }
}

function updateSendButton() {
  if (isGenerating) {
    sendBtn.disabled = false;
    sendBtn.classList.remove('bg-white', 'text-base', 'hover:bg-zinc-200', 'active:bg-zinc-300', 'opacity-50', 'cursor-not-allowed');
    sendBtn.classList.add('bg-red-500', 'text-white', 'hover:bg-red-400', 'active:bg-red-600');
    sendBtn.innerHTML = STOP_ICON_HTML;
    sendBtn.setAttribute('aria-label', 'Stop generating');
  } else {
    sendBtn.classList.remove('bg-red-500', 'text-white', 'hover:bg-red-400', 'active:bg-red-600');
    sendBtn.classList.add('bg-white', 'text-base', 'hover:bg-zinc-200', 'active:bg-zinc-300');
    sendBtn.innerHTML = SEND_ICON_HTML;
    sendBtn.setAttribute('aria-label', 'Send message');
    setSendEnabled(contextReady);
  }
}

function setEmptyStateMessage(text) {
  emptyStateText.innerText = text;
}

function showEmptyState() {
  if (activeMessages().length > 0) {
    emptyState.classList.add('hidden');
    return;
  }
  emptyState.classList.remove('hidden');
  if (contextReady && modelName) {
    setEmptyStateMessage('Ready. Ask ' + (modelDisplayName || modelName) + ' anything.');
    mainLoadBtn.classList.add('hidden');
  } else {
    setEmptyStateMessage('No local model loaded.');
    mainLoadBtn.classList.remove('hidden');
  }
}

function hideEmptyState() {
  emptyState.classList.add('hidden');
}

function setModelLabels(name) {
  const display = name ? getModelAlias(name) : '';
  if (name) modelDisplayName = display;
  document.getElementById('sidebar-model-label').innerText = display || 'No model';
  document.getElementById('active-model-chip').innerText = display ? display.toUpperCase() : 'NO MODEL';
  const avatarEl = document.getElementById('sidebar-model-avatar');
  if (avatarEl) avatarEl.innerHTML = getModelAvatarHTML(display);
  setMultimodalSupport(!!name && isMultimodal(name));
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
}

function parseSizeLabelToBytes(label) {
  const match = String(label || '').match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toUpperCase();
  if (unit === 'GB') return Math.round(value * 1073741824);
  if (unit === 'MB') return Math.round(value * 1048576);
  return Math.round(value * 1024);
}

function getCatalogModelBytes(filename) {
  const entry = MODEL_CATALOG.find((model) => model.file === filename);
  return entry ? parseSizeLabelToBytes(entry.size) : 0;
}

async function getFreeDiskSpace() {
  try {
    const { Device } = getPlugins();
    if (Device) {
      const info = await Device.getInfo();
      const free = Number(info && (info.realDiskFree || info.diskFree)) || 0;
      if (free > 0) return free;
    }
  } catch (error) {
    console.warn('[Fern] Could not read free disk space:', error);
  }
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      const quota = Number(estimate && estimate.quota) || 0;
      const usage = Number(estimate && estimate.usage) || 0;
      if (quota > usage) return quota - usage;
    }
  } catch (error) {
    console.warn('[Fern] Storage estimate unavailable:', error);
  }
  return 0;
}

function getPreferencesPlugin() {
  try {
    return getPlugins().Preferences;
  } catch (error) {
    return null;
  }
}

async function initializeLegacyFlags() {
  const Preferences = getPreferencesPlugin();
  if (!Preferences) return;
  try {
    const { value } = await Preferences.get({ key: IS_LEGACY_USER_KEY });
    if (value === null || value === undefined) {
      await Preferences.set({ key: IS_LEGACY_USER_KEY, value: 'true' });
      await Preferences.set({ key: FIRST_LAUNCH_DATE_KEY, value: new Date().toISOString() });
    }
  } catch (error) {
    console.warn('[Fern] Could not initialize legacy flags:', error);
  }
}

function base64ToBytes(base64) {
  const normalized = String(base64).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyLicenseKey(keyString, deviceId) {
  try {
    if (!keyString || !deviceId) return false;
    if (typeof crypto === 'undefined' || !crypto.subtle) return false;
    const signature = base64ToBytes(keyString);
    const publicKeyBytes = base64ToBytes(LICENSE_PUBLIC_KEY_B64);
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    const message = new TextEncoder().encode(String(deviceId));
    return await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, message);
  } catch (error) {
    console.warn('[Fern] License verification failed:', error);
    return false;
  }
}

function getModelAlias(name) {
  const key = name || modelName;
  if (!key) return '';
  const alias = modelAliases[key];
  return typeof alias === 'string' && alias.trim() ? alias.trim() : key;
}

const FERN_SHIELD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 80 80" fill="none" role="img" aria-label="Fern">' +
    '<path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M40 3L70 25L60 55L40 77L20 55L10 25Z M40 12L18 27L35 43L22 39L40 61L58 39L45 43L62 27Z"/>' +
  '</svg>';

function getModelAvatarHTML(modelNameValue) {
  const name = typeof modelNameValue === 'string' ? modelNameValue.trim() : '';
  if (!name) {
    return '<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800">' +
      FERN_SHIELD_SVG +
    '</div>';
  }
  const letter = Array.from(name)[0].toUpperCase();
  return '<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 font-sans text-[11px] font-bold text-white uppercase">' +
    escapeHtml(letter) +
  '</div>';
}

function syncModelDisplayName() {
  modelDisplayName = getModelAlias(modelName);
}

function sessionKeyForModel(name) {
  const key = name || modelName;
  if (!key) return '';
  return getModelAlias(key);
}

async function loadModelAliases() {
  try {
    const Preferences = getPreferencesPlugin();
    if (!Preferences) return;
    const { value } = await Preferences.get({ key: MODEL_ALIASES_KEY });
    if (!value) return;
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const clean = {};
    Object.keys(parsed).forEach((key) => {
      const alias = parsed[key];
      if (typeof alias === 'string' && alias.trim()) clean[key] = alias.trim();
    });
    modelAliases = clean;
  } catch (error) {
    console.warn('Could not load model aliases:', error);
  }
}

async function saveModelAliases() {
  try {
    const Preferences = getPreferencesPlugin();
    if (!Preferences) return;
    await Preferences.set({ key: MODEL_ALIASES_KEY, value: JSON.stringify(modelAliases) });
  } catch (error) {
    console.warn('Could not save model aliases:', error);
  }
}

function showConfirm(options) {
  const opts = typeof options === 'string' ? { description: options } : (options || {});
  if (!confirmModal) return Promise.resolve(false);

  confirmModalTitle.innerText = opts.title || 'Confirm';
  confirmModalDescription.innerText = opts.description || '';
  confirmModalCancel.innerText = opts.cancelText || 'Cancel';
  confirmModalConfirm.innerText = opts.confirmText || 'Confirm';

  const danger = opts.danger !== false;
  confirmModalConfirm.className = danger
    ? 'flex h-9 flex-1 items-center justify-center rounded-md border border-red-500/40 bg-red-500/15 text-[12.5px] font-medium text-red-200 transition hover:bg-red-500/25'
    : 'flex h-9 flex-1 items-center justify-center rounded-md border border-line bg-white text-[12.5px] font-medium text-base transition hover:bg-zinc-200';

  confirmModal.classList.remove('hidden');
  confirmModal.style.display = 'flex';

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function resolveConfirm(value) {
  if (!confirmModal) return;
  confirmModal.classList.add('hidden');
  confirmModal.style.display = 'none';
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(!!value);
}

function openAliasModal(filename) {
  if (!aliasModal || !filename) return;
  aliasTargetModel = filename;
  if (aliasModalFilename) aliasModalFilename.innerText = filename;
  if (aliasModalInput) {
    aliasModalInput.value = modelAliases[filename] || '';
    aliasModalInput.placeholder = filename;
  }
  aliasModal.classList.remove('hidden');
  aliasModal.style.display = 'flex';
  setTimeout(() => {
    if (!aliasModalInput) return;
    aliasModalInput.focus();
    aliasModalInput.select();
  }, 50);
}

function closeAliasModal() {
  if (!aliasModal) return;
  aliasModal.classList.add('hidden');
  aliasModal.style.display = 'none';
  aliasTargetModel = '';
}

async function saveAliasFromModal() {
  if (!aliasTargetModel) return;
  const filename = aliasTargetModel;
  const value = aliasModalInput ? aliasModalInput.value.trim() : '';
  const oldKey = sessionKeyForModel(filename);

  if (value && value !== filename) modelAliases[filename] = value;
  else delete modelAliases[filename];

  const newKey = sessionKeyForModel(filename);
  if (oldKey && newKey && oldKey !== newKey) {
    const oldSessions = Array.isArray(sessions[oldKey]) ? sessions[oldKey] : [];
    const existing = Array.isArray(sessions[newKey]) ? sessions[newKey] : [];
    if (oldSessions.length) {
      sessions[newKey] = mergeSessionLists(oldSessions, existing);
    }
    delete sessions[oldKey];
  }

  await saveModelAliases();
  await saveSessions();

  if (filename === modelName) {
    syncModelDisplayName();
    setModelLabels(modelName);
    updatePersonalizationControls();
    renderSidebarSessions();
    renderSessionMessages();
  }

  closeAliasModal();
  await refreshModelManager();
}

function capSessionMessages(session) {
  if (!session || !Array.isArray(session.messages)) return;
  if (session.messages.length > MAX_SESSION_MESSAGES) {
    session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
  }
}

function normalizeMessageList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((message) => {
      if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') return false;
      const role = message.role.trim().toLowerCase();
      if (role !== 'user' && role !== 'assistant') return false;
      return message.content.trim().length > 0;
    })
    .map((message) => ({
      role: message.role.trim().toLowerCase(),
      content: message.content,
    }));
}

function normalizeSessionsData(parsed) {
  const result = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

  Object.keys(parsed).forEach((model) => {
    const list = parsed[model];
    if (!Array.isArray(list)) return;
    result[model] = list
      .filter((session) => session && typeof session === 'object')
      .map((session, index) => {
        const normalized = {
          id: typeof session.id === 'string' && session.id
            ? session.id
            : 's_' + Date.now().toString(36) + '_' + index,
          title: typeof session.title === 'string' && session.title.trim()
            ? session.title.trim()
            : 'New chat',
          model: typeof session.model === 'string' && session.model
            ? session.model
            : model,
          messages: normalizeMessageList(session.messages),
        };
        capSessionMessages(normalized);
        return normalized;
      });
  });

  return result;
}

function mergeSessionLists(primary, secondary) {
  const seen = new Set();
  const merged = [];
  (Array.isArray(primary) ? primary : [])
    .concat(Array.isArray(secondary) ? secondary : [])
    .forEach((session) => {
      if (!session) return;
      if (session.id && seen.has(session.id)) return;
      if (session.id) seen.add(session.id);
      merged.push(session);
    });
  return merged;
}

function createSessionId() {
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function ensureModelSessions(name) {
  const key = sessionKeyForModel(name);
  if (!key) return [];
  if (!Array.isArray(sessions[key])) sessions[key] = [];
  return sessions[key];
}

function createSessionRecord(title, messages) {
  const record = {
    id: createSessionId(),
    title: title || 'New chat',
    // Snapshot the owning model (raw filename) so a sidebar entry always knows
    // which model must be loaded when the chat is tapped.
    model: modelName || '',
    messages: normalizeMessageList(messages),
  };
  capSessionMessages(record);
  return record;
}

// Map a session id back to the model (raw filename) that owns it. Uses the
// stored tag when present, otherwise resolves the sessions grouping key back
// to a filename via the alias table.
function findSessionOwnerModel(sessionId) {
  for (const key of Object.keys(sessions)) {
    const list = Array.isArray(sessions[key]) ? sessions[key] : [];
    const session = list.find((entry) => entry && entry.id === sessionId);
    if (!session) continue;
    if (session.model) return session.model;
    if (modelName && sessionKeyForModel(modelName) === key) return modelName;
    const aliasFile = Object.keys(modelAliases).find((file) => modelAliases[file] === key);
    return aliasFile || key;
  }
  return '';
}

function getActiveSession() {
  if (!modelName) return null;
  const key = sessionKeyForModel(modelName);
  const list = Array.isArray(sessions[key]) ? sessions[key] : [];
  return list.find((session) => session.id === activeSessionId) || null;
}

function activeMessages() {
  const session = getActiveSession();
  return session && Array.isArray(session.messages) ? session.messages : [];
}

function createSession(options) {
  const opts = options || {};
  if (!modelName) return null;

  const session = createSessionRecord(opts.title || 'New chat', opts.messages);

  const list = ensureModelSessions(modelName);
  if (opts.append) list.push(session);
  else list.unshift(session);

  if (opts.select !== false) {
    activeSessionId = session.id;
    renderSidebarSessions();
    renderSessionMessages();
  }

  saveSessions();
  return session;
}

function updateActiveSessionTitle(text) {
  const session = getActiveSession();
  if (!session) return;
  const title = String(text || '').replace(/\s+/g, ' ').trim();
  if (!title || (session.title && session.title !== 'New chat')) return;
  session.title = title.slice(0, 25) || 'New chat';
  renderSidebarSessions();
}

async function selectSession(id) {
  if (!id) return;
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  stopActiveTypewriter();
  const currentList = modelName ? ensureModelSessions(modelName) : [];
  if (currentList.some((session) => session.id === id)) {
    activeSessionId = id;
    renderSidebarSessions();
    renderSessionMessages();
    return;
  }

  // The tapped chat belongs to another model: find its owner, load that model
  // (fully releasing the current one first inside loadInstalledModel) and then
  // restore the tapped conversation verbatim.
  const ownerModel = findSessionOwnerModel(id);
  if (!ownerModel || ownerModel === modelName) return;
  await loadInstalledModel(ownerModel, { selectSessionId: id });
}

async function deleteSession(id) {
  if (!modelName) return;
  const list = ensureModelSessions(modelName);
  const index = list.findIndex((session) => session.id === id);
  if (index < 0) return;
  const confirmed = await showConfirm({
    title: 'Delete chat',
    description: 'Delete this chat? This cannot be undone.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  list.splice(index, 1);

  if (activeSessionId === id) {
    if (list.length > 0) {
      activeSessionId = list[0].id;
    } else {
      const session = createSessionRecord('New chat', []);
      list.push(session);
      activeSessionId = session.id;
    }
    renderSessionMessages();
  }

  renderSidebarSessions();
  await saveSessions();
}

function isNearChatBottom() {
  if (!chatContainer) return false;
  return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight <= AUTO_SCROLL_THRESHOLD;
}

function scheduleAutoScroll(force) {
  if (!chatContainer) return;
  if (!force && !isNearChatBottom()) return;
  if (scrollFramePending) return;
  scrollFramePending = true;
  requestAnimationFrame(() => {
    scrollFramePending = false;
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

function renderSessionMessages() {
  messagesEl.innerHTML = '';
  const messages = activeMessages();
  if (messages.length === 0) {
    showEmptyState();
    return;
  }
  hideEmptyState();
  messages.forEach((message, index) => {
    appendMessage(message.role, message.content, { persist: false, index });
  });
  scheduleAutoScroll(true);
}

function editUserMessage(index) {
  if (isGenerating) return;
  const session = getActiveSession();
  if (!session || !Array.isArray(session.messages)) return;
  if (!Number.isInteger(index) || index < 0 || index >= session.messages.length) return;

  const message = session.messages[index];
  if (!message || message.role !== 'user') return;

  stopActiveTypewriter();
  generationAbortRequested = false;
  inputEl.value = message.content || '';
  session.messages.splice(index);
  if (index === 0) session.title = 'New chat';
  renderSidebarSessions();
  renderSessionMessages();
  saveSessions();
  inputEl.dispatchEvent(new Event('input'));
  inputEl.focus();
}

function renderSidebarSessions() {
  if (!chatNav) return;

  if (!modelName) {
    chatNav.innerHTML = '<p class="px-2 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-600">Load a model to see your chats.</p>';
    return;
  }

  const key = sessionKeyForModel(modelName);
  const allSessions = Array.isArray(sessions[key]) ? sessions[key] : [];
  if (allSessions.length === 0) {
    chatNav.innerHTML = '<p class="px-2 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-600">No chats for this model yet.</p>';
    return;
  }

  const query = chatSearchQuery.trim().toLowerCase();
  const list = query
    ? allSessions.filter((session) => String(session.title || 'New chat').toLowerCase().includes(query))
    : allSessions;

  if (list.length === 0) {
    chatNav.innerHTML = '<p class="px-2 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-600">No chats match &quot;' + escapeHtml(chatSearchQuery.trim()) + '&quot;.</p>';
    return;
  }

  chatNav.innerHTML = list.map((session) => {
    const active = session.id === activeSessionId;
    return '<div class="group/session relative mb-0.5">' +
      '<button type="button" data-session-id="' + escapeHtml(session.id) + '" class="flex w-full items-center gap-2 rounded-md py-2 pl-2.5 pr-8 text-left transition ' +
        (active ? 'bg-white/[0.07] text-white' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-white') + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 ' + (active ? 'text-zinc-300' : 'text-zinc-600') + '"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '<span class="truncate text-[12.5px]">' + escapeHtml(session.title || 'New chat') + '</span>' +
      '</button>' +
      '<button type="button" data-delete-session-id="' + escapeHtml(session.id) + '" aria-label="Delete chat" class="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-600 opacity-60 transition hover:bg-white/5 hover:text-red-400 group-hover/session:opacity-100">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');
}

function saveSessions() {
  const serialized = JSON.stringify(sessions);
  chatSaveChain = chatSaveChain.then(async () => {
    try {
      const Preferences = getPreferencesPlugin();
      if (!Preferences) return;
      await Preferences.set({ key: SESSIONS_KEY, value: serialized });
    } catch (error) {
      console.warn('Could not save chat sessions:', error);
    }
  });
  return chatSaveChain;
}

async function loadSessions() {
  try {
    const Preferences = getPreferencesPlugin();
    if (!Preferences) return;

    const { value } = await Preferences.get({ key: SESSIONS_KEY });
    if (value) {
      try {
        sessions = normalizeSessionsData(JSON.parse(value));
      } catch (error) {
        console.warn('Could not parse saved sessions:', error);
        sessions = {};
      }
      await migrateSessionsToAliases();
      return;
    }

    // One-time migration from the flat v2 chat history.
    const legacy = await Preferences.get({ key: LEGACY_CHAT_HISTORY_KEY });
    if (legacy && legacy.value) {
      try {
        const parsed = JSON.parse(legacy.value);
        if (Array.isArray(parsed)) {
          const messages = normalizeMessageList(parsed);
          if (messages.length > 0) pendingLegacyMessages = messages;
        }
      } catch (error) {
        console.warn('Could not parse legacy chat history:', error);
      }
    }
  } catch (error) {
    console.warn('Could not load chat sessions:', error);
  }
}

async function migrateSessionsToAliases() {
  let changed = false;

  Object.keys(modelAliases).forEach((filename) => {
    const alias = modelAliases[filename];
    if (!alias || alias === filename) return;
    const fileSessions = sessions[filename];
    if (!Array.isArray(fileSessions) || fileSessions.length === 0) return;
    const aliasSessions = Array.isArray(sessions[alias]) ? sessions[alias] : [];
    sessions[alias] = mergeSessionLists(fileSessions, aliasSessions);
    delete sessions[filename];
    changed = true;
  });

  if (changed) await saveSessions();
}

async function clearLegacyChatHistory() {
  try {
    const Preferences = getPreferencesPlugin();
    if (Preferences) await Preferences.remove({ key: LEGACY_CHAT_HISTORY_KEY });
  } catch (error) {
    console.warn('Could not clear legacy chat history:', error);
  }
}

async function activateModelSessions() {
  if (!modelName) {
    activeSessionId = '';
    renderSidebarSessions();
    renderSessionMessages();
    return;
  }

  const list = ensureModelSessions(modelName);

  if (list.length === 0) {
    if (pendingLegacyMessages && pendingLegacyMessages.length > 0) {
      const legacySession = createSessionRecord('Restored chat', pendingLegacyMessages);
      pendingLegacyMessages = null;
      list.push(legacySession);
      await clearLegacyChatHistory();
    } else {
      list.push(createSessionRecord('New chat', []));
    }
    activeSessionId = list[0].id;
  } else if (!list.some((session) => session.id === activeSessionId)) {
    activeSessionId = list[0].id;
  }

  // Keep the owner tag correct for every session in this model's group.
  list.forEach((session) => {
    if (!session.model) session.model = sessionKeyForModel(modelName);
  });

  renderSidebarSessions();
  renderSessionMessages();
  saveSessions();
}

function getSystemPromptKey(name) {
  const key = name || modelName;
  if (!key) return '';
  return `systemPrompt_${key}`;
}

async function loadModelPersonalization() {
  const targetModel = modelName;
  customSystemPrompt = '';
  syncModelDisplayName();
  if (!targetModel) {
    updatePersonalizationControls();
    return;
  }

  try {
    const Preferences = getPreferencesPlugin();
    if (Preferences) {
      const prompt = await Preferences.get({ key: getSystemPromptKey(targetModel) });
      if (modelName !== targetModel) return;
      customSystemPrompt = prompt.value || '';
    }
  } catch (error) {
    console.warn('Could not load model personalization:', error);
  }

  if (modelName !== targetModel) return;
  updatePersonalizationControls();
}

function updatePersonalizationControls() {
  if (systemPromptInput) {
    systemPromptInput.value = customSystemPrompt || '';
    systemPromptInput.disabled = !modelName;
  }
  if (systemPromptStatus) {
    systemPromptStatus.innerText = modelName
      ? 'Saved for ' + (modelDisplayName || modelName) + '.'
      : 'Load a model to customize its personality.';
  }
}

async function saveActiveModelName(name) {
  try {
    const Preferences = getPreferencesPlugin();
    if (!Preferences || !name) return;
    await Preferences.set({ key: ACTIVE_MODEL_KEY, value: name });
  } catch (error) {
    console.warn('Could not save active model name:', error);
  }
}

async function clearActiveModelName() {
  try {
    const Preferences = getPreferencesPlugin();
    if (!Preferences) return;
    await Preferences.remove({ key: ACTIVE_MODEL_KEY });
  } catch (error) {
    console.warn('Could not clear active model name:', error);
  }
}

// ============================================================
// 4. PERMISSIONS, NOTIFICATIONS & STORAGE
// ============================================================
async function requestStartupPermissions() {
  try {
    const { LocalNotifications, Device, Filesystem, ForegroundService } = getPlugins();

    if (LocalNotifications) {
      try {
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (error) {
        console.warn('Notification permission unavailable:', error);
      }
    }

    if (ForegroundService) {
      try {
        const status = await ForegroundService.checkPermissions();
        if (status.display !== 'granted') {
          await ForegroundService.requestPermissions();
        }
      } catch (error) {
        console.warn('Foreground service notification permission unavailable:', error);
      }
    }

    if (Device && Filesystem) {
      try {
        const info = await Device.getInfo();
        const androidVersion = parseInt(String(info.osVersion || '').split('.')[0], 10);
        if (info.platform === 'android' && androidVersion <= 12) {
          const status = await Filesystem.checkPermissions();
          if (status.publicStorage !== 'granted') {
            await Filesystem.requestPermissions();
          }
        }
      } catch (error) {
        console.warn('Storage permission unavailable:', error);
      }
    }
  } catch (error) {
    console.warn('Permission setup unavailable:', error);
  }
}

async function showDownloadingNotification(filename) {
  try {
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.cancel({ notifications: [{ id: DOWNLOAD_NOTIFICATION_ID }] });
    } catch (error) {}
    await LocalNotifications.schedule({
      notifications: [{
        id: DOWNLOAD_NOTIFICATION_ID,
        title: 'Downloading Model...',
        body: filename,
        ongoing: true,
        autoCancel: false,
        isExactNotification: false,
      }],
    });
  } catch (error) {
    console.warn('Could not show download notification:', error);
  }
}

async function showModelReadyNotification(filename) {
  try {
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return;
    try {
      await LocalNotifications.cancel({ notifications: [{ id: DOWNLOAD_NOTIFICATION_ID }] });
    } catch (error) {}
    await LocalNotifications.schedule({
      notifications: [{
        id: DOWNLOAD_NOTIFICATION_ID,
        title: 'Model Ready!',
        body: filename + ' loaded. Fern is ready to chat.',
        autoCancel: true,
        isExactNotification: false,
      }],
    });
  } catch (error) {
    console.warn('Could not update download notification:', error);
  }
}

async function clearDownloadNotification() {
  try {
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return;
    await LocalNotifications.cancel({ notifications: [{ id: DOWNLOAD_NOTIFICATION_ID }] });
  } catch (error) {
    console.warn('Could not clear download notification:', error);
  }
}

async function notifyBackgroundResponse(text) {
  if (document.visibilityState !== 'hidden' || !text) return;
  try {
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return;
    const body = text.trim().slice(0, 50) + (text.trim().length > 50 ? '…' : '');
    await LocalNotifications.schedule({
      notifications: [{
        id: RESPONSE_NOTIFICATION_ID,
        title: 'Fern',
        body,
        autoCancel: true,
        isExactNotification: false,
      }],
    });
  } catch (error) {
    console.warn('Could not show response notification:', error);
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function readInstalledModels() {
  const { Filesystem } = getPlugins();
  if (!Filesystem) return [];
  const result = await Filesystem.readdir({ path: '', directory: Directory.Data });
  const models = [];
  for (const file of result.files || []) {
    if (file.type && file.type !== 'file') continue;
    const name = String(file.name || file.path || '').split('/').pop();
    if (!name || !/\.gguf$/i.test(name)) continue;
    let size = Number(file.size) || 0;
    if (!size) {
      try {
        const stat = await Filesystem.stat({ path: name, directory: Directory.Data });
        size = Number(stat.size) || 0;
      } catch (error) {
        console.warn('Could not stat ' + name + ':', error);
      }
    }
    models.push({ name, size });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

async function getInstalledModels() {
  return readInstalledModels();
}

async function cleanupPartialDownloads() {
  try {
    const { Filesystem } = getPlugins();
    if (!Filesystem) return;
    const result = await Filesystem.readdir({ path: '', directory: Directory.Data });
    for (const file of result.files || []) {
      const name = String(file.name || file.path || '').split('/').pop();
      if (!name || !/\.tmp$/i.test(name)) continue;
      try {
        await Filesystem.deleteFile({ path: name, directory: Directory.Data });
        console.log('[Fern] Removed partial download ' + name);
      } catch (error) {
        console.warn('[Fern] Could not remove partial download ' + name + ':', error);
      }
    }
  } catch (error) {
    console.warn('[Fern] Partial download cleanup failed:', error);
  }
}

function modelPowerBars(level) {
  let bars = '';
  for (let i = 0; i < 4; i++) {
    const on = i < level;
    bars += '<span class="' + (on ? 'text-white' : 'text-zinc-700') + '">' + (on ? '■' : '□') + '</span>';
  }
  return '<span class="flex shrink-0 items-center gap-[3px] font-mono text-[10px] leading-none">' + bars + '</span>';
}

async function renderModelSelector() {
  if (!modelSelectorList) return;

  let installed = [];
  try {
    installed = await readInstalledModels();
  } catch (error) {
    console.warn('Could not list models for the selector:', error);
  }

  const installedNames = new Set(installed.map((model) => model.name));
  const installedRows = installed.map((model) => {
    const displayName = getModelAlias(model.name);
    const isActive = model.name === modelName && contextReady;
    const status = isActive
      ? '<span class="shrink-0 bg-white px-1 font-mono text-[9px] font-bold leading-4 text-black">[ACTIVE]</span>'
      : '<span class="shrink-0 text-[10px] text-zinc-500">' + formatBytes(model.size) + '</span>';
    return '<button type="button" data-load-model="' + escapeHtml(model.name) + '" class="model-select-row flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left font-mono transition hover:bg-white/[0.04]">' +
      getModelAvatarHTML(displayName) +
      '<span class="min-w-0 flex-1 truncate text-[11px] ' + (isActive ? 'text-white' : 'text-zinc-300') + '">' + escapeHtml(displayName) + '</span>' +
      status +
    '</button>';
  }).join('');

  const deviceMemory = Number(navigator.deviceMemory) || 0;
  const recId = deviceMemory > 6 ? 'llama-3.2-3b' : 'llama-3.2-1b';
  const catalogRows = MODEL_CATALOG.filter((model) => !installedNames.has(model.file)).map((model) => {
    const rec = model.id === recId
      ? '<span class="shrink-0 bg-white px-1 font-mono text-[9px] font-bold leading-4 text-black">[REC]</span>'
      : '<span class="w-[31px] shrink-0"></span>';
    return '<button type="button" data-model-id="' + model.id + '" class="model-select-row flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left font-mono transition hover:bg-white/[0.04]">' +
      modelPowerBars(model.power) +
      '<span class="min-w-0 flex-1 truncate text-[11px] text-zinc-300">' + escapeHtml(model.display) + '</span>' +
      '<span class="shrink-0 text-[10px] text-zinc-500">' + escapeHtml(model.size) + '</span>' +
      rec +
    '</button>';
  }).join('');

  const installedSection = installedRows || '<p class="px-2 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-600">No models on this device.</p>';
  const catalogSection = catalogRows
    ? '<div class="my-1 border-t border-line"></div>' +
      '<p class="px-2 pb-1 pt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">Download</p>' +
      catalogRows
    : '';

  modelSelectorList.innerHTML = installedSection + catalogSection;
}

function renderModelList(models) {
  if (!modelList) return;
  if (!models.length) {
    modelList.innerHTML = '<p class="rounded-md border border-line bg-base px-3 py-3 text-center font-mono text-[11px] text-zinc-600">No models installed.</p>';
    return;
  }

  modelList.innerHTML = models.map((model) => {
    const alias = modelAliases[model.name];
    const displayName = alias && alias.trim() ? alias.trim() : model.name;
    const meta = alias && alias.trim()
      ? escapeHtml(model.name) + ' · ' + formatBytes(model.size)
      : formatBytes(model.size);
    const isActive = model.name === modelName && contextReady;
    const loadButton = '<button type="button" data-load-model="' + escapeHtml(model.name) + '" class="shrink-0 transition ' +
      (isActive
        ? 'px-1.5 py-0.5 text-[9px] uppercase font-mono border border-zinc-600 text-zinc-400 bg-transparent rounded-sm'
        : 'rounded-md border border-line bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-zinc-600 hover:bg-white/[0.07] hover:text-white') + '">' +
      (isActive ? 'Loaded' : 'Load') +
    '</button>';
    return '<div class="flex items-center gap-2 rounded-md border border-line bg-base px-3 py-2.5">' +
      '<div class="min-w-0 flex-1">' +
        '<p class="truncate font-mono text-[11.5px] text-zinc-200">' + escapeHtml(displayName) + '</p>' +
        '<p class="mt-0.5 truncate font-mono text-[10px] text-zinc-600">' + meta + '</p>' +
      '</div>' +
      loadButton +
      '<button type="button" data-rename-model="' + escapeHtml(model.name) + '" aria-label="Rename model" title="Rename model" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-zinc-400 transition hover:border-zinc-600 hover:text-white">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
      '</button>' +
      '<button type="button" data-delete-model="' + escapeHtml(model.name) + '" class="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-300 transition hover:bg-red-500/20">Delete</button>' +
    '</div>';
  }).join('');
}

async function renderModelManager() {
  if (!modelList) return [];
  try {
    const models = await readInstalledModels();
    renderModelList(models);
    const total = models.reduce((sum, model) => sum + model.size, 0);
    if (settingsStorageTotal) settingsStorageTotal.innerText = formatBytes(total);
    if (storageUsage) storageUsage.innerText = total > 0 ? formatBytes(total) : 'No models';
    return models;
  } catch (error) {
    console.warn('Could not list models:', error);
    renderModelList([]);
    if (settingsStorageTotal) settingsStorageTotal.innerText = 'Unavailable';
    return [];
  }
}

async function refreshModelManager() {
  const models = await renderModelManager();
  await renderModelSelector();
  return models;
}

async function updateStorageMeter() {
  try {
    const models = await getInstalledModels();
    const total = models.reduce((sum, model) => sum + model.size, 0);
    if (storageUsage) storageUsage.innerText = total > 0 ? formatBytes(total) : 'No models';
    if (settingsStorageTotal) settingsStorageTotal.innerText = formatBytes(total);
    return total;
  } catch (error) {
    if (storageUsage) storageUsage.innerText = '';
    return 0;
  }
}

async function updateStorageLocation() {
  try {
    const { Filesystem } = getPlugins();
    if (!Filesystem) return;
    const result = await Filesystem.getUri({ path: '', directory: Directory.Data });
    storageLocationText.innerText = result.uri || 'App private storage (Directory.Data)';
    storageLocationText.title = result.uri || '';
  } catch (error) {
    storageLocationText.innerText = 'App private storage (Directory.Data)';
  }
}

function applySettingsToControls() {
  if (temperatureSlider) temperatureSlider.value = String(appSettings.temperature);
  if (temperatureValue) temperatureValue.innerText = appSettings.temperature.toFixed(1);
  if (maxTokensSlider) maxTokensSlider.value = String(appSettings.maxTokens);
  if (maxTokensValue) maxTokensValue.innerText = String(appSettings.maxTokens);
  if (repeatPenaltySlider) repeatPenaltySlider.value = String(appSettings.repeatPenalty);
  if (repeatPenaltyValue) repeatPenaltyValue.innerText = appSettings.repeatPenalty.toFixed(2);
}

async function loadSettings() {
  try {
    const { Preferences } = getPlugins();
    if (Preferences) {
      const { value } = await Preferences.get({ key: SETTINGS_KEY });
      if (value) {
        const parsed = JSON.parse(value);
        appSettings.temperature = clampNumber(parsed.temperature, 0, 1, DEFAULT_SETTINGS.temperature);
        appSettings.maxTokens = Math.round(clampNumber(parsed.maxTokens, 128, 1024, DEFAULT_SETTINGS.maxTokens));
        appSettings.repeatPenalty = clampNumber(parsed.repeatPenalty, 1, 2, DEFAULT_SETTINGS.repeatPenalty);
      }
    }
  } catch (error) {
    console.warn('Could not load settings:', error);
  }
  applySettingsToControls();
}

async function saveSettings() {
  try {
    const { Preferences } = getPlugins();
    if (!Preferences) return;
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(appSettings) });
  } catch (error) {
    console.warn('Could not save settings:', error);
  }
}

function scheduleSaveSettings(delay) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null;
    saveSettings();
  }, delay == null ? 500 : delay);
}

async function updateAppVersion() {
  let version = '1.0.5';
  try {
    const { Device } = getPlugins();
    if (Device) {
      const info = await Device.getInfo();
      if (info && info.appVersion) version = info.appVersion;
    }
  } catch (error) {}
  if (appVersionEl) appVersionEl.innerText = version;
  if (sidebarVersionEl) sidebarVersionEl.innerText = 'v' + version.split('.').slice(0, 2).join('.');
}

async function openSettings() {
  settingsModal.classList.remove('hidden');
  settingsModal.style.display = 'flex';
  applySettingsToControls();
  await Promise.all([
    refreshModelManager(),
    updateStorageLocation(),
    updateAppVersion(),
    loadModelPersonalization(),
  ]);
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

function closeSidebar() {
  const navToggle = document.getElementById('nav-toggle');
  if (navToggle) navToggle.checked = false;
}

async function setupBackButtonHandler() {
  try {
    const { App } = getPlugins();
    if (!App || typeof App.addListener !== 'function') return;
    await App.addListener('backButton', () => {
      if (settingsModal && settingsModal.style.display === 'flex') {
        closeSettings();
        return;
      }
      const navToggle = document.getElementById('nav-toggle');
      if (navToggle && navToggle.checked) {
        closeSidebar();
        return;
      }
      if (quickSettingsSheet && quickSettingsSheet.style.display === 'flex') {
        closeQuickSettings();
        return;
      }
      if (aliasModal && aliasModal.style.display === 'flex') {
        closeAliasModal();
        return;
      }
      if (confirmModal && confirmModal.style.display === 'flex') {
        resolveConfirm(false);
        return;
      }
      if (ramWarningOverlay && ramWarningOverlay.style.display === 'flex') {
        resolveRamWarning(false);
        return;
      }
      if (typeof App.exitApp === 'function') App.exitApp();
    });
  } catch (error) {
    console.warn('[Fern] Could not register the back button handler:', error);
  }
}

// Belt-and-braces teardown: drops every context the engine still holds so a
// stale llama.cpp instance can block the next model from mmap'ing its file
// (the classic "Model file not found" context release race).
async function releaseEngineContexts() {
  const pro = llamaCppPro();
  if (pro && typeof pro.releaseAllLlama === 'function') {
    try {
      await pro.releaseAllLlama();
      return;
    } catch (error) {
      console.warn('[Fern] releaseAllLlama failed:', error);
    }
  }
  const native = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[LlamaCppPluginName];
  if (native && typeof native.releaseAllContexts === 'function') {
    try {
      await native.releaseAllContexts();
    } catch (error) {
      console.warn('[Fern] releaseAllContexts failed:', error);
    }
  }
}

async function unloadActiveContext() {
  const pro = llamaCppPro();
  const context = activeContext;

  if (context) {
    try {
      if (pro && typeof pro.releaseContext === 'function' && context.id != null) {
        await pro.releaseContext({ contextId: context.id });
      } else if (typeof context.release === 'function') {
        await context.release();
      }
    } catch (error) {
      console.warn('[Fern] Could not release the model context:', error);
    }
    if (activeContext === context) activeContext = null;
  }

  await releaseEngineContexts();
}

async function releaseLoadedModel() {
  await unloadActiveContext();
  contextReady = false;
  isGenerating = false;
  setModelControlsLocked(false);
  generationAbortRequested = false;
  generationRunId++;
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  stopActiveTypewriter();
  await stopGenerationForegroundService();
  updateSendButton();
  setSendEnabled(false);
  setMultimodalSupport(false);
}

async function deleteModel(filename) {
  const confirmed = await showConfirm({
    title: 'Delete model',
    description: 'Delete ' + filename + '? This removes the file from your device.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;

  const deleteChats = await showConfirm({
    title: 'Delete chat histories?',
    description: 'Do you want to also delete all chat histories for this model?',
    cancelText: 'Keep chats',
    confirmText: 'Delete chats',
    danger: true,
  });

  const { Filesystem } = getPlugins();
  const deletingActive = modelName === filename;

  if (deletingActive) await releaseLoadedModel();

  try {
    await Filesystem.deleteFile({ path: filename, directory: Directory.Data });
  } catch (error) {
    console.error('Could not delete model:', error);
    showErrorOverlay('Delete failed', error && error.message ? error.message : String(error));
    return;
  }

  if (deleteChats) {
    const sessionKey = sessionKeyForModel(filename);
    if (sessionKey) delete sessions[sessionKey];
    delete sessions[filename];
    delete modelAliases[filename];
    await saveModelAliases();
    await saveSessions();
  }

  if (deletingActive) {
    modelName = '';
    modelDisplayName = '';
    activeSessionId = '';
    customSystemPrompt = '';
    setModelLabels('');
    updatePersonalizationControls();
    renderSidebarSessions();
    messagesEl.innerHTML = '';
    await clearActiveModelName();
    showEmptyState();
    setEmptyStateMessage('No local model loaded.');
  }
  await refreshModelManager();
}

async function deleteAllModels() {
  const confirmed = await showConfirm({
    title: 'Delete all models',
    description: 'Delete every downloaded model? This cannot be undone.',
    confirmText: 'Delete All',
    danger: true,
  });
  if (!confirmed) return;
  const { Filesystem } = getPlugins();

  await releaseLoadedModel();

  let models = [];
  try {
    models = await getInstalledModels();
  } catch (error) {
    console.warn('Could not list models:', error);
  }

  for (const model of models) {
    try {
      await Filesystem.deleteFile({ path: model.name, directory: Directory.Data });
    } catch (error) {
      console.warn('Could not delete ' + model.name + ':', error);
    }
  }

  modelName = '';
  modelDisplayName = '';
  activeSessionId = '';
  customSystemPrompt = '';
  setModelLabels('');
  updatePersonalizationControls();
  renderSidebarSessions();
  messagesEl.innerHTML = '';
  await clearActiveModelName();
  showEmptyState();
  setEmptyStateMessage('No local model loaded.');
  await refreshModelManager();
  await clearDownloadNotification();
}

async function clearAllFernPreferences() {
  const Preferences = getPreferencesPlugin();
  if (!Preferences) return;

  const shouldRemove = (key) => {
    const value = String(key || '');
    return value.startsWith('fern.') ||
      value === ACTIVE_MODEL_KEY ||
      value === LEGACY_CHAT_HISTORY_KEY ||
      value.startsWith('systemPrompt_');
  };

  try {
    if (typeof Preferences.keys === 'function') {
      const { keys } = await Preferences.keys();
      for (const key of keys || []) {
        if (!shouldRemove(key)) continue;
        try {
          await Preferences.remove({ key });
        } catch (error) {
          console.warn('[Fern] Could not remove ' + key + ':', error);
        }
      }
      return;
    }
  } catch (error) {
    console.warn('[Fern] Could not enumerate preferences:', error);
  }

  const fallbackKeys = [SETTINGS_KEY, SESSIONS_KEY, MODEL_ALIASES_KEY, ACTIVE_MODEL_KEY, LEGACY_CHAT_HISTORY_KEY];
  for (const key of fallbackKeys) {
    try {
      await Preferences.remove({ key });
    } catch (error) {
      console.warn('[Fern] Could not remove ' + key + ':', error);
    }
  }
}

async function clearAppData() {
  const confirmed = await showConfirm({
    title: 'Clear app data',
    description: 'Delete all downloaded models and clear every chat? This cannot be undone.',
    confirmText: 'Clear Data',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await releaseLoadedModel();
    await chatSaveChain;

    const { Filesystem } = getPlugins();
    if (Filesystem) {
      const models = await getInstalledModels();
      for (const model of models) {
        try {
          await Filesystem.deleteFile({ path: model.name, directory: Directory.Data });
        } catch (error) {
          console.warn('Could not delete ' + model.name + ':', error);
        }
      }
    }

    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
    clearTimeout(systemPromptSaveTimer);
    systemPromptSaveTimer = null;

    await clearAllFernPreferences();

    appSettings = { ...DEFAULT_SETTINGS };
    modelAliases = {};
    sessions = {};
    pendingLegacyMessages = null;
    customSystemPrompt = '';
    activeDownloadCancel = null;
    chatSaveChain = Promise.resolve();

    applySettingsToControls();
    resetToNoModelState();
    updatePersonalizationControls();
    renderSidebarSessions();
    setAdvancedSettingsExpanded(false);
    await clearDownloadNotification();
    await refreshModelManager();
    await updateStorageLocation();
    closeSettings();
    closeQuickSettings();
    hideOverlay();
  } catch (error) {
    console.error('Clear app data failed:', error);
    showErrorOverlay('Clear failed', error && error.message ? error.message : String(error));
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ============================================================
// 4. MODEL LOADING
// ============================================================
function isOutOfMemoryError(error) {
  const text = String(
    (error && (error.message || error.errorMessage || error.code || error.name)) || error || ''
  ).toLowerCase();
  return /bad_alloc|out of memory|\boom\b|not enough memory|cannot allocate|memory allocation|failed to allocate/.test(text);
}

function reportModelLoadError(error) {
  if (error && error.fernCancelled) return;
  const message = String((error && (error.message || error.errorMessage)) || error || '');
  if (isOutOfMemoryError(error)) {
    showErrorOverlay('Out of Memory', "Out of Memory: Your device couldn't handle this model. Please try a smaller model.");
    return;
  }
  showErrorOverlay('Could not load model', message || 'Failed to load model');
}

async function getModelSizeBytes(modelPath) {
  const { Filesystem } = getPlugins();
  if (!Filesystem) return 0;

  const candidates = [];
  if (modelName) candidates.push({ path: modelName, directory: Directory.Data });
  const rawPath = String(modelPath || '').replace(/^file:\/\//, '');
  if (rawPath && rawPath !== modelName) candidates.push({ path: rawPath });

  for (const candidate of candidates) {
    try {
      const stat = await Filesystem.stat(candidate);
      const size = Number(stat && stat.size);
      if (size > 0) return size;
    } catch (error) {}
  }
  return 0;
}

async function getDeviceMemoryStats() {
  const stats = { total: 0, available: 0, diskFree: 0, memUsed: 0 };

  try {
    const { Device } = getPlugins();
    if (Device) {
      const info = await Device.getInfo();
      stats.total = Number(info && (info.memTotal || info.totalMemory || info.memoryTotal)) || 0;
      stats.memUsed = Number(info && info.memUsed) || 0;
      stats.diskFree = Number(info && (info.realDiskFree || info.diskFree)) || 0;
      if (stats.total > 0) {
        stats.available = Math.max(stats.total - stats.memUsed, 0);
      }
    }
  } catch (error) {
    console.warn('[Fern] Device.getInfo failed:', error);
  }

  // WebView fallback: navigator.deviceMemory is the approximate total RAM in GB.
  if (!stats.total) {
    const deviceMemory = Number(navigator.deviceMemory) || 0;
    if (deviceMemory > 0) {
      stats.total = deviceMemory * 1073741824;
      stats.available = stats.total;
    }
  }

  if (!stats.available) stats.available = stats.total;
  return stats;
}

async function runMemoryPreflight(modelPath) {
  const modelSize = await getModelSizeBytes(modelPath);
  if (!modelSize) return;

  const stats = await getDeviceMemoryStats();
  console.log('[Fern] memory preflight:', {
    modelSize,
    availableRam: stats.available,
    totalRam: stats.total,
    diskFree: stats.diskFree,
  });

  if (!stats.available) return;
  if (modelSize <= stats.available * 0.6) return;

  const sizeGb = (modelSize / 1073741824).toFixed(2);
  const proceed = await showRamWarning(
    'Warning: This model is ' + sizeGb + 'GB. Your device may not have enough RAM to run it. ' +
    'Loading it might crash the app. Do you want to proceed?'
  );

  if (!proceed) {
    const error = new Error('Model load cancelled by user');
    error.fernCancelled = true;
    throw error;
  }
}

async function loadModelFile(modelPath, notify, options) {
  // Double-tap / model-switch-while-loading guard: only one load may run at a
  // time. Mark the rejection as a non-error user no-op so the caller does not
  // report a scary failure for an extra tap.
  if (isModelLoading) {
    const busyError = new Error('A model load is already in progress.');
    busyError.fernCancelled = true;
    throw busyError;
  }
  isModelLoading = true;
  setModelControlsLocked(true);
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  try {
    await runModelLoad(modelPath, notify, options);
  } finally {
    isModelLoading = false;
    setModelControlsLocked(false);
  }
}

async function runModelLoad(modelPath, notify, options) {
  const exactPath = !!(options && options.exact);
  const pro = llamaCppPro();
  if (!pro) {
    const diag = {
      capacitorLlamaCpp: typeof window.capacitorLlamaCpp,
      nativeLlamaCpp: !!(window.Capacitor && window.Capacitor.Plugins[LlamaCppPluginName]),
      pluginNames: window.Capacitor ? Object.keys(window.Capacitor.Plugins) : [],
    };
    console.error('[Fern] llama-cpp-pro runtime not found:', diag);
    throw new Error('llama-cpp-pro runtime is unavailable. ' +
      'Check the device console: capacitorLlamaCpp bundle = ' + diag.capacitorLlamaCpp +
      ', native LlamaCpp plugin = ' + diag.nativeLlamaCpp + '.');
  }

  // Completely unload whatever is resident before touching initLlama().
  // releaseAllContexts is awaited so the native engine is guaranteed idle
  // before the next model file is opened (no release/load race).
  if (isGenerating) {
    try { await stopGeneration(); } catch (stopError) {
      console.warn('[Fern] Could not stop generation before unload:', stopError);
    }
    isGenerating = false;
  }
  await unloadActiveContext();
  await releaseEngineContexts();
  contextReady = false;
  activeContext = null;
  stopActiveTypewriter();
  generationRunId++;
  generationAbortRequested = false;

  await keepScreenAwake();
  try {
    await runMemoryPreflight(modelPath);

    if (notify) notify('Initializing context: ' + modelName);

    // The FilePicker returns content:// URIs that the native loader cannot
    // open directly (keep them verbatim). Downloaded models are resolved to
    // file:// URIs by Filesystem.getUri() and must be stripped to a raw
    // absolute path (/data/user/0/.../files/foo.gguf) before fopen().
    const normalizeModelPath = (p) => String(p || '').replace(/^file:\/\//, '');
    const candidates = exactPath
      ? [normalizeModelPath(modelPath)]
      : [normalizeModelPath(modelPath.replace(/^(content|file):\/\//, '')), modelName].filter(Boolean);

    let lastError = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        console.log('Available Plugins:', Object.keys(window.Capacitor.Plugins));
        console.log('[Fern] pre-init:', {
          'window.capacitorLlamaCpp': window.capacitorLlamaCpp,
          nativeLlamaCpp: !!window.Capacitor.Plugins[LlamaCppPluginName],
          resolvedRuntime: pro === window.capacitorLlamaCpp ? 'bundle' : 'native-bridge-fallback',
          model: candidate,
        });
        const context = await pro.initLlama({
          model: candidate,
          n_ctx: 2048,
          n_batch: 512,
          n_threads: Math.max(2, (navigator.hardwareConcurrency || 4) - 1),
          ctx_shift: true,
        });
        activeContext = context;
        return context;
      } catch (e) {
        lastError = e;
        if (isOutOfMemoryError(e)) break;
      }
    }
    throw lastError || new Error('Could not initialize model context');
  } finally {
    await allowScreenSleep();
  }
}

async function statModelInData(filename) {
  try {
    const { Filesystem } = getPlugins();
    const stat = await Filesystem.stat({ path: filename, directory: Directory.Data });
    return !!stat && Number(stat.size) > 0;
  } catch (error) {
    return false;
  }
}

// Filesystem.getUri() returns a file:///data/user/0/... URI, but the native
// llama.cpp engine opens the model with fopen() and needs the raw absolute
// path without any scheme prefix.
async function resolveRawModelPath(filename) {
  const { Filesystem } = getPlugins();
  if (!Filesystem) throw new Error('The Filesystem plugin is not installed.');
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Data });
  if (!uri) throw new Error('Could not resolve the saved model path');
  return String(uri).replace(/^file:\/\//, '');
}

async function loadInstalledModel(filename, options) {
  const opts = options || {};
  const selectSessionId = typeof opts.selectSessionId === 'string' ? opts.selectSessionId : '';
  if (!filename) return false;

  const isModelLoaded = (target) => modelName === target && contextReady;
  if (isModelLoaded(filename) && (!selectSessionId || selectSessionId === activeSessionId)) {
    await refreshModelManager();
    return true;
  }

  if (!(await statModelInData(filename))) {
    showErrorOverlay('Model not found', filename + ' is no longer on this device.');
    await refreshModelManager();
    return false;
  }

  // Snapshot the whole app state so a failed switch can put it back exactly.
  const previousModelName = modelName;
  const previousModelDisplayName = modelDisplayName;
  const previousSessionId = activeSessionId;

  // Switch chat scope to the incoming model instantly: the sidebar and the
  // message area re-render for the target model's history right away.
  modelName = filename;
  modelDisplayName = getModelAlias(filename);
  activeSessionId = selectSessionId;
  customSystemPrompt = '';
  syncModelDisplayName();
  setModelLabels(filename);
  renderSidebarSessions();
  renderSessionMessages();
  updatePersonalizationControls();
  setSendEnabled(false);
  showOverlay('Loading ' + (modelDisplayName || filename) + ' (this can take a while)...');
  progressBar.style.display = '';
  progressBar.style.width = '100%';

  let loadSucceeded = false;
  try {
    const rawPath = await resolveRawModelPath(filename);

    // Fully release the previous model's context (waitFor finish) before
    // initLlama touches the next file — this is the release race fix.
    await loadModelFile(rawPath, null, { exact: true });
    await saveActiveModelName(filename);
    await onModelReady();

    if (selectSessionId) {
      const list = ensureModelSessions(filename);
      if (list.some((session) => session.id === selectSessionId)) {
        activeSessionId = selectSessionId;
        renderSidebarSessions();
        renderSessionMessages();
      } else if (list.length > 0) {
        activeSessionId = list[0].id;
      }
    }

    await updateStorageMeter();
    await refreshModelManager();
    loadSucceeded = true;
    return true;
  } catch (error) {
    console.error('Model switch failed:', error);

    // DO NOT wipe app state: put back the exact previous model/session scope.
    const previousContextStillLoaded = contextReady && !!previousModelName;
    modelName = previousModelName;
    modelDisplayName = previousModelDisplayName || (previousModelName ? getModelAlias(previousModelName) : '');
    activeSessionId = previousSessionId;
    customSystemPrompt = '';

    if (previousModelName) {
      syncModelDisplayName();
      setModelLabels(previousModelName);
      renderSidebarSessions();
      renderSessionMessages();
      await loadModelPersonalization();
      updatePersonalizationControls();
    } else {
      resetToNoModelState();
    }

    // The failed switch released the old context; restore the previous model
    // from disk only when it is genuinely no longer resident.
    if (!previousContextStillLoaded) {
      contextReady = false;
      activeContext = null;

      if (previousModelName && await statModelInData(previousModelName)) {
        try {
          const rawPath = await resolveRawModelPath(previousModelName);
          await loadModelFile(rawPath, null, { exact: true });
          await saveActiveModelName(previousModelName);
          await onModelReady({ announce: false });
          renderSessionMessages();
        } catch (restoreError) {
          console.error('Could not restore the previous model:', restoreError);
        }
      }

      if (!contextReady) {
        setSendEnabled(false);
      }
    } else {
      contextReady = true;
      setSendEnabled(true);
    }

    await refreshModelManager();
    if (!error || !error.fernCancelled) reportModelLoadError(error);
    return false;
  } finally {
    hideOverlay();
    progressBar.style.display = 'none';
    if (loadSucceeded && !isGenerating) setSendEnabled(contextReady);
  }
}

async function downloadAndLoadModel(url, filename) {
  const { Filesystem, FileTransfer } = getPlugins();

  if (!Filesystem) {
    showErrorOverlay('Filesystem unavailable', 'The Filesystem plugin is not installed.');
    return;
  }

  // Already on disk: switch to it without touching the file.
  if (await statModelInData(filename)) {
    await loadInstalledModel(filename);
    return;
  }

  if (!FileTransfer) {
    showErrorOverlay('FileTransfer unavailable', 'The FileTransfer plugin is not installed.');
    return;
  }

  const requiredBytes = getCatalogModelBytes(filename);
  const freeBytes = await getFreeDiskSpace();
  if (requiredBytes > 0 && freeBytes > 0 && freeBytes < requiredBytes + 67108864) {
    showErrorOverlay(
      'Not enough storage',
      'This model needs about ' + formatBytes(requiredBytes) + ' but only ' + formatBytes(freeBytes) + ' is free.'
    );
    return;
  }

  // Download into a partial .tmp file so cancelling can never remove a model
  // that was already loaded before this download started.
  const tmpFilename = filename + '.tmp';
  const previousModelName = modelName;
  const previousModelDisplayName = modelDisplayName;
  const previousSessionId = activeSessionId;

  showOverlay('Downloading ' + filename + '... Please wait.');
  progressBar.style.display = '';
  progressBar.style.width = '0%';
  setSendEnabled(false);
  showDownloadingNotification(filename);
  if (cancelDownloadBtn) cancelDownloadBtn.classList.remove('hidden');

  let progressListener = null;
  let cancelRequested = false;

  const deletePartialDownload = async () => {
    try {
      await Filesystem.deleteFile({ path: tmpFilename, directory: Directory.Data });
    } catch (cleanupError) {}
  };

  const restorePreviousModelUI = () => {
    if (previousModelName) {
      modelName = previousModelName;
      modelDisplayName = previousModelDisplayName || getModelAlias(previousModelName);
      activeSessionId = previousSessionId;
      setModelLabels(modelName);
      updatePersonalizationControls();
      renderSidebarSessions();
      renderSessionMessages();
      setSendEnabled(contextReady);
    } else {
      resetToNoModelState();
    }
    updateSendButton();
    setSendEnabled(contextReady);
  };

  const cancelDownload = async () => {
    if (cancelRequested) return;
    cancelRequested = true;

    try {
      if (typeof FileTransfer.abort === 'function') {
        await FileTransfer.abort();
      } else if (typeof FileTransfer.cancel === 'function') {
        await FileTransfer.cancel();
      } else if (typeof FileTransfer.removeAllListeners === 'function') {
        await FileTransfer.removeAllListeners();
      }
    } catch (cancelError) {}

    if (progressListener) {
      try {
        await progressListener.remove();
      } catch (removeError) {}
      progressListener = null;
    }

    if (cancelDownloadBtn) cancelDownloadBtn.classList.add('hidden');
    hideOverlay();
    await deletePartialDownload();
    await clearDownloadNotification();
    progressBar.style.display = 'none';
    progressBar.style.width = '0%';
    restorePreviousModelUI();
  };

  activeDownloadCancel = cancelDownload;

  try {
    await deletePartialDownload();

    const { uri } = await Filesystem.getUri({ path: tmpFilename, directory: Directory.Data });
    if (!uri) {
      throw new Error('Could not resolve the download destination path');
    }

    progressListener = await FileTransfer.addListener('progress', (progress) => {
      if (cancelRequested) return;
      if (!progress || progress.type === 'upload') return;
      if (progress.url && url && progress.url !== url) return;

      const loaded = Number(progress.bytes != null ? progress.bytes : progress.bytesLoaded) || 0;
      const total = Number(progress.contentLength != null ? progress.contentLength : progress.totalBytes) || 0;

      if (total <= 0) {
        progressText.innerText = 'Downloading: ' + formatBytes(loaded);
        return;
      }

      const percentage = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
      progressText.innerText = 'Downloading: ' + percentage + '% (' + formatBytes(loaded) + ' / ' + formatBytes(total) + ')';
      progressBar.style.width = percentage + '%';
    });

    await FileTransfer.downloadFile({
      url,
      path: uri,
      progress: true,
    });

    if (cancelRequested) {
      await deletePartialDownload();
      return;
    }

    let tmpStat = null;
    try {
      tmpStat = await Filesystem.stat({ path: tmpFilename, directory: Directory.Data });
    } catch (statError) {
      throw new Error('Download failed: File not saved properly.');
    }
    if (!tmpStat || Number(tmpStat.size) <= 0) {
      throw new Error('Download failed: File not saved properly.');
    }

    // Promote the completed .tmp file to its final model name.
    let finalized = false;
    try {
      await Filesystem.rename({
        from: tmpFilename,
        to: filename,
        directory: Directory.Data,
        toDirectory: Directory.Data,
      });
      finalized = true;
    } catch (renameError) {
      try {
        await Filesystem.copy({
          from: tmpFilename,
          to: filename,
          directory: Directory.Data,
          toDirectory: Directory.Data,
        });
        finalized = true;
      } catch (copyError) {
        console.warn('Could not finalize the downloaded model:', copyError);
      }
      if (finalized) {
        try {
          await Filesystem.deleteFile({ path: tmpFilename, directory: Directory.Data });
        } catch (cleanupError) {}
      }
    }

    if (!finalized) {
      throw new Error('Download failed: Could not finalize the model file.');
    }

    if (cancelRequested) return;

    let savedStat = null;
    try {
      savedStat = await Filesystem.stat({ path: filename, directory: Directory.Data });
    } catch (statError) {
      throw new Error('Download failed: File not saved properly.');
    }
    if (!savedStat || Number(savedStat.size) <= 0) {
      throw new Error('Download failed: File not saved properly.');
    }

    const rawPath = await resolveRawModelPath(filename);

    if (progressListener) {
      try {
        await progressListener.remove();
      } catch (removeError) {}
      progressListener = null;
    }
    progressBar.style.width = '100%';
    progressBar.style.display = 'none';

    modelName = filename;
    modelDisplayName = getModelAlias(filename);
    setModelLabels(filename);
    renderSidebarSessions();
    showOverlay('Loading ' + (modelDisplayName || filename) + ' (this can take a while)...');
    await loadModelFile(rawPath, null, { exact: true });
    await saveActiveModelName(filename);
    await onModelReady();
    await updateStorageMeter();
    await refreshModelManager();
    showModelReadyNotification(filename);
  } catch (error) {
    if (cancelRequested) return;
    console.error('Model download failed:', error);
    const cancelled = !!(error && error.fernCancelled);
    if (!cancelled) {
      await deletePartialDownload();
    }
    await clearDownloadNotification();
    hideOverlay();
    restorePreviousModelUI();

    if (!contextReady && previousModelName && await statModelInData(previousModelName)) {
      try {
        const rawPath = await resolveRawModelPath(previousModelName);
        await loadModelFile(rawPath, null, { exact: true });
        await saveActiveModelName(previousModelName);
        await onModelReady({ announce: false });
      } catch (restoreError) {
        console.error('Could not restore the previous model:', restoreError);
      }
    }

    if (!cancelled) {
      if (isOutOfMemoryError(error)) {
        showErrorOverlay('Out of Memory', "Out of Memory: Your device couldn't handle this model. Please try a smaller model.");
      } else {
        showErrorOverlay('Download failed', error && error.message ? error.message : String(error));
      }
    }
  } finally {
    if (progressListener) {
      try {
        await progressListener.remove();
      } catch (removeError) {}
      progressListener = null;
    }
    if (cancelDownloadBtn) cancelDownloadBtn.classList.add('hidden');
    progressBar.style.display = 'none';
    if (activeDownloadCancel === cancelDownload) activeDownloadCancel = null;
  }
}

async function pickAndLoadModel() {
  setSendEnabled(false);
  showOverlay('Selecting model file...');

  const previousModelName = modelName;
  const previousModelDisplayName = modelDisplayName;
  const previousSessionId = activeSessionId;

  try {
    const { FilePicker, Filesystem } = getPlugins();
    if (!Filesystem) {
      throw new Error('The Filesystem plugin is not installed.');
    }
    if (!FilePicker) {
      throw new Error('The FilePicker plugin is not installed.');
    }
    const result = await FilePicker.pickFiles({
      types: ['*/*', 'application/octet-stream'],
      limit: 1,
    });
    const file = result && result.files && result.files[0];
    if (!file) return;
    const filename = String(file.name || file.path || '').split('/').pop();
    if (!filename || !/\.gguf$/i.test(filename)) {
      appendMessage('assistant', 'That file is not a .gguf model. Please select a .gguf file.');
      return;
    }
    if (!file.path) {
      throw new Error('The selected file did not provide a readable path');
    }

    // The FilePicker returns a content:// SAF URI that the native llama.cpp
    // engine cannot open with fopen(). Copy it into the app's private vault
    // with a native stream (no Base64 round-trip, so large models don't OOM)
    // and hand the resolved file:///data/user/0/... path to the engine.
    // `toDirectory` (not `directory`) is required: `directory` applies to the
    // source too, which would make the plugin treat the content:// URI as a
    // relative path inside Directory.Data.
    modelName = filename;
    modelDisplayName = getModelAlias(filename);
    setModelLabels(filename);
    renderSidebarSessions();
    showOverlay('Importing ' + filename + ' into private storage...');
    await Filesystem.copy({
      from: file.path,
      to: filename,
      toDirectory: Directory.Data,
    });

    showOverlay('Loading ' + filename + ' (this can take a while)...');
    const rawPath = await resolveRawModelPath(filename);
    await loadModelFile(rawPath, null, { exact: true });
    await saveActiveModelName(filename);
    await onModelReady();
    await refreshModelManager();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    const cancelled = (error && error.fernCancelled) || /cancel/i.test(message);
    console.error('Model load failed:', error);

    modelName = previousModelName;
    modelDisplayName = previousModelDisplayName;
    activeSessionId = previousSessionId;

    if (previousModelName) {
      setModelLabels(previousModelName);
      updatePersonalizationControls();
      renderSidebarSessions();
      renderSessionMessages();
    } else {
      resetToNoModelState();
    }

    if (!contextReady && previousModelName && await statModelInData(previousModelName)) {
      try {
        const rawPath = await resolveRawModelPath(previousModelName);
        await loadModelFile(rawPath, null, { exact: true });
        await saveActiveModelName(previousModelName);
        await onModelReady({ announce: false });
      } catch (restoreError) {
        console.error('Could not restore the previous model:', restoreError);
      }
    }

    setSendEnabled(contextReady);
    if (!cancelled) reportModelLoadError(error);
  } finally {
    hideOverlay();
    setSendEnabled(contextReady);
  }
}

async function loadPersistedModel() {
  let savedName = '';
  try {
    const Preferences = getPreferencesPlugin();
    if (Preferences) {
      const { value } = await Preferences.get({ key: ACTIVE_MODEL_KEY });
      savedName = value || '';
    }
  } catch (error) {
    console.warn('Could not read the saved model name:', error);
  }

  let targetName = '';

  if (savedName) {
    if (await statModelInData(savedName)) {
      targetName = savedName;
    } else {
      console.warn('[Fern] Saved model no longer exists:', savedName);
      await clearActiveModelName();
    }
  }

  if (!targetName) {
    try {
      const models = await getInstalledModels();
      if (models.length > 0) {
        targetName = models[models.length - 1].name;
      }
    } catch (error) {
      console.warn('Could not scan for installed models:', error);
    }
  }

  if (!targetName) {
    hideOverlay();
    setEmptyStateMessage('No local model loaded.');
    showEmptyState();
    return false;
  }

  modelName = targetName;
  modelDisplayName = targetName;
  setModelLabels(targetName);
  showOverlay('Loading ' + targetName + '...');

  try {
    const { Filesystem } = getPlugins();
    if (!Filesystem) throw new Error('The Filesystem plugin is not installed.');

    const rawPath = await resolveRawModelPath(targetName);
    await loadModelFile(rawPath, null, { exact: true });
    await saveActiveModelName(targetName);
    await onModelReady({ announce: false });
    return true;
  } catch (error) {
    console.error('Model load failed:', error);
    hideOverlay();
    modelName = '';
    modelDisplayName = '';
    activeSessionId = '';
    setModelLabels('');
    updatePersonalizationControls();
    renderSidebarSessions();
    setSendEnabled(false);
    showEmptyState();
    if (!error || !error.fernCancelled) reportModelLoadError(error);
    return false;
  }
}

async function onModelReady(options) {
  const announce = !options || options.announce !== false;
  contextReady = true;
  hideOverlay();
  await loadModelPersonalization();
  setModelLabels(modelName);
  setSendEnabled(true);
  await activateModelSessions();
  await renderModelSelector();
  if (announce && activeMessages().length === 0) {
    appendMessage('assistant', 'I am running locally on your device. Loaded: ' + (modelDisplayName || modelName) + '. No data leaves this machine.');
  }
}

// ============================================================
// 5. CHAT UI RENDERING
// ============================================================
function appendMessage(role, content, options) {
  const persist = !options || options.persist !== false;
  let editIndex = options && Number.isInteger(options.index) ? options.index : -1;
  if (persist) {
    let session = getActiveSession();
    if (!session && modelName) {
      session = createSessionRecord('New chat', []);
      ensureModelSessions(modelName).unshift(session);
      activeSessionId = session.id;
      renderSidebarSessions();
    }
    if (session) {
      session.messages.push({ role, content });
      capSessionMessages(session);
      if (role === 'user') {
        updateActiveSessionTitle(content);
        editIndex = session.messages.length - 1;
      }
      saveSessions();
    }
  }

  const displayName = modelDisplayName || modelName || 'Local model';
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = role === 'user'
    ? 'group mb-8 flex flex-col items-end'
    : 'group mb-9 flex gap-3';

  if (role === 'user') {
    const editButton = editIndex >= 0
      ? '<button type="button" data-edit-message-index="' + editIndex + '" aria-label="Edit message" title="Edit message" class="flex h-5 w-5 items-center justify-center rounded text-zinc-600 transition hover:bg-white/5 hover:text-white">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
        '</button>'
      : '';
    div.innerHTML =
      '<div class="mb-1.5 flex items-center gap-2 pr-0.5">' +
        editButton +
        '<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">You</span>' +
        '<span class="font-mono text-[10px] text-zinc-600">' + timestamp + '</span>' +
      '</div>' +
      '<div class="max-w-[85%] rounded-lg rounded-br-sm border border-white/[0.04] bg-line px-3.5 py-2.5 sm:max-w-[75%]">' +
        '<p class="break-words [overflow-wrap:anywhere] min-w-0 font-mono text-[13.5px] leading-[1.65] text-white whitespace-pre-wrap">' + escapeHtml(content) + '</p>' +
      '</div>';
  } else {
    div.innerHTML =
      '<div class="mt-0.5 shrink-0">' + getModelAvatarHTML(displayName) + '</div>' +
      '<div class="min-w-0 flex-1">' +
        '<div class="mb-1.5 flex items-center gap-2">' +
          '<span class="text-[12px] font-semibold tracking-tight text-white">' + escapeHtml(displayName) + '</span>' +
          '<span class="font-mono text-[10px] text-zinc-600">' + timestamp + '</span>' +
        '</div>' +
        '<p class="break-words [overflow-wrap:anywhere] min-w-0 font-mono text-[13.5px] leading-[1.75] text-white whitespace-pre-wrap"></p>' +
      '</div>';

    if (content) div.querySelector('p').innerText = content;
  }

  messagesEl.appendChild(div);
  hideEmptyState();
  scheduleAutoScroll();
  return div;
}

function lastAssistantBubble() {
  const bubbles = chatContainer.querySelectorAll('.group');
  return bubbles[bubbles.length - 1];
}

// ============================================================
// 6. GENERATION
// ============================================================
const FERN_SYSTEM_PROMPT = 'You are Fern, a helpful local AI.';
const GENERATION_TIMEOUT_MS = 180000;

function getStopTokens(modelName) {
  const name = String(modelName || '').toLowerCase();
  if (name.includes('llama')) return ['<|eot_id|>', '<|end_of_text|>', '<|start_header_id|>'];
  if (name.includes('qwen')) return ['<|im_end|>', '<|endoftext|>'];
  if (name.includes('gemma')) return ['<end_of_turn>', '<eos>'];
  if (name.includes('phi')) return ['<|end|>', '<|user|>', '<|assistant|>'];
  if (name.includes('mistral')) return ['</s>'];
  return ['</s>', '<|endoftext|>'];
}

function approxTokensForText(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function approxTokensForMessages(messages) {
  return (messages || []).reduce((sum, message) => sum + approxTokensForText(message && message.content) + 4, 0);
}

function trimHistoryForContext(history, systemPrompt) {
  const list = (Array.isArray(history) ? history : [])
    .filter((message) => message && message.role && typeof message.content === 'string')
    .map((message) => ({ role: message.role, content: message.content }));

  const systemTokens = approxTokensForText(systemPrompt) + 4;
  if (systemTokens + approxTokensForMessages(list) <= HISTORY_TOKEN_BUDGET) return list;

  const minimumRecent = Math.min(list.length, MIN_RECENT_MESSAGES);
  const keepRecent = Math.min(list.length, MAX_RECENT_MESSAGES);
  const trimmed = list.slice(list.length - keepRecent);
  let tokens = systemTokens + approxTokensForMessages(trimmed);

  while (trimmed.length > minimumRecent && tokens > HISTORY_TOKEN_BUDGET) {
    tokens -= approxTokensForText(trimmed[0].content) + 4;
    trimmed.shift();
  }

  while (trimmed.length > 1 && systemTokens + approxTokensForMessages(trimmed) > CONTEXT_TOKEN_LIMIT) {
    trimmed.shift();
  }

  if (trimmed.length === 1 && systemTokens + approxTokensForMessages(trimmed) > CONTEXT_TOKEN_LIMIT) {
    const availableChars = Math.max(0, (CONTEXT_TOKEN_LIMIT - systemTokens - 4) * CHARS_PER_TOKEN);
    trimmed[0].content = trimmed[0].content.slice(-availableChars);
  }

  return trimmed;
}

// Universal prompt formatter: picks the correct chat template from the model
// filename so every supported family receives the exact control tokens it
// expects. Returns a single raw prompt string (history already trimmed).
function formatPrompt(modelName, systemPrompt, history) {
  const name = String(modelName || '').toLowerCase();
  const system = String(systemPrompt || '');
  const messages = (Array.isArray(history) ? history : [])
    .filter((msg) => msg && msg.role && typeof msg.content === 'string');

  // Llama 3 / 3.2 — canonical template, byte-exact for a single turn:
  // <|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{systemPrompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{message}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n
  if (name.includes('llama')) {
    const turns = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => `<|start_header_id|>${msg.role}<|end_header_id|>\n\n${msg.content}<|eot_id|>`)
      .join('');
    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${system}<|eot_id|>${turns}<|start_header_id|>assistant<|end_header_id|>\n\n`;
  }

  // Qwen / ChatML
  if (name.includes('qwen')) {
    let prompt = '<|im_start|>system\n' + system + '<|im_end|>\n';
    messages.forEach((msg) => {
      prompt += '<|im_start|>' + msg.role + '\n' + msg.content + '<|im_end|>\n';
    });
    return prompt + '<|im_start|>assistant\n';
  }

  // Gemma (system prompt folded into the first user turn)
  if (name.includes('gemma')) {
    let prompt = '';
    let firstUser = true;
    messages.forEach((msg) => {
      if (msg.role === 'user') {
        const content = firstUser ? system + '\n\n' + msg.content : msg.content;
        firstUser = false;
        prompt += '<start_of_turn>user\n' + content + '<end_of_turn>\n';
      } else if (msg.role === 'assistant') {
        prompt += '<start_of_turn>model\n' + msg.content + '<end_of_turn>\n';
      }
    });
    if (firstUser && system) {
      prompt += '<start_of_turn>user\n' + system + '<end_of_turn>\n';
    }
    return prompt + '<start_of_turn>model\n';
  }

  // Phi
  if (name.includes('phi')) {
    let prompt = '<|system|>\n' + system + '<|end|>\n';
    messages.forEach((msg) => {
      prompt += '<|' + msg.role + '|>\n' + msg.content + '<|end|>\n';
    });
    return prompt + '<|assistant|>\n';
  }

  // Mistral (system prompt folded into the first user instruction)
  if (name.includes('mistral')) {
    let prompt = '';
    let firstUser = true;
    messages.forEach((msg) => {
      if (msg.role === 'user') {
        const content = firstUser && system ? system + '\n\n' + msg.content : msg.content;
        firstUser = false;
        prompt += '[INST] ' + content + ' [/INST]';
      } else if (msg.role === 'assistant') {
        prompt += ' ' + msg.content + '</s>';
      }
    });
    if (firstUser && system) {
      prompt += '[INST] ' + system + ' [/INST]';
    }
    return prompt;
  }

  // Fallback: ChatML
  let prompt = '<|im_start|>system\n' + system + '<|im_end|>\n';
  messages.forEach((msg) => {
    prompt += '<|im_start|>' + msg.role + '\n' + msg.content + '<|im_end|>\n';
  });
  return prompt + '<|im_start|>assistant\n';
}

function showTypingIndicator() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'group mb-9 flex gap-3';
  div.setAttribute('aria-label', 'Fern is typing');
  div.innerHTML =
    '<div class="mt-0.5 shrink-0">' + getModelAvatarHTML(modelDisplayName || modelName) + '</div>' +
    '<div class="min-w-0 flex-1">' +
      '<div class="mb-1.5 flex items-center gap-2">' +
        '<span class="text-[12px] font-semibold tracking-tight text-white">' + escapeHtml(modelDisplayName || modelName || 'Local model') + '</span>' +
      '</div>' +
      '<p class="break-words [overflow-wrap:anywhere] min-w-0 font-mono text-[13.5px] leading-[1.75] text-white whitespace-pre-wrap"></p>' +
      '<div data-typing-dots class="flex h-6 items-center gap-1.5">' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
      '</div>' +
    '</div>';

  messagesEl.appendChild(div);
  hideEmptyState();
  scheduleAutoScroll();
  return div;
}

function persistAssistantMessage(text) {
  const session = getActiveSession();
  if (!session) return;
  session.messages.push({ role: 'assistant', content: text });
  capSessionMessages(session);
  saveSessions();
}

function stopActiveTypewriter() {
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  if (!activeTypewriter) return;
  const { timer, resolve } = activeTypewriter;
  clearInterval(timer);
  activeTypewriter = null;
  if (typeof resolve === 'function') resolve();
}

// Fake streaming: when the native token callback never fires, reveal the
// finished response word by word so the UI still feels responsive.
function simulateTyping(element, text, shouldStop) {
  stopActiveTypewriter();
  return new Promise((resolve) => {
    const words = String(text).match(/\S+\s*/g) || [String(text)];
    let index = 0;
    element.innerText = '';
    clearInterval(activeTypewriterInterval);
    const timer = setInterval(() => {
      if (shouldStop() || index >= words.length) {
        clearInterval(timer);
        if (activeTypewriterInterval === timer) activeTypewriterInterval = null;
        if (activeTypewriter && activeTypewriter.timer === timer) activeTypewriter = null;
        resolve();
        return;
      }
      element.innerText += words[index++];
      scheduleAutoScroll();
    }, 30);
    activeTypewriterInterval = timer;
    activeTypewriter = { timer, resolve, element, text };
  });
}

async function requestNativeAbort() {
  try {
    const native = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[LlamaCppPluginName];
    const pro = llamaCppPro();
    const targets = [activeContext, pro];
    const methodNames = ['stopCompletion', 'abort', 'cancel'];

    for (const target of targets) {
      if (!target) continue;
      for (const methodName of methodNames) {
        if (typeof target[methodName] !== 'function') continue;
        try {
          if (methodName === 'stopCompletion' && target.id != null && target === pro) {
            await target.stopCompletion({ contextId: target.id });
          } else {
            await target[methodName]();
          }
          return;
        } catch (error) {
          console.warn('[Fern] ' + methodName + ' failed:', error);
        }
      }
    }

    if (native && typeof native.stopCompletion === 'function' && activeContext && activeContext.id != null) {
      await native.stopCompletion({ contextId: activeContext.id });
    }
  } catch (error) {
    console.warn('[Fern] stopGeneration failed:', error);
  }
}

async function stopGeneration() {
  if (!isGenerating) return;
  generationAbortRequested = true;

  // Flip the UI instantly so the button responds on the first tap; the
  // native abort is fired in the background and never blocks the repaint.
  isGenerating = false;
  setModelControlsLocked(false);
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  stopActiveTypewriter();
  updateSendButton();
  sendBtn.innerHTML = SEND_ICON_HTML;
  sendBtn.setAttribute('aria-label', 'Send message');
  stopGenerationForegroundService();
  requestNativeAbort();
}

async function generateResponse(userPrompt) {
  if (!contextReady || isGenerating || !activeContext) return;

  const runId = ++generationRunId;
  const isCurrentRun = () => generationRunId === runId;

  appendMessage('user', userPrompt);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const bubble = showTypingIndicator();
  const bubbleText = bubble.querySelector('p');
  let bubbleDots = bubble.querySelector('[data-typing-dots]');

  const revealBubble = (content) => {
    if (bubbleDots && bubbleDots.parentNode) bubbleDots.remove();
    bubbleDots = null;
    if (bubble.id === 'typing-indicator') bubble.removeAttribute('id');
    if (typeof content === 'string') bubbleText.innerText = content;
    return bubbleText;
  };

  const finalizeStopped = () => {
    if (!isCurrentRun()) {
      if (bubble && bubble.parentNode) bubble.remove();
      return;
    }
    const partial = bubbleText ? bubbleText.innerText : '';
    if (partial.trim()) {
      revealBubble(partial);
      persistAssistantMessage(partial);
    } else if (bubble && bubble.parentNode) {
      bubble.remove();
    }
    scheduleAutoScroll();
  };

  let timeoutFinalized = false;
  const finalizeTimedOut = () => {
    if (timeoutFinalized) return;
    timeoutFinalized = true;
    const partial = bubbleText ? bubbleText.innerText : '';
    const timeoutText = partial.trim()
      ? partial + '\n\n[Generation timed out]'
      : 'Generation timed out';
    revealBubble(timeoutText);
    persistAssistantMessage(timeoutText);
    notifyBackgroundResponse(timeoutText);
    scheduleAutoScroll();
  };

  isGenerating = true;
  generationAbortRequested = false;
  setModelControlsLocked(true);
  let generationTimedOut = false;
  let timeoutId = null;
  updateSendButton();
  await startGenerationForegroundService();
  await keepScreenAwake();

  const isAborted = () => generationAbortRequested || !isCurrentRun();

  let streamed = false;
  try {
    if (isAborted()) {
      finalizeStopped();
      return;
    }

    const systemPrompt = (customSystemPrompt && customSystemPrompt.trim()) || FERN_SYSTEM_PROMPT;
    const history = trimHistoryForContext(activeMessages(), systemPrompt);
    if (history.length !== activeMessages().length) {
      console.log('[Fern] trimmed chat context to ' + history.length + ' recent messages');
    }
    const formattedPrompt = formatPrompt(modelName, systemPrompt, history);
    if (isAborted()) {
      finalizeStopped();
      return;
    }

    timeoutId = setTimeout(() => {
      if (!isGenerating || generationTimedOut || !isCurrentRun()) return;
      generationTimedOut = true;
      finalizeTimedOut();
      stopGeneration();
    }, GENERATION_TIMEOUT_MS);

    const tokenCallback = (data) => {
      const tok = (data && (data.token || data.content || data.text)) || '';
      if (!tok || generationTimedOut || isAborted()) return;
      streamed = true;
      revealBubble();
      bubbleText.innerText += tok;
      scheduleAutoScroll();
    };

    const isLlamaModel = String(modelName || '').toLowerCase().includes('llama');

    console.log("RAW PROMPT:", formattedPrompt);

    const result = await activeContext.completion({
      prompt: formattedPrompt,
      messages: null,
      chatTemplate: null,
      chat_template: null,
      applyTemplate: false,
      n_predict: isLlamaModel ? 256 : appSettings.maxTokens,
      temperature: isLlamaModel ? 0.3 : appSettings.temperature,
      top_k: 40,
      penalty_repeat: appSettings.repeatPenalty,
      repeat_penalty: 1.15,
      stop: getStopTokens(modelName),
    }, tokenCallback);

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (generationTimedOut) {
      finalizeTimedOut();
      return;
    }
    if (isAborted()) {
      finalizeStopped();
      return;
    }

    const fullText = (result && (result.content || result.text)) || '';
    const finalText = fullText || (streamed ? bubbleText.innerText : '') || '[Empty response]';

    if (!streamed && finalText !== '[Empty response]') {
      // The native token callback never fired: simulate typing so the user
      // still sees the response arrive progressively.
      revealBubble();
      await simulateTyping(bubbleText, finalText, () => generationTimedOut || isAborted());
      if (generationTimedOut) {
        finalizeTimedOut();
        return;
      }
      if (isAborted()) {
        finalizeStopped();
        return;
      }
      bubbleText.innerText = finalText;
    } else {
      revealBubble(finalText);
      bubbleText.innerText = finalText;
    }

    persistAssistantMessage(finalText);
    notifyBackgroundResponse(finalText);
    scheduleAutoScroll();
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (generationTimedOut) {
      finalizeTimedOut();
      return;
    }
    if (isAborted()) {
      finalizeStopped();
      return;
    }
    console.error('Generation error:', error);
    if (isOutOfMemoryError(error)) {
      if (bubble && bubble.parentNode) bubble.remove();
      showErrorOverlay('Out of Memory', "Out of Memory: Your device couldn't handle this model. Please try a smaller model.");
    } else {
      const message = '[Error: ' + (error.message || String(error)) + ']';
      revealBubble(message);
      persistAssistantMessage(message);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    stopActiveTypewriter();
    if (isCurrentRun()) {
      await allowScreenSleep();
      if (!generationAbortRequested) {
        isGenerating = false;
        setModelControlsLocked(false);
        generationAbortRequested = false;
        updateSendButton();
        sendBtn.innerHTML = SEND_ICON_HTML;
        sendBtn.setAttribute('aria-label', 'Send message');
        await stopGenerationForegroundService();
      }
    }
  }
}

// ============================================================
// 7. QUICK SETTINGS, EXPORT & IMPORT
// ============================================================
function openQuickSettings() {
  applySettingsToControls();
  setAdvancedSettingsExpanded(false);
  if (!quickSettingsSheet) return;
  quickSettingsSheet.style.display = 'flex';
}

function closeQuickSettings() {
  if (!quickSettingsSheet) return;
  quickSettingsSheet.style.display = 'none';
}

async function exportActiveChat() {
  const session = getActiveSession();
  if (!modelName || !session || session.messages.length === 0) {
    showErrorOverlay('Nothing to export', 'Load a model and start a chat before exporting.');
    return;
  }

  try {
    const { Filesystem, Share } = getPlugins();
    if (!Filesystem) throw new Error('The Filesystem plugin is not installed.');
    if (!Share) throw new Error('The Share plugin is not installed.');

    const payload = {
      app: 'Fern',
      type: 'fern.chat',
      version: 1,
      exportedAt: new Date().toISOString(),
      model: modelName,
      modelDisplayName: modelDisplayName || modelName,
      session: {
        title: session.title || 'New chat',
        messages: session.messages,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = 'fern-chat-' + Date.now() + '.json';

    const written = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: 'utf8',
    });
    if (!written || !written.uri) throw new Error('Could not write the chat export.');

    try {
      await Share.share({
        title: 'Fern Chat Export',
        url: written.uri,
        dialogTitle: 'Save or share your chat',
      });
    } catch (shareError) {
      const shareMessage = String(
        (shareError && (shareError.message || shareError.errorMessage || shareError.code)) || shareError || ''
      );
      if (/cancel/i.test(shareMessage)) return;
      throw shareError;
    }
  } catch (error) {
    console.error('Chat export failed:', error);
    showErrorOverlay('Export failed', error && error.message ? error.message : String(error));
  }
}

function base64ToUtf8(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function normalizeImportedChat(parsed) {
  let source = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.session) {
    source = parsed.session;
  }

  let messages = [];
  if (Array.isArray(source)) {
    messages = source;
  } else if (source && Array.isArray(source.messages)) {
    messages = source.messages;
  } else if (parsed && Array.isArray(parsed.messages)) {
    messages = parsed.messages;
  }

  const cleanMessages = normalizeMessageList(messages);
  const title = (source && typeof source.title === 'string' && source.title.trim())
    || (parsed && typeof parsed.title === 'string' && parsed.title.trim())
    || 'Imported chat';

  return { title, messages: cleanMessages };
}

async function importChat() {
  if (!modelName) {
    showErrorOverlay('No model loaded', 'Load a model before importing a chat.');
    return;
  }

  try {
    const { FilePicker } = getPlugins();
    if (!FilePicker) throw new Error('The FilePicker plugin is not installed.');

    const result = await FilePicker.pickFiles({
      types: ['application/json'],
      limit: 1,
      readData: true,
    });
    const file = result && result.files && result.files[0];
    if (!file) return;
    if (!file.name || !/\.json$/i.test(file.name)) {
      showErrorOverlay('Invalid file', 'Please select a .json chat export.');
      return;
    }

    let raw = file.data;
    if (!raw && file.path) {
      const { Filesystem } = getPlugins();
      const read = await Filesystem.readFile({ path: file.path });
      raw = typeof read.data === 'string' ? read.data : '';
    }
    if (!raw) throw new Error('The selected file could not be read.');

    let text = raw;
    if (file.data) {
      try {
        text = base64ToUtf8(raw);
      } catch (decodeError) {
        text = raw;
      }
    }

    const parsed = JSON.parse(text);
    const imported = normalizeImportedChat(parsed);
    if (!imported.messages.length) {
      throw new Error('The file does not contain any chat messages.');
    }

    const session = {
      id: createSessionId(),
      title: imported.title.slice(0, 60),
      model: modelName,
      messages: imported.messages,
    };
    capSessionMessages(session);

    await loadModelAliases();
    syncModelDisplayName();
    setModelLabels(modelName);

    const sessionKey = sessionKeyForModel(modelName) || modelName;
    if (sessionKey !== modelName && Array.isArray(sessions[modelName]) && sessions[modelName].length > 0) {
      sessions[sessionKey] = mergeSessionLists(sessions[sessionKey], sessions[modelName]);
      delete sessions[modelName];
    }
    if (!Array.isArray(sessions[sessionKey])) sessions[sessionKey] = [];
    sessions[sessionKey].unshift(session);
    activeSessionId = session.id;
    renderSidebarSessions();
    renderSessionMessages();
    await saveSessions();
    closeSettings();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if (/cancel/i.test(message)) return;
    console.error('Chat import failed:', error);
    showErrorOverlay('Import failed', message || 'Could not import that chat.');
  }
}

// ============================================================
// 8. EVENT LISTENERS
// ============================================================
sendBtn.addEventListener('click', () => {
  if (isGenerating) {
    stopGeneration();
    return;
  }
  const text = inputEl.value.trim();
  if (text) generateResponse(text);
});

inputEl.addEventListener('keydown', (e) => {
  if (isGenerating) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (text) generateResponse(text);
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = inputEl.scrollHeight + 'px';
});

// MANUAL MODEL LOADING
mainLoadBtn.addEventListener('click', () => {
  pickAndLoadModel();
});

document.getElementById('local-model-btn').addEventListener('click', () => {
  pickAndLoadModel();
});

// ACTIVE MODEL CHIP -> MODEL SELECTOR
const activeModelChipBtn = document.getElementById('active-model-chip-btn');
if (activeModelChipBtn) {
  activeModelChipBtn.addEventListener('click', () => {
    const details = document.getElementById('model-selector-details');
    if (!details) return;
    const navToggle = document.getElementById('nav-toggle');
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile && navToggle) navToggle.checked = true;
    renderModelSelector();
    details.open = true;
  });
}

// MODEL SELECTOR
if (modelSelectorList) {
  modelSelectorList.addEventListener('click', (event) => {
    const loadButton = event.target.closest('[data-load-model]');
    if (loadButton) {
      const details = loadButton.closest('details');
      if (details) details.open = false;
      loadInstalledModel(loadButton.getAttribute('data-load-model'));
      return;
    }
    const button = event.target.closest('[data-model-id]');
    if (!button) return;
    const model = MODEL_CATALOG.find((entry) => entry.id === button.dataset.modelId);
    if (!model) return;
    const details = button.closest('details');
    if (details) details.open = false;
    downloadAndLoadModel(model.url, model.file);
  });
}

// SIDEBAR MODEL DROPDOWN
document.querySelectorAll('details').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (details.open) {
      document.querySelectorAll('details').forEach((other) => {
        if (other !== details) other.open = false;
      });
    }
  });
});

// SETTINGS
settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettings();
});
clearDataBtn.addEventListener('click', clearAppData);
deleteAllModelsBtn.addEventListener('click', deleteAllModels);
importChatBtn.addEventListener('click', importChat);
exportChatBtn.addEventListener('click', exportActiveChat);

// CRYPTO DONATION COPY BUTTONS
document.querySelectorAll('.donate-copy-btn').forEach((button) => {
  button.addEventListener('click', async () => {
    const address = button.getAttribute('data-address');
    if (!address) return;
    const originalText = button.innerText;
    try {
      await navigator.clipboard.writeText(address);
      button.innerText = 'COPIED!';
      setTimeout(() => {
        button.innerText = originalText;
      }, 2000);
    } catch (error) {
      console.warn('Could not copy donation address:', error);
    }
  });
});

systemPromptInput.addEventListener('input', () => {
  customSystemPrompt = systemPromptInput.value;
  if (!modelName) return;

  const targetModel = modelName;
  const targetKey = getSystemPromptKey(targetModel);
  const targetValue = systemPromptInput.value;
  if (systemPromptStatus) systemPromptStatus.innerText = 'Saving...';
  clearTimeout(systemPromptSaveTimer);
  systemPromptSaveTimer = setTimeout(async () => {
    try {
      const Preferences = getPreferencesPlugin();
      if (Preferences) {
        await Preferences.set({ key: targetKey, value: targetValue });
      }
      if (systemPromptStatus && modelName === targetModel) {
        systemPromptStatus.innerText = 'Saved for ' + (modelDisplayName || targetModel) + '.';
      }
    } catch (error) {
      console.warn('Could not save system prompt:', error);
      if (systemPromptStatus) systemPromptStatus.innerText = 'Could not save.';
    }
  }, 350);
});

// QUICK SETTINGS BOTTOM SHEET
quickSettingsBtn.addEventListener('click', openQuickSettings);
closeQuickSettingsBtn.addEventListener('click', closeQuickSettings);
quickSettingsBackdrop.addEventListener('click', closeQuickSettings);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && quickSettingsSheet.style.display === 'flex') {
    closeQuickSettings();
  }
});

function setAdvancedSettingsExpanded(expanded) {
  if (!advancedSettingsPanel || !advancedSettingsToggle) return;
  advancedSettingsPanel.classList.toggle('hidden', !expanded);
  advancedSettingsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const label = advancedSettingsToggle.querySelector('[data-advanced-label]');
  if (label) label.innerText = expanded ? 'Hide advanced' : 'Advanced';
}

advancedSettingsToggle.addEventListener('click', () => {
  const expanded = advancedSettingsPanel.classList.contains('hidden');
  setAdvancedSettingsExpanded(expanded);
});

temperatureSlider.addEventListener('input', () => {
  appSettings.temperature = clampNumber(temperatureSlider.value, 0, 1, DEFAULT_SETTINGS.temperature);
  temperatureValue.innerText = appSettings.temperature.toFixed(1);
  scheduleSaveSettings(500);
});

maxTokensSlider.addEventListener('input', () => {
  appSettings.maxTokens = Math.round(clampNumber(maxTokensSlider.value, 128, 1024, DEFAULT_SETTINGS.maxTokens));
  maxTokensValue.innerText = String(appSettings.maxTokens);
  scheduleSaveSettings(500);
});

repeatPenaltySlider.addEventListener('input', () => {
  appSettings.repeatPenalty = clampNumber(repeatPenaltySlider.value, 1, 2, DEFAULT_SETTINGS.repeatPenalty);
  repeatPenaltyValue.innerText = appSettings.repeatPenalty.toFixed(2);
  scheduleSaveSettings(500);
});

modelList.addEventListener('click', (event) => {
  const loadButton = event.target.closest('[data-load-model]');
  if (loadButton) {
    closeSettings();
    loadInstalledModel(loadButton.getAttribute('data-load-model'));
    return;
  }
  const renameButton = event.target.closest('[data-rename-model]');
  if (renameButton) {
    openAliasModal(renameButton.getAttribute('data-rename-model'));
    return;
  }
  const button = event.target.closest('[data-delete-model]');
  if (!button) return;
  deleteModel(button.getAttribute('data-delete-model'));
});

// MODEL ALIAS MODAL
aliasModalCancel.addEventListener('click', closeAliasModal);
aliasModalSave.addEventListener('click', saveAliasFromModal);
aliasModal.addEventListener('click', (event) => {
  if (event.target === aliasModal) closeAliasModal();
});
aliasModalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveAliasFromModal();
  }
  if (event.key === 'Escape') closeAliasModal();
});

// CANCEL DOWNLOAD
if (cancelDownloadBtn) {
  cancelDownloadBtn.addEventListener('click', () => {
    if (activeDownloadCancel) activeDownloadCancel();
  });
}

// CUSTOM CONFIRM MODAL
confirmModalCancel.addEventListener('click', () => resolveConfirm(false));
confirmModalConfirm.addEventListener('click', () => resolveConfirm(true));
confirmModal.addEventListener('click', (event) => {
  if (event.target === confirmModal) resolveConfirm(false);
});

// EDIT USER MESSAGE
messagesEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-message-index]');
  if (!button) return;
  editUserMessage(Number(button.getAttribute('data-edit-message-index')));
});

// SESSION LIST
if (chatSearchInput) {
  chatSearchInput.addEventListener('input', () => {
    chatSearchQuery = chatSearchInput.value;
    renderSidebarSessions();
  });
}

chatNav.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-session-id]');
  if (deleteButton) {
    deleteSession(deleteButton.getAttribute('data-delete-session-id')).catch((error) => {
      console.error('Session delete failed:', error);
    });
    return;
  }
  const sessionButton = event.target.closest('[data-session-id]');
  if (sessionButton) {
    closeSidebar();
    selectSession(sessionButton.getAttribute('data-session-id')).catch((error) => {
      console.error('Session select failed:', error);
    });
    return;
  }
});

// ERROR OVERLAY
errorDismissBtn.addEventListener('click', closeErrorOverlay);

// RAM WARNING MODAL
ramWarningProceedBtn.addEventListener('click', () => resolveRamWarning(true));
ramWarningCancelBtn.addEventListener('click', () => resolveRamWarning(false));

// NEW CHAT
newChatBtn.addEventListener('click', () => {
  closeSidebar();
  if (!modelName) {
    showErrorOverlay('No model loaded', 'Load a model before starting a new chat.');
    return;
  }
  clearInterval(activeTypewriterInterval);
  activeTypewriterInterval = null;
  stopActiveTypewriter();
  createSession({ title: 'New chat' });
  inputEl.focus();
});

// ============================================================
// 8. BOOTSTRAP
// ============================================================
async function initApp() {
  try {
    setSendEnabled(false);
    setMultimodalSupport(false);

    updateAppVersion();
    await initializeLegacyFlags();
    requestStartupPermissions();
    setupBackButtonHandler();
    updateStorageLocation();
    await cleanupPartialDownloads();

    // 1. Restore generation settings and model aliases.
    await loadSettings();
    await loadModelAliases();
    await renderModelSelector();

    // 2. Restore scoped sessions for every model.
    await loadSessions();
    renderSidebarSessions();
    updatePersonalizationControls();

    // 3. Restore the last model (or scan Directory.Data) and load it.
    await loadPersistedModel();

    await updateStorageMeter();
  } catch (error) {
    console.error('Bootstrap error:', error);
    showErrorOverlay('Init error', error && error.message ? error.message : String(error));
  } finally {
    // 4. Only reveal the app once state restoration is complete.
    hideSplash();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
