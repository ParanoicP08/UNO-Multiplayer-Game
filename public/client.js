const socket = io();

let myPlayerId = localStorage.getItem('uno_player_id');
if (!myPlayerId) {
  myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('uno_player_id', myPlayerId);
}

let currentRoom = '';
let moveTimerInterval = null;

const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

const playerNameInput = document.getElementById('player-name');
const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('start-btn');
const leaveBtn = document.getElementById('leave-btn');
const lobbyPlayers = document.getElementById('lobby-players');

if (playerNameInput) playerNameInput.value = localStorage.getItem('uno_name') || '';
if (roomIdInput) roomIdInput.value = localStorage.getItem('uno_room') || '';

if (joinBtn) {
  joinBtn.onclick = () => {
    const name = playerNameInput?.value.trim();
    const room = roomIdInput?.value.trim();
    if (name && room) {
      currentRoom = room;
      localStorage.setItem('uno_name', name);
      localStorage.setItem('uno_room', room);
      socket.emit('join_room', { roomId: room, playerName: name, playerId: myPlayerId });
    } else {
      alert("Please enter both your name and room ID.");
    }
  };
}

if (startBtn) {
  startBtn.onclick = () => socket.emit('start_game');
}

if (leaveBtn) {
  leaveBtn.onclick = () => window.location.reload();
}

// Used anywhere a server-supplied string (player name, chat text) gets
// injected into innerHTML. Any connected client can send arbitrary text
// here regardless of the input's maxlength - that's a UI hint, not a
// guarantee - so this isn't optional.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

socket.on('lobby_update', (players = []) => {
  lobbyScreen.style.display = 'block';
  gameScreen.style.display = 'none';

  if (lobbyPlayers) {
    const rows = players.map(p => `
      <li class="player-row">
        <span class="player-dot"></span>
        <span class="player-name">${escapeHtml(p.name)}</span>
        ${p.id === myPlayerId ? '<span class="you-tag">You</span>' : ''}
      </li>
    `).join('');

    lobbyPlayers.innerHTML = `
      <div class="players-panel-header">
        <span class="players-panel-title">Players</span>
        <span class="players-count-badge">${players.length} joined</span>
      </div>
      <ul class="players-list">${rows}</ul>
    `;
  }
  if (startBtn) startBtn.style.display = players.length >= 2 ? 'inline-block' : 'none';
});

// UNO Game UI Elements
const topCardEl = document.getElementById('top-card');
const myHandEl = document.getElementById('my-hand');
const opponentsArea = document.getElementById('opponents-area');
const statusTxt = document.getElementById('status-announcement');
const colorTxt = document.getElementById('current-color-txt');
const drawBtn = document.getElementById('draw-btn');
const passBtn = document.getElementById('pass-btn');
const colorModal = document.getElementById('color-modal');
const restartBtn = document.getElementById('restart-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

let pendingWildCardId = null;
let choosingStartColor = false;

socket.on('game_state_update', (state) => {
  if (!state) return;
  lobbyScreen.style.display = 'none';
  gameScreen.style.display = 'grid';

  const players = state.players || [];
  const isMyTurn = state.currentPlayerId === myPlayerId;
  const currentPName = players.find(p => p.id === state.currentPlayerId)?.name || "Someone";

  // The opening flipped card can be a plain Wild, in which case the first
  // player must choose the starting color before anyone can act. Without
  // this, the game just sits there with no cards playable and no explanation.
  if (state.awaitingStartColor) {
    if (isMyTurn) {
      choosingStartColor = true;
      if (colorModal) colorModal.style.display = 'flex';
      if (statusTxt) statusTxt.innerText = "👉 Choose the starting color!";
    } else if (statusTxt) {
      statusTxt.innerText = `Waiting for ${currentPName} to choose a color...`;
    }
  }
  
  // Manage Turn Timer
  if (isMyTurn && !state.winner) {
    startMyTurnTimer();
  } else {
    clearInterval(moveTimerInterval);
    hideTimeoutModal();
  }

  if (state.winner) {
    clearInterval(moveTimerInterval);
    if (statusTxt) {
      statusTxt.innerText = `🎉 ${state.winner === myPlayerId ? 'You Win!' : currentPName + ' Wins!'}`;
      statusTxt.style.color = "var(--uno-green)";
    }
    if (restartBtn) restartBtn.style.display = 'block';
    if (drawBtn) drawBtn.style.display = 'none';
    if (passBtn) passBtn.style.display = 'none';
  } else {
    if (restartBtn) restartBtn.style.display = 'none';
    if (drawBtn) drawBtn.style.display = state.awaitingStartColor ? 'none' : 'inline-block';
    if (passBtn) passBtn.style.display = state.awaitingStartColor ? 'none' : 'inline-block';
    if (statusTxt) {
      statusTxt.innerText = isMyTurn ? "👉 IT'S YOUR TURN!" : `Waiting for ${currentPName}...`;
      statusTxt.style.color = isMyTurn ? "var(--uno-green)" : "var(--uno-yellow)";
    }
  }
  
  if (colorTxt) {
    colorTxt.innerText = (state.currentColor || '-').toUpperCase();
    colorTxt.style.backgroundColor = getHexColor(state.currentColor);
    colorTxt.style.color = state.currentColor === 'yellow' ? '#1e293b' : '#fff';
  }
  
  const directionTxt = document.getElementById('direction-txt');
  if (directionTxt) {
    directionTxt.innerText = state.direction === 1 ? 'Clockwise ↻' : 'Counter-Clockwise ↺';
  }

  if (opponentsArea) {
    opponentsArea.innerHTML = '';
    players.forEach(p => {
      if (p.id !== myPlayerId) {
        const opp = document.createElement('div');
        opp.id = `opponent-box-${p.id}`;
        opp.className = `opponent ${state.currentPlayerId === p.id ? 'active-turn' : ''} ${!p.connected ? 'offline' : ''}`;
        opp.innerHTML = `<strong>${escapeHtml(p.name)} ${!p.connected ? '🔌(Offline)' : ''}</strong><br/>🎴 ${p.handCount} cards`;
        
        if (p.handCount === 1 && p.connected) {
          const catchBtn = document.createElement('button');
          catchBtn.innerText = "🚨 Catch UNO!";
          catchBtn.className = "catch-btn";
          catchBtn.onclick = () => socket.emit('catch_uno', p.id);
          opp.appendChild(catchBtn);
        }
        opponentsArea.appendChild(opp);
      }
    });
  }

  if (topCardEl && state.topCard) {
    renderCard(state.topCard, topCardEl);
  }

  const myPlayerObj = players.find(p => p.id === myPlayerId);
  if (myPlayerObj && myPlayerObj.hand) {
    renderHand(myPlayerObj.hand, state);
  }
});

if (sendChatBtn) sendChatBtn.onclick = sendChat;
if (chatInput) {
  chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });
}

