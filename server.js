import http from 'http';
import express from 'express';
import { Server } from 'socket.io';

import { getRoom, handleJoin, handleDisconnect, broadcastGameState } from './rooms.js';
import { createGame, playCard, drawCard, passTurn, catchUnoFailure, chooseStartColor, GameError } from './gameEngine.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// 🌲 NEXUS-0 ARENA: QUAD-TREE & ENGINE
// (unchanged - separate feature, not touched)
// ==========================================
class Rectangle {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  contains(point) {
    return (
      point.x >= this.x &&
      point.x <= this.x + this.w &&
      point.y >= this.y &&
      point.y <= this.y + this.h
    );
  }

  intersects(range) {
    return !(
      range.x > this.x + this.w ||
      range.x + range.w < this.x ||
      range.y > this.y + this.h ||
      range.y + range.h < this.y
    );
  }
}

class Quadtree {
  constructor(boundary, capacity) {
    this.boundary = boundary;
    this.capacity = capacity;
    this.entities = [];
    this.divided = false;
  }

  subdivide() {
    let x = this.boundary.x;
    let y = this.boundary.y;
    let w = this.boundary.w / 2;
    let h = this.boundary.h / 2;

    this.northwest = new Quadtree(new Rectangle(x, y, w, h), this.capacity);
    this.northeast = new Quadtree(new Rectangle(x + w, y, w, h), this.capacity);
    this.southwest = new Quadtree(new Rectangle(x, y + h, w, h), this.capacity);
    this.southeast = new Quadtree(new Rectangle(x + w, y + h, w, h), this.capacity);
    this.divided = true;
  }

  insert(entity) {
    if (!this.boundary.contains(entity)) return false;

    if (this.entities.length < this.capacity) {
      this.entities.push(entity);
      return true;
    }

    if (!this.divided) this.subdivide();

    if (this.northeast.insert(entity)) return true;
    if (this.northwest.insert(entity)) return true;
    if (this.southeast.insert(entity)) return true;
    if (this.southwest.insert(entity)) return true;

    return false;
  }

  query(range, found = []) {
    if (!this.boundary.intersects(range)) return found;

    for (let p of this.entities) {
      if (range.contains(p)) found.push(p);
    }

    if (this.divided) {
      this.northwest.query(range, found);
      this.northeast.query(range, found);
      this.southwest.query(range, found);
      this.southeast.query(range, found);
    }

    return found;
  }
}

const WORLD_WIDTH = 1200;
const WORLD_HEIGHT = 800;
const TICK_RATE = 30;
const MS_PER_TICK = 1000 / TICK_RATE;

const arenaRooms = {};

class ArenaRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = {};
    this.projectiles = [];
    this.isRunning = false;
    this.intervalId = null;
  }

  addPlayer(socketId, playerName) {
    this.players[socketId] = {
      id: socketId,
      name: playerName,
      x: Math.random() * (WORLD_WIDTH - 100) + 50,
      y: Math.random() * (WORLD_HEIGHT - 100) + 50,
      vx: 0,
      vy: 0,
      speed: 4,
      radius: 20,
      health: 100,
      score: 0,
      inputs: { up: false, down: false, left: false, right: false }
    };
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    if (Object.keys(this.players).length === 0) {
      this.stopLoop();
    }
  }

  startLoop() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalId = setInterval(() => {
      this.update();
      io.to(this.roomId).emit('server_tick', {
        players: this.players,
        projectiles: this.projectiles
      });
    }, MS_PER_TICK);
  }

  stopLoop() {
    this.isRunning = false;
    clearInterval(this.intervalId);
    delete arenaRooms[this.roomId];
  }

  update() {
    for (let id in this.players) {
      let p = this.players[id];
      let dx = 0;
      let dy = 0;

      if (p.inputs.left) dx -= 1;
      if (p.inputs.right) dx += 1;
      if (p.inputs.up) dy -= 1;
      if (p.inputs.down) dy += 1;

      if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
      }

      p.vx = dx * p.speed;
      p.vy = dy * p.speed;

      p.x = Math.max(p.radius, Math.min(WORLD_WIDTH - p.radius, p.x + p.vx));
      p.y = Math.max(p.radius, Math.min(WORLD_HEIGHT - p.radius, p.y + p.vy));
    }

    const worldBoundary = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const spatialTree = new Quadtree(worldBoundary, 4);

    for (let id in this.players) {
      spatialTree.insert(this.players[id]);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      let proj = this.projectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;

      if (proj.x < 0 || proj.x > WORLD_WIDTH || proj.y < 0 || proj.y > WORLD_HEIGHT) {
        this.projectiles.splice(i, 1);
        continue;
      }

      const queryRange = new Rectangle(proj.x - 15, proj.y - 15, 30, 30);
      const nearbyPlayers = spatialTree.query(queryRange);

      let hitDetected = false;
      for (let player of nearbyPlayers) {
        if (player.id === proj.ownerId) continue;

        const distSq = Math.pow(player.x - proj.x, 2) + Math.pow(player.y - proj.y, 2);
        if (distSq <= Math.pow(player.radius + proj.radius, 2)) {
          player.health -= 15;
          hitDetected = true;

          if (player.health <= 0) {
            player.health = 100;
            if (this.players[proj.ownerId]) {
              this.players[proj.ownerId].score += 1;
            }
          }
          break;
        }
      }

      if (hitDetected) {
        this.projectiles.splice(i, 1);
      }
    }
  }
}

// ==========================================
// 🃏 UNO helpers
// ==========================================

// Never let a bad/cheating client action crash the whole process. gameEngine
// throws GameError on any invalid move by design (that's the point of a
// server-authoritative engine) - this is what actually catches it. Without
// this, one malformed play_card from any client takes down every room.
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

