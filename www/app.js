console.log("App.js loaded");
window.onerror = function(msg, url, line, col, error) {
  alert("JS Error: " + msg + "\nLine: " + line);
  return false;
};

// ============================================================
// 1. NATIVE PLUGINS (via window.Capacitor.Plugins — no bundler)
// ============================================================
const getPlugins = () => {
  if (!window.Capacitor || !window.Capacitor.Plugins) {
    throw new Error('Capacitor runtime not available');
  }
  return {
    LlamaCpp: window.Capacitor.Plugins.LlamaCpp,
    FilePicker: window.Capacitor.Plugins.FilePicker,
    Filesystem: window.Capacitor.Plugins.Filesystem,
    LocalNotifications: window.Capacitor.Plugins.LocalNotifications,
    Device: window.Capacitor.Plugins.Device,
  };
};

// Filesystem.Directory.Data === 'DATA'. The plugin's enum is not exposed on
// the global bridge, so keep the value local.
const Directory = { Data: 'DATA' };

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

// ============================================================
// 3. STATE
// ============================================================
const CONTEXT_ID = 1;
const N_THREADS = Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
const DOWNLOAD_NOTIFICATION_ID = 1001;
const RESPONSE_NOTIFICATION_ID = 1002;
let contextReady = false;
let isGenerating = false;
let chatHistory = [];
let modelName = '';
let activeListener = null;

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
  document.getElementById('sidebar-model-label').innerText = name || 'No model';
  document.getElementById('active-model-chip').innerText = name ? name.toUpperCase() : 'NO MODEL';
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

async function updateStorageMeter() {
  try {
    const { Filesystem } = getPlugins();
    if (!Filesystem) return;
    const result = await Filesystem.readdir({ path: '', directory: Directory.Data });
    const total = result.files
      .filter((file) => file.type === 'file' && /\.gguf$/i.test(file.name))
      .reduce((sum, file) => sum + (file.size || 0), 0);
    storageUsage.innerText = total > 0 ? formatBytes(total) : 'No models';
  } catch (error) {
    storageUsage.innerText = '';
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

function openSettings() {
  settingsModal.style.display = 'flex';
  updateStorageMeter();
  updateStorageLocation();
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

async function clearAppData() {
  if (!confirm('Delete all downloaded models and clear the current chat?')) return;

  try {
    const { Filesystem, LlamaCpp } = getPlugins();

    if (activeListener) {
      try { await activeListener.remove(); } catch (error) {}
      activeListener = null;
    }
    if (LlamaCpp) {
      try { await LlamaCpp.releaseAllContexts(); } catch (error) {}
    }

    if (Filesystem) {
      try {
        const result = await Filesystem.readdir({ path: '', directory: Directory.Data });
        for (const file of result.files) {
          if (file.type === 'file' && /\.gguf$/i.test(file.name)) {
            try {
              await Filesystem.deleteFile({ path: file.name, directory: Directory.Data });
            } catch (error) {
              console.warn('Could not delete ' + file.name + ':', error);
            }
          }
        }
      } catch (error) {
        console.warn('Could not list app data:', error);
      }
    }

    contextReady = false;
    isGenerating = false;
    modelName = '';
    chatHistory = [];
    messagesEl.innerHTML = '';
    setModelLabels('');
    setSendEnabled(false);
    await clearDownloadNotification();
    await updateStorageMeter();
    await updateStorageLocation();
    showEmptyState();
    closeSettings();
  } catch (error) {
    console.error('Clear app data failed:', error);
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
async function loadModelFile(modelPath, notify) {
  const { LlamaCpp, FilePicker } = getPlugins();

  if (activeListener) {
    try { await activeListener.remove(); } catch (e) {}
    activeListener = null;
  }
  try { await LlamaCpp.releaseAllContexts(); } catch (e) {}

  if (notify) notify('Initializing context: ' + modelName);

  // The FilePicker returns content:// URIs that the native loader cannot
  // open directly. Try the path first, then the bare filename, which the
  // native side resolves against Download/, Documents/ and app dirs.
  const candidates = [
    modelPath.replace(/^(content|file):\/\//, ''),
    modelName,
  ];

  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const context = await LlamaCpp.initContext({
        contextId: CONTEXT_ID,
        params: {
          model: candidate,
          n_ctx: 2048,
          n_batch: 512,
          n_threads: N_THREADS,
          ctx_shift: true,
        },
      });
      return { LlamaCpp, context };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Could not initialize model context');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read downloaded data'));
    reader.readAsDataURL(blob);
  });
}

async function downloadAndLoadModel(url, filename) {
  showOverlay('Downloading ' + filename + '...');
  progressBar.style.width = '0%';
  setSendEnabled(false);
  showDownloadingNotification(filename);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Download failed: HTTP ' + response.status);
    }

    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      const mb = (received / 1048576).toFixed(1);
      if (contentLength > 0) {
        const percent = Math.min(100, Math.round((received / contentLength) * 100));
        progressText.innerText = 'Downloading ' + filename + ': ' + percent + '% (' + mb + ' MB)';
        progressBar.style.width = percent + '%';
      } else {
        progressText.innerText = 'Downloading ' + filename + ': ' + mb + ' MB';
      }
    }

    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    showOverlay('Saving ' + filename + '...');
    const base64Data = await blobToBase64(blob);

    const { Filesystem } = getPlugins();
    const saved = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Data,
      recursive: true,
    });

    modelName = filename;
    showOverlay('Loading ' + filename + ' (this can take a while)...');
    await loadModelFile(saved.uri || filename);
    onModelReady();
    updateStorageMeter();
    showModelReadyNotification(filename);
  } catch (error) {
    console.error('Model download failed:', error);
    await clearDownloadNotification();
    hideOverlay();
    setSendEnabled(contextReady);
    if (!contextReady) {
      showEmptyState();
      setEmptyStateMessage('Download failed. Tap a model to retry, or load a .gguf file.');
    }
  }
}

