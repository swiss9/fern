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
  };
};

// ============================================================
// 2. UI ELEMENTS
// ============================================================
const chatContainer = document.getElementById('chat-container');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const overlay = document.getElementById('loading-overlay');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');

// ============================================================
// 3. STATE
// ============================================================
const CONTEXT_ID = 1;
const N_THREADS = Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
let contextReady = false;
let isGenerating = false;
let chatHistory = [];
let modelName = '';
let activeListener = null;

function showOverlay(text) {
  progressText.classList.remove('text-red-400');
  progressText.innerText = text;
  overlay.style.opacity = '1';
  overlay.style.pointerEvents = 'auto';
}

function hideOverlay() {
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
    modelPath.replace(/^content:\/\//, ''),
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

function createPickButton() {
  const existing = document.getElementById('pick-model-btn');
  if (existing) existing.remove();
  let btn = document.createElement('button');
  btn.id = 'pick-model-btn';
  btn.type = 'button';
  btn.className =
    'mt-4 flex items-center gap-2 rounded-md border border-line bg-panel px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-white transition hover:bg-white/10 active:bg-white/20';
  btn.innerText = 'Choose .gguf file';
  btn.addEventListener('click', pickAndLoadModel);
  overlay.querySelector('.flex-col')?.appendChild(btn);
  return btn;
}

async function pickAndLoadModel() {
  const { LlamaCpp, FilePicker } = getPlugins();
  document.getElementById('pick-model-btn')?.remove();

  showOverlay('Selecting model file...');
  try {
    const result = await FilePicker.pickFiles({
      types: ['application/octet-stream'],
      limit: 1,
    });
    const file = result.files && result.files[0];
    if (!file) {
      showOverlay('No file selected.');
      createPickButton();
      return;
    }
    if (!file.name || !/\.gguf$/i.test(file.name)) {
      showOverlay('That file is not a .gguf model. Pick a .gguf file.');
      createPickButton();
      return;
    }
    modelName = file.name;
    showOverlay('Loading ' + file.name + ' (this can take a while)...');
    await loadModelFile(file.path || file.name);
    onModelReady();
  } catch (error) {
    console.error('Model load failed:', error);
    showOverlay('Failed to load model: ' + (error.message || String(error)));
    progressText.classList.add('text-red-400');
    createPickButton();
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

  showOverlay('No local model found. Select a .gguf model file.');
  createPickButton();
}

function onModelReady() {
  contextReady = true;
  hideOverlay();
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

  chatContainer.appendChild(div);
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

// ============================================================
// 8. BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  setSendEnabled(false);
  try {
    initModel();
  } catch (error) {
    console.error('Bootstrap error:', error);
    showOverlay('Error: ' + error.message);
    progressText.classList.add('text-red-400');
  }
});
