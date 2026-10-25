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
        return await native.chat({
          contextId: id,
          messages: params.messages || [],
          params: {
            n_predict: params.n_predict,
            temperature: params.temperature,
            emit_partial_completion: !!callback,
          },
        });
      } finally {
        try { await handle.remove(); } catch (e) {}
      }
    },
    async release() {
      try { await native.releaseContext({ contextId: id }); } catch (e) {}
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
    LocalNotifications: window.Capacitor.Plugins.LocalNotifications,
    Device: window.Capacitor.Plugins.Device,
    Preferences: window.Capacitor.Plugins.Preferences,
  };
};

// Filesystem.Directory enum values are not exposed on the global bridge.
const Directory = { Data: 'DATA', External: 'EXTERNAL' };

// ============================================================
// 2. UI ELEMENTS
// ============================================================
const chatContainer = document.getElementById('chat-container');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const overlay = document.getElementById('loading-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
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
const attachBtn = document.getElementById('attach-btn');
const temperatureSlider = document.getElementById('temperature-slider');
const temperatureValue = document.getElementById('temperature-value');
const maxTokensSlider = document.getElementById('max-tokens-slider');
const maxTokensValue = document.getElementById('max-tokens-value');
const modelList = document.getElementById('model-list');
const modelListEmpty = document.getElementById('model-list-empty');
const deleteAllModelsBtn = document.getElementById('delete-all-models-btn');
const settingsStorageTotal = document.getElementById('settings-storage-total');
const appVersionEl = document.getElementById('app-version');
const sidebarVersionEl = document.getElementById('sidebar-version');

// ============================================================
// 3. STATE
// ============================================================
const N_THREADS = Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
const DOWNLOAD_NOTIFICATION_ID = 1001;
const RESPONSE_NOTIFICATION_ID = 1002;
const SETTINGS_KEY = 'fern.settings';
const DEFAULT_SETTINGS = { temperature: 0.7, maxTokens: 512 };
let appSettings = { ...DEFAULT_SETTINGS };
let contextReady = false;
let isGenerating = false;
let chatHistory = [];
let modelName = '';
let activeContext = null;

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
  resetToNoModelState();
}

function resetToNoModelState() {
  contextReady = false;
  modelName = '';
  setModelLabels('');
  setSendEnabled(false);
  setMultimodalSupport(false);
  showEmptyState();
  setEmptyStateMessage('No local model loaded.');
}

function isMultimodalModel(name) {
  return /(llava|vision|multimodal|moondream|bakllava|qwen[-\s]?vl|minicpm[-\s]?v|pixtral|idefics|internvl|gemma[-\s]?3)/i.test(name || '');
}

function setMultimodalSupport(enabled) {
  if (!attachBtn) return;
  attachBtn.classList.toggle('hidden', !enabled);
  attachBtn.classList.toggle('flex', !!enabled);
}

