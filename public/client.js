// Automatically connects to current domain on Render
const socket = io();

const joinForm = document.getElementById('joinForm');

if (joinForm) {
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault(); // Stop form from refreshing the page

    const username = document.getElementById('username').value.trim();
    const room = document.getElementById('room').value.trim();

    if (username && room) {
      socket.emit('joinRoom', { username, room });
      console.log(`Joining room '${room}' as '${username}'...`);
    }
  });
}

socket.on('message', (msg) => {
  console.log('Room Notification:', msg);
});