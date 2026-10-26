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
    LocalNotifications: window.Capacitor.Plugins.LocalNotifications,
    Device: window.Capacitor.Plugins.Device,
    Preferences: window.Capacitor.Plugins.Preferences,
    KeepAwake: window.Capacitor.Plugins.KeepAwake,
    Share: window.Capacitor.Plugins.Share,
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
const SYSTEM_PROMPT_PREFIX = 'systemPrompt_';
const MODEL_ALIASES_KEY = 'fern.modelAliases';
const DEFAULT_SETTINGS = { temperature: 0.6, maxTokens: 512, repeatPenalty: 1.15 };
let appSettings = { ...DEFAULT_SETTINGS };
let contextReady = false;
let isGenerating = false;
let generationAbortRequested = false;
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
  resetToNoModelState();
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
  setMultimodalSupport(!!name && isMultimodal(name));
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / 1048576;
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(mb >= 100 ? 0 : 1) + ' MB';
}

function getPreferencesPlugin() {
  try {
    return getPlugins().Preferences;
  } catch (error) {
    return null;
  }
}

function getModelAlias(name) {
  const key = name || modelName;
  if (!key) return '';
  const alias = modelAliases[key];
  return typeof alias === 'string' && alias.trim() ? alias.trim() : key;
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
      sessions[newKey] = oldSessions.concat(existing);
    }
    delete sessions[oldKey];
  }

  await saveModelAliases();

  if (filename === modelName) {
    syncModelDisplayName();
    setModelLabels(modelName);
    updatePersonalizationControls();
    renderSidebarSessions();
    renderSessionMessages();
    await saveSessions();
  }

  closeAliasModal();
  await refreshModelManager();
}

function normalizeMessageList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((message) =>
      message &&
      typeof message.role === 'string' &&
      typeof message.content === 'string' &&
      (message.role === 'user' || message.role === 'assistant')
    )
    .map((message) => ({ role: message.role, content: message.content }));
}

function normalizeSessionsData(parsed) {
  const result = {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

  Object.keys(parsed).forEach((model) => {
    const list = parsed[model];
    if (!Array.isArray(list)) return;
    result[model] = list
      .filter((session) => session && typeof session === 'object')
      .map((session, index) => ({
        id: typeof session.id === 'string' && session.id
          ? session.id
          : 's_' + Date.now().toString(36) + '_' + index,
        title: typeof session.title === 'string' && session.title.trim()
          ? session.title.trim()
          : 'New chat',
        messages: normalizeMessageList(session.messages),
      }));
  });

  return result;
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

  const session = {
    id: createSessionId(),
    title: opts.title || 'New chat',
    messages: normalizeMessageList(opts.messages),
  };

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

function selectSession(id) {
  if (!modelName) return;
  const list = ensureModelSessions(modelName);
  const session = list.find((entry) => entry.id === id);
  if (!session) return;
  activeSessionId = session.id;
  renderSidebarSessions();
  renderSessionMessages();
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
      const session = {
        id: createSessionId(),
        title: 'New chat',
        messages: [],
      };
      list.push(session);
      activeSessionId = session.id;
    }
    renderSessionMessages();
  }

  renderSidebarSessions();
  await saveSessions();
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
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function editUserMessage(index) {
  if (isGenerating) return;
  const session = getActiveSession();
  if (!session || !Array.isArray(session.messages)) return;
  if (!Number.isInteger(index) || index < 0 || index >= session.messages.length) return;

  const message = session.messages[index];
  if (!message || message.role !== 'user') return;

  inputEl.value = message.content || '';
  session.messages = session.messages.slice(0, index);
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
      const session = {
        id: createSessionId(),
        title: 'Restored chat',
        messages: pendingLegacyMessages,
      };
      list.push(session);
      pendingLegacyMessages = null;
      await clearLegacyChatHistory();
    } else {
      list.push({ id: createSessionId(), title: 'New chat', messages: [] });
    }
    activeSessionId = list[0].id;
  } else if (!list.some((session) => session.id === activeSessionId)) {
    activeSessionId = list[0].id;
  }

  renderSidebarSessions();
  renderSessionMessages();
  saveSessions();
}