function setSendEnabled(enabled) {
  sendBtn.disabled = !enabled;
  if (enabled) {
    sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  } else {
    sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
}

function setEmptyStateMessage(text) {
  emptyStateText.innerText = text;
}

function showEmptyState() {
  emptyState.classList.remove('hidden');
  if (contextReady && modelName) {
    setEmptyStateMessage('Ready. Ask ' + modelName + ' anything.');
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
  const label = name || 'No model';
  document.getElementById('sidebar-model-label').innerText = label;
  document.getElementById('active-model-chip').innerText = name ? name.toUpperCase() : 'NO MODEL';
  setMultimodalSupport(!!name && isMultimodalModel(name));
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
}

// ============================================================
// 4. PERMISSIONS, NOTIFICATIONS & STORAGE
// ============================================================
async function requestStartupPermissions() {
  try {
    const { LocalNotifications, Device, Filesystem } = getPlugins();

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

async function getInstalledModels() {
  const { Filesystem } = getPlugins();
  if (!Filesystem) return [];
  const result = await Filesystem.readdir({ path: '', directory: Directory.Data });
  const models = [];
  for (const file of result.files || []) {
    if (file.type !== 'file' || !/\.gguf$/i.test(file.name)) continue;
    let size = Number(file.size) || 0;
    try {
      const stat = await Filesystem.stat({ path: file.name, directory: Directory.Data });
      size = Number(stat.size) || size;
    } catch (error) {
      console.warn('Could not stat ' + file.name + ':', error);
    }
    models.push({ name: file.name, size });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

function renderModelList(models) {
  if (!modelList) return;
  if (!models.length) {
    modelList.innerHTML = '<p class="rounded-md border border-line bg-base px-3 py-3 text-center font-mono text-[11px] text-zinc-600">No models installed.</p>';
    return;
  }

  modelList.innerHTML = models.map((model) => (
    '<div class="flex items-center gap-3 rounded-md border border-line bg-base px-3 py-2.5">' +
      '<div class="min-w-0 flex-1">' +
        '<p class="truncate font-mono text-[11.5px] text-zinc-200">' + escapeHtml(model.name) + '</p>' +
        '<p class="mt-0.5 font-mono text-[10px] text-zinc-600">' + formatBytes(model.size) + '</p>' +
      '</div>' +
      '<button type="button" data-delete-model="' + escapeHtml(model.name) + '" class="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-300 transition hover:bg-red-500/20">Delete</button>' +
    '</div>'
  )).join('');
}

async function refreshModelManager() {
  try {
    const models = await getInstalledModels();
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

async function updateStorageMeter() {
  try {
    const models = await getInstalledModels();
    const total = models.reduce((sum, model) => sum + model.size, 0);
    storageUsage.innerText = total > 0 ? formatBytes(total) : 'No models';
    if (settingsStorageTotal) settingsStorageTotal.innerText = formatBytes(total);
    return total;
  } catch (error) {
    storageUsage.innerText = '';
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
}

async function loadSettings() {
  try {
    const { Preferences } = getPlugins();
    if (Preferences) {
      const { value } = await Preferences.get({ key: SETTINGS_KEY });
      if (value) {
        const parsed = JSON.parse(value);
        appSettings.temperature = clampNumber(parsed.temperature, 0, 1, DEFAULT_SETTINGS.temperature);
        appSettings.maxTokens = Math.round(clampNumber(parsed.maxTokens, 128, 2048, DEFAULT_SETTINGS.maxTokens));
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

async function updateAppVersion() {
  let version = '2.2.3';
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
  await Promise.all([
    loadSettings(),
    refreshModelManager(),
    updateStorageLocation(),
    updateAppVersion(),
  ]);
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

async function releaseLoadedModel() {
  const pro = llamaCppPro();
  if (pro) {
    try { await pro.releaseAllLlama(); } catch (error) {}
  }
  activeContext = null;
  contextReady = false;
  isGenerating = false;
  setSendEnabled(false);
  setMultimodalSupport(false);
}

async function deleteModel(filename) {
  if (!confirm('Delete ' + filename + '?')) return;
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

  if (deletingActive) {
    modelName = '';
    setModelLabels('');
    showEmptyState();
    setEmptyStateMessage('No local model loaded.');
  }
  await refreshModelManager();
}

async function deleteAllModels() {
  if (!confirm('Delete every downloaded model? This cannot be undone.')) return;
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
  setModelLabels('');
  showEmptyState();
  setEmptyStateMessage('No local model loaded.');
  await refreshModelManager();
  await clearDownloadNotification();
}

async function clearAppData() {
  if (!confirm('Delete all downloaded models and clear the current chat?')) return;

  try {
    await releaseLoadedModel();

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

    modelName = '';
    chatHistory = [];
    messagesEl.innerHTML = '';
    setModelLabels('');
    await clearDownloadNotification();
    await refreshModelManager();
    await updateStorageLocation();
    showEmptyState();
    setEmptyStateMessage('No local model loaded.');
    closeSettings();
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
async function loadModelFile(modelPath, notify, options) {
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

  try { await pro.releaseAllLlama(); } catch (e) {}
  activeContext = null;

  if (notify) notify('Initializing context: ' + modelName);

  // The FilePicker returns content:// URIs that the native loader cannot
  // open directly. Downloaded models are resolved with Filesystem.getUri()
  // and must be passed through unchanged (exactPath).
  const candidates = exactPath
    ? [modelPath]
    : [modelPath.replace(/^(content|file):\/\//, ''), modelName].filter(Boolean);

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
        n_threads: N_THREADS,
        ctx_shift: true,
      });
      activeContext = context;
      return context;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Could not initialize model context');
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

async function downloadAndLoadModel(url, filename) {
  const { Filesystem } = getPlugins();

  if (!Filesystem) {
    showErrorOverlay('Filesystem unavailable', 'The Filesystem plugin is not installed.');
    return;
  }

  if (await statModelInData(filename)) {
    setSendEnabled(false);
    modelName = filename;
    showOverlay('Loading ' + filename + ' (this can take a while)...');
    progressBar.style.display = '';
    progressBar.style.width = '100%';
    try {
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Data });
      if (!uri) throw new Error('Could not resolve the saved model path');
      await loadModelFile(uri, null, { exact: true });
      onModelReady();
      await updateStorageMeter();
    } catch (error) {
      console.error('Model load failed:', error);
      await clearDownloadNotification();
      hideOverlay();
      setSendEnabled(contextReady);
      showErrorOverlay('Could not load model', error && error.message ? error.message : String(error));
    }
    return;
  }

  showOverlay('Downloading ' + filename + '... Please wait.');
  progressBar.style.display = 'none';
  setSendEnabled(false);
  showDownloadingNotification(filename);

  try {
    try {
      await Filesystem.deleteFile({ path: filename, directory: Directory.Data });
    } catch (error) {}

    const result = await Filesystem.downloadFile({
      url,
      path: filename,
      directory: Directory.Data,
    });
    if (!result || !result.path) {
      throw new Error('Download did not return a saved file path');
    }

    modelName = filename;
    showOverlay('Loading ' + filename + ' (this can take a while)...');
    await loadModelFile(result.path, null, { exact: true });
    onModelReady();
    await updateStorageMeter();
    showModelReadyNotification(filename);
  } catch (error) {
    console.error('Model download failed:', error);
    try {
      await Filesystem.deleteFile({ path: filename, directory: Directory.Data });
    } catch (cleanupError) {}
    await clearDownloadNotification();
    hideOverlay();
    setSendEnabled(contextReady);
    showErrorOverlay('Download failed', error && error.message ? error.message : String(error));
  }
}

async function pickAndLoadModel() {
  setSendEnabled(false);
  showOverlay('Selecting model file...');

  try {
    const { FilePicker, Filesystem } = getPlugins();
    if (!Filesystem) {
      throw new Error('The Filesystem plugin is not installed.');
    }
    const result = await FilePicker.pickFiles({
      types: ['application/octet-stream'],
      limit: 1,
    });
    const file = result.files && result.files[0];
    if (!file) {
      hideOverlay();
      return;
    }
    if (!file.name || !/\.gguf$/i.test(file.name)) {
      hideOverlay();
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
    modelName = file.name;
    showOverlay('Importing ' + file.name + ' into private storage...');
    await Filesystem.copy({
      from: file.path,
      to: file.name,
      toDirectory: Directory.Data,
    });

    const { uri } = await Filesystem.getUri({ path: file.name, directory: Directory.Data });
    if (!uri) throw new Error('Could not resolve the imported model path');

    showOverlay('Loading ' + file.name + ' (this can take a while)...');
    await loadModelFile(uri, null, { exact: true });
    onModelReady();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if (/cancel/i.test(message)) {
      hideOverlay();
      return;
    }
    console.error('Model load failed:', error);
    hideOverlay();
    setSendEnabled(contextReady);
    showErrorOverlay('Could not load model', message || 'Failed to load model');
  }
}

async function initModel() {
  const pro = llamaCppPro();
  showOverlay('Looking for models...');

  let models = [];
  try {
    models = await pro.getAvailableModels();
  } catch (error) {
    console.warn('getAvailableModels failed:', error);
  }

  if (models && models.length > 0) {
    const model = models[models.length - 1];
    modelName = model.name;
    showOverlay('Loading ' + model.name + '...');
    try {
      await loadModelFile(model.path);
      onModelReady();
      return;
    } catch (error) {
      console.error('Model load failed:', error);
      hideOverlay();
      setModelLabels('');
      setSendEnabled(false);
      showErrorOverlay('Could not load model', error && error.message ? error.message : String(error));
      return;
    }
  }

  hideOverlay();
  showEmptyState();
}

function onModelReady() {
  contextReady = true;
  hideOverlay();
  hideEmptyState();
  setModelLabels(modelName);
  setSendEnabled(true);
  appendMessage('assistant', 'I am running locally on your device. Loaded: ' + modelName + '. No data leaves this machine.');
}

// ============================================================
// 5. CHAT UI RENDERING
// ============================================================
function appendMessage(role, content) {
  chatHistory.push({ role, content });

  const div = document.createElement('div');
  div.className = role === 'user'
    ? 'group mb-8 flex flex-col items-end'
    : 'group mb-9 flex gap-3';

  if (role === 'user') {
    div.innerHTML =
      '<div class="mb-1.5 flex items-center gap-2 pr-0.5">' +
        '<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">You</span>' +
      '</div>' +
      '<div class="max-w-[85%] rounded-lg rounded-br-sm border border-white/[0.04] bg-line px-3.5 py-2.5 sm:max-w-[75%]">' +
        '<p class="font-mono text-[13.5px] leading-[1.65] text-white whitespace-pre-wrap">' + escapeHtml(content) + '</p>' +
      '</div>';
  } else {
    div.innerHTML =
      '<div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" role="img" aria-label="' + escapeHtml(modelName || 'Local model') + '">' +
          '<path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M7.6 2.2c.6-.2 1.2.2 1.3.8l.5 2.9c.9-.4 1.7-.6 2.6-.6s1.7.2 2.6.6l.5-2.9c.1-.6.7-1 1.3-.8.6.2 1 .8.8 1.4l-.5 3.1c1.5 1.1 2.4 2.8 2.4 4.7 0 2.2-1.2 4.1-3 5.2l-.5 4.2c-.1 1.4-1.3 2.5-2.7 2.5h-2.2c-1.4 0-2.6-1.1-2.7-2.5l-.5-4.2c-1.8-1.1-3-3-3-5.2 0-1.9.9-3.6 2.4-4.7l-.5-3.1c-.2-.6.2-1.2.8-1.4Zm2.3 9.6a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Zm4.2 0a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Z"/>' +
        '</svg>' +
      '</div>' +
      '<div class="min-w-0 flex-1">' +
        '<div class="mb-1.5 flex items-center gap-2">' +
          '<span class="text-[12px] font-semibold tracking-tight text-white">' + escapeHtml(modelName || 'Local model') + '</span>' +
        '</div>' +
        '<p class="font-mono text-[13.5px] leading-[1.75] text-white whitespace-pre-wrap"></p>' +
      '</div>';

    if (content) div.querySelector('p').innerText = content;
  }

  messagesEl.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}

function lastAssistantBubble() {
  const bubbles = chatContainer.querySelectorAll('.group');
  return bubbles[bubbles.length - 1];
}

// ============================================================
// 6. GENERATION
// ============================================================
async function generateResponse(userPrompt) {
  if (!contextReady || isGenerating || !activeContext) return;

  appendMessage('user', userPrompt);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const bubble = appendMessage('assistant', '');
  const bubbleText = bubble.querySelector('p');
  bubbleText.classList.add('animate-pulse');

  isGenerating = true;
  setSendEnabled(false);

  let streamed = false;
  try {
    // llama-cpp-pro: completion() replaces chat(); tokens stream through the
    // optional per-token callback instead of a global onToken listener.
    const result = await activeContext.completion({
      messages: chatHistory,
      n_predict: appSettings.maxTokens,
      temperature: appSettings.temperature,
    }, (data) => {
      const tok = (data && (data.token || data.content)) || '';
      if (tok) {
        streamed = true;
        bubbleText.classList.remove('animate-pulse');
        bubbleText.innerText += tok;
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    });

    const fullText = (result && (result.content || result.text)) || '';
    chatHistory[chatHistory.length - 1] = { role: 'assistant', content: fullText };

    bubbleText.classList.remove('animate-pulse');
    if (!streamed) {
      if (fullText) {
        bubbleText.innerText = fullText;
      } else {
        bubbleText.innerText = '[Empty response]';
      }
    }
    notifyBackgroundResponse(fullText || bubbleText.innerText);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  } catch (error) {
    console.error('Generation error:', error);
    bubbleText.classList.remove('animate-pulse');
    bubbleText.innerText = '[Error: ' + (error.message || String(error)) + ']';
  } finally {
    isGenerating = false;
    setSendEnabled(true);
  }
}

// ============================================================
// 7. EVENT LISTENERS
// ============================================================
sendBtn.addEventListener('click', () => {
  const text = inputEl.value.trim();
  if (text) generateResponse(text);
});

inputEl.addEventListener('keydown', (e) => {
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

// RECOMMENDED MODEL DOWNLOADS
document.querySelectorAll('.model-download-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const url = button.dataset.url;
    const name = button.dataset.name;
    const details = button.closest('details');
    if (details) details.open = false;
    if (url && name) downloadAndLoadModel(url, name);
  });
});

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

temperatureSlider.addEventListener('input', () => {
  appSettings.temperature = clampNumber(temperatureSlider.value, 0, 1, DEFAULT_SETTINGS.temperature);
  temperatureValue.innerText = appSettings.temperature.toFixed(1);
  saveSettings();
});

maxTokensSlider.addEventListener('input', () => {
  appSettings.maxTokens = Math.round(clampNumber(maxTokensSlider.value, 128, 2048, DEFAULT_SETTINGS.maxTokens));
  maxTokensValue.innerText = String(appSettings.maxTokens);
  saveSettings();
});

modelList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-model]');
  if (!button) return;
  deleteModel(button.getAttribute('data-delete-model'));
});

// ERROR OVERLAY
errorDismissBtn.addEventListener('click', closeErrorOverlay);

// NEW CHAT
newChatBtn.addEventListener('click', () => {
  chatHistory = [];
  messagesEl.innerHTML = '';
  showEmptyState();
});

// ============================================================
// 8. BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  try {
    setSendEnabled(false);
    setMultimodalSupport(false);
    loadSettings();
    updateAppVersion();
    requestStartupPermissions();
    updateStorageMeter();
    updateStorageLocation();
    initModel().catch((error) => {
      console.error('Init error:', error);
      showErrorOverlay('Init error', error && error.message ? error.message : String(error));
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    showErrorOverlay('Init error', error && error.message ? error.message : String(error));
  }
});
