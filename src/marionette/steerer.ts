import { Chess, Move, Color, PieceSymbol } from 'chess.js';
import {
  MarionettePlan,
  HardConstraint,
  PlanPhase,
  PhaseCondition,
  PromotionPiece,
} from './dsl';
import { evaluateFeatures, FeatureBreakdownItem, getBoardPieces } from './features';

export interface CandidateMoveEval {
  uci: string;       // e.g. "e2e4" or "e7e8n"
  san: string;       // e.g. "e4" or "e8=N#"
  cp: number;        // Stockfish centipawns from player's perspective (+300 = +3.0 pawns ahead, 10000 = forced mate)
  mateIn?: number;   // Positive if we mate in N, negative if we get mated in N
  pv?: string[];     // Principal variation
}

export interface MoveHistoryStats {
  queenMovesCount: number;
  promotedKnightsCount: number;
  totalPromotionsCount: number;
  movedPieces: Set<PieceSymbol>;
  moveNumber: number;
  seenPositionKeys?: Set<string>;
}

export interface ScoredCandidate extends CandidateMoveEval {
  allowedByHardConstraints: boolean;
  violatedConstraint?: string;
  withinEvalGuardrail: boolean;
  featureBonusCp: number;
  compositeScoreCp: number;
  deliversTargetCheckmate: boolean;
  isSacrificeMove: boolean;
  featureBreakdown: FeatureBreakdownItem[];
}

export interface SteeringDecision {
  chosenMove: ScoredCandidate;
  bestEngineMove: CandidateMoveEval;
  activePhase: PlanPhase;
  candidates: ScoredCandidate[];
  guardrailTriggered: boolean;
  promotionOverrideApplied: boolean;
  reasoning: string;
}

/**
 * Applies `promotionOverride` or `promote_only_to` constraint to any promotion UCI string
 * or checks if a legal move with the desired promotion exists.
 */
export function applyPromotionOverride(
  fen: string,
  uciMove: string,
  plan: MarionettePlan
): { uci: string; overridden: boolean } {
  const overridePiece: PromotionPiece | undefined =
    plan.promotionOverride ??
    (plan.hardConstraints.find(c => c.type === 'promote_only_to') as { piece: PromotionPiece } | undefined)?.piece ??
    (plan.terminal.checkmateWithPiece && ['n', 'b', 'r', 'q'].includes(plan.terminal.checkmateWithPiece)
      ? (plan.terminal.checkmateWithPiece as PromotionPiece)
      : undefined);

  if (!overridePiece) {
    return { uci: uciMove, overridden: false };
  }

  // A UCI move is 5 chars if it's a promotion (e.g. a7a8q)
  if (uciMove.length === 5) {
    const base = uciMove.slice(0, 4);
    const currentPromo = uciMove[4];
    if (currentPromo !== overridePiece) {
      const candidateUci = `${base}${overridePiece}`;
      // Verify legality in chess.js
      const chess = new Chess(fen);
      const legal = chess.moves({ verbose: true }).some(
        m => `${m.from}${m.to}${m.promotion ?? ''}` === candidateUci
      );
      if (legal) {
        return { uci: candidateUci, overridden: true };
      }
    }
  }
  return { uci: uciMove, overridden: false };
}

/**
 * Checks if a verbose chess.js Move violates any hard constraint in the plan.
 */
export function checkHardConstraints(
  move: Move,
  constraints: HardConstraint[],
  historyStats: MoveHistoryStats = {
    queenMovesCount: 0,
    promotedKnightsCount: 0,
    totalPromotionsCount: 0,
    movedPieces: new Set(),
    moveNumber: 1,
  }
): { allowed: boolean; violated?: string } {
  for (const c of constraints) {
    switch (c.type) {
      case 'never_move_piece': {
        if (move.piece === c.piece) {
          return { allowed: false, violated: `never_move_piece(${c.piece})` };
        }
        break;
      }
      case 'never_capture_with': {
        if ((move.captured || move.flags.includes('c') || move.flags.includes('e')) && move.piece === c.piece) {
          return { allowed: false, violated: `never_capture_with(${c.piece})` };
        }
        break;
      }
      case 'forbid_castling': {
        if (move.flags.includes('k') || move.flags.includes('q') || move.san.startsWith('O-O')) {
          return { allowed: false, violated: 'forbid_castling' };
        }
        break;
      }
      case 'promote_only_to': {
        if (move.promotion && move.promotion !== c.piece) {
          return { allowed: false, violated: `promote_only_to(${c.piece})` };
        }
        break;
      }
      case 'never_move_file_pawn': {
        if (move.piece === 'p' && move.from[0] === c.file) {
          return { allowed: false, violated: `never_move_file_pawn(${c.file})` };
        }
        break;
      }
      case 'max_queen_moves': {
        if (move.piece === 'q' && historyStats.queenMovesCount >= c.count) {
          return { allowed: false, violated: `max_queen_moves(${c.count})` };
        }
        break;
      }
    }
  }
  return { allowed: true };
}