function getSystemPromptKey(name) {
  const key = name || modelName;
  if (!key) return '';
  return SYSTEM_PROMPT_PREFIX + key;
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

  modelList.innerHTML = models.map((model) => {
    const alias = modelAliases[model.name];
    const displayName = alias && alias.trim() ? alias.trim() : model.name;
    const meta = alias && alias.trim()
      ? escapeHtml(model.name) + ' · ' + formatBytes(model.size)
      : formatBytes(model.size);
    return '<div class="flex items-center gap-2 rounded-md border border-line bg-base px-3 py-2.5">' +
      '<div class="min-w-0 flex-1">' +
        '<p class="truncate font-mono text-[11.5px] text-zinc-200">' + escapeHtml(displayName) + '</p>' +
        '<p class="mt-0.5 truncate font-mono text-[10px] text-zinc-600">' + meta + '</p>' +
      '</div>' +
      '<button type="button" data-rename-model="' + escapeHtml(model.name) + '" aria-label="Rename model" title="Rename model" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-zinc-400 transition hover:border-zinc-600 hover:text-white">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
      '</button>' +
      '<button type="button" data-delete-model="' + escapeHtml(model.name) + '" class="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-300 transition hover:bg-red-500/20">Delete</button>' +
    '</div>';
  }).join('');
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
        appSettings.maxTokens = Math.round(clampNumber(parsed.maxTokens, 128, 2048, DEFAULT_SETTINGS.maxTokens));
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

async function updateAppVersion() {
  let version = '3.0.3';
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
    loadModelPersonalization(),
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
  generationAbortRequested = false;
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
    modelDisplayName = '';
    activeSessionId = '';
    customSystemPrompt = '';
    sessions = {};
    pendingLegacyMessages = null;
    messagesEl.innerHTML = '';
    setModelLabels('');
    updatePersonalizationControls();
    renderSidebarSessions();
    await saveSessions();
    await clearLegacyChatHistory();
    await clearActiveModelName();
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

  await keepScreenAwake();
  try {
    await runMemoryPreflight(modelPath);

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
          n_threads: navigator.hardwareConcurrency || 4,
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

async function downloadAndLoadModel(url, filename) {
  const { Filesystem } = getPlugins();

  if (!Filesystem) {
    showErrorOverlay('Filesystem unavailable', 'The Filesystem plugin is not installed.');
    return;
  }

  if (await statModelInData(filename)) {
    setSendEnabled(false);
    modelName = filename;
    modelDisplayName = filename;
    showOverlay('Loading ' + filename + ' (this can take a while)...');
    progressBar.style.display = '';
    progressBar.style.width = '100%';
    try {
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Data });
      if (!uri) throw new Error('Could not resolve the saved model path');
      await loadModelFile(uri, null, { exact: true });
      await saveActiveModelName(filename);
      await onModelReady();
      await updateStorageMeter();
    } catch (error) {
      console.error('Model load failed:', error);
      await clearDownloadNotification();
      hideOverlay();
      setSendEnabled(contextReady);
      if (!error || !error.fernCancelled) reportModelLoadError(error);
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
    modelDisplayName = filename;
    showOverlay('Loading ' + filename + ' (this can take a while)...');
    await loadModelFile(result.path, null, { exact: true });
    await saveActiveModelName(filename);
    await onModelReady();
    await updateStorageMeter();
    showModelReadyNotification(filename);
  } catch (error) {
    console.error('Model download failed:', error);
    const cancelled = !!(error && error.fernCancelled);
    if (!cancelled) {
      try {
        await Filesystem.deleteFile({ path: filename, directory: Directory.Data });
      } catch (cleanupError) {}
    }
    await clearDownloadNotification();
    hideOverlay();
    setSendEnabled(contextReady);
    if (!cancelled) {
      if (isOutOfMemoryError(error)) {
        showErrorOverlay('Out of Memory', "Out of Memory: Your device couldn't handle this model. Please try a smaller model.");
      } else {
        showErrorOverlay('Download failed', error && error.message ? error.message : String(error));
      }
    }
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
    modelDisplayName = file.name;
    showOverlay('Importing ' + file.name + ' into private storage...');
    await Filesystem.copy({
      from: file.path,
      to: file.name,
      toDirectory: Directory.Data,
    });

    const uriResult = await Filesystem.getUri({ path: file.name, directory: Directory.Data });
    if (!uriResult || !uriResult.uri) throw new Error('Could not resolve the imported model path');

    // getUri returns a file:// URI, but the native llama.cpp engine opens the
    // model with fopen() and needs a raw absolute path.
    const rawPath = uriResult.uri.replace('file://', '');

    const stat = await Filesystem.stat({ path: file.name, directory: Directory.Data });
    console.log("File exists, size: " + stat.size);

    showOverlay('Loading ' + file.name + ' (this can take a while)...');
    await loadModelFile(rawPath, null, { exact: true });
    await saveActiveModelName(file.name);
    await onModelReady();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if ((error && error.fernCancelled) || /cancel/i.test(message)) {
      hideOverlay();
      return;
    }
    console.error('Model load failed:', error);
    hideOverlay();
    setSendEnabled(contextReady);
    reportModelLoadError(error);
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

    const { uri } = await Filesystem.getUri({ path: targetName, directory: Directory.Data });
    if (!uri) throw new Error('Could not resolve the saved model path');

    const rawPath = uri.replace(/^file:\/\//, '');
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
      session = { id: createSessionId(), title: 'New chat', messages: [] };
      ensureModelSessions(modelName).unshift(session);
      activeSessionId = session.id;
      renderSidebarSessions();
    }
    if (session) {
      session.messages.push({ role, content });
      if (role === 'user') {
        updateActiveSessionTitle(content);
        editIndex = session.messages.length - 1;
      }
      saveSessions();
    }
  }

  const displayName = modelDisplayName || modelName || 'Local model';
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
      '</div>' +
      '<div class="max-w-[85%] rounded-lg rounded-br-sm border border-white/[0.04] bg-line px-3.5 py-2.5 sm:max-w-[75%]">' +
        '<p class="font-mono text-[13.5px] leading-[1.65] text-white whitespace-pre-wrap">' + escapeHtml(content) + '</p>' +
      '</div>';
  } else {
    div.innerHTML =
      '<div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" role="img" aria-label="' + escapeHtml(displayName) + '">' +
          '<path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M7.6 2.2c.6-.2 1.2.2 1.3.8l.5 2.9c.9-.4 1.7-.6 2.6-.6s1.7.2 2.6.6l.5-2.9c.1-.6.7-1 1.3-.8.6.2 1 .8.8 1.4l-.5 3.1c1.5 1.1 2.4 2.8 2.4 4.7 0 2.2-1.2 4.1-3 5.2l-.5 4.2c-.1 1.4-1.3 2.5-2.7 2.5h-2.2c-1.4 0-2.6-1.1-2.7-2.5l-.5-4.2c-1.8-1.1-3-3-3-5.2 0-1.9.9-3.6 2.4-4.7l-.5-3.1c-.2-.6.2-1.2.8-1.4Zm2.3 9.6a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Zm4.2 0a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Z"/>' +
        '</svg>' +
      '</div>' +
      '<div class="min-w-0 flex-1">' +
        '<div class="mb-1.5 flex items-center gap-2">' +
          '<span class="text-[12px] font-semibold tracking-tight text-white">' + escapeHtml(displayName) + '</span>' +
        '</div>' +
        '<p class="font-mono text-[13.5px] leading-[1.75] text-white whitespace-pre-wrap"></p>' +
      '</div>';

    if (content) div.querySelector('p').innerText = content;
  }

  messagesEl.appendChild(div);
  hideEmptyState();
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
const FERN_SYSTEM_PROMPT = 'You are Fern, a helpful local AI.';

function buildChatMessages(history) {
  const systemPrompt = (customSystemPrompt && customSystemPrompt.trim()) || FERN_SYSTEM_PROMPT;
  const messages = [{ role: 'system', content: systemPrompt }];
  (history || []).forEach((msg) => {
    if (!msg || !msg.role) return;
    messages.push({ role: msg.role, content: msg.content || '' });
  });
  return messages;
}

async function formatPromptWithNative(messages) {
  const context = activeContext;
  const pro = llamaCppPro();
  const sources = [];
  if (context) sources.push(context);
  if (pro && pro !== context) sources.push(pro);

  const methodNames = ['formatChat', 'applyChatTemplate', 'getFormattedChat'];
  for (const source of sources) {
    for (const methodName of methodNames) {
      if (typeof source[methodName] !== 'function') continue;
      try {
        let result;
        if (methodName === 'getFormattedChat' && source === pro && context && context.id != null) {
          result = await source.getFormattedChat({ contextId: context.id, messages, params: {} });
        } else {
          result = await source[methodName](messages);
        }
        const prompt = typeof result === 'string'
          ? result
          : result && (result.prompt || result.formatted || result.text);
        if (prompt && typeof prompt === 'string' && prompt.length > 0) {
          console.log('[Fern] using native chat template via ' + methodName);
          return prompt;
        }
      } catch (error) {
        console.warn('[Fern] native ' + methodName + ' failed; trying fallback:', error);
      }
    }
  }
  return null;
}

function buildChatMLPrompt(messages) {
  return messages.map((msg) =>
    '<|im_start|>' + msg.role + '\n' + (msg.content || '') + '<|im_end|>\n'
  ).join('') + '<|im_start|>assistant\n';
}

function buildLlama3Prompt(messages) {
  let prompt = '<|begin_of_text|>';
  messages.forEach((msg) => {
    prompt += '<|start_header_id|>' + msg.role + '<|end_header_id|>\n\n' +
      (msg.content || '') + '<|eot_id|>';
  });
  return prompt + '<|start_header_id|>assistant<|end_header_id|>\n\n';
}

function buildMistralPrompt(messages) {
  let system = '';
  const turns = [];
  messages.forEach((msg) => {
    if (msg.role === 'system') {
      system = msg.content || '';
    } else {
      turns.push(msg);
    }
  });

  let prompt = '';
  let hasUserTurn = false;
  turns.forEach((msg) => {
    if (msg.role === 'user') {
      const content = !hasUserTurn && system
        ? system + '\n\n' + (msg.content || '')
        : (msg.content || '');
      prompt += '<s>[INST] ' + content + ' [/INST]';
      hasUserTurn = true;
    } else if (msg.role === 'assistant') {
      if (!hasUserTurn) return;
      prompt += ' ' + (msg.content || '') + '</s>';
    }
  });
  return prompt;
}

function fallbackChatTemplate(messages) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('llama')) return buildLlama3Prompt(messages);
  if (name.includes('mistral')) return buildMistralPrompt(messages);
  if (name.includes('qwen')) return buildChatMLPrompt(messages);
  return buildChatMLPrompt(messages);
}

