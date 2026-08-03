// cards.js - Card model and standard 108-card UNO deck

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const WILD = 'wild';

// type: 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'
export function createDeck(numDecks = 1) {
  const deck = [];
  let id = 0;

  for (let d = 0; d < numDecks; d++) {
    for (const color of COLORS) {
      // One 0 per color
      deck.push({ id: id++, color, type: 'number', value: 0 });
      // Two each of 1-9 per color
      for (let v = 1; v <= 9; v++) {
        deck.push({ id: id++, color, type: 'number', value: v });
        deck.push({ id: id++, color, type: 'number', value: v });
      }
      // Two each of Skip, Reverse, Draw Two per color
      for (let i = 0; i < 2; i++) {
        deck.push({ id: id++, color, type: 'skip' });
        deck.push({ id: id++, color, type: 'reverse' });
        deck.push({ id: id++, color, type: 'draw2' });
      }
    }

    // 4 Wild, 4 Wild Draw Four
    for (let i = 0; i < 4; i++) {
      deck.push({ id: id++, color: WILD, type: 'wild' });
      deck.push({ id: id++, color: WILD, type: 'wild4' });
    }
  }

  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cardMatches(card, topCard, currentColor) {
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (topCard.type === 'number' && card.type === 'number') {
    return card.value === topCard.value;
  }
  if (card.type === topCard.type && card.type !== 'number') return true;
  return false;
}

export function cardLabel(card) {
  if (card.type === 'number') return `${card.color} ${card.value}`;
  if (card.type === 'wild') return 'Wild';
  if (card.type === 'wild4') return 'Wild Draw Four';
  return `${card.color} ${card.type}`;
}