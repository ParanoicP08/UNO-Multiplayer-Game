import http from 'http';
import express from 'express';
import { Server } from 'socket.io';

import { getRoom, handleJoin, handleDisconnect, broadcastGameState } from './rooms.js';
import { createGame, playCard, drawCard, passTurn, catchUnoFailure, chooseStartColor, removePlayerFromGame, GameError } from './gameEngine.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

function safeAction(socket, fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof GameError) {
      socket.emit('chat_message', { sender: 'System', text: err.message, sys: true });
    } else {
      console.error('[Unexpected UNO error]', err);
      socket.emit('chat_message', { sender: 'System', text: 'Something went wrong with that action.', sys: true });
    }
  }
}

function buildStandings(room) {
  return room.gameState.players
    .map(gp => ({
      name: room.players.find(p => p.id === gp.id)?.name ?? 'Player',
      cardsCount: gp.hand.length
    }))
    .sort((a, b) => a.cardsCount - b.cardsCount);
}

const TURN_TIME_LIMIT_MS = Number(process.env.TURN_TIME_LIMIT_MS) || 23000;

function handleTurnTimeout(io, room) {
  const state = room.gameState;
  if (!state || state.winner) return;
  const pid = state.players[state.currentPlayerIndex].id;

  try {
    if (state.awaitingStartColor) {
      const color = ['red', 'yellow', 'green', 'blue'][Math.floor(Math.random() * 4)];
      chooseStartColor(state, pid, color);
    } else {
      if (!state.hasDrawnThisTurn) drawCard(state, pid);
      passTurn(state, pid);
      
      const playerObj = room.players.find(p => p.id === pid);
      if (playerObj) {
        playerObj.afkStrikes = (playerObj.afkStrikes || 0) + 1;
        if (playerObj.afkStrikes >= 3) {
          io.to(room.roomId).emit('chat_message', { sender: 'System', text: `${playerObj.name} was kicked for inactivity.`, sys: true });
          room.players = room.players.filter(p => p.id !== pid);
          removePlayerFromGame(state, pid);
        }
      }
    }
  } catch (err) {
    console.error('[AFK auto-resolve error]', err);
  }

  pushState(io, room);
}

function syncTurnTimer(io, room) {
  const state = room.gameState;
  if (!state || state.winner) {
    clearTurnTimer(room);
    return;
  }
  const target = state.awaitingStartColor ? 'START_COLOR' : state.players[state.currentPlayerIndex].id;
  if (room.timerTarget === target && room.turnTimer) return;

  clearTurnTimer(room);
  room.timerTarget = target;
  room.turnTimer = setTimeout(() => handleTurnTimeout(io, room), TURN_TIME_LIMIT_MS);
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.timerTarget = null;
}

function pushState(io, room) {
  broadcastGameState(io, room);
  syncTurnTimer(io, room);
  if (room.gameState?.winner) {
    const winnerName = room.players.find(p => p.id === room.gameState.winner)?.name ?? 'Someone';
    io.to(room.roomId).emit('game-over', { winnerName, standings: buildStandings(room) });
  }
}

function promoteSpectators(room) {
  while (room.players.length < 10 && room.spectators.length > 0) {
    const spec = room.spectators.shift();
    room.players.push({
      id: spec.id,
      name: spec.name,
      socketId: spec.socketId,
      connected: true,
      afkStrikes: 0
    });
  }
}

io.on('connection', (socket) => {
  console.log(`[Connection] User connected: ${socket.id}`);

  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    const cleanName = String(playerName || '').trim().slice(0, 20) || 'Player';
    const { room } = handleJoin(socket, { roomId, playerName: cleanName, playerId });

    socket.data.roomId = roomId;
    socket.data.playerId = playerId;

    io.to(roomId).emit('lobby_update', room.players);

    if (room.gameState) {
      pushState(io, room);
    }
  });

  socket.on('start_game', () => {
    const { roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (room.gameState && !room.gameState.winner) return;

    promoteSpectators(room);

    safeAction(socket, () => {
      room.gameState = createGame(room.players.map(p => p.id));
      pushState(io, room);
    });
  });

  socket.on('play_card', ({ cardId, chosenColor, declareUno }) => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

    if (typeof cardId !== 'number') return;
    if (chosenColor !== null && typeof chosenColor !== 'string') return;
    if (typeof declareUno !== 'boolean') declareUno = false;

    safeAction(socket, () => {
      playCard(room.gameState, playerId, cardId, chosenColor, declareUno);
      pushState(io, room);
    });
  });

  socket.on('choose_start_color', (color) => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

    safeAction(socket, () => {
      chooseStartColor(room.gameState, playerId, color);
      pushState(io, room);
    });
  });

  socket.on('draw_card', () => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

    safeAction(socket, () => {
      drawCard(room.gameState, playerId);
      pushState(io, room);
    });
  });

  socket.on('pass_turn', () => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

    safeAction(socket, () => {
      passTurn(room.gameState, playerId);
      pushState(io, room);
    });
  });

  socket.on('catch_uno', (targetPlayerId) => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

    safeAction(socket, () => {
      catchUnoFailure(room.gameState, playerId, targetPlayerId);
      pushState(io, room);
    });
  });

  socket.on('restart-game', ({ room: roomId }) => {
    const room = getRoom(roomId);
    if (room.gameState && !room.gameState.winner) return;
    
    promoteSpectators(room);

    safeAction(socket, () => {
      room.gameState = createGame(room.players.map(p => p.id));
      pushState(io, room);
    });
  });

  socket.on('send_chat', (text) => {
    const { roomId, playerId } = socket.data;
    if (!roomId || typeof text !== 'string' || !text.trim()) return;
    const room = getRoom(roomId);
    const sender = room.players.find(p => p.id === playerId)?.name ?? 'Player';
    io.to(roomId).emit('chat_message', { sender, text: text.slice(0, 200), sys: false });
  });

  socket.on('send-reaction', ({ room: roomId, emoji }) => {
    if (!roomId || !emoji) return;
    io.to(roomId).emit('receive-reaction', { senderId: socket.data.playerId, emoji });
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnection] User left: ${socket.id}`);
    const result = handleDisconnect(socket, io);
    if (result) pushState(io, result.room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Game Server running on port ${PORT}`);
});