function sendChat() {
  const text = chatInput?.value.trim();
  if (text) {
    socket.emit('send_chat', text);
    chatInput.value = '';
  }
}

socket.on('chat_message', (msg) => {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${msg.sys ? 'sys' : ''}`;
  div.innerHTML = `<strong>${escapeHtml(msg.sender)}:</strong> ${escapeHtml(msg.text)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

function renderCard(card, el) {
  el.className = 'card';
  el.dataset.color = card.color;
  
  const inner = document.createElement('div');
  inner.className = 'card-inner';
  
  if (card.type === 'number') {
    inner.innerHTML = `<span style="font-size: 2.2rem; font-weight: 800;">${card.value}</span>`;
  } else if (card.type === 'skip') {
    inner.innerHTML = `<span style="font-size: 2rem;">⊘</span>`;
  } else if (card.type === 'reverse') {
    inner.innerHTML = `<span style="font-size: 2rem;">⇄</span>`;
  } else if (card.type === 'draw2') {
    inner.innerHTML = `<span style="font-size: 1.8rem; font-weight: 800;">+2</span>`;
  } else if (card.type === 'wild') {
    inner.innerHTML = `
      <div class="wild-emblem">
        <div class="wild-red"></div>
        <div class="wild-blue"></div>
        <div class="wild-green"></div>
        <div class="wild-yellow"></div>
      </div>
      <span style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.5px;">WILD</span>`;
  } else if (card.type === 'wild4') {
    inner.innerHTML = `
      <div class="wild-emblem">
        <div class="wild-red"></div>
        <div class="wild-blue"></div>
        <div class="wild-green"></div>
        <div class="wild-yellow"></div>
      </div>
      <span style="font-size: 0.65rem; font-weight: 800; letter-spacing: 0.5px;">+4</span>`;
  }
  
  el.innerHTML = '';
  el.appendChild(inner);
}

function getHexColor(color) {
  switch(color) {
    case 'red': return '#ef4444'; 
    case 'blue': return '#3b82f6';
    case 'green': return '#22c55e'; 
    case 'yellow': return '#eab308'; 
    default: return '#334155';
  }
}

function tryPlayCard(card) {
  const declareUno = document.getElementById('uno-checkbox')?.checked || false;
  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCardId = card.id;
    if (colorModal) colorModal.style.display = 'flex'; 
  } else {
    socket.emit('play_card', { cardId: card.id, chosenColor: null, declareUno });
    const checkbox = document.getElementById('uno-checkbox');
    if (checkbox) checkbox.checked = false;
  }
}

document.querySelectorAll('.color-choice-btn').forEach(btn => {
  btn.onclick = () => {
    const chosenColor = btn.dataset.color;
    const declareUno = document.getElementById('uno-checkbox')?.checked || false;
    if (choosingStartColor) {
      socket.emit('choose_start_color', chosenColor);
      choosingStartColor = false;
    } else if (pendingWildCardId !== null) {
      socket.emit('play_card', { cardId: pendingWildCardId, chosenColor, declareUno });
      pendingWildCardId = null;
      const checkbox = document.getElementById('uno-checkbox');
      if (checkbox) checkbox.checked = false;
    }
    if (colorModal) colorModal.style.display = 'none';
  };
});

if (drawBtn) drawBtn.onclick = () => socket.emit('draw_card');
if (passBtn) passBtn.onclick = () => socket.emit('pass_turn');

// --- 1. Working Emoji Reactions Handler ---
function sendReaction(emoji) {
  showReactionLocally(myPlayerId, emoji);
  socket.emit('send-reaction', { room: currentRoom, emoji: emoji });
}

function showReactionLocally(senderId, emoji) {
  const el = document.getElementById(`player-box-${senderId}`) || document.getElementById(`opponent-box-${senderId}`) || myHandEl;
  if (el) {
    const bubble = document.createElement('div');
    bubble.className = 'floating-reaction';
    bubble.innerText = emoji;
    bubble.style.cssText = 'position:absolute;font-size:24px;z-index:100;pointer-events:none;';
    el.style.position = 'relative';
    el.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1500);
  }
}

socket.on('receive-reaction', (data) => {
  if (data && data.senderId && data.emoji) {
    showReactionLocally(data.senderId, data.emoji);
  }
});

// --- 2. Turn Countdown Timer & Timeout Pop-up Modal ---
function startMyTurnTimer() {
  clearInterval(moveTimerInterval);
  let timeLeft = 20; // 20 seconds per turn

  moveTimerInterval = setInterval(() => {
    timeLeft--;
    if (statusTxt && statusTxt.innerText.includes("YOUR TURN")) {
      statusTxt.innerText = `👉 IT'S YOUR TURN! (${timeLeft}s)`;
    }

    if (timeLeft <= 0) {
      clearInterval(moveTimerInterval);
      showTimeoutModal();
    }
  }, 1000);
}

function showTimeoutModal() {
  let modal = document.getElementById('timeout-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'timeout-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;';
    modal.innerHTML = `
      <div style="background:#1e293b;padding:28px;border-radius:12px;text-align:center;color:#fff;max-width:340px;width:100%;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
        <h3 style="margin-bottom:12px;color:#ef4444;font-size:1.5rem;">⏱️ Time's Up!</h3>
        <p style="margin-bottom:24px;color:#94a3b8;line-height:1.4;">Your time for this move has finished. The server drew/passed for you automatically - play continues.</p>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="timeout-continue-btn" style="background:#22c55e;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">OK, Got It</button>
          <button id="timeout-exit-btn" style="background:#ef4444;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">Exit</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('timeout-continue-btn').onclick = () => {
      hideTimeoutModal();
    };
    document.getElementById('timeout-exit-btn').onclick = () => {
      window.location.reload();
    };
  } else {
    modal.style.display = 'flex';
  }
}

function hideTimeoutModal() {
  const modal = document.getElementById('timeout-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// --- 3. Card Flight Animation Handler ---
function appendCardWithAnimation(cardObj, container) {
  const cardEl = document.createElement('div');
  renderCard(cardObj, cardEl);
  cardEl.classList.add('flying-in');
  container.appendChild(cardEl);
  return cardEl;
}

// --- 4. Post-Game Scoreboard Handler ---
socket.on('game-over', (data) => {
  const { winnerName, standings } = data;
  document.getElementById('winner-announcement').innerText = `🎉 ${winnerName} Wins the Game!`;
  
  const scoreList = document.getElementById('score-list');
  scoreList.innerHTML = '';
  standings.forEach((p, idx) => {
    scoreList.innerHTML += `
      <div class="score-item">
        <span>#${idx + 1} ${p.name}</span>
        <span style="color: var(--text-muted);">${p.cardsCount} cards left</span>
      </div>
    `;
  });

  document.getElementById('scoreboard-modal').style.display = 'flex';
});

const scoreboardRestartBtn = document.getElementById('scoreboard-restart-btn');
if (scoreboardRestartBtn) {
  scoreboardRestartBtn.addEventListener('click', () => {
    document.getElementById('scoreboard-modal').style.display = 'none';
    socket.emit('restart-game', { room: currentRoom });
  });
}

// --- 5. Animated Hand Render Integration ---
function renderHand(cardsArray, state) {
  if (!myHandEl) return;
  myHandEl.innerHTML = ''; 
  let hasValidPlay = false;

  cardsArray.forEach((card) => {
    const cardEl = appendCardWithAnimation(card, myHandEl);
    cardEl.onclick = () => tryPlayCard(card);

    if (card.type === 'wild' || card.type === 'wild4' || card.color === state.currentColor || 
       (card.type === state.topCard?.type && card.type !== 'number') || 
       (card.type === 'number' && state.topCard?.type === 'number' && card.value === state.topCard.value)) {
      hasValidPlay = true;
    }
  });

  const isMyTurn = state.currentPlayerId === myPlayerId;
  if (isMyTurn && state.hasDrawnThisTurn && !hasValidPlay) {
    if (statusTxt) statusTxt.innerText = "No playable cards drawn. Auto-passing...";
    setTimeout(() => socket.emit('pass_turn'), 1200);
  }
}