import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { validatePlan, MarionettePlan } from './dsl';
import { computeFeatureValue, evaluateFeatures } from './features';
import {
  applyPromotionOverride,
  checkHardConstraints,
  selectSteeredMove,
  CandidateMoveEval,
} from './steerer';
import { FIXTURE_GOALS, compileGoalWithLLM, compileGoalHeuristic } from './compiler';

// ============================================================================
// 1. DSL VALIDATION TESTS
// ============================================================================
test('DSL validates all 10 fixture plans and rejects malformed or contradictory specs', () => {
  for (const fixture of FIXTURE_GOALS) {
    const res = validatePlan(fixture.expectedPlan);
    assert.equal(
      res.valid,
      true,
      `Fixture "${fixture.id}" should be valid, errors: ${res.errors?.join('; ')}`
    );
  }

  // Reject empty phases array
  const emptyPhases = {
    ...FIXTURE_GOALS[0].expectedPlan,
    phases: [],
  };
  const r1 = validatePlan(emptyPhases);
  assert.equal(r1.valid, false, 'Should reject plan with empty phases');

  // Reject invalid piece symbol in hardConstraint
  const invalidPiece = {
    ...FIXTURE_GOALS[0].expectedPlan,
    hardConstraints: [{ type: 'never_move_piece', piece: 'dragon' }],
  };
  const r2 = validatePlan(invalidPiece);
  assert.equal(r2.valid, false, 'Should reject unknown piece symbol');

  // Reject conflicting promotionOverride and promote_only_to constraint
  const conflictingPromo = {
    ...FIXTURE_GOALS[0].expectedPlan,
    promotionOverride: 'n',
    hardConstraints: [{ type: 'promote_only_to', piece: 'q' }],
  };
  const r3 = validatePlan(conflictingPromo);
  assert.equal(r3.valid, false, 'Should reject conflicting promotionOverride and promote_only_to');

  // Reject contradictory checkmateWithPiece and never_move_piece on same piece
  const contradictoryMate = {
    ...FIXTURE_GOALS[0].expectedPlan,
    hardConstraints: [{ type: 'never_move_piece', piece: 'n' }],
    terminal: { mustWin: true, checkmateWithPiece: 'n' },
  };
  const r4 = validatePlan(contradictoryMate);
  assert.equal(r4.valid, false, 'Should reject checkmateWithPiece=n when never_move_piece=n');
});