async function buildChatPrompt(history) {
  const messages = buildChatMessages(history);
  const nativePrompt = await formatPromptWithNative(messages);
  if (nativePrompt) return nativePrompt;
  console.log('[Fern] native chat template unavailable; using filename fallback for ' + (modelName || 'unknown model'));
  return fallbackChatTemplate(messages);
}

function showTypingIndicator() {
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'group mb-9 flex gap-3';
  div.setAttribute('aria-label', 'Fern is typing');
  div.innerHTML =
    '<div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M7.6 2.2c.6-.2 1.2.2 1.3.8l.5 2.9c.9-.4 1.7-.6 2.6-.6s1.7.2 2.6.6l.5-2.9c.1-.6.7-1 1.3-.8.6.2 1 .8.8 1.4l-.5 3.1c1.5 1.1 2.4 2.8 2.4 4.7 0 2.2-1.2 4.1-3 5.2l-.5 4.2c-.1 1.4-1.3 2.5-2.7 2.5h-2.2c-1.4 0-2.6-1.1-2.7-2.5l-.5-4.2c-1.8-1.1-3-3-3-5.2 0-1.9.9-3.6 2.4-4.7l-.5-3.1c-.2-.6.2-1.2.8-1.4Zm2.3 9.6a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Zm4.2 0a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Z"/>' +
      '</svg>' +
    '</div>' +
    '<div class="min-w-0 flex-1">' +
      '<div class="mb-1.5 flex items-center gap-2">' +
        '<span class="text-[12px] font-semibold tracking-tight text-white">' + escapeHtml(modelDisplayName || modelName || 'Local model') + '</span>' +
      '</div>' +
      '<div class="flex h-6 items-center gap-1.5">' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
      '</div>' +
    '</div>';

  messagesEl.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return div;
}

