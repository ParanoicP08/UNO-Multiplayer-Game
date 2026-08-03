# UNO Multiplayer Game

A real-time multiplayer UNO game built with Node.js, Express, Socket.io, and vanilla JavaScript. Players can create or join room codes, chat, send quick reactions, and play UNO together in their web browser.

---

## Features

* **Real-Time Rooms**: Join or host game lobbies using custom room codes.
* **Full Deck Rules**: Supports standard numbers, Skip, Reverse, Draw 2, Wild, and Wild +4 cards.
* **Catch UNO**: Button to penalize players who have 1 card left and forget to call UNO.
* **Turn Timer**: 20-second turn limit to keep games moving if someone goes AFK.
* **In-Game Chat & Reactions**: Built-in room chat and quick floating reaction buttons.
* **Game Over Scoreboard**: Tracks player placement and remaining card counts at the end of a match.
* **Responsive Interface**: Dark-themed UI built with custom CSS without external frontend frameworks.

---

## Tech Stack

* **Backend**: Node.js, Express, Socket.io
* **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)

---

## How It Works

I built this project around a server-authoritative architecture:

1. **Server-Side Validation**: The backend manages the official state of the deck, hands, turn order, and active rules. Clients cannot manipulate game data locally.
2. **Socket Events**: When a player clicks a card or draws, the browser sends an event to the server. The server verifies if the action is legal, updates the room state, and sends the update to all connected players in that room.
3. **Client Rendering**: The frontend acts purely as a display layer. Every time the server broadcasts a new state, the DOM updates to show the latest cards and active turn status.

---

## Engineering Challenges and Solutions

### 1. Game State Desynchronization

* **Problem**: If clients managed their own card counts or turn tracking, network delays could quickly cause players to see different states of the board.
* **Solution**: I moved all state evaluation to the server. The client simply requests an action (`play_card`, `draw_card`), and the server validates it before broadcasting the updated game state to everyone.

### 2. Players Going AFK or Disconnecting

* **Problem**: If a player stopped taking their turn or closed their browser tab, the game would stall indefinitely.
* **Solution**: I added a 20-second countdown timer for active turns. If the timer runs out, a modal pops up giving options to restart or pass. If a socket disconnects, the server marks the player as offline so others know what happened.

### 3. Handling Wild Card Color Choices

* **Problem**: Playing a Wild card requires picking a color before the move can actually be submitted to the game loop.
* **Solution**: When a Wild card is clicked, the script holds the card ID in a temporary variable (`pendingWildCardId`) and pops up the color modal. Once the user selects a color, the combined data is sent to the server in a single socket event.

### 4. Smooth Animations Without Lag

* **Problem**: Sending animation data across sockets can introduce heavy latency.
* **Solution**: Instead of transmitting movement positions over the network, the server only sends light status signals. The browser handles card transitions and floating reactions locally using CSS animations.

---

## Local Setup

### Requirements

* Node.js (v14 or higher)
* Git

### Steps

1. Clone the repository:
```bash
git clone https://github.com/ParanoicP08/UNO-Multiplayer-Game.git
cd UNO-Multiplayer-Game

```


2. Install dependencies:
```bash
npm install

```


3. Start the server:
```bash
node server.js

```


4. Open your browser and go to `http://localhost:3000`. You can open multiple browser tabs or windows to test playing against yourself locally.

---

## License

Distributed under the MIT License.