async function pickAndLoadModel() {
  setSendEnabled(false);
  showOverlay('Selecting model file...');

  try {
    const { FilePicker } = getPlugins();
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
    modelName = file.name;
    showOverlay('Loading ' + file.name + ' (this can take a while)...');
    await loadModelFile(file.path || file.name);
    onModelReady();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if (/cancel/i.test(message)) {
      hideOverlay();
      return;
    }
    console.error('Model load failed:', error);
    showOverlay('Failed to load model: ' + message);
    progressText.classList.add('text-red-400');
  }
}

async function initModel() {
  const { LlamaCpp } = getPlugins();
  showOverlay('Looking for models...');

  try {
    const models = await LlamaCpp.getAvailableModels();
    if (models && models.length > 0) {
      const model = models[models.length - 1];
      modelName = model.name;
      showOverlay('Loading ' + model.name + '...');
      await loadModelFile(model.path);
      onModelReady();
      return;
    }
  } catch (e) {
    console.warn('getAvailableModels failed, falling back to picker:', e);
  }

  hideOverlay();
  showEmptyState();
}

function onModelReady() {
  contextReady = true;
  hideOverlay();
  hideEmptyState();
  setModelLabels(modelName);
  if (activeListener) activeListener.remove();
  activeListener = null;
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
  if (!contextReady || isGenerating) return;
  const { LlamaCpp } = getPlugins();

  appendMessage('user', userPrompt);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const bubble = appendMessage('assistant', '');
  const bubbleText = bubble.querySelector('p');
  bubbleText.classList.add('animate-pulse');

  isGenerating = true;
  setSendEnabled(false);

  let streamed = false;
  if (activeListener) activeListener.remove();
  activeListener = LlamaCpp.addListener('@LlamaCpp_onToken', (evt) => {
    if (!evt || evt.contextId !== CONTEXT_ID || !evt.tokenResult) return;
    const tok = evt.tokenResult.token || evt.tokenResult.content || evt.tokenResult.accumulated_text || '';
    if (tok) {
      streamed = true;
      bubbleText.classList.remove('animate-pulse');
      bubbleText.innerText += evt.tokenResult.token || '';
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  try {
    const result = await LlamaCpp.chat({
      contextId: CONTEXT_ID,
      messages: chatHistory,
      params: {
        n_predict: 512,
        temperature: 0.7,
        emit_partial_completion: true,
      },
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
    if (activeListener) activeListener.remove();
    activeListener = null;
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
    requestStartupPermissions();
    updateStorageMeter();
    updateStorageLocation();
    initModel().catch((error) => {
      console.error('Init error:', error);
      alert("Init Error: " + (error && error.message ? error.message : String(error)));
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    alert("Init Error: " + (error && error.message ? error.message : String(error)));
  }
});
