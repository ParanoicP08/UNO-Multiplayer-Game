import { createGame, getPublicState } from './gameEngine.js';

const rooms = {};

export function broadcastGameState(io, room) {
  if (!room.gameState) return;

  const nameById = new Map(room.players.map(p => [p.id, p.name]));
  const connectedById = new Map(room.players.map(p => [p.id, p.connected]));

  const sendTo = (participant) => {
    if (!participant.socketId) return;
    const publicState = getPublicState(room.gameState, participant.id);
    // getPublicState only knows about ids/hands - it has no concept of a
    // display name or connection status, so stitch those in from the room's
    // player list before this goes out over the wire.
    publicState.players = publicState.players.map(p => ({
      ...p,
      name: nameById.get(p.id) ?? 'Player',
      connected: connectedById.get(p.id) ?? false,
    }));
    io.to(participant.socketId).emit('game_state_update', publicState);
  };

  room.players.forEach(sendTo);
  room.spectators.forEach(sendTo);
}

export function getRoom(roomId) {
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

export function handleJoin(socket, { roomId, playerName, playerId }) {
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

export function handleDisconnect(socket, io) {
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
        }
      }, 30000);

      return { room, player };
    }
  }
  return null;
}