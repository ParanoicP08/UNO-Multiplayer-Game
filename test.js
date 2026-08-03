import { createDeck, shuffle } from './cards.js';
import {
  createGame, isValidPlay, playCard, drawCard, passTurn,
  catchUnoFailure, getPublicState, GameError, chooseStartColor
} from './gameEngine.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ', name); }
  else { fail++; console.log(' FAIL ', name); }
}
function expectThrow(name, fn) {
  try { fn(); fail++; console.log(' FAIL ', name, '(did not throw)'); }
  catch (e) {
    if (e instanceof GameError) { pass++; console.log('  OK  ', name, '->', e.message); }
    else { fail++; console.log(' FAIL ', name, '(threw wrong error type)', e); }
  }
}

console.log('=== Deck composition ===');
const deck = createDeck();
check('deck has 108 cards', deck.length === 108);
check('19 red cards (0-9, two of 1-9 = 19)', deck.filter(c => c.color === 'red' && c.type === 'number').length === 19);
check('2 red skip cards', deck.filter(c => c.color === 'red' && c.type === 'skip').length === 2);
check('4 wild cards', deck.filter(c => c.type === 'wild').length === 4);
check('4 wild4 cards', deck.filter(c => c.type === 'wild4').length === 4);
check('all card ids unique', new Set(deck.map(c => c.id)).size === 108);

const shuffled = shuffle(deck, () => 0.42);
check('shuffle preserves card count', shuffled.length === 108);
check('shuffle preserves all ids (no loss/dup)', new Set(shuffled.map(c => c.id)).size === 108);

console.log();
console.log('=== Game setup ===');
let seed = 1;
const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

const g = createGame(['alice', 'bob', 'carol'], rng);
check('3 players created', g.players.length === 3);
check('each player dealt 7 cards', g.players.every(p => p.hand.length === 7));
check('discard pile has exactly 1 card (the start card)', g.discardPile.length === 1);
check('total cards conserved (108 = hands + draw + discard)',
  g.players.reduce((s, p) => s + p.hand.length, 0) + g.drawPile.length + g.discardPile.length === 108);
check('currentColor is set', ['red','yellow','green','blue'].includes(g.currentColor));

console.log();
console.log('=== Turn enforcement ===');
const g2 = createGame(['alice', 'bob'], rng);
const notCurrentPlayer = g2.players.find(p => p.id !== g2.players[g2.currentPlayerIndex].id).id;
expectThrow('playing out of turn is rejected', () => {
  const someCard = g2.players.find(p => p.id === notCurrentPlayer).hand[0];
  playCard(g2, notCurrentPlayer, someCard.id);
});

console.log();
console.log('=== Skip effect ===');
{
  // Build a controlled 3-player state manually to test Skip precisely
  const g3 = createGame(['a', 'b', 'c'], rng);
  g3.currentPlayerIndex = 0;
  g3.direction = 1;
  g3.discardPile = [{ id: 9001, color: 'red', type: 'number', value: 5 }];
  g3.currentColor = 'red';
  g3.players[0].hand = [{ id: 9002, color: 'red', type: 'skip' }, { id: 9902, color: 'blue', type: 'number', value: 1 }];
  playCard(g3, 'a', 9002);
  check('Skip moves past player b straight to player c', g3.currentPlayerIndex === 2);
}

console.log();
console.log('=== Reverse effect (3+ players just flips direction) ===');
{
  const g4 = createGame(['a', 'b', 'c'], rng);
  g4.currentPlayerIndex = 0;
  g4.direction = 1;
  g4.discardPile = [{ id: 9003, color: 'blue', type: 'number', value: 5 }];
  g4.currentColor = 'blue';
  g4.players[0].hand = [{ id: 9004, color: 'blue', type: 'reverse' }, { id: 9904, color: 'red', type: 'number', value: 1 }];
  playCard(g4, 'a', 9004);
  check('direction flipped to -1', g4.direction === -1);
  check('turn moves backward to player c (index 2)', g4.currentPlayerIndex === 2);
}

console.log();
console.log('=== Reverse effect (2 players acts as Skip) ===');
{
  const g5 = createGame(['a', 'b'], rng);
  g5.currentPlayerIndex = 0;
  g5.direction = 1;
  g5.discardPile = [{ id: 9005, color: 'green', type: 'number', value: 5 }];
  g5.currentColor = 'green';
  g5.players[0].hand = [{ id: 9006, color: 'green', type: 'reverse' }, { id: 9906, color: 'red', type: 'number', value: 1 }];
  playCard(g5, 'a', 9006);
  check('2-player reverse keeps turn with player a (acts as skip)', g5.currentPlayerIndex === 0);
}

