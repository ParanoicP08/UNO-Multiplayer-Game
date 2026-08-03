// gameEngine.js - Server-authoritative UNO state machine.
// Design: state is a single mutable object per room; every exported function
// takes (state, ...) and mutates it in place, then returns it. This matches
// how a real game server holds one canonical state per room and applies
// validated actions to it - no client ever computes state itself.

import { createDeck, shuffle, cardMatches, COLORS } from './cards.js';

export class GameError extends Error {}

export function createGame(playerIds, rng = Math.random) {
  if (playerIds.length < 2) throw new GameError('UNO needs at least 2 players');
  if (playerIds.length > 10) throw new GameError('UNO supports at most 10 players');

  const deck = shuffle(createDeck(), rng);

  const state = {
    rng,
    players: playerIds.map(id => ({ id, hand: [] })),
    drawPile: deck,
    discardPile: [],
    currentPlayerIndex: 0,
    direction: 1, // 1 = clockwise (increasing index), -1 = counter-clockwise
    currentColor: null,
    hasDrawnThisTurn: false,
    unoCalled: new Set(),
    winner: null,
    awaitingStartColor: false,
    log: [],
  };

  // Deal 7 cards each
  for (let r = 0; r < 7; r++) {
    for (const p of state.players) {
      p.hand.push(state.drawPile.pop());
    }
  }

  // Flip the starting discard card. Official rule: if it's Wild Draw Four,
  // reshuffle it back in and try again. Other action cards apply their
  // start-of-game effect to the first player before play begins.
  let startCard = drawFromPile(state);
  while (startCard.type === 'wild4') {
    state.drawPile.unshift(startCard);
    state.drawPile = shuffle(state.drawPile, rng);
    startCard = drawFromPile(state);
  }
  state.discardPile.push(startCard);

  if (startCard.type === 'wild') {
    // Plain Wild as the opening card: let the first player choose the
    // color (matches official rules) instead of picking one for them.
    state.currentColor = null;
    state.awaitingStartColor = true;
  } else {
    state.currentColor = startCard.color;
  }

  applyStartOfGameEffect(state, startCard);

  state.log.push(`Game started. First card: ${startCard.type}${startCard.type === 'number' ? ' ' + startCard.value : ''}${state.currentColor ? ' (' + state.currentColor + ')' : ''}`);
  return state;
}

export function chooseStartColor(state, playerId, color) {
  if (state.winner) throw new GameError('Game already over');
  if (!state.awaitingStartColor) throw new GameError('No starting color choice is pending');
  const player = currentPlayer(state);
  if (player.id !== playerId) throw new GameError('Not your turn');
  if (!COLORS.includes(color)) throw new GameError('Invalid color choice');
  state.currentColor = color;
  state.awaitingStartColor = false;
  state.log.push(`${playerId} chose ${color} as the starting color.`);
  return state;
}

function applyStartOfGameEffect(state, startCard) {
  switch (startCard.type) {
    case 'skip':
      advanceTurn(state);
      break;
    case 'reverse':
      state.direction *= -1;
      if (state.players.length === 2) advanceTurn(state);
      break;
    case 'draw2': {
      const target = state.players[state.currentPlayerIndex];
      drawCards(state, target, 2);
      advanceTurn(state);
      break;
    }
    default:
      break; // number card or wild: no effect, first player just plays normally
  }
}

function drawFromPile(state) {
  if (state.drawPile.length === 0) reshuffleDiscardIntoDraw(state);
  return state.drawPile.pop();
}

function reshuffleDiscardIntoDraw(state) {
  if (state.discardPile.length <= 1) {
    throw new GameError('No cards left to draw or reshuffle');
  }
  const top = state.discardPile.pop();
  state.drawPile = shuffle(state.discardPile, state.rng || Math.random);
  state.discardPile = [top];
  state.log.push('Draw pile empty - reshuffled discard pile.');
}

function drawCards(state, player, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = drawFromPile(state);
    player.hand.push(card);
    drawn.push(card);
  }
  state.unoCalled.delete(player.id);
  return drawn;
}

export function advanceTurn(state, steps = 1) {
  const n = state.players.length;
  state.currentPlayerIndex = ((state.currentPlayerIndex + steps * state.direction) % n + n) % n;
  state.hasDrawnThisTurn = false;
}

function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function topCard(state) {
  return state.discardPile[state.discardPile.length - 1];
}

