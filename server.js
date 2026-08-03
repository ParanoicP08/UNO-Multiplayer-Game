const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ==========================================
// 🌲 NEXUS-0 ARENA: QUAD-TREE & ENGINE
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
    // 1. Process Player Physics
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

    // 2. Build Quadtree Spatial Partitioning
    const worldBoundary = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const spatialTree = new Quadtree(worldBoundary, 4);

    for (let id in this.players) {
      spatialTree.insert(this.players[id]);
    }

    // 3. Process Projectiles & Collisions
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
// 🔌 SOCKET.IO CONNECTION HANDLING
// ==========================================
io.on('connection', (socket) => {
  console.log(`[Connection] User connected: ${socket.id}`);

  // --- NEXUS-0 ARENA LISTENERS ---
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

  // --- UNO & TRIVIA ROOM LISTENERS (Placeholders for your existing handlers) ---
  socket.on('join_room', (data) => {
    // Keep or wire your existing UNO / Trivia room logic here if needed
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnection] User left: ${socket.id}`);
    for (let roomId in arenaRooms) {
      if (arenaRooms[roomId].players[socket.id]) {
        arenaRooms[roomId].removePlayer(socket.id);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Game Hub Server running on port ${PORT}`);
});