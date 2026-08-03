const assistantName = 'Cognitivis AI Assistant';
const MAX_HISTORY_ITEMS = 6;
const BAN_STORAGE_KEY = 'cognitivis_ai_banned_v2';
const CHAT_SESSION_KEY = 'cognitivis_chat_session_v1';
const STORAGE_CONSENT_VERSION = '2026-08-03';
const BAN_MESSAGE =
  'You are banned from using the Cognitivis AI Assistant on this browser because suspicious or abusive usage was detected.';
const conversationHistory = [];
let sessionBanned = false;
let conversationSession = createChatSession();

function createDeletionToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createChatSession() {
  return {
    conversationId: window.crypto.randomUUID(),
    deletionToken: createDeletionToken(),
    stored: false,
  };
}

function loadChatSession() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(CHAT_SESSION_KEY) || 'null');
    if (
      typeof saved?.conversationId === 'string' &&
      typeof saved?.deletionToken === 'string' &&
      /^[0-9a-f-]{36}$/i.test(saved.conversationId) &&
      /^[0-9a-f]{64}$/i.test(saved.deletionToken)
    ) {
      conversationSession = { ...saved, stored: saved.stored === true };
      return;
    }
  } catch {
    // Start a fresh anonymous session if browser storage is unavailable.
  }
  conversationSession = createChatSession();
  persistChatSession();
}

function persistChatSession() {
  try {
    window.sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(conversationSession));
  } catch {
    // The in-memory session still supports chat and deletion until the page closes.
  }
}

function isLocallyBanned() {
  if (sessionBanned) {
    return true;
  }

  try {
    sessionBanned = window.localStorage.getItem(BAN_STORAGE_KEY) === '1';
  } catch {
    sessionBanned = false;
  }
  return sessionBanned;
}

function persistBan() {
  sessionBanned = true;
  try {
    window.localStorage.setItem(BAN_STORAGE_KEY, '1');
  } catch {
    // The server also stores the ban in a secure HttpOnly cookie.
  }
}

function createMessageElement(text, sender) {
  const wrapper = document.createElement('div');
  wrapper.className = `chatbot__message chatbot__message--${sender}`;
  const bubble = document.createElement('div');
  bubble.className = 'chatbot__bubble';
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  return wrapper;
}

function appendMessage(container, text, sender) {
  const element = createMessageElement(text, sender);
  container.appendChild(element);
  container.scrollTop = container.scrollHeight;
  return element;
}

function rememberExchange(question, answer) {
  conversationHistory.push(
    { role: 'user', content: question },
    { role: 'assistant', content: answer }
  );

  if (conversationHistory.length > MAX_HISTORY_ITEMS) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_ITEMS);
  }
}

async function askAssistant(question, container, input, submitButton, deleteButton, onBanned) {
  const trimmed = question.trim();
  if (!trimmed || isLocallyBanned()) {
    return;
  }

  const loadingMessage = appendMessage(container, 'Thinking…', 'assistant');
  container.setAttribute('aria-busy', 'true');
  input.disabled = true;
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: trimmed,
        history: conversationHistory.slice(-MAX_HISTORY_ITEMS),
        conversationId: conversationSession.conversationId,
        requestId: window.crypto.randomUUID(),
        deletionToken: conversationSession.deletionToken,
        storageConsent: true,
        consentVersion: STORAGE_CONSENT_VERSION,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (data.banned === true) {
      persistBan();
      if (data.stored === true) {
        conversationSession.stored = true;
        persistChatSession();
      }
      deleteButton.hidden = !conversationSession.stored;
      loadingMessage.replaceWith(createMessageElement(data.error || BAN_MESSAGE, 'assistant'));
      onBanned();
      return;
    }

    if (!response.ok) {
      throw new Error(
        data.error || 'The AI Assistant is unavailable right now. Please try again shortly.'
      );
    }

    const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
    if (!answer) {
      throw new Error('The AI Assistant could not prepare an answer right now. Please try again.');
    }

    rememberExchange(trimmed, answer);
    conversationSession.stored = conversationSession.stored || data.stored === true;
    persistChatSession();
    deleteButton.hidden = !conversationSession.stored;
    loadingMessage.replaceWith(createMessageElement(answer, 'assistant'));
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'The AI Assistant is unavailable right now. Please try again shortly.';
    loadingMessage.replaceWith(createMessageElement(message, 'assistant'));
  } finally {
    container.removeAttribute('aria-busy');
    const banned = isLocallyBanned();
    input.disabled = banned;
    submitButton.disabled = banned;
    if (!banned) {
      input.focus();
    }
    container.scrollTop = container.scrollHeight;
  }
}

