const chatbotName = 'Jisam';
const MAX_HISTORY_ITEMS = 6;
const conversationHistory = [];

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

async function askJisam(question, container, input, submitButton) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  const loadingMessage = appendMessage(container, 'Thinking…', 'jisam');
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
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Jisam is unavailable right now. Please try again shortly.');
    }

    const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
    if (!answer) {
      throw new Error('Jisam could not prepare an answer right now. Please try again.');
    }

    rememberExchange(trimmed, answer);
    loadingMessage.replaceWith(createMessageElement(answer, 'jisam'));
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Jisam is unavailable right now. Please try again shortly.';
    loadingMessage.replaceWith(createMessageElement(message, 'jisam'));
  } finally {
    container.removeAttribute('aria-busy');
    input.disabled = false;
    submitButton.disabled = false;
    input.focus();
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

  if (
    !chatContainer ||
    !form ||
    !input ||
    !submitButton ||
    !widget ||
    !launcher ||
    !minimizeButton ||
    !panel
  ) {
    return;
  }

  const setCollapsed = (collapsed) => {
    widget.classList.toggle('chatbot-widget--collapsed', collapsed);
    widget.classList.toggle('chatbot-widget--open', !collapsed);
    launcher.setAttribute('aria-expanded', (!collapsed).toString());
    panel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (!collapsed) {
      input.focus();
    }
  };

  appendMessage(
    chatContainer,
    `Hi, I'm ${chatbotName}. Ask me about Cognitivis, our AI services, or responsible AI delivery.`,
    'jisam'
  );
  setCollapsed(false);

  launcher.addEventListener('click', () => setCollapsed(false));
  minimizeButton.addEventListener('click', () => setCollapsed(true));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value;
    if (!question.trim() || submitButton.disabled) {
      return;
    }

    appendMessage(chatContainer, question, 'user');
    input.value = '';
    await askJisam(question, chatContainer, input, submitButton);
  });
}

document.addEventListener('DOMContentLoaded', initChatbot);