/**
 * Filters all legal moves in a position, returning only those that satisfy hard constraints.
 */
export function getConstraintCompliantMoves(
  fen: string,
  constraints: HardConstraint[],
  historyStats?: MoveHistoryStats
): { compliantMoves: Move[]; allLegalMoves: Move[] } {
  const chess = new Chess(fen);
  const allLegalMoves = chess.moves({ verbose: true });
  const compliantMoves = allLegalMoves.filter(
    m => checkHardConstraints(m, constraints, historyStats).allowed
  );
  return { compliantMoves, allLegalMoves };
}

export function evaluatePhaseCondition(
  fen: string,
  cond: PhaseCondition,
  color: Color,
  bestCp: number,
  moveNumber: number
): boolean {
  const pieces = getBoardPieces(fen).filter(p => p.color === color);
  switch (cond.type) {
    case 'always':
      return true;
    case 'own_non_pawn_count_lte': {
      const nonPawnNonKing = pieces.filter(p => p.type !== 'p' && p.type !== 'k');
      return nonPawnNonKing.length <= cond.count;
    }
    case 'own_piece_count_gte': {
      const count = pieces.filter(p => p.type === cond.piece).length;
      return count >= cond.count;
    }
    case 'move_number_gte':
      return moveNumber >= cond.move;
    case 'eval_cp_gte':
      return bestCp >= cond.cp;
    case 'only_pieces_remaining': {
      return pieces.every(p => cond.allowedPieces.includes(p.type));
    }
  }
}

export function selectActivePhase(
  fen: string,
  plan: MarionettePlan,
  color: Color,
  bestCp: number,
  moveNumber: number
): PlanPhase {
  let selected = plan.phases[0];
  for (const phase of plan.phases) {
    const active = evaluatePhaseCondition(fen, phase.activationCondition, color, bestCp, moveNumber);
    const completed = phase.completionCondition
      ? evaluatePhaseCondition(fen, phase.completionCondition, color, bestCp, moveNumber)
      : false;
    if (active && !completed) {
      selected = phase;
    } else if (active && completed) {
      selected = phase;
    }
  }
  return selected;
}

/**
 * Core Marionette steering algorithm:
 * Given a FEN, Stockfish's Multi-PV candidate evaluations (or full legal move evaluations),
 * and the structured `MarionettePlan`, returns the chosen move and full diagnostic breakdown.
 */
