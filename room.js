// rooms.js
const { initGame, advanceTurn, checkPlayValidity } = require('./gameEngine');

const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      roomId,
      players: [],
      spectators: [],
      gameState: null,
      disconnectTimeouts: {}
    };
  }
  return rooms[roomId];
}

function handleJoin(socket, { roomId, playerName, playerId }) {
  const room = getRoom(roomId);
  
  if (room.disconnectTimeouts[playerId]) {
    clearTimeout(room.disconnectTimeouts[playerId]);
    delete room.disconnectTimeouts[playerId];
  }

  let player = room.players.find(p => p.id === playerId);
  if (player) {
    player.socketId = socket.id;
    player.name = playerName;
    player.connected = true;
    socket.join(roomId);
    return { success: true, room, isSpectator: false };
  } 
  
  // If game already started, join as Spectator
  if (room.gameState && room.gameState.winner === null) {
    room.spectators.push({ id: playerId, name: playerName, socketId: socket.id });
    socket.join(roomId);
    return { success: true, room, isSpectator: true };
  }

  room.players.push({
    id: playerId,
    name: playerName,
    socketId: socket.id,
    connected: true
  });

  socket.join(roomId);
  return { success: true, room, isSpectator: false };
}

function handleDisconnect(socket, io) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    
    // Check if spectator
    room.spectators = room.spectators.filter(s => s.socketId !== socket.id);

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.connected = false;
      
      room.disconnectTimeouts[player.id] = setTimeout(() => {
        room.players = room.players.filter(p => p.id !== player.id);
        delete room.disconnectTimeouts[player.id];
        
        if (room.players.length === 0 && room.spectators.length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('lobby_update', room.players);
          if (room.gameState) {
            io.to(roomId).emit('game_state_update', getSanitizedState(room.gameState, null));
          }
        }
      }, 30000);

      return { room, player };
    }
  }
  return null;
}

function getSanitizedState(gameState, targetPlayerId) {
  if (!gameState) return null;
  return {
    ...gameState,
    players: gameState.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: gameState.hands[p.id]?.length || 0,
      connected: p.connected,
      hand: p.id === targetPlayerId ? gameState.hands[p.id] : undefined
    }))
  };
}

module.exports = { getRoom, handleJoin, handleDisconnect, getSanitizedState };