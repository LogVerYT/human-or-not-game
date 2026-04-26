// Подключаемся к локальному серверу Socket.io.
const socket = io("http://10.163.249.9:3000");

// Получаем ссылки на элементы интерфейса.
const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const playButton = document.getElementById("playBtn");
const statusElement = document.getElementById("status");
const findMatchButton = document.getElementById("findMatchBtn");
const searchIndicator = document.getElementById("search-indicator");
const cancelSearchButton = document.getElementById("cancelSearchBtn");
const chatContainer = document.getElementById("chat-container");
const messagesElement = document.getElementById("messages");
const typingIndicator = document.getElementById("typing-indicator");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendBtn");
const timerElement = document.getElementById("timer");
const voteArea = document.getElementById("vote-area");
const voteHumanButton = document.getElementById("voteHumanBtn");
const voteBotButton = document.getElementById("voteBotBtn");
const voteStatusElement = document.getElementById("vote-status");
const resultCardElement = document.getElementById("result-card");
const resultIconElement = document.getElementById("result-icon");
const resultElement = document.getElementById("result");
const resultOpponentVoteElement = document.getElementById("result-opponent-vote");
const playAgainButton = document.getElementById("playAgainBtn");
const menuButton = document.getElementById("menuBtn");
const chatMenu = document.getElementById("chatMenu");
const endChatButton = document.getElementById("endChatBtn");
const backToStartButton = document.getElementById("backToStartBtn");
const reportButton = document.getElementById("reportBtn");
const reportModalOverlay = document.getElementById("report-modal-overlay");
const reportReasonElement = document.getElementById("reportReason");
const reportCounterElement = document.getElementById("reportCounter");
const cancelReportButton = document.getElementById("cancelReportBtn");
const submitReportButton = document.getElementById("submitReportBtn");
const particlesCanvas = document.getElementById("particles-canvas");
const safeModeButton = document.getElementById("safeModeBtn");
const freeModeButton = document.getElementById("freeModeBtn");
const soundToggleButton = document.getElementById("soundToggleBtn");
const historyToggleButton = document.getElementById("historyToggleBtn");

// Храним актуальные данные текущего матча.
let currentRoomId = null;
let hasVoted = false;
let userMessageCount = 0;
let isMyTurn = false;
let wasForceEnded = false;
let chatBlocked = false;
let lastTypingEmitMs = 0;
let typingHideTimerId = null;
let turnToastTimerId = null;

// Готовые SVG-иконки для человека и робота в итоговой карточке.
const HUMAN_ICON_SVG =
  '<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16v5"/><path d="M14 16v5"/><path d="M9 9h6l-1 7h-4l-1 -7"/><path d="M5 11c1.333 -1.333 2.667 -2 4 -2"/><path d="M19 11c-1.333 -1.333 -2.667 -2 -4 -2"/><path d="M10 4a2 2 0 1 0 4 0 2 2 0 1 0 -4 0"/></svg>';
const ROBOT_ICON_SVG =
  '<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2V6"/><path d="M12 2v2"/><path d="M9 12v9"/><path d="M15 12v9"/><path d="M5 16l4 -2"/><path d="M15 14l4 2"/><path d="M9 18h6"/><path d="M10 8v.01"/><path d="M14 8v.01"/></svg>';

// Переключаем только визуальное состояние карточек режимов (без влияния на логику игры).
function setModeCardState(selectedMode) {
  const isSafe = selectedMode === "safe";
  safeModeButton.classList.toggle("is-selected", isSafe);
  freeModeButton.classList.toggle("is-selected", !isSafe);
  safeModeButton.setAttribute("aria-checked", String(isSafe));
  freeModeButton.setAttribute("aria-checked", String(!isSafe));
}

if (safeModeButton && freeModeButton) {
  safeModeButton.addEventListener("click", () => setModeCardState("safe"));
  freeModeButton.addEventListener("click", () => setModeCardState("free"));
}