export function selectSteeredMove(
  fen: string,
  engineCandidates: CandidateMoveEval[],
  plan: MarionettePlan,
  historyStats: MoveHistoryStats = {
    queenMovesCount: 0,
    promotedKnightsCount: 0,
    totalPromotionsCount: 0,
    movedPieces: new Set(),
    moveNumber: 1,
  }
): SteeringDecision {
  const chess = new Chess(fen);
  const color = chess.turn();
  const allLegal = chess.moves({ verbose: true });

  if (allLegal.length === 0) {
    throw new Error('No legal moves in position');
  }

  const legalByUci = new Map<string, Move>();
  for (const m of allLegal) {
    const uci = `${m.from}${m.to}${m.promotion ?? ''}`;
    legalByUci.set(uci, m);
  }

  const normalizedCandidates: CandidateMoveEval[] = [];
  const seenUci = new Set<string>();
  let anyPromotionOverridden = false;

  for (const cand of engineCandidates) {
    const { uci: overriddenUci, overridden } = applyPromotionOverride(fen, cand.uci, plan);
    if (overridden) anyPromotionOverridden = true;
    const moveObj = legalByUci.get(overriddenUci);
    if (moveObj && !seenUci.has(overriddenUci)) {
      seenUci.add(overriddenUci);
      normalizedCandidates.push({
        ...cand,
        uci: overriddenUci,
        san: moveObj.san,
      });
    }
  }

  const lowestEngineCp =
    normalizedCandidates.length > 0
      ? Math.min(...normalizedCandidates.map(c => c.cp))
      : 0;

  for (const [uci, m] of legalByUci.entries()) {
    if (!seenUci.has(uci)) {
      normalizedCandidates.push({
        uci,
        san: m.san,
        cp: lowestEngineCp - 60,
      });
      seenUci.add(uci);
    }
  }

  const bestEngineMove =
    normalizedCandidates.reduce((best, curr) => (curr.cp > best.cp ? curr : best), normalizedCandidates[0]);

  const activePhase = selectActivePhase(
    fen,
    plan,
    color,
    bestEngineMove.cp,
    historyStats.moveNumber
  );

  const isPureWinPlan =
    plan.rawGoal.trim().toLowerCase() === 'just win' ||
    (plan.hardConstraints.length === 0 && !plan.terminal.checkmateWithPiece && !plan.promotionOverride);

  // Guardrail floor: ensure we never drop below +100cp once we are winning, and raise the eval floor to prevent losses
  const baseEvalFloor = Math.max(activePhase.evalFloorCp ?? plan.evalFloorCp, 50);
  const effectiveEvalFloor =
    bestEngineMove.cp >= 200 ? Math.max(baseEvalFloor, 120) : baseEvalFloor;

  const baseMaxDrop = activePhase.maxEvalDropCp ?? plan.maxEvalDropCp;
  // For "just win", keep maxEvalDropCp at 10cp so Marionette plays pure top Stockfish moves;
  // For constrained plans, keep maxEvalDropCp tight (<= 35cp) until we have a clear advantage (+220cp) so we never lose to Elo 2200-2400!
  const effectiveMaxDrop = isPureWinPlan
    ? Math.min(baseMaxDrop, 12)
    : bestEngineMove.cp < 220
    ? Math.min(baseMaxDrop, 35)
    : baseMaxDrop;

  const scoredCandidates: ScoredCandidate[] = [];

  for (const cand of normalizedCandidates) {
    const moveObj = legalByUci.get(cand.uci)!;
    const constraintCheck = checkHardConstraints(moveObj, plan.hardConstraints, historyStats);

    const nextChess = new Chess(fen);
    nextChess.move(moveObj);
    const nextFen = nextChess.fen();
    const isCheckmate = nextChess.isCheckmate();
    const isDrawOrStalemate = nextChess.isDraw() || nextChess.isStalemate() || nextChess.isInsufficientMaterial();

    // Check if this position key was already seen (anti-repetition when Marionette is ahead or trying to win)
    const posKey = nextFen.split(' ').slice(0, 4).join(' ');
    const isRepeatedPosition = Boolean(historyStats.seenPositionKeys?.has(posKey));

    let deliversTargetCheckmate = false;
    let avoidsWrongCheckmatePenalty = 0;

    if (isCheckmate) {
      const effectivePiece = (moveObj.promotion ?? moveObj.piece) as PieceSymbol;
      const reqMatePiece = plan.terminal.checkmateWithPiece;
      const reqMateSq = plan.terminal.checkmateOnSquare;
      const reqRemaining = plan.terminal.requireOnlyPiecesRemaining;

      let matchesMateRequirements = true;
      if (reqMatePiece && effectivePiece !== reqMatePiece) {
        matchesMateRequirements = false;
      }
      if (reqMateSq && moveObj.to !== reqMateSq) {
        matchesMateRequirements = false;
      }
      if (reqRemaining && reqRemaining.length > 0) {
        const ownRemaining = getBoardPieces(nextFen).filter(p => p.color === color);
        if (!ownRemaining.every(p => reqRemaining.includes(p.type))) {
          matchesMateRequirements = false;
        }
      }

      if (matchesMateRequirements) {
        deliversTargetCheckmate = true;
      } else {
        // Massive penalty so neither Tier 2 nor Tier 3 picks a wrong-piece checkmate when other moves exist!
        avoidsWrongCheckmatePenalty = -50000;
      }
    }

    // Also penalize accidental stalemate / draw or repetition when we are trying to win
    let drawRepetitionPenalty = 0;
    if (isDrawOrStalemate && bestEngineMove.cp > -100) {
      drawRepetitionPenalty -= 25000;
    } else if (isRepeatedPosition && bestEngineMove.cp > 0) {
      drawRepetitionPenalty -= 1200;
    }

    // Lookahead 1 ply for immediate target-piece checkmate threat (e.g., setting up mate-in-1 with a knight!)
    let targetMateThreatBonus = 0;
    const reqMatePiece = plan.terminal.checkmateWithPiece;
    if (!isCheckmate && !isDrawOrStalemate && reqMatePiece && bestEngineMove.cp >= 250) {
      const oppResponses = nextChess.moves({ verbose: true });
      if (oppResponses.length > 0 && oppResponses.length <= 8) {
        let canMateNextWithTarget = false;
        for (const oppM of oppResponses.slice(0, 4)) {
          nextChess.move(oppM);
          const ourFollowups = nextChess.moves({ verbose: true });
          for (const fMove of ourFollowups) {
            const effP = (fMove.promotion ?? fMove.piece) as PieceSymbol;
            if (effP === reqMatePiece && fMove.san.endsWith('#')) {
              canMateNextWithTarget = true;
              break;
            }
          }
          nextChess.undo();
          if (canMateNextWithTarget) break;
        }
        if (canMateNextWithTarget) {
          targetMateThreatBonus = 1500;
        }
      }
    }

    const nextPromotedKnights =
      historyStats.promotedKnightsCount + (moveObj.promotion === 'n' ? 1 : 0);

    const { totalBonusCp, breakdown } = evaluateFeatures(nextFen, activePhase.features, {
      color,
      promotedKnightsCount: nextPromotedKnights,
      queenMovesCount: historyStats.queenMovesCount + (moveObj.piece === 'q' ? 1 : 0),
      lastMoveGivesCheck: nextChess.inCheck(),
    });

    // Scale feature weights: for pure win plans keep bonus tiny (0.05) so Stockfish's own evaluation dominates;
    // for stylistic plans scale down when position is close (< +180cp) so Stockfish plays rock-solid opening/middlegame first
    const phaseScale = isPureWinPlan ? 0.05 : bestEngineMove.cp < 180 ? 0.35 : 1.0;
    const scaledFeatureBonus = Math.round(totalBonusCp * phaseScale);

    // Detect active piece offering / sacrifice ONLY when we have a commanding advantage (> +450cp) and at least 1 pawn on board to promote!
    let tacticalSacrificeBonus = 0;
    let isSacrificeMove = false;
    const ownPawnsCount = getBoardPieces(nextFen).filter(p => p.color === color && p.type === 'p').length;
    const sacFeature = activePhase.features.find(f => f.feature === 'non_pawn_pieces_sacrificed' && f.weight > 0);
    if (sacFeature && bestEngineMove.cp >= 420 && ownPawnsCount >= 1 && moveObj.piece !== 'p' && moveObj.piece !== 'k') {
      const targetPieces = sacFeature.targetPieces ?? ['q', 'r', 'b'];
      if (targetPieces.includes(moveObj.piece)) {
        const opponentColor: Color = color === 'w' ? 'b' : 'w';
        if (nextChess.isAttacked(moveObj.to, opponentColor)) {
          isSacrificeMove = true;
          tacticalSacrificeBonus = Math.round(sacFeature.weight * 0.9);
        }
      }
    }

    let promotionBonus = 0;
    const reqPromo =
      plan.promotionOverride ??
      plan.terminal.requirePromotionsTo ??
      (plan.hardConstraints.find(c => c.type === 'promote_only_to') as { piece: PromotionPiece } | undefined)?.piece;
    if (reqPromo && moveObj.promotion === reqPromo) {
      promotionBonus = 900;
    }

    const excessAdvantage = Math.max(0, bestEngineMove.cp - 450);
    const dynamicMaxDrop = effectiveMaxDrop + Math.round(excessAdvantage * 0.65);

    const withinEvalGuardrail =
      ((cand.cp >= effectiveEvalFloor && bestEngineMove.cp - cand.cp <= dynamicMaxDrop) ||
        deliversTargetCheckmate) &&
      avoidsWrongCheckmatePenalty === 0 &&
      !isDrawOrStalemate;

    const totalFeatureBonus =
      scaledFeatureBonus +
      tacticalSacrificeBonus +
      promotionBonus +
      targetMateThreatBonus +
      avoidsWrongCheckmatePenalty +
      drawRepetitionPenalty +
      (deliversTargetCheckmate ? 50000 : 0);

    const compositeScoreCp = cand.cp + totalFeatureBonus;

    scoredCandidates.push({
      ...cand,
      allowedByHardConstraints: constraintCheck.allowed,
      violatedConstraint: constraintCheck.violated,
      withinEvalGuardrail,
      featureBonusCp: totalFeatureBonus,
      compositeScoreCp,
      deliversTargetCheckmate,
      isSacrificeMove,
      featureBreakdown: breakdown,
    });
  }

  // Tier 1: Allowed by hard constraints AND delivers target checkmate
  const tier1 = scoredCandidates.filter(c => c.allowedByHardConstraints && c.deliversTargetCheckmate);
  if (tier1.length > 0) {
    tier1.sort((a, b) => b.compositeScoreCp - a.compositeScoreCp);
    return {
      chosenMove: tier1[0],
      bestEngineMove,
      activePhase,
      candidates: scoredCandidates.sort((a, b) => b.compositeScoreCp - a.compositeScoreCp),
      guardrailTriggered: false,
      promotionOverrideApplied: anyPromotionOverridden,
      reasoning: `Delivered target checkmate (${tier1[0].san}) in phase "${activePhase.name}".`,
    };
  }

  // Tier 2: Allowed by hard constraints AND within eval guardrail
  const tier2 = scoredCandidates.filter(c => c.allowedByHardConstraints && c.withinEvalGuardrail);
  if (tier2.length > 0) {
    tier2.sort((a, b) => b.compositeScoreCp - a.compositeScoreCp);
    const chosen = tier2[0];
    const steeredAway = chosen.uci !== bestEngineMove.uci;
    return {
      chosenMove: chosen,
      bestEngineMove,
      activePhase,
      candidates: scoredCandidates.sort((a, b) => b.compositeScoreCp - a.compositeScoreCp),
      guardrailTriggered: false,
      promotionOverrideApplied: anyPromotionOverridden,
      reasoning: steeredAway
        ? `Steered to ${chosen.san} (eval ${chosen.cp}cp, plan bonus +${chosen.featureBonusCp}cp) over engine top ${bestEngineMove.san} (${bestEngineMove.cp}cp) during "${activePhase.name}".`
        : `Selected engine top choice ${chosen.san} (${chosen.cp}cp, plan bonus +${chosen.featureBonusCp}cp) in "${activePhase.name}".`,
    };
  }

  // Tier 3: Guardrail active! Pick the highest-survival compliant move that ALSO avoids wrong-piece checkmate or repetition
  const tier3 = scoredCandidates.filter(c => c.allowedByHardConstraints);
  if (tier3.length > 0) {
    tier3.sort((a, b) => (b.cp + Math.min(0, b.featureBonusCp)) - (a.cp + Math.min(0, a.featureBonusCp)));
    const chosen = tier3[0];
    return {
      chosenMove: chosen,
      bestEngineMove,
      activePhase,
      candidates: scoredCandidates.sort((a, b) => b.compositeScoreCp - a.compositeScoreCp),
      guardrailTriggered: true,
      promotionOverrideApplied: anyPromotionOverridden,
      reasoning: `Eval guardrail active (${chosen.cp}cp vs floor ${effectiveEvalFloor}cp): prioritized highest-survival compliant move ${chosen.san}.`,
    };
  }

  // Tier 4: Forced violation only if 0 legal moves satisfy hard constraints
  scoredCandidates.sort((a, b) => b.cp - a.cp);
  return {
    chosenMove: scoredCandidates[0],
    bestEngineMove,
    activePhase,
    candidates: scoredCandidates,
    guardrailTriggered: true,
    promotionOverrideApplied: anyPromotionOverridden,
    reasoning: `No constraint-compliant legal moves exist in this position; forced to play ${scoredCandidates[0].san}.`,
  };
}
