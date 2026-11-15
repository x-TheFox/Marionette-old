import { Chess, Color, PieceSymbol } from 'chess.js';
import { MarionettePlan } from './dsl';
import { StockfishEngine } from './stockfish-uci';
import {
  selectSteeredMove,
  MoveHistoryStats,
  SteeringDecision,
  checkHardConstraints,
} from './steerer';
import { getBoardPieces } from './features';

export interface GameStepTelemetry {
  ply: number;
  moveNumber: number;
  side: Color;
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  isMarionetteTurn: boolean;
  steeringDecision?: SteeringDecision;
  opponentEvalCp?: number;
}

export interface MatchResult {
  gameId: string;
  planId: string;
  rawGoal: string;
  marionetteColor: Color;
  opponentElo: number;
  outcome: 'win' | 'draw' | 'loss';
  terminationReason: string;
  goalAchieved: boolean;
  goalFailureReason?: string;
  hardConstraintsViolated: number;
  guardrailActivations: number;
  promotionOverridesCount: number;
  totalMoves: number;
  finalFen: string;
  pgn: string;
  steps: GameStepTelemetry[];
}

export interface RunMatchOptions {
  plan: MarionettePlan;
  opponentElo: number;
  marionetteColor?: Color;
  marionetteDepth?: number;
  marionetteMultiPv?: number;
  maxPlies?: number;
  startingFen?: string;
  gameIndex?: number;
  onStep?: (step: GameStepTelemetry) => void;
}

export function verifyGoalAchievement(
  chess: Chess,
  plan: MarionettePlan,
  marionetteColor: Color,
  historyStats: MoveHistoryStats,
  lastMarionetteMove?: { piece: PieceSymbol; to: string; promotion?: PieceSymbol }
): { achieved: boolean; reason: string } {
  const isCheckmate = chess.isCheckmate();
  const winner: Color | null = isCheckmate ? (chess.turn() === 'w' ? 'b' : 'w') : null;

  if (plan.terminal.mustWin && winner !== marionetteColor) {
    return { achieved: false, reason: 'Did not win by checkmate' };
  }

  if (plan.terminal.checkmateWithPiece) {
    if (!lastMarionetteMove || lastMarionetteMove.piece !== plan.terminal.checkmateWithPiece) {
      return {
        achieved: false,
        reason: `Won, but final checkmate was delivered by '${lastMarionetteMove?.piece ?? 'unknown'}' instead of '${plan.terminal.checkmateWithPiece}'`,
      };
    }
  }

  if (plan.terminal.checkmateOnSquare) {
    if (!lastMarionetteMove || lastMarionetteMove.to !== plan.terminal.checkmateOnSquare) {
      return {
        achieved: false,
        reason: `Won, but final checkmate occurred on '${lastMarionetteMove?.to}' instead of '${plan.terminal.checkmateOnSquare}'`,
      };
    }
  }

  if (plan.terminal.requireZeroPieceMoves && plan.terminal.requireZeroPieceMoves.length > 0) {
    for (const p of plan.terminal.requireZeroPieceMoves) {
      if (historyStats.movedPieces.has(p)) {
        return {
          achieved: false,
          reason: `Forbidden piece '${p}' moved during the game`,
        };
      }
    }
  }

  if (plan.terminal.requireOnlyPiecesRemaining && plan.terminal.requireOnlyPiecesRemaining.length > 0) {
    const ownPieces = getBoardPieces(chess.fen()).filter(p => p.color === marionetteColor);
    const invalidRemaining = ownPieces.filter(
      p => !plan.terminal.requireOnlyPiecesRemaining!.includes(p.type)
    );
    if (invalidRemaining.length > 0) {
      return {
        achieved: false,
        reason: `Still had non-allowed pieces remaining at end: ${invalidRemaining.map(p => p.type).join(',')}`,
      };
    }
  }

  return { achieved: true, reason: 'All terminal and hard constraints satisfied' };
}

/**
 * Plays a full game between Marionette (steered Stockfish) and an opponent Stockfish at `opponentElo`.
 */