// Переключаем только визуальное состояние иконки в тулбаре (без влияния на игровую логику).
function toggleToolbarIcon(buttonElement) {
  if (!buttonElement) {
    return;
  }

  const isEnabled = buttonElement.classList.contains("icon-active");
  buttonElement.classList.toggle("icon-active", !isEnabled);
  buttonElement.classList.toggle("is-active", !isEnabled);
  buttonElement.classList.toggle("icon-inactive", isEnabled);
}

if (soundToggleButton) {
  soundToggleButton.addEventListener("click", () => {
    toggleToolbarIcon(soundToggleButton);
  });
}

if (historyToggleButton) {
  historyToggleButton.addEventListener("click", () => {
    toggleToolbarIcon(historyToggleButton);
  });
}

// Рисуем фоновый слой падающих геометрических частиц на Canvas.
function initFallingParticles() {
  if (!particlesCanvas) {
    return;
  }

  const ctx = particlesCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const particleCount = 52;
  const particles = [];
  let width = 0;
  let height = 0;

  function randomFrom(min, max) {
    return Math.random() * (max - min) + min;
  }

  function createParticle(forceTop = false) {
    const size = randomFrom(8, 38);
    const depth = size / 38;
    return {
      x: randomFrom(0, width),
      y: forceTop ? randomFrom(-height, -10) : randomFrom(0, height),
      size,
      depth,
      speed: randomFrom(0.25, 0.75) + depth * 1.25,
      rotation: randomFrom(0, Math.PI * 2),
      rotationSpeed: randomFrom(-0.008, 0.008),
      typeIndex: Math.floor(Math.random() * 3),
      neon: Math.random() > 0.4,
      alpha: randomFrom(0.1, 0.2),
    };
  }

  function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    particlesCanvas.width = width;
    particlesCanvas.height = height;
    particles.length = 0;
    for (let i = 0; i < particleCount; i += 1) {
      particles.push(createParticle());
    }
  }

  function drawParticle(particle) {
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);
    ctx.lineWidth = particle.depth > 0.55 ? 1.25 : 1;
    const neonColor = `rgba(74, 222, 128, ${particle.alpha})`;
    const grayColor = `rgba(166, 166, 166, ${particle.alpha * 0.9})`;
    ctx.strokeStyle = particle.neon ? neonColor : grayColor;

    // Добавляем легкий blur для дальних фигур, чтобы усилить глубину.
    if (particle.depth < 0.45) {
      ctx.shadowColor = "rgba(180, 180, 180, 0.08)";
      ctx.shadowBlur = 5;
    } else if (particle.neon) {
      ctx.shadowColor = "rgba(74, 222, 128, 0.18)";
      ctx.shadowBlur = 7;
    } else {
      ctx.shadowBlur = 0;
    }

    if (particle.typeIndex === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, particle.size * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (particle.typeIndex === 1) {
      const s = particle.size * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s, s);
      ctx.lineTo(-s, s);
      ctx.closePath();
      ctx.stroke();
    } else {
      const line = particle.size * 0.8;
      ctx.beginPath();
      ctx.moveTo(-line * 0.5, 0);
      ctx.lineTo(line * 0.5, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      particle.y += particle.speed;
      particle.rotation += particle.rotationSpeed;

      if (particle.y - particle.size > height) {
        particles[i] = createParticle(true);
      } else {
        drawParticle(particle);
      }
    }
    window.requestAnimationFrame(animate);
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.requestAnimationFrame(animate);
}

initFallingParticles();

// Показываем короткую всплывающую подсказку внизу экрана.
function showTurnToast(text) {
  const existingToast = document.getElementById("turn-toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.id = "turn-toast";
  toast.textContent = text;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.bottom = "20px";
  toast.style.transform = "translateX(-50%)";
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "10px";
  toast.style.background = "rgba(20, 20, 20, 0.95)";
  toast.style.color = "#ffffff";
  toast.style.fontSize = "14px";
  toast.style.zIndex = "9999";
  toast.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.35)";
  document.body.appendChild(toast);

  if (turnToastTimerId) {
    clearTimeout(turnToastTimerId);
  }
  turnToastTimerId = setTimeout(() => {
    toast.remove();
    turnToastTimerId = null;
  }, 2000);
}

