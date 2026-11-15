import { Chess, Square, PieceSymbol, Color } from 'chess.js';
import { ProgressFeatureType, WeightedFeature } from './dsl';

export interface FeatureContext {
  color: Color;
  promotedKnightsCount?: number;
  queenMovesCount?: number;
  lastMoveGivesCheck?: boolean;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

function squareCoords(sq: string): [number, number] {
  const f = FILES.indexOf(sq[0] as any);
  const r = parseInt(sq[1], 10) - 1;
  return [f, r];
}

function manhattanDistance(sq1: string, sq2: string): number {
  const [f1, r1] = squareCoords(sq1);
  const [f2, r2] = squareCoords(sq2);
  return Math.abs(f1 - f2) + Math.abs(r1 - r2);
}

function chebyshevDistance(sq1: string, sq2: string): number {
  const [f1, r1] = squareCoords(sq1);
  const [f2, r2] = squareCoords(sq2);
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}

export function getBoardPieces(fen: string): Array<{ square: Square; type: PieceSymbol; color: Color }> {
  const chess = new Chess(fen);
  const board = chess.board();
  const list: Array<{ square: Square; type: PieceSymbol; color: Color }> = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p) {
        list.push({ square: p.square, type: p.type, color: p.color });
      }
    }
  }
  return list;
}

/**
 * Evaluates a single progress feature on a given FEN position from `color`'s perspective.
 * Returns a normalized scalar (typically in [0, 10] or count-based) that is deterministic and testable on hand-written FENs.
 */