function persistAssistantMessage(text) {
  const session = getActiveSession();
  if (!session) return;
  session.messages.push({ role: 'assistant', content: text });
  saveSessions();
}

async function stopGeneration() {
  if (!isGenerating) return;
  generationAbortRequested = true;

  try {
    if (activeContext && typeof activeContext.stopCompletion === 'function') {
      await activeContext.stopCompletion();
      return;
    }
    const pro = llamaCppPro();
    if (pro && typeof pro.stopCompletion === 'function') {
      await pro.stopCompletion();
      return;
    }
    const native = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[LlamaCppPluginName];
    if (native && typeof native.stopCompletion === 'function' && activeContext && activeContext.id != null) {
      await native.stopCompletion({ contextId: activeContext.id });
    }
  } catch (error) {
    console.warn('[Fern] stopGeneration failed:', error);
  }
}

async function generateResponse(userPrompt) {
  if (!contextReady || isGenerating || !activeContext) return;

  appendMessage('user', userPrompt);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const typing = showTypingIndicator();
  let bubble = null;
  let bubbleText = null;

  const revealBubble = (content) => {
    if (typing.parentNode) typing.remove();
    if (!bubble) {
      bubble = appendMessage('assistant', content || '', { persist: false });
      bubbleText = bubble.querySelector('p');
    }
    return bubbleText;
  };

  const finalizeStopped = () => {
    if (typing.parentNode) typing.remove();
    const partial = bubbleText ? bubbleText.innerText : '';
    if (partial.trim()) {
      if (!bubble) revealBubble(partial);
      bubbleText.innerText = partial;
      persistAssistantMessage(partial);
    } else if (bubble && bubble.parentNode) {
      bubble.remove();
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
  };

  isGenerating = true;
  generationAbortRequested = false;
  updateSendButton();
  await keepScreenAwake();

  let streamed = false;
  try {
    await loadSettings();
    if (generationAbortRequested) {
      finalizeStopped();
      return;
    }

    const prompt = await buildChatPrompt(activeMessages());
    if (generationAbortRequested) {
      finalizeStopped();
      return;
    }
    const result = await activeContext.completion({
      prompt,
      n_predict: appSettings.maxTokens,
      temperature: appSettings.temperature,
      top_k: 40,
      penalty_repeat: appSettings.repeatPenalty,
    }, (data) => {
      const tok = (data && (data.token || data.content)) || '';
      if (tok) {
        streamed = true;
        revealBubble();
        bubbleText.innerText += tok;
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    });

    if (generationAbortRequested) {
      finalizeStopped();
      return;
    }

    const fullText = (result && (result.content || result.text)) || '';
    const finalText = fullText || (streamed ? bubbleText.innerText : '') || '[Empty response]';
    revealBubble(finalText);
    bubbleText.innerText = finalText;
    persistAssistantMessage(finalText);
    notifyBackgroundResponse(finalText);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  } catch (error) {
    if (generationAbortRequested) {
      finalizeStopped();
      return;
    }
    console.error('Generation error:', error);
    if (isOutOfMemoryError(error)) {
      revealBubble('');
      if (typing.parentNode) typing.remove();
      showErrorOverlay('Out of Memory', "Out of Memory: Your device couldn't handle this model. Please try a smaller model.");
    } else {
      const message = '[Error: ' + (error.message || String(error)) + ']';
      revealBubble(message);
      bubbleText.innerText = message;
      persistAssistantMessage(message);
    }
  } finally {
    await allowScreenSleep();
    isGenerating = false;
    generationAbortRequested = false;
    updateSendButton();
    sendBtn.innerHTML = SEND_ICON_HTML;
    sendBtn.setAttribute('aria-label', 'Send message');
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
      messages: imported.messages,
    };
    ensureModelSessions(modelName).unshift(session);
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
importChatBtn.addEventListener('click', importChat);
exportChatBtn.addEventListener('click', exportActiveChat);

let systemPromptSaveTimer = null;
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
  saveSettings();
});

maxTokensSlider.addEventListener('input', () => {
  appSettings.maxTokens = Math.round(clampNumber(maxTokensSlider.value, 128, 2048, DEFAULT_SETTINGS.maxTokens));
  maxTokensValue.innerText = String(appSettings.maxTokens);
  saveSettings();
});

repeatPenaltySlider.addEventListener('input', () => {
  appSettings.repeatPenalty = clampNumber(repeatPenaltySlider.value, 1, 2, DEFAULT_SETTINGS.repeatPenalty);
  repeatPenaltyValue.innerText = appSettings.repeatPenalty.toFixed(2);
  saveSettings();
});

modelList.addEventListener('click', (event) => {
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
    deleteSession(deleteButton.getAttribute('data-delete-session-id'));
    return;
  }
  const sessionButton = event.target.closest('[data-session-id]');
  if (sessionButton) selectSession(sessionButton.getAttribute('data-session-id'));
});

// ERROR OVERLAY
errorDismissBtn.addEventListener('click', closeErrorOverlay);

// RAM WARNING MODAL
ramWarningProceedBtn.addEventListener('click', () => resolveRamWarning(true));
ramWarningCancelBtn.addEventListener('click', () => resolveRamWarning(false));

// NEW CHAT
newChatBtn.addEventListener('click', () => {
  if (!modelName) {
    showErrorOverlay('No model loaded', 'Load a model before starting a new chat.');
    return;
  }
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
    requestStartupPermissions();
    updateStorageLocation();

    // 1. Restore generation settings and model aliases.
    await loadSettings();
    await loadModelAliases();

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