function initChatbot() {
  const chatContainer = document.querySelector('.chatbot__messages');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const submitButton = form?.querySelector('button[type="submit"]');
  const widget = document.querySelector('.chatbot-widget');
  const launcher = document.getElementById('chatbot-launcher');
  const minimizeButton = document.getElementById('chatbot-minimize');
  const panel = document.getElementById('chatbot-panel');
  const note = document.getElementById('chatbot-note');
  const storageConsent = document.getElementById('chatbot-storage-consent');
  const deleteButton = document.getElementById('chatbot-delete');

  if (
    !chatContainer ||
    !form ||
    !input ||
    !submitButton ||
    !widget ||
    !launcher ||
    !minimizeButton ||
    !panel ||
    !note ||
    !storageConsent ||
    !deleteButton
  ) {
    return;
  }

  const setCollapsed = (collapsed) => {
    widget.classList.toggle('chatbot-widget--collapsed', collapsed);
    widget.classList.toggle('chatbot-widget--open', !collapsed);
    launcher.setAttribute('aria-expanded', (!collapsed).toString());
    panel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (!collapsed && !isLocallyBanned()) {
      input.focus();
      window.requestAnimationFrame(() => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    }
  };

  const applyBannedState = () => {
    widget.classList.add('chatbot-widget--banned');
    input.disabled = true;
    submitButton.disabled = true;
    input.placeholder = 'AI Assistant access is blocked';
    note.textContent = 'Access to the AI Assistant has been blocked for this browser.';
  };

  loadChatSession();
  deleteButton.hidden = !conversationSession.stored;

  if (isLocallyBanned()) {
    appendMessage(chatContainer, BAN_MESSAGE, 'assistant');
    applyBannedState();
  } else {
    appendMessage(
      chatContainer,
      `Hi, I’m the ${assistantName}. Ask me about Cognitivis, our AI services, responsible AI, or the document audit demo.`,
      'assistant'
    );
  }

  setCollapsed(true);

  launcher.addEventListener('click', () => setCollapsed(false));
  minimizeButton.addEventListener('click', () => setCollapsed(true));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  storageConsent.addEventListener('change', () => {
    submitButton.disabled = !storageConsent.checked || isLocallyBanned();
  });

  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('Permanently delete this stored conversation?')) return;
    deleteButton.disabled = true;
    try {
      const response = await fetch('/api/chat', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(conversationSession),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.deleted !== true) {
        throw new Error(data.error || data.message || 'This conversation could not be deleted.');
      }
      conversationHistory.splice(0);
      conversationSession = createChatSession();
      persistChatSession();
      chatContainer.replaceChildren();
      appendMessage(chatContainer, 'Your stored conversation has been permanently deleted.', 'assistant');
      appendMessage(chatContainer, `Hi, I’m the ${assistantName}. How can I help with Cognitivis?`, 'assistant');
      deleteButton.hidden = true;
    } catch (error) {
      appendMessage(
        chatContainer,
        error instanceof Error ? error.message : 'Conversation deletion is temporarily unavailable.',
        'assistant'
      );
    } finally {
      deleteButton.disabled = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value;
    if (!question.trim() || !storageConsent.checked || submitButton.disabled || isLocallyBanned()) {
      if (!storageConsent.checked) storageConsent.focus();
      return;
    }

    appendMessage(chatContainer, question, 'user');
    input.value = '';
    await askAssistant(
      question,
      chatContainer,
      input,
      submitButton,
      deleteButton,
      applyBannedState
    );
  });

  submitButton.disabled = !storageConsent.checked || isLocallyBanned();
}

document.addEventListener('DOMContentLoaded', initChatbot);