export function computeFeatureValue(
  fen: string,
  feature: ProgressFeatureType,
  ctx: FeatureContext = { color: 'w' },
  options?: { targetPieces?: PieceSymbol[]; targetSquares?: string[] }
): number {
  const color = ctx.color;
  const enemyColor: Color = color === 'w' ? 'b' : 'w';
  const pieces = getBoardPieces(fen);
  const ownPieces = pieces.filter(p => p.color === color);
  const enemyPieces = pieces.filter(p => p.color === enemyColor);

  switch (feature) {
    case 'non_pawn_pieces_sacrificed': {
      // Starting non-pawn, non-king pieces = 7 (2 N, 2 B, 2 R, 1 Q)
      // Note: If a pawn promotes to a knight, we still care about original or current non-knight/non-pawn pieces if we are doing a knight promotion challenge!
      // Specifically, if targetPieces is provided, count how many of those are missing; otherwise count missing from 7 initial minor/major pieces (excluding promoted knights if specified).
      const targetTypes = options?.targetPieces ?? (['q', 'r', 'b', 'n'] as PieceSymbol[]);
      let initialCount = 0;
      if (targetTypes.includes('q')) initialCount += 1;
      if (targetTypes.includes('r')) initialCount += 2;
      if (targetTypes.includes('b')) initialCount += 2;
      if (targetTypes.includes('n')) initialCount += 2;

      const currentCount = ownPieces.filter(p => targetTypes.includes(p.type)).length;
      return Math.max(0, initialCount - currentCount);
    }

    case 'pawn_advancement': {
      // Sum of how far each own pawn has advanced from starting rank (rank 2 for white, rank 7 for black)
      const pawns = ownPieces.filter(p => p.type === 'p');
      let advancement = 0;
      for (const p of pawns) {
        const rank = parseInt(p.square[1], 10);
        const steps = color === 'w' ? rank - 2 : 7 - rank;
        // Exponentially reward 5th, 6th, 7th rank pawns to encourage promotion
        advancement += steps + (steps >= 4 ? (steps - 3) * 1.5 : 0);
      }
      return Number(advancement.toFixed(2));
    }

    case 'passed_pawn_advancement': {
      const ownPawns = ownPieces.filter(p => p.type === 'p');
      const enemyPawns = enemyPieces.filter(p => p.type === 'p');
      let score = 0;
      for (const p of ownPawns) {
        const [f, r] = squareCoords(p.square);
        const isPassed = !enemyPawns.some(ep => {
          const [ef, er] = squareCoords(ep.square);
          if (Math.abs(ef - f) > 1) return false;
          return color === 'w' ? er > r : er < r;
        });
        if (isPassed) {
          const steps = color === 'w' ? r - 1 : 6 - r;
          score += steps * 2;
        }
      }
      return score;
    }

    case 'knight_count': {
      return ownPieces.filter(p => p.type === 'n').length;
    }

    case 'bishop_count': {
      return ownPieces.filter(p => p.type === 'b').length;
    }

    case 'rook_count': {
      return ownPieces.filter(p => p.type === 'r').length;
    }

    case 'queen_count': {
      return ownPieces.filter(p => p.type === 'q').length;
    }

    case 'knight_proximity_to_enemy_king': {
      const enemyKing = enemyPieces.find(p => p.type === 'k');
      const knights = ownPieces.filter(p => p.type === 'n');
      if (!enemyKing || knights.length === 0) return 0;
      let proximitySum = 0;
      for (const k of knights) {
        const dist = manhattanDistance(k.square, enemyKing.square);
        // Max manhattan distance on board is 14; closer = higher score
        proximitySum += Math.max(0, 10 - dist);
      }
      return proximitySum;
    }

    case 'queen_on_starting_square': {
      const startSq = color === 'w' ? 'd1' : 'd8';
      const q = ownPieces.find(p => p.type === 'q' && p.square === startSq);
      return q ? 1 : 0;
    }

    case 'center_control': {
      const centerSquares = ['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5'];
      const chess = new Chess(fen);
      let control = 0;
      for (const sq of centerSquares) {
        const p = chess.get(sq as Square);
        if (p && p.color === color) {
          control += ['d4', 'e4', 'd5', 'e5'].includes(sq) ? 2 : 1;
        }
      }
      return control;
    }

    case 'enemy_king_confinement': {
      const enemyKing = enemyPieces.find(p => p.type === 'k');
      if (!enemyKing) return 0;
      const [kf, kr] = squareCoords(enemyKing.square);
      // Distance of enemy king from center (3.5, 3.5) -> pushed to edge/corner is higher confinement
      const edgePush = Math.abs(kf - 3.5) + Math.abs(kr - 3.5);
      return Number(edgePush.toFixed(2));
    }

    case 'castled_kingside': {
      const k = ownPieces.find(p => p.type === 'k');
      const r = ownPieces.filter(p => p.type === 'r');
      if (!k) return 0;
      const targetKingSq = color === 'w' ? ['g1', 'h1'] : ['g8', 'h8'];
      const hasRoverLeft = r.some(rook => {
        const [rf] = squareCoords(rook.square);
        const [kf] = squareCoords(k.square);
        return rf < kf;
      });
      return targetKingSq.includes(k.square) && hasRoverLeft ? 1 : 0;
    }

    case 'castled_queenside': {
      const k = ownPieces.find(p => p.type === 'k');
      if (!k) return 0;
      const targetKingSq = color === 'w' ? ['c1', 'b1'] : ['c8', 'b8'];
      return targetKingSq.includes(k.square) ? 1 : 0;
    }

    case 'king_walk_advancement': {
      const k = ownPieces.find(p => p.type === 'k');
      if (!k) return 0;
      const rank = parseInt(k.square[1], 10);
      return color === 'w' ? rank - 1 : 8 - rank;
    }

    case 'edge_file_control': {
      const edgeFiles = ['a', 'h'];
      return ownPieces.filter(p => edgeFiles.includes(p.square[0])).length;
    }

    case 'material_advantage': {
      const ownMat = ownPieces.reduce((acc, p) => acc + PIECE_VALUES[p.type], 0);
      const enemyMat = enemyPieces.reduce((acc, p) => acc + PIECE_VALUES[p.type], 0);
      return ownMat - enemyMat;
    }

    case 'promoted_knights_count': {
      if (typeof ctx.promotedKnightsCount === 'number') {
        return ctx.promotedKnightsCount;
      }
      const knights = ownPieces.filter(p => p.type === 'n').length;
      return Math.max(0, knights - 2);
    }

    case 'opponent_pieces_captured': {
      // Total enemy pieces starts at 16
      return Math.max(0, 16 - enemyPieces.length);
    }

    case 'checks_delivered_bonus': {
      const chess = new Chess(fen);
      if (ctx.lastMoveGivesCheck || chess.inCheck()) {
        return 1;
      }
      return 0;
    }

    case 'custom_square_occupation': {
      const targets = options?.targetSquares ?? [];
      if (targets.length === 0) return 0;
      const allowedPieces = options?.targetPieces;
      let count = 0;
      for (const sq of targets) {
        const found = ownPieces.find(
          p => p.square === sq && (!allowedPieces || allowedPieces.length === 0 || allowedPieces.includes(p.type))
        );
        if (found) count += 1;
      }
      return count;
    }

    default:
      return 0;
  }
}

export interface FeatureBreakdownItem {
  feature: ProgressFeatureType;
  rawValue: number;
  weight: number;
  contributionCp: number;
}

export function evaluateFeatures(
  fen: string,
  weightedFeatures: WeightedFeature[],
  ctx: FeatureContext = { color: 'w' }
): { totalBonusCp: number; breakdown: FeatureBreakdownItem[] } {
  const breakdown: FeatureBreakdownItem[] = [];
  let totalBonusCp = 0;

  for (const wf of weightedFeatures) {
    const rawValue = computeFeatureValue(fen, wf.feature, ctx, {
      targetPieces: wf.targetPieces,
      targetSquares: wf.targetSquares,
    });
    const contributionCp = Math.round(rawValue * wf.weight);
    totalBonusCp += contributionCp;
    breakdown.push({
      feature: wf.feature,
      rawValue,
      weight: wf.weight,
      contributionCp,
    });
  }

  return { totalBonusCp, breakdown };
}
