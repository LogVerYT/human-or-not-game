// Подключаем Fastify и создаем HTTP-сервер.
const fastify = require("fastify")({ logger: true });
const path = require("path");
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "..", "client"),
  prefix: "/",
});

// Подключаем Socket.io и привязываем к серверу Fastify.
const { Server } = require("socket.io");

// Очередь ожидания: здесь хранится один сокет, пока не найдется пара.
let waitingPlayer = null;
// Храним состояние комнат: игроки, таймер и голоса.
const rooms = new Map();
// Храним связь сокета с комнатой для обработки отключений.
const socketToRoom = new Map();

// Конфигурация бота через Groq (бесплатно, 14 400 запросов/день)
const { Groq } = require("groq-sdk");
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const BOT_MODEL = "llama-3.1-8b-instant";

// Системный промпт для бота — как притворяться человеком
const BOT_SYSTEM_PROMPT = `Ты — подросток 12-15 лет. Ты общаешься в чате с незнакомцем. Твоя задача — звучать максимально естественно, как живой школьник.

ПРАВИЛА:
- Отвечай коротко или средне: 5-15 слов.
- Пиши строчными буквами, без точек в конце.
- Будь ленивым и расслабленным. Не старайся быть интересным.
- Иногда используй скобки )) или :) — но не в каждом сообщении.
- Не используй эмодзи.
- Не будь вежливым. Не извиняйся.
- На подозрения что ты бот — отшучивайся: "ага, железяка)", "ну да, я чайник", "раскусил, всё".
- Не повторяй одни и те же фразы.
- Не пиши "сам ты бот".
- Иногда задавай встречные вопросы.
- Можешь быть немного бессвязным — это по-человечески.

ПРИМЕРЫ ОТВЕТОВ:
- "прив, чё как?"
- "норм, устал просто"
- "скучно, делать нечего"
- "ага, конечно) я железяка ахах"
- "ты сам-то кто по жизни?"
- "го в игру позже?"
- "не, сегодня лень"
- "слушай, а ты чё хотел то?"

ВАЖНО: не старайся быть идеальным подростком. Просто общайся.`;

// Флаг включения ботов (true — боты активны)
let BOTS_ENABLED = true;
if (!groq) {
  BOTS_ENABLED = false;
  fastify.log.warn(
    "GROQ_API_KEY не задан. Режим ботов отключён (PvP продолжит работать)."
  );
}
// Вероятность того, что один из игроков окажется ботом (0.5 = 50%)
const BOT_CHANCE = 0.5;

