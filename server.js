const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static assets (HTML, CSS, JS) from the root directory
app.use(express.static(__dirname));

// Default route to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', ({ username, room }) => {
    socket.join(room);
    console.log(`${username} joined room: ${room}`);

    // Broadcast to room members
    io.to(room).emit('message', `${username} joined the room!`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Bind to process.env.PORT and 0.0.0.0 for Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});