export function isValidPlay(state, playerId, cardId) {
  if (state.winner) return false;
  const player = currentPlayer(state);
  if (player.id !== playerId) return false;
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return false;
  return cardMatches(card, topCard(state), state.currentColor);
}

export function playCard(state, playerId, cardId, chosenColor = null, declareUno = false) {
  if (state.winner) throw new GameError('Game already over');
  if (state.awaitingStartColor) throw new GameError('Waiting for the starting color to be chosen');
  const player = currentPlayer(state);
  if (player.id !== playerId) throw new GameError('Not your turn');

  const cardIndex = player.hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) throw new GameError('Card not in hand');
  const card = player.hand[cardIndex];

  if (!cardMatches(card, topCard(state), state.currentColor)) {
    throw new GameError('Card does not match the current color/number/type');
  }

  if ((card.type === 'wild' || card.type === 'wild4') && !chosenColor) {
    throw new GameError('Must choose a color when playing a wild card');
  }
  if (chosenColor && !COLORS.includes(chosenColor)) {
    throw new GameError('Invalid color choice');
  }

  // Remove from hand, place on discard
  player.hand.splice(cardIndex, 1);
  state.discardPile.push(card);
  state.currentColor = (card.type === 'wild' || card.type === 'wild4') ? chosenColor : card.color;

  // UNO call handling: must declare when this play leaves exactly 1 card
  if (player.hand.length === 1) {
    if (declareUno) state.unoCalled.add(player.id);
  } else {
    state.unoCalled.delete(player.id);
  }

  // Win check
  if (player.hand.length === 0) {
    state.winner = player.id;
    state.log.push(`${player.id} wins!`);
    return state;
  }

  // Resolve effect then advance turn
  switch (card.type) {
    case 'skip':
      advanceTurn(state);
      advanceTurn(state);
      break;
    case 'reverse':
      state.direction *= -1;
      if (state.players.length === 2) {
        // With only 2 players, reversing direction and advancing once would
        // still land on the opponent - reverse has to act as a skip here,
        // so advance twice with the new direction to return to the same player.
        advanceTurn(state);
        advanceTurn(state);
      } else {
        advanceTurn(state);
      }
      break;
    case 'draw2': {
      advanceTurn(state);
      drawCards(state, currentPlayer(state), 2);
      advanceTurn(state);
      break;
    }
    case 'wild4': {
      advanceTurn(state);
      drawCards(state, currentPlayer(state), 4);
      advanceTurn(state);
      break;
    }
    default:
      advanceTurn(state);
  }

  return state;
}

export function drawCard(state, playerId) {
  if (state.winner) throw new GameError('Game already over');
  if (state.awaitingStartColor) throw new GameError('Waiting for the starting color to be chosen');
  const player = currentPlayer(state);
  if (player.id !== playerId) throw new GameError('Not your turn');
  if (state.hasDrawnThisTurn) throw new GameError('Already drew this turn - play the card or pass');

  const [card] = drawCards(state, player, 1);
  state.hasDrawnThisTurn = true;
  return card;
}

export function passTurn(state, playerId) {
  if (state.winner) throw new GameError('Game already over');
  const player = currentPlayer(state);
  if (player.id !== playerId) throw new GameError('Not your turn');
  if (!state.hasDrawnThisTurn) throw new GameError('Must draw before passing');
  advanceTurn(state);
}

export function catchUnoFailure(state, accuserId, targetId) {
  const accuser = state.players.find(p => p.id === accuserId);
  if (!accuser) throw new GameError('Accuser is not in this game');
  if (accuserId === targetId) throw new GameError('You cannot catch yourself');
  const target = state.players.find(p => p.id === targetId);
  if (!target) throw new GameError('No such player');
  if (target.hand.length !== 1) throw new GameError('Target does not have exactly 1 card');
  if (state.unoCalled.has(targetId)) throw new GameError('Target already called UNO');
  drawCards(state, target, 2);
  state.log.push(`${targetId} caught not calling UNO - draws 2 penalty cards.`);
}

export function getPublicState(state, forPlayerId) {
  return {
    players: state.players.map(p => ({
      id: p.id,
      handCount: p.hand.length,
      hand: p.id === forPlayerId ? p.hand : undefined,
    })),
    topCard: topCard(state),
    currentColor: state.currentColor,
    currentPlayerId: currentPlayer(state).id,
    direction: state.direction,
    drawPileCount: state.drawPile.length,
    hasDrawnThisTurn: state.hasDrawnThisTurn,
    awaitingStartColor: state.awaitingStartColor,
    winner: state.winner,
  };
}