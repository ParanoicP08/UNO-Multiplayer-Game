import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { getRoom, handleJoin, handleDisconnect } from './rooms.js';
import {
  createGame, playCard, drawCard, passTurn,
  catchUnoFailure, getPublicState
} from './gameEngine.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

function emitStateToRoom(room) {
  if (!room || !room.gameState) return;

  const basePublicState = getPublicState(room.gameState, null);

  // Combine state data with lobby display names and connection statuses
  const mergedPlayers = room.gameState.players.map(p => {
    const roomP = room.players.find(rp => rp.id === p.id);
    return {
      id: p.id,
      name: roomP ? roomP.name : p.id,
      connected: roomP ? roomP.connected : true,
      handCount: p.hand.length
    };
  });

  // Send state customized for each active player
  room.players.forEach(p => {
    if (p.socketId) {
      const pStateInGame = room.gameState.players.find(gp => gp.id === p.id);
      const playerSpecificState = {
        ...basePublicState,
        players: mergedPlayers.map(mp => mp.id === p.id ? { ...mp, hand: pStateInGame?.hand } : mp)
      };
      io.to(p.socketId).emit('game_state_update', playerSpecificState);
    }
  });

  // Broadcast state to spectators
  room.spectators.forEach(s => {
    if (s.socketId) {
      io.to(s.socketId).emit('game_state_update', {
        ...basePublicState,
        players: mergedPlayers
      });
    }
  });
}

io.on('connection', (socket) => {
  // Join Room
  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    socket.roomId = roomId;
    socket.playerId = playerId;
    socket.playerName = playerName;

    const room = getRoom(roomId);
    handleJoin(socket, { roomId, playerName, playerId });

    io.to(roomId).emit('lobby_update', room.players);
    if (room.gameState) {
      emitStateToRoom(room);
    }
  });

  // Start Game
  socket.on('start_game', () => {
    const room = getRoom(socket.roomId);
    if (!room || room.players.length < 2) return;

    const playerIds = room.players.map(p => p.id);
    room.gameState = createGame(playerIds);
    emitStateToRoom(room);
    io.to(socket.roomId).emit('chat_message', { sender: 'System', text: '🎮 Game has started!', sys: true });
  });

  // Play Card
  socket.on('play_card', ({ cardId, chosenColor, declareUno }) => {
    const room = getRoom(socket.roomId);
    if (!room || !room.gameState) return;

    try {
      playCard(room.gameState, socket.playerId, cardId, chosenColor, declareUno);
      emitStateToRoom(room);
    } catch (err) {
      socket.emit('chat_message', { sender: 'System', text: err.message, sys: true });
    }
  });

  // Draw Card
  socket.on('draw_card', () => {
    const room = getRoom(socket.roomId);
    if (!room || !room.gameState) return;

    try {
      drawCard(room.gameState, socket.playerId);
      emitStateToRoom(room);
    } catch (err) {
      socket.emit('chat_message', { sender: 'System', text: err.message, sys: true });
    }
  });

  // Pass Turn
  socket.on('pass_turn', () => {
    const room = getRoom(socket.roomId);
    if (!room || !room.gameState) return;

    try {
      passTurn(room.gameState, socket.playerId);
      emitStateToRoom(room);
    } catch (err) {
      socket.emit('chat_message', { sender: 'System', text: err.message, sys: true });
    }
  });

  // Catch Missed UNO Call
  socket.on('catch_uno', (targetId) => {
    const room = getRoom(socket.roomId);
    if (!room || !room.gameState) return;

    try {
      catchUnoFailure(room.gameState, socket.playerId, targetId);
      emitStateToRoom(room);
    } catch (err) {
      socket.emit('chat_message', { sender: 'System', text: err.message, sys: true });
    }
  });

  // Restart Game
  socket.on('restart-game', ({ room }) => {
    const targetRoom = getRoom(room || socket.roomId);
    if (!targetRoom || targetRoom.players.length < 2) return;

    const playerIds = targetRoom.players.map(p => p.id);
    targetRoom.gameState = createGame(playerIds);
    emitStateToRoom(targetRoom);
    io.to(targetRoom.roomId).emit('chat_message', { sender: 'System', text: '🔄 Game restarted!', sys: true });
  });

  // Chat Broadcast
  socket.on('send_chat', (text) => {
    if (!socket.roomId) return;
    io.to(socket.roomId).emit('chat_message', {
      sender: socket.playerName || 'Player',
      text
    });
  });

  // Emoji Reactions
  socket.on('send-reaction', ({ room, emoji }) => {
    if (!room) return;
    io.to(room).emit('receive-reaction', {
      senderId: socket.playerId,
      emoji
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const result = handleDisconnect(socket, io);
    if (result && result.room) {
      io.to(result.room.roomId).emit('lobby_update', result.room.players);
      if (result.room.gameState) {
        emitStateToRoom(result.room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 UNO Game Server running on port ${PORT}`);
});