// Обновляем текст статусной строки.
function setStatus(text) {
  statusElement.textContent = text;
}

// Показываем/скрываем анимированный индикатор поиска.
function setSearchIndicatorVisible(visible) {
  searchIndicator.style.display = visible ? "flex" : "none";
  cancelSearchButton.style.display = visible ? "block" : "none";
}

// Форматируем секунды в ММ:СС.
function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// Прокручиваем чат вниз.
function scrollMessagesToBottom() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

// Скрываем индикатор печати.
function hideTypingIndicator() {
  typingIndicator.style.display = "none";
  if (typingHideTimerId) {
    clearTimeout(typingHideTimerId);
    typingHideTimerId = null;
  }
}

// Обновляем доступность пунктов меню с учетом счетчика сообщений.
function updateMenuActionsState() {
  const isActive = userMessageCount >= 4;
  endChatButton.disabled = !isActive;
  backToStartButton.disabled = !isActive;
  endChatButton.textContent = `Завершить чат (${Math.min(userMessageCount, 4)}/4)`;
}

// Переключаем доступность поля ввода по текущему ходу.
function applyTurnState() {
  if (chatBlocked) {
    messageInput.disabled = true;
    sendButton.style.display = "none";
    messageInput.placeholder = "Ожидайте...";
    return;
  }

  const canType = Boolean(currentRoomId && isMyTurn);
  messageInput.disabled = !canType;
  sendButton.style.display = canType ? "inline-flex" : "none";

  if (canType) {
    messageInput.placeholder = "Введите сообщение...";
    hideTypingIndicator();
  } else {
    messageInput.placeholder = "Ожидайте...";
    // Вне своего хода показываем явный статус ожидания.
    if (currentRoomId) {
      typingIndicator.style.display = "flex";
    }
  }
}

// Добавляем системное сообщение в чат.
function addSystemMessage(text) {
  const item = document.createElement("div");
  item.className = "system-message";
  item.textContent = text;
  messagesElement.appendChild(item);
  scrollMessagesToBottom();
}

// Добавляем сообщение пользователя/собеседника в чат.
function addChatMessage(authorKey, text) {
  const isSelf = authorKey === "self";
  const item = document.createElement("div");
  item.className = `message ${isSelf ? "message-self" : "message-opponent"}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${isSelf ? "avatar-self" : "avatar-opponent"}`;
  avatar.textContent = isSelf ? "В" : "С";

  const body = document.createElement("div");
  body.className = "message-body";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = isSelf ? "Вы: " : "Собеседник: ";

  const content = document.createElement("span");
  content.textContent = text;

  body.appendChild(author);
  body.appendChild(content);
  item.appendChild(avatar);
  item.appendChild(body);
  messagesElement.appendChild(item);

  // Считаем только реальные сообщения для активации меню.
  userMessageCount += 1;
  updateMenuActionsState();
  hideTypingIndicator();
  scrollMessagesToBottom();
}

// Полностью очищаем интерфейс матча перед новой игрой.
function resetMatchUi() {
  currentRoomId = null;
  hasVoted = false;
  isMyTurn = false;
  wasForceEnded = false;
  chatBlocked = false;
  userMessageCount = 0;
  lastTypingEmitMs = 0;
  if (turnToastTimerId) {
    clearTimeout(turnToastTimerId);
    turnToastTimerId = null;
  }
  const existingToast = document.getElementById("turn-toast");
  if (existingToast) {
    existingToast.remove();
  }

  messagesElement.innerHTML = "";
  voteStatusElement.textContent = "";
  resultElement.textContent = "";
  resultOpponentVoteElement.textContent = "";
  resultCardElement.style.display = "none";
  resultCardElement.classList.remove("result-win", "result-lose");
  resultIconElement.innerHTML = HUMAN_ICON_SVG;
  timerElement.textContent = "02:00";
  timerElement.classList.remove("timer-danger");
  voteArea.style.display = "none";
  chatContainer.style.display = "none";
  messageInput.value = "";
  messageInput.disabled = true;
  messageInput.placeholder = "Введите сообщение...";
  sendButton.style.display = "none";
  hideTypingIndicator();
  chatMenu.classList.remove("open");
  // Жестко очищаем потенциальные инлайн-сдвиги экранов после отмены поиска.
  startScreen.style.position = "";
  startScreen.style.transform = "";
  startScreen.style.top = "";
  startScreen.style.left = "";
  startScreen.style.marginTop = "";
  gameScreen.style.position = "";
  gameScreen.style.transform = "";
  gameScreen.style.top = "";
  gameScreen.style.left = "";
  gameScreen.style.marginTop = "";
  updateMenuActionsState();
}