// ============================================================================
// 2. PROGRESS FEATURE TESTS ON HAND-WRITTEN FEN POSITIONS
// ============================================================================
test('Progress features compute accurate scores on hand-written FEN positions', () => {
  // Starting position FEN
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(computeFeatureValue(startFen, 'non_pawn_pieces_sacrificed', { color: 'w' }), 0);
  assert.equal(computeFeatureValue(startFen, 'queen_on_starting_square', { color: 'w' }), 1);
  assert.equal(computeFeatureValue(startFen, 'knight_count', { color: 'w' }), 2);
  assert.equal(computeFeatureValue(startFen, 'pawn_advancement', { color: 'w' }), 0);
  assert.equal(computeFeatureValue(startFen, 'material_advantage', { color: 'w' }), 0);

  // Hand-written FEN 1: White sacrificed Queen, 2 Rooks, 2 Bishops, 1 Knight (only 1 Knight + Pawns + King left = 6 non-pawns sacrificed)
  const sacrificedFen = '4k3/P7/8/3PP3/8/5N2/8/4K3 w - - 0 1';
  assert.equal(
    computeFeatureValue(sacrificedFen, 'non_pawn_pieces_sacrificed', { color: 'w' }),
    6,
    'White lost Q, 2R, 2B, 1N = 6 non-pawn pieces sacrificed'
  );
  assert.equal(
    computeFeatureValue(sacrificedFen, 'queen_on_starting_square', { color: 'w' }),
    0,
    'White queen is no longer on d1'
  );
  assert.ok(
    computeFeatureValue(sacrificedFen, 'passed_pawn_advancement', { color: 'w' }) > 10,
    'White passed pawns on a7, d5, e5 should yield high passed_pawn_advancement'
  );

  // Hand-written FEN 2: Three White knights surrounding Black king on h8 (underpromoted knight!)
  const knightSwarmFen = '7k/5N1p/5KNN/8/8/8/8/8 w - - 0 1';
  assert.equal(computeFeatureValue(knightSwarmFen, 'knight_count', { color: 'w' }), 3);
  assert.equal(computeFeatureValue(knightSwarmFen, 'promoted_knights_count', { color: 'w' }), 1);
  const prox = computeFeatureValue(knightSwarmFen, 'knight_proximity_to_enemy_king', { color: 'w' });
  assert.ok(prox >= 20, `Expected high knight proximity to h8 king, got ${prox}`);
  const conf = computeFeatureValue(knightSwarmFen, 'enemy_king_confinement', { color: 'w' });
  assert.equal(conf, 7, 'King on h8 (7,7) has max distance 3.5+3.5 = 7.0 from center');

  // Hand-written FEN 3: Castled kingside and central citadel occupation (d4, e4)
  const castledCenterFen = 'r1bq1rk1/pppp1ppp/2n2n2/4p3/3PP3/2N2N2/PPP2PPP/R1BQ1RK1 w - - 4 6';
  assert.equal(computeFeatureValue(castledCenterFen, 'castled_kingside', { color: 'w' }), 1);
  assert.equal(
    computeFeatureValue(
      castledCenterFen,
      'custom_square_occupation',
      { color: 'w' },
      { targetSquares: ['d4', 'e4', 'd5', 'e5'] }
    ),
    2
  );

  // Weighted evaluation breakdown test
  const evalRes = evaluateFeatures(
    knightSwarmFen,
    [
      { feature: 'knight_count', weight: 100 },
      { feature: 'promoted_knights_count', weight: 200 },
    ],
    { color: 'w' }
  );
  assert.equal(evalRes.totalBonusCp, 3 * 100 + 1 * 200);
});

// ============================================================================
// 3. PROMOTION OVERRIDE TESTS
// ============================================================================
test('Promotion override rewrites Queen/Rook/Bishop promotions to target piece (Knight)', () => {
  // White pawn on a7 ready to promote on a8 (with a second pawn on c5 so K+N+P vs K is not an immediate insufficient-material draw)
  const promoFen = '4k3/P7/8/2P5/8/8/8/4K3 w - - 0 1';
  const knightPlan = FIXTURE_GOALS.find(f => f.id === 'sacrifice-promote-knight-mate')!.expectedPlan;

  const res = applyPromotionOverride(promoFen, 'a7a8q', knightPlan);
  assert.equal(res.overridden, true, 'Should override a7a8q to a7a8n');
  assert.equal(res.uci, 'a7a8n');

  // Also test inside selectSteeredMove when Stockfish only returns a7a8q
  const engineCandidates: CandidateMoveEval[] = [
    { uci: 'a7a8q', san: 'a8=Q+', cp: 900 },
    { uci: 'e1e2', san: 'Ke2', cp: 100 },
  ];
  const decision = selectSteeredMove(promoFen, engineCandidates, knightPlan);
  assert.equal(decision.chosenMove.uci, 'a7a8n', 'Steerer must pick underpromotion to knight a7a8n');
  assert.equal(decision.promotionOverrideApplied, true);
});