console.log();
console.log('=== Draw Two effect ===');
{
  const g6 = createGame(['a', 'b', 'c'], rng);
  g6.currentPlayerIndex = 0;
  g6.direction = 1;
  g6.discardPile = [{ id: 9007, color: 'yellow', type: 'number', value: 3 }];
  g6.currentColor = 'yellow';
  g6.players[0].hand = [{ id: 9008, color: 'yellow', type: 'draw2' }, { id: 9908, color: 'red', type: 'number', value: 1 }];
  const bBefore = g6.players[1].hand.length;
  playCard(g6, 'a', 9008);
  check('player b drew exactly 2 cards', g6.players[1].hand.length === bBefore + 2);
  check('turn skips b entirely, lands on c', g6.currentPlayerIndex === 2);
}

console.log();
console.log('=== Wild Draw Four effect + color choice ===');
{
  const g7 = createGame(['a', 'b', 'c'], rng);
  g7.currentPlayerIndex = 0;
  g7.direction = 1;
  g7.discardPile = [{ id: 9009, color: 'red', type: 'number', value: 3 }];
  g7.currentColor = 'red';
  g7.players[0].hand = [{ id: 9010, color: 'wild', type: 'wild4' }, { id: 9910, color: 'red', type: 'number', value: 1 }];
  const bBefore = g7.players[1].hand.length;
  playCard(g7, 'a', 9010, 'blue');
  check('player b drew exactly 4 cards', g7.players[1].hand.length === bBefore + 4);
  check('turn skips b, lands on c', g7.currentPlayerIndex === 2);
  check('current color changed to chosen blue', g7.currentColor === 'blue');
}

console.log();
console.log('=== Wild card requires a color choice ===');
{
  const g8 = createGame(['a', 'b'], rng);
  g8.currentPlayerIndex = 0;
  g8.discardPile = [{ id: 9011, color: 'red', type: 'number', value: 3 }];
  g8.currentColor = 'red';
  g8.players[0].hand = [{ id: 9012, color: 'wild', type: 'wild' }];
  expectThrow('wild without chosen color throws', () => playCard(g8, 'a', 9012));
}

console.log();
console.log('=== Invalid card rejected ===');
{
  const g9 = createGame(['a', 'b'], rng);
  g9.currentPlayerIndex = 0;
  g9.discardPile = [{ id: 9013, color: 'red', type: 'number', value: 3 }];
  g9.currentColor = 'red';
  g9.players[0].hand = [{ id: 9014, color: 'blue', type: 'number', value: 7 }];
  expectThrow('mismatched color and number rejected', () => playCard(g9, 'a', 9014));
}

console.log();
console.log('=== Win condition ===');
{
  const g10 = createGame(['a', 'b'], rng);
  g10.currentPlayerIndex = 0;
  g10.discardPile = [{ id: 9015, color: 'red', type: 'number', value: 3 }];
  g10.currentColor = 'red';
  g10.players[0].hand = [{ id: 9016, color: 'red', type: 'number', value: 3 }]; // last card
  playCard(g10, 'a', 9016);
  check('winner set correctly', g10.winner === 'a');
  expectThrow('cannot play after game is won', () => playCard(g10, 'b', g10.players[1].hand[0]?.id ?? -1));
}

console.log();
console.log('=== Draw / pass flow ===');
{
  const g11 = createGame(['a', 'b'], rng);
  g11.currentPlayerIndex = 0;
  g11.discardPile = [{ id: 9017, color: 'red', type: 'number', value: 3 }];
  g11.currentColor = 'red';
  // Give player a a hand with nothing playable
  g11.players[0].hand = [{ id: 9018, color: 'blue', type: 'number', value: 9 }];
  expectThrow('cannot pass before drawing', () => passTurn(g11, 'a'));
  const before = g11.players[0].hand.length;
  drawCard(g11, 'a');
  check('hand grew by 1 after draw', g11.players[0].hand.length === before + 1);
  expectThrow('cannot draw twice in one turn', () => drawCard(g11, 'a'));
  passTurn(g11, 'a');
  check('turn passed to player b', g11.currentPlayerIndex === 1);
}

console.log();
console.log('=== UNO call / catch mechanic ===');
{
  const g12 = createGame(['a', 'b'], rng);
  g12.currentPlayerIndex = 0;
  g12.discardPile = [{ id: 9019, color: 'red', type: 'number', value: 3 }];
  g12.currentColor = 'red';
  g12.players[0].hand = [
    { id: 9020, color: 'red', type: 'number', value: 5 },
    { id: 9021, color: 'green', type: 'number', value: 2 },
  ];
  playCard(g12, 'a', 9020); // leaves exactly 1 card, no declareUno passed
  check('player a now has 1 card', g12.players[0].hand.length === 1);
  check('uno NOT registered (did not declare)', !g12.unoCalled.has('a'));
  const before = g12.players[0].hand.length;
  catchUnoFailure(g12, 'b', 'a');
  check('caught player draws 2 penalty cards', g12.players[0].hand.length === before + 2);
}