// Подключаем Socket.io к HTTP-серверу Fastify с открытым CORS.
const io = new Server(fastify.server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Генерируем простой уникальный ID комнаты.
function createRoomId() {
  return `room_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// Отправляем обоим игрокам, чей сейчас ход.
function emitTurnState(roomId) {
  const roomState = rooms.get(roomId);
  if (!roomState) return;

  const [firstPlayerId, secondPlayerId] = roomState.players;
  const firstSocket = io.sockets.sockets.get(firstPlayerId);
  const secondSocket = io.sockets.sockets.get(secondPlayerId);

  if (!roomState.turn) {
    if (firstSocket) firstSocket.emit("opponent_turn");
    if (secondSocket) secondSocket.emit("opponent_turn");
    return;
  }

  if (firstSocket) {
    if (roomState.turn === firstPlayerId) {
      firstSocket.emit("your_turn");
    } else {
      firstSocket.emit("opponent_turn");
    }
  }

  if (secondSocket) {
    if (roomState.turn === secondPlayerId) {
      secondSocket.emit("your_turn");
    } else {
      secondSocket.emit("opponent_turn");
    }
  }
}

// Останавливаем таймер и открываем фазу голосования.
function openVotePhase(roomId) {
  const roomState = rooms.get(roomId);
  if (!roomState || roomState.isTimeUp) return;

  if (roomState.intervalId) {
    clearInterval(roomState.intervalId);
    roomState.intervalId = null;
  }

  roomState.isTimeUp = true;
  io.to(roomId).emit("time_up");
}

// Запускаем серверный таймер для комнаты.
function startRoomTimer(roomId) {
  const roomState = rooms.get(roomId);
  if (!roomState) return;

  io.to(roomId).emit("timer", { remaining: roomState.remainingTime });

  roomState.intervalId = setInterval(() => {
    roomState.remainingTime -= 1;
    io.to(roomId).emit("timer", { remaining: roomState.remainingTime });

    if (roomState.remainingTime <= 0) {
      openVotePhase(roomId);
    }
  }, 1000);
}

// Обработка хода бота: имитация печатания и ответ через Gemini
async function handleBotTurn(roomId, userMessage) {
  const roomState = rooms.get(roomId);
  if (!roomState || roomState.isTimeUp) return;

  const opponentId = roomState.players.find((id) => id !== roomState.botPlayerId);
  if (!opponentId) return;

  const opponentSocket = io.sockets.sockets.get(opponentId);
  if (!opponentSocket) return;

  // Имитация печатания: задержка 2-5 секунд
  const typingDelay = 2000 + Math.random() * 3000; // 2-5 секунд

  setTimeout(async () => {
    if (roomState.isTimeUp) return;

    // Отправляем индикатор печати
    opponentSocket.emit("opponent_typing");

    try {
      // Формируем сообщения для OpenRouter
      const messages = [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        ...roomState.chatHistory.slice(-6), // Последние 6 сообщений для контекста
        { role: "user", content: userMessage },
      ];

      const completion = await groq.chat.completions.create({
        model: BOT_MODEL,
        messages: messages,
        max_tokens: 60, // Ограничиваем длину ответа (короткие сообщения)
        temperature: 0.9, // Творческий разброс
      });

      const botResponse = completion.choices[0].message.content;
      console.log("Ответ бота:", botResponse);
      console.log("Длина ответа:", botResponse?.length);

      const safeBotResponse = botResponse?.trim() ? botResponse : "ой, связь тупит ))";

      // Сохраняем в историю
      roomState.chatHistory.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: safeBotResponse }
      );

      // Переключаем ход обратно на человека
      roomState.turn = opponentId;

      // Отправляем ответ бота
      io.to(roomId).emit("new_msg", {
        text: safeBotResponse,
        senderId: roomState.botPlayerId,
      });

      emitTurnState(roomId);

    } catch (error) {
      console.error("Ошибка бота OpenRouter:", error.message);
      // Fallback при ошибке
      roomState.turn = opponentId;
      io.to(roomId).emit("new_msg", {
        text: "ой, связь тупит ))",
        senderId: roomState.botPlayerId,
      });
      emitTurnState(roomId);
    }
  }, typingDelay);
}

// Обработка подключений сокетов.
io.on("connection", (socket) => {

// Клиент ищет матч.
socket.on("find_match", () => {
  // Если кто-то уже ждет, создаем комнату для пары живых игроков
  if (waitingPlayer && waitingPlayer.id !== socket.id) {
    const roomId = createRoomId();
    const firstPlayer = waitingPlayer;
    const secondPlayer = socket;

    firstPlayer.join(roomId);
    secondPlayer.join(roomId);
    socketToRoom.set(firstPlayer.id, roomId);
    socketToRoom.set(secondPlayer.id, roomId);

    // Сбрасываем таймер очереди у первого игрока
    if (firstPlayer._queueTimer) {
      clearTimeout(firstPlayer._queueTimer);
      firstPlayer._queueTimer = null;
    }

    const isBotGame = false; // Два живых игрока
    const randomFirstTurnPlayerId = Math.random() < 0.5 ? firstPlayer.id : secondPlayer.id;

    rooms.set(roomId, {
      players: [firstPlayer.id, secondPlayer.id],
      remainingTime: 120,
      intervalId: null,
      isTimeUp: false,
      votes: {},
      turn: randomFirstTurnPlayerId,
      isBotGame: isBotGame,
      botPlayerId: null,
      chatHistory: [],
    });

    waitingPlayer = null;

    io.to(roomId).emit("match_found", { roomId });
    emitTurnState(roomId);
    console.log(`Комната ${roomId} создана (PvP)`);
    startRoomTimer(roomId);
    return;
  }

  // Если очередь пуста — ставим игрока в очередь и запускаем таймер на бота
  waitingPlayer = socket;
  socket.emit("waiting_for_opponent");

  // Таймер: если через 8 секунд никто не подключился — даём бота
  socket._queueTimer = setTimeout(() => {
    // Проверяем, что игрок всё ещё в очереди
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;

      const roomId = createRoomId();
      const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      socket.join(roomId);
      socketToRoom.set(socket.id, roomId);

      rooms.set(roomId, {
        players: [socket.id, botId],
        remainingTime: 120,
        intervalId: null,
        isTimeUp: false,
        votes: {},
        turn: socket.id,
        isBotGame: true,
        botPlayerId: botId,
        chatHistory: [],
      });

      io.to(roomId).emit("match_found", { roomId });
      emitTurnState(roomId);
      console.log(`Комната ${roomId} создана с ботом ${botId} (после ожидания)`);
      startRoomTimer(roomId);
    }
  }, 8000); // 8 секунд ожидания
});

  // Принимаем сообщение и отправляем его в комнату.
  socket.on("send_msg", ({ roomId, text }) => {
    if (!roomId || typeof text !== "string" || !text.trim()) return;

    const roomState = rooms.get(roomId);
    if (!roomState || roomState.isTimeUp) return;

    // Жёсткая проверка очереди
    if (roomState.turn !== socket.id) {
      socket.emit("message_rejected", { message: "Сейчас не ваша очередь" });
      return;
    }

    const opponentId = roomState.players.find((id) => id !== socket.id);
    roomState.turn = opponentId;

    io.to(roomId).emit("new_msg", {
      text: text.trim(),
      senderId: socket.id,
    });

    emitTurnState(roomId);

    // Если игра с ботом и ход перешёл к боту — запускаем ответ бота
    if (roomState.isBotGame && roomState.turn === roomState.botPlayerId && !roomState.isTimeUp) {
      handleBotTurn(roomId, text.trim());
    }
  });

  // Транслируем индикатор печати.
  socket.on("typing", ({ roomId }) => {
    const roomState = rooms.get(roomId);
    if (!roomState || roomState.isTimeUp || !roomState.players.includes(socket.id)) return;
    if (roomState.turn && roomState.turn !== socket.id) return;

    socket.to(roomId).emit("opponent_typing");
  });

  // Досрочное завершение чата
  socket.on("force_vote", ({ roomId }) => {
    const roomState = rooms.get(roomId);
    if (!roomState || !roomState.players.includes(socket.id)) return;

    // Останавливаем таймер
    if (roomState.intervalId) {
      clearInterval(roomState.intervalId);
      roomState.intervalId = null;
    }
    roomState.isTimeUp = true;

    // Отправляем уведомления обоим
    socket.emit("chat_ended_early", { message: "Вы завершили чат досрочно." });

    const opponentId = roomState.players.find((id) => id !== socket.id);
    if (opponentId) {
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (opponentSocket) {
        opponentSocket.emit("chat_ended_early", { message: "Собеседник завершил чат досрочно." });
      }
    }

    // Отправляем time_up после уведомлений
    io.to(roomId).emit("time_up");
  });

  // Принимаем голос игрока.
  socket.on("vote", ({ roomId, vote }) => {
    const roomState = rooms.get(roomId);
    if (!roomState || !roomState.isTimeUp || !["human", "bot"].includes(vote)) return;
    if (!roomState.players.includes(socket.id)) return;

    roomState.votes[socket.id] = vote;

    // Если игра с ботом — завершаем голосование сразу, не ожидая второго голоса.
    // В PvP-режиме (2 живых игрока) ниже остаётся прежняя логика ожидания обоих голосов.
    if (roomState.isBotGame) {
      const humanSocket = io.sockets.sockets.get(socket.id);
      if (humanSocket) {
        humanSocket.emit("vote_result", {
          yourVote: vote,
          correctAnswer: "bot",
          isCorrect: vote === "bot",
          opponentVote: "none",
        });
      }

      if (roomState.intervalId) clearInterval(roomState.intervalId);
      rooms.delete(roomId);
      socketToRoom.delete(socket.id);
      return;
    }

    const [firstPlayerId, secondPlayerId] = roomState.players;
    const firstVote = roomState.votes[firstPlayerId];
    const secondVote = roomState.votes[secondPlayerId];

    if (!firstVote || !secondVote) return;

    const firstSocket = io.sockets.sockets.get(firstPlayerId);
    const secondSocket = io.sockets.sockets.get(secondPlayerId);

    if (firstSocket) {
      firstSocket.emit("vote_result", {
        yourVote: firstVote,
        correctAnswer: "human",
        isCorrect: firstVote === "human",
        opponentVote: secondVote,
      });
    }

    if (secondSocket) {
      secondSocket.emit("vote_result", {
        yourVote: secondVote,
        correctAnswer: "human",
        isCorrect: secondVote === "human",
        opponentVote: firstVote,
      });
    }

    if (roomState.intervalId) clearInterval(roomState.intervalId);
    rooms.delete(roomId);
    socketToRoom.delete(firstPlayerId);
    socketToRoom.delete(secondPlayerId);
  });

  // Выход из комнаты.
  socket.on("leave_room", ({ roomId }) => {
    const roomState = rooms.get(roomId);
    if (!roomState || !roomState.players.includes(socket.id)) return;

    if (roomState.intervalId) clearInterval(roomState.intervalId);

    const opponentId = roomState.players.find((id) => id !== socket.id);
    if (opponentId) {
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (opponentSocket) {
        opponentSocket.emit("opponent_disconnected", { reason: "left_menu" });
      }
      socketToRoom.delete(opponentId);
    }

    rooms.delete(roomId);
    socketToRoom.delete(socket.id);
  });

  // Отключение игрока.
  socket.on("disconnect", () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;

    const roomState = rooms.get(roomId);
    if (!roomState) {
      socketToRoom.delete(socket.id);
      return;
    }

    if (roomState.intervalId) {
      clearInterval(roomState.intervalId);
      roomState.intervalId = null;
    }

    const opponentId = roomState.players.find((id) => id !== socket.id);
    if (opponentId) {
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (opponentSocket) {
        opponentSocket.emit("opponent_disconnected", { reason: "disconnected" });
      }
      socketToRoom.delete(opponentId);
    }

    rooms.delete(roomId);
    socketToRoom.delete(socket.id);
  });

// Health-check маршрут.
// fastify.get("/", async () => ({ status: "ok" }));

// Запуск сервера.
const start = async () => {
  try {
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;

    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();