// ============================================================================
// 4. PROPERTY TEST: HARD CONSTRAINTS ARE NEVER VIOLATED ACROSS RANDOM LEGAL POSITIONS
// ============================================================================
test('Property test: hard constraints are never violated across 100 random legal game positions', () => {
  const testPlans: MarionettePlan[] = [
    FIXTURE_GOALS.find(f => f.id === 'never-move-queen')!.expectedPlan,
    FIXTURE_GOALS.find(f => f.id === 'no-castling-king-walk')!.expectedPlan,
    FIXTURE_GOALS.find(f => f.id === 'pacifist-knights')!.expectedPlan,
    FIXTURE_GOALS.find(f => f.id === 'center-outpost-fortress')!.expectedPlan,
    FIXTURE_GOALS.find(f => f.id === 'sacrifice-promote-knight-mate')!.expectedPlan,
  ];

  // Generate 100 diverse legal positions via random playouts + tactical promotion/castling FENs
  const fens: string[] = [
    // Castling available FEN
    'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    // Promotion available FEN
    '8/P1P5/8/8/8/8/2k5/4K3 w - - 0 1',
    // Knight capture available FEN
    'rnbqkbnr/ppp1pppp/8/3p4/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2',
  ];

  let seed = 1337;
  function nextRand() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  while (fens.length < 100) {
    const c = new Chess();
    const plies = 4 + Math.floor(nextRand() * 35);
    for (let i = 0; i < plies; i++) {
      const moves = c.moves();
      if (moves.length === 0) break;
      const pick = moves[Math.floor(nextRand() * moves.length)];
      c.move(pick);
    }
    if (!c.isGameOver() && c.moves().length > 1) {
      fens.push(c.fen());
    }
  }

  for (const fen of fens) {
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });

    // Create mock Stockfish evaluations that deliberately tempt the steerer with forbidden moves (+500cp)
    const mockEngineCands: CandidateMoveEval[] = legalMoves.slice(0, 12).map((m, idx) => ({
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      san: m.san,
      cp: 400 - idx * 25,
    }));

    for (const plan of testPlans) {
      // Ensure at least one compliant move exists in this position
      const hasCompliantMove = legalMoves.some(
        m => checkHardConstraints(m, plan.hardConstraints).allowed
      );
      if (!hasCompliantMove) continue;

      const decision = selectSteeredMove(fen, mockEngineCands, plan);
      const chosenUci = decision.chosenMove.uci;
      const chosenMoveObj = legalMoves.find(
        m => `${m.from}${m.to}${m.promotion ?? ''}` === chosenUci
      );

      assert.ok(chosenMoveObj, `Chosen move ${chosenUci} must be legal in ${fen}`);
      const check = checkHardConstraints(chosenMoveObj, plan.hardConstraints);
      assert.equal(
        check.allowed,
        true,
        `Hard constraint violated by ${chosenUci} (${chosenMoveObj.san}) in FEN ${fen} under plan ${plan.id}: ${check.violated}`
      );
    }
  }
});

// ============================================================================
// 5. LLM COMPILER TESTS (10 FIXTURE GOALS + MOCK CI + NOVEL GOALS)
// ============================================================================
test('LLM Compiler compiles all 10 fixture goals to valid expected specs in mocked CI mode', async () => {
  assert.equal(FIXTURE_GOALS.length, 10, 'Must have 10 fixture goals');

  for (const fixture of FIXTURE_GOALS) {
    const res = await compileGoalWithLLM(fixture.goal, { mock: true });
    const validation = validatePlan(res.plan);
    assert.equal(validation.valid, true, `Compiled plan for "${fixture.goal}" must validate`);
    assert.equal(
      res.plan.terminal.checkmateWithPiece,
      fixture.expectedPlan.terminal.checkmateWithPiece,
      `checkmateWithPiece mismatch for ${fixture.id}`
    );
    assert.deepEqual(
      res.plan.hardConstraints,
      fixture.expectedPlan.hardConstraints,
      `hardConstraints mismatch for ${fixture.id}`
    );
  }
});

test('Heuristic & LLM compiler synthesizes valid DSL specs for unseen out-of-distribution objectives', () => {
  const unseenGoals = [
    'Win without ever moving the rook and deliver checkmate with a bishop',
    'Never castle, occupy d4 and e5, promote only to knights, and win',
    'Win without capturing with the queen and march the king up the board',
  ];

  for (const goal of unseenGoals) {
    const plan = compileGoalHeuristic(goal);
    const validation = validatePlan(plan);
    assert.equal(
      validation.valid,
      true,
      `Synthesized plan for unseen goal "${goal}" must be valid: ${validation.errors?.join(', ')}`
    );
  }
});