// 20s to match the client's own countdown display, plus a small grace
// window so the server never force-acts before the player's own UI has
// even finished counting down (clock drift, network lag). Override via
// env var for tests, so a test doesn't have to burn 23 real seconds.
const TURN_TIME_LIMIT_MS = Number(process.env.TURN_TIME_LIMIT_MS) || 23000;

// Draw-then-pass, never auto-play: the server should never choose a card -
// or a Wild's color - on a player's behalf. That's a strategic choice, not
// a mechanical default, and it's not the server's to make. This is the one
// fallback that requires no judgment call at all.
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
    }
  } catch (err) {
    console.error('[AFK auto-resolve error]', err);
  }

  pushState(io, room);
}

// Applies uniformly whether the current player is idle or actually
// disconnected - server-side there's no reliable way to tell those apart,
// and trying to would just be guessing. Same 20s penalty either way. This
// also means a player who's been fully removed from room.players after the
// 30s disconnect grace period can never permanently stall the game: the
// engine still thinks they're "current," but the timer keeps firing and
// auto-resolving their turn regardless of whether any live socket exists
// for them.
//
// Self-syncing by design: call this after every state-changing action, no
// exceptions needed for "does this action change whose turn it is" - if the
// target (current player, or the special start-color phase) hasn't
// changed, the already-scheduled timer is left alone untouched.
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

// Single choke point: broadcasts state, keeps the AFK timer in sync, and
// fires game-over when applicable. Every handler below calls this instead
// of touching broadcastGameState directly, so the timer can never drift
// out of sync with a handler someone adds later and forgets to wire in.
function pushState(io, room) {
  broadcastGameState(io, room);
  syncTurnTimer(io, room);
  if (room.gameState?.winner) {
    const winnerName = room.players.find(p => p.id === room.gameState.winner)?.name ?? 'Someone';
    io.to(room.roomId).emit('game-over', { winnerName, standings: buildStandings(room) });
  }
}

// ==========================================
// 🔌 SOCKET.IO CONNECTION HANDLING
// ==========================================
io.on('connection', (socket) => {
  console.log(`[Connection] User connected: ${socket.id}`);

  // --- NEXUS-0 ARENA LISTENERS (unchanged) ---
  socket.on('join_arena', ({ roomId, playerName }) => {
    socket.join(roomId);
    if (!arenaRooms[roomId]) {
      arenaRooms[roomId] = new ArenaRoom(roomId);
    }
    arenaRooms[roomId].addPlayer(socket.id, playerName);
    arenaRooms[roomId].startLoop();
  });

  socket.on('player_input', ({ roomId, inputs }) => {
    if (arenaRooms[roomId] && arenaRooms[roomId].players[socket.id]) {
      arenaRooms[roomId].players[socket.id].inputs = inputs;
    }
  });

  socket.on('player_shoot', ({ roomId, angle }) => {
    const room = arenaRooms[roomId];
    if (!room || !room.players[socket.id]) return;

    const p = room.players[socket.id];
    const bulletSpeed = 10;

    room.projectiles.push({
      id: Math.random().toString(36).substr(2, 9),
      ownerId: socket.id,
      x: p.x + Math.cos(angle) * (p.radius + 5),
      y: p.y + Math.sin(angle) * (p.radius + 5),
      vx: Math.cos(angle) * bulletSpeed,
      vy: Math.sin(angle) * bulletSpeed,
      radius: 4
    });
  });

  // --- UNO ROOM LISTENERS ---

  socket.on('join_room', ({ roomId, playerName, playerId }) => {
    const cleanName = String(playerName || '').trim().slice(0, 20) || 'Player';
    const { room } = handleJoin(socket, { roomId, playerName: cleanName, playerId });

    // Every later gameplay event (play_card, draw_card, ...) arrives with no
    // roomId/playerId payload - the client never resends them. This is the
    // only place that association gets recorded, so it MUST happen here.
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;

    io.to(roomId).emit('lobby_update', room.players);

    // Reconnecting mid-game: push current state immediately instead of
    // leaving them stuck on the lobby screen.
    if (room.gameState) {
      pushState(io, room);
    }
  });

  socket.on('start_game', () => {
    const { roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    // A game already running (no winner yet) must never be clobbered by a
    // stray/duplicate start_game - only allow starting fresh.
    if (room.gameState && !room.gameState.winner) return;

    safeAction(socket, () => {
      room.gameState = createGame(room.players.map(p => p.id));
      pushState(io, room);
    });
  });

  socket.on('play_card', ({ cardId, chosenColor, declareUno }) => {
    const { roomId, playerId } = socket.data;
    const room = getRoom(roomId);
    if (!room.gameState) return;

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
    // Only allow a restart once the current match actually has a winner.
    // Without this, any single player - e.g. via their own AFK-timeout
    // popup, which can fire mid-game with no winner set - could reset the
    // board and re-deal everyone's hands out from under the whole table.
    if (room.gameState && !room.gameState.winner) return;
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
    // senderId comes from the server-tracked identity, never trusted from
    // the client payload (client doesn't even send one today, but even if
    // it did, identity should never be client-asserted).
    io.to(roomId).emit('receive-reaction', { senderId: socket.data.playerId, emoji });
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnection] User left: ${socket.id}`);
    for (let roomId in arenaRooms) {
      if (arenaRooms[roomId].players[socket.id]) {
        arenaRooms[roomId].removePlayer(socket.id);
        break;
      }
    }
    const result = handleDisconnect(socket, io);
    if (result) pushState(io, result.room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Game Hub Server running on port ${PORT}`);
});