export async function playMarionetteMatch(
  engine: StockfishEngine,
  options: RunMatchOptions
): Promise<MatchResult> {
  const {
    plan,
    opponentElo,
    marionetteColor = 'w',
    marionetteDepth = 10,
    marionetteMultiPv = 14,
    maxPlies = 180,
    startingFen,
    gameIndex = 0,
    onStep,
  } = options;

  const chess = startingFen ? new Chess(startingFen) : new Chess();
  await engine.newGame();

  const historyStats: MoveHistoryStats = {
    queenMovesCount: 0,
    promotedKnightsCount: 0,
    totalPromotionsCount: 0,
    movedPieces: new Set<PieceSymbol>(),
    moveNumber: 1,
    seenPositionKeys: new Set<string>([chess.fen().split(' ').slice(0, 4).join(' ')]),
  };

  const steps: GameStepTelemetry[] = [];
  let hardConstraintsViolated = 0;
  let guardrailActivations = 0;
  let promotionOverridesCount = 0;
  let lastMarionetteMove: { piece: PieceSymbol; to: string; promotion?: PieceSymbol } | undefined;

  for (let ply = 1; ply <= maxPlies; ply++) {
    if (chess.isGameOver()) break;

    const fenBefore = chess.fen();
    const side = chess.turn();
    const moveNumber = Math.floor((ply - 1) / 2) + 1;
    historyStats.moveNumber = moveNumber;

    if (side === marionetteColor) {
      // Marionette's turn: analyze with MultiPV and steer
      const candidates = await engine.analyzeMultiPV(fenBefore, {
        depth: marionetteDepth,
        multiPv: marionetteMultiPv,
      });

      const decision = selectSteeredMove(fenBefore, candidates, plan, historyStats);
      if (decision.guardrailTriggered) guardrailActivations++;
      if (decision.promotionOverrideApplied) promotionOverridesCount++;

      // Apply the chosen move
      const uci = decision.chosenMove.uci;
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length === 5 ? (uci[4] as PieceSymbol) : undefined;

      const moveObj = chess.move({ from, to, promotion });
      if (!moveObj) {
        throw new Error(`Illegal move chosen by steerer: ${uci} in ${fenBefore}`);
      }

      // Check if hard constraint was violated
      const hc = checkHardConstraints(moveObj, plan.hardConstraints, historyStats);
      if (!hc.allowed) {
        hardConstraintsViolated++;
      }

      historyStats.movedPieces.add(moveObj.piece);
      if (moveObj.piece === 'q') historyStats.queenMovesCount++;
      if (moveObj.promotion) {
        historyStats.totalPromotionsCount++;
        if (moveObj.promotion === 'n') historyStats.promotedKnightsCount++;
      }

      lastMarionetteMove = {
        piece: (moveObj.promotion ?? moveObj.piece) as PieceSymbol,
        to: moveObj.to,
        promotion: moveObj.promotion as PieceSymbol | undefined,
      };

      const step: GameStepTelemetry = {
        ply,
        moveNumber,
        side,
        uci,
        san: moveObj.san,
        fenBefore,
        fenAfter: chess.fen(),
        isMarionetteTurn: true,
        steeringDecision: decision,
      };
      historyStats.seenPositionKeys?.add(step.fenAfter.split(' ').slice(0, 4).join(' '));
      steps.push(step);
      onStep?.(step);
    } else {
      // Opponent's turn
      const oppMove = await engine.pickOpponentMove(fenBefore, opponentElo, {
        seedOffset: gameIndex + ply,
      });
      const from = oppMove.uci.slice(0, 2);
      const to = oppMove.uci.slice(2, 4);
      const promotion = oppMove.uci.length === 5 ? (oppMove.uci[4] as PieceSymbol) : undefined;

      const moveObj = chess.move({ from, to, promotion });
      const step: GameStepTelemetry = {
        ply,
        moveNumber,
        side,
        uci: oppMove.uci,
        san: moveObj.san,
        fenBefore,
        fenAfter: chess.fen(),
        isMarionetteTurn: false,
        opponentEvalCp: oppMove.cp,
      };
      historyStats.seenPositionKeys?.add(step.fenAfter.split(' ').slice(0, 4).join(' '));
      steps.push(step);
      onStep?.(step);
    }
  }

  // Determine game outcome
  let outcome: 'win' | 'draw' | 'loss' = 'draw';
  let terminationReason = 'Max plies reached / adjudicated';

  if (chess.isCheckmate()) {
    const winner: Color = chess.turn() === 'w' ? 'b' : 'w';
    outcome = winner === marionetteColor ? 'win' : 'loss';
    terminationReason = 'Checkmate';
  } else if (chess.isStalemate()) {
    outcome = 'draw';
    terminationReason = 'Stalemate';
  } else if (chess.isThreefoldRepetition()) {
    outcome = 'draw';
    terminationReason = 'Threefold repetition';
  } else if (chess.isInsufficientMaterial()) {
    outcome = 'draw';
    terminationReason = 'Insufficient material';
  } else if (chess.isDraw()) {
    outcome = 'draw';
    terminationReason = '50-move rule / draw';
  } else {
    // Max plies reached: adjudicate if overwhelming advantage (> +650cp) for standard games
    const lastMarionetteStep = [...steps].reverse().find(s => s.isMarionetteTurn);
    const finalCp = lastMarionetteStep?.steeringDecision?.chosenMove.cp ?? 0;
    if (finalCp >= 650 && !plan.terminal.checkmateWithPiece) {
      outcome = 'win';
      terminationReason = `Adjudicated win at +${finalCp}cp`;
    }
  }

  const verification =
    outcome === 'win' && !chess.isCheckmate() && !plan.terminal.checkmateWithPiece
      ? { achieved: hardConstraintsViolated === 0, reason: 'Adjudicated decisive win with constraints intact' }
      : verifyGoalAchievement(chess, plan, marionetteColor, historyStats, lastMarionetteMove);

  const goalAchieved = outcome === 'win' && verification.achieved && hardConstraintsViolated === 0;

  return {
    gameId: `${plan.id}-vs-${opponentElo}-g${gameIndex + 1}`,
    planId: plan.id,
    rawGoal: plan.rawGoal,
    marionetteColor,
    opponentElo,
    outcome,
    terminationReason,
    goalAchieved,
    goalFailureReason: goalAchieved ? undefined : verification.reason,
    hardConstraintsViolated,
    guardrailActivations,
    promotionOverridesCount,
    totalMoves: Math.ceil(steps.length / 2),
    finalFen: chess.fen(),
    pgn: chess.pgn(),
    steps,
  };
}