// Запускаем новый поиск матча.
function requestMatch() {
  resetMatchUi();
  setStatus("Поиск соперника...");
  statusElement.style.display = "block";
  findMatchButton.style.display = "none";
  findMatchButton.disabled = true;
  setSearchIndicatorVisible(true);
  socket.emit("find_match");
}

// Отменяем поиск соперника и возвращаемся в главное меню.
function cancelMatchSearch() {
  setSearchIndicatorVisible(false);
  resetMatchUi();
  showStartScreen();
}

// Отправляем сообщение, если сейчас ход игрока.
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentRoomId || messageInput.disabled || !isMyTurn) {
    return;
  }

  socket.emit("send_msg", { roomId: currentRoomId, text });
  messageInput.value = "";
}

// Отправляем typing не чаще 1 раза в секунду.
function emitTypingThrottled() {
  if (!currentRoomId || messageInput.disabled || !isMyTurn) {
    return;
  }

  const now = Date.now();
  if (now - lastTypingEmitMs < 1000) {
    return;
  }

  lastTypingEmitMs = now;
  socket.emit("typing", { roomId: currentRoomId });
}

// Открываем стартовый экран.
function showStartScreen() {
  // Возвращаем исходный flex-режим, чтобы меню не уезжало вверх.
  startScreen.style.display = "flex";
  startScreen.style.position = "";
  startScreen.style.transform = "";
  startScreen.style.top = "";
  startScreen.style.left = "";
  gameScreen.style.position = "";
  gameScreen.style.transform = "";
  gameScreen.style.top = "";
  gameScreen.style.left = "";
  gameScreen.style.display = "none";
}

// Открываем модалку жалобы.
function openReportModal() {
  reportModalOverlay.classList.add("open");
}

// Закрываем модалку жалобы.
function closeReportModal() {
  reportModalOverlay.classList.remove("open");
  reportReasonElement.value = "";
  reportCounterElement.textContent = "0/500";
}

// Отправляем сигнал о досрочном переходе к голосованию.
function forceVoteNow() {
  if (!currentRoomId || userMessageCount < 4) {
    return;
  }

  wasForceEnded = true;
  socket.emit("force_vote", { roomId: currentRoomId });
  chatMenu.classList.remove("open");
}

// Выходим в стартовое меню и уведомляем соперника.
function leaveToStart() {
  if (!currentRoomId || userMessageCount < 4) {
    return;
  }

  chatMenu.classList.remove("open");
  socket.emit("leave_room", { roomId: currentRoomId });
  resetMatchUi();
  setSearchIndicatorVisible(false);
  showStartScreen();
}

// Запускаем игру по кнопке главного экрана.
playButton.addEventListener("click", () => {
  startScreen.style.display = "none";
  gameScreen.style.display = "block";
  requestMatch();
});

// Ручной резервный поиск.
findMatchButton.addEventListener("click", () => {
  requestMatch();
});

// Отмена поиска с возвратом на стартовый экран.
cancelSearchButton.addEventListener("click", () => {
  cancelMatchSearch();
});

// Отправляем сообщение по кнопке.
sendButton.addEventListener("click", () => {
  sendMessage();
});

// Отправляем сообщение по Enter.
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
    return;
  }

  emitTypingThrottled();
});