console.log();
console.log('=== Full random-play simulation (card conservation under real play) ===');
{
  let simSeed = 777;
  const simRng = () => { simSeed = (simSeed * 9301 + 49297) % 233280; return simSeed / 233280; };
  const g13 = createGame(['a', 'b', 'c', 'd'], simRng);
  let turns = 0;
  const maxTurns = 3000;
  let crashed = false;
  try {
    while (!g13.winner && turns < maxTurns) {
      const pid = g13.players[g13.currentPlayerIndex].id;
      const hand = g13.players[g13.currentPlayerIndex].hand;
      const playable = hand.find(c => isValidPlay(g13, pid, c.id));
      if (playable) {
        const color = (playable.type === 'wild' || playable.type === 'wild4')
          ? ['red','yellow','green','blue'][Math.floor(simRng() * 4)]
          : null;
        playCard(g13, pid, playable.id, color, hand.length === 2);
      } else if (!g13.hasDrawnThisTurn) {
        drawCard(g13, pid);
        const stillHand = g13.players[g13.currentPlayerIndex].hand;
        const nowPlayable = stillHand.find(c => isValidPlay(g13, pid, c.id));
        if (!nowPlayable) passTurn(g13, pid);
      } else {
        passTurn(g13, pid);
      }
      turns++;
      const total = g13.players.reduce((s, p) => s + p.hand.length, 0) + g13.drawPile.length + g13.discardPile.length;
      if (total !== 108) throw new Error(`Card conservation broken at turn ${turns}: total=${total}`);
    }
  } catch (e) {
    crashed = true;
    console.log('SIMULATION ERROR:', e.message);
  }
  check('simulation ran without crashing', !crashed);
  check('simulation reached a winner within maxTurns', !!g13.winner);
  console.log('  (finished in', turns, 'turns, winner:', g13.winner, ')');
}

console.log();
console.log('=== Starting Wild card lets first player choose the color ===');
{
  const g15 = createGame(['a', 'b', 'c'], rng);
  g15.currentPlayerIndex = 0;
  g15.discardPile = [{ id: 9022, color: 'wild', type: 'wild' }];
  g15.currentColor = null;
  g15.awaitingStartColor = true;
  check('play is blocked while awaiting start color', (() => {
    try { playCard(g15, 'a', g15.players[0].hand[0]?.id ?? -1); return false; }
    catch (e) { return e instanceof GameError; }
  })());
  check('draw is blocked while awaiting start color', (() => {
    try { drawCard(g15, 'a'); return false; }
    catch (e) { return e instanceof GameError; }
  })());
  expectThrow('non-current player cannot choose start color', () => chooseStartColor(g15, 'b', 'red'));
  expectThrow('invalid color rejected', () => chooseStartColor(g15, 'a', 'purple'));
  chooseStartColor(g15, 'a', 'green');
  check('currentColor set to chosen color', g15.currentColor === 'green');
  check('awaitingStartColor cleared', g15.awaitingStartColor === false);
  expectThrow('cannot choose start color again once resolved', () => chooseStartColor(g15, 'a', 'red'));
}

console.log();
console.log('=== catchUnoFailure validates the accuser ===');
{
  const g16 = createGame(['a', 'b'], rng);
  g16.discardPile = [{ id: 9023, color: 'red', type: 'number', value: 3 }];
  g16.currentColor = 'red';
  g16.players[0].hand = [{ id: 9024, color: 'red', type: 'number', value: 3 }, { id: 9924, color: 'blue', type: 'number', value: 1 }];
  g16.currentPlayerIndex = 0;
  playCard(g16, 'a', 9024); // leaves a with 1 card, no uno declared
  expectThrow('unknown accuser rejected', () => catchUnoFailure(g16, 'ghost', 'a'));
  expectThrow('cannot catch yourself', () => catchUnoFailure(g16, 'a', 'a'));
}

console.log();
console.log('=== getPublicState hides other players hands ===');
{
  const g14 = createGame(['a', 'b'], rng);
  const view = getPublicState(g14, 'a');
  const aView = view.players.find(p => p.id === 'a');
  const bView = view.players.find(p => p.id === 'b');
  check('requesting player sees own hand', Array.isArray(aView.hand) && aView.hand.length === 7);
  check('other player hand is hidden', bView.hand === undefined);
  check('other player hand count is still visible', bView.handCount === 7);
}

console.log();
console.log(`=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);