// Отправляем typing во время ввода.
messageInput.addEventListener("input", () => {
  emitTypingThrottled();
});

// Открываем/закрываем меню.
menuButton.addEventListener("click", () => {
  chatMenu.classList.toggle("open");
});

// Закрываем меню кликом вне области.
document.addEventListener("click", (event) => {
  if (!chatMenu.contains(event.target) && !menuButton.contains(event.target)) {
    chatMenu.classList.remove("open");
  }
});

// Досрочно переводим матч к голосованию.
endChatButton.addEventListener("click", () => {
  forceVoteNow();
});

// Возвращаемся к старту и уведомляем соперника.
backToStartButton.addEventListener("click", () => {
  leaveToStart();
});

// Открываем модалку жалобы.
reportButton.addEventListener("click", () => {
  chatMenu.classList.remove("open");
  openReportModal();
});

// Закрываем модалку жалобы.
cancelReportButton.addEventListener("click", () => {
  closeReportModal();
});

// Обновляем счетчик символов жалобы.
reportReasonElement.addEventListener("input", () => {
  reportCounterElement.textContent = `${reportReasonElement.value.length}/500`;
});

// Отправляем жалобу (локальное подтверждение).
submitReportButton.addEventListener("click", () => {
  addSystemMessage("Жалоба отправлена.");
  closeReportModal();
});

// Закрываем модалку кликом по затемнению.
reportModalOverlay.addEventListener("click", (event) => {
  if (event.target === reportModalOverlay) {
    closeReportModal();
  }
});

// Перезапускаем матч после результата.
playAgainButton.addEventListener("click", () => {
  requestMatch();
});

// Сервер подтвердил постановку в очередь.
socket.on("waiting_for_opponent", () => {
  setStatus("Поиск соперника...");
  setSearchIndicatorVisible(true);
});

// Матч найден: показываем чат и системное сообщение.
socket.on("match_found", ({ roomId }) => {
  currentRoomId = roomId;
  hasVoted = false;
  chatBlocked = false;
  // До команды сервера поле ввода заблокировано у обоих игроков.
  isMyTurn = false;
  setSearchIndicatorVisible(false);
  statusElement.style.display = "none";
  findMatchButton.style.display = "none";
  chatContainer.style.display = "block";
  addSystemMessage("Соперник найден. Чат открыт.");
  applyTurnState();
  messageInput.focus();
});

// Сервер сообщил, что ход игрока активен.
socket.on("your_turn", () => {
  isMyTurn = true;
  applyTurnState();
});

// Сервер сообщил, что ход соперника.
socket.on("opponent_turn", () => {
  isMyTurn = false;
  applyTurnState();
});

// Получаем сообщение из комнаты.
socket.on("new_msg", ({ text, senderId }) => {
  if (!currentRoomId) {
    return;
  }

  const authorKey = senderId === socket.id ? "self" : "opponent";
  addChatMessage(authorKey, text);
  applyTurnState();
});

// Сервер отклонил сообщение вне очереди.
socket.on("message_rejected", ({ message } = {}) => {
  // Сервер строго отклоняет сообщение вне очереди.
  // Показываем короткую всплывающую подсказку вместо сообщения в чат.
  showTurnToast(message || "Сейчас не ваша очередь");
});

// Показываем индикатор печати соперника.
socket.on("opponent_typing", () => {
  if (!currentRoomId || chatBlocked) {
    return;
  }

  typingIndicator.style.display = "flex";
  if (typingHideTimerId) {
    clearTimeout(typingHideTimerId);
  }
  typingHideTimerId = setTimeout(() => {
    hideTypingIndicator();
  }, 2000);
});

// Обновляем таймер и служебные отметки времени.
socket.on("timer", ({ remaining }) => {
  const safeRemaining = Math.max(0, remaining);
  timerElement.textContent = formatTime(safeRemaining);

  if (safeRemaining === 60) {
    addSystemMessage("Осталась 1 минута.");
  }
  if (safeRemaining === 30) {
    addSystemMessage("Осталось 30 секунд.");
  }

  if (safeRemaining <= 10) {
    timerElement.classList.add("timer-danger");
  } else {
    timerElement.classList.remove("timer-danger");
  }
});

// Переходим в режим голосования.
socket.on("time_up", () => {
  chatBlocked = true;
  applyTurnState();
  hideTypingIndicator();
  voteArea.style.display = "flex";
  voteStatusElement.textContent = wasForceEnded
    ? "Чат завершен досрочно. Выберите вариант."
    : "";
  timerElement.classList.remove("timer-danger");
});

// Соперник досрочно завершил чат: показываем системное уведомление и голосование.
socket.on("chat_ended_early", ({ message } = {}) => {
  addSystemMessage(message || "Собеседник завершил чат досрочно");
  wasForceEnded = true;
  chatBlocked = true;
  applyTurnState();
  hideTypingIndicator();
  voteArea.style.display = "flex";
  voteStatusElement.textContent = "Чат завершен досрочно. Выберите вариант.";
  timerElement.classList.remove("timer-danger");
});

// Отправляем голос игрока.
function sendVote(voteValue) {
  if (!currentRoomId || hasVoted) {
    return;
  }

  socket.emit("vote", { roomId: currentRoomId, vote: voteValue });
  hasVoted = true;
  voteArea.style.display = "none";
  voteStatusElement.textContent = "Ожидаем ответа соперника...";
}

voteHumanButton.addEventListener("click", () => {
  sendVote("human");
});

voteBotButton.addEventListener("click", () => {
  sendVote("bot");
});

// Показываем персональный итог голосования.
socket.on("vote_result", ({ isCorrect, opponentVote }) => {
  voteStatusElement.textContent = "";
  resultCardElement.style.display = "block";
  resultCardElement.classList.remove("result-win", "result-lose");

  if (isCorrect) {
    resultElement.textContent = "Вы угадали! Ваш соперник — человек.";
    resultIconElement.innerHTML = HUMAN_ICON_SVG;
    resultCardElement.classList.add("result-win");
  } else {
    resultElement.textContent = "Вы ошиблись. Ваш соперник — человек.";
    resultIconElement.innerHTML = ROBOT_ICON_SVG;
    resultCardElement.classList.add("result-lose");
  }

  // Важно: отдельная строка с мнением соперника не перезаписывается.
  resultOpponentVoteElement.textContent =
    opponentVote === "human"
      ? "Соперник считает, что вы — человек."
      : "Соперник считает, что вы — бот.";
});

// Обрабатываем уход/отключение соперника.
socket.on("opponent_disconnected", ({ reason } = {}) => {
  chatBlocked = true;
  applyTurnState();
  voteArea.style.display = "none";
  voteStatusElement.textContent = "";
  hideTypingIndicator();

  // Показываем разный текст для главного меню и обрыва связи.
  if (reason === "left_menu") {
    addSystemMessage("Соперник вышел в главное меню.");
    resultElement.textContent = "Соперник вышел в главное меню.";
  } else {
    addSystemMessage("Соперник покинул игру. Вам засчитана победа.");
    resultElement.textContent = "Соперник покинул игру. Вам засчитана победа.";
  }

  resultCardElement.style.display = "block";
  resultCardElement.classList.remove("result-win", "result-lose");
  resultCardElement.classList.add("result-win");
  resultIconElement.textContent = "🏆";
  resultOpponentVoteElement.textContent = "";
});

// Ошибка подключения к сокет-серверу.
socket.on("connect_error", () => {
  setStatus("Ошибка подключения к серверу.");
  setSearchIndicatorVisible(false);
  findMatchButton.style.display = "inline-block";
  findMatchButton.disabled = false;
});

// Глобальный обрыв соединения.
socket.on("disconnect", () => {
  resetMatchUi();
  setSearchIndicatorVisible(false);
  setStatus("Соединение потеряно. Нажмите «Найти игру».");
  statusElement.style.display = "block";
  findMatchButton.style.display = "inline-block";
  findMatchButton.disabled = false;
});
