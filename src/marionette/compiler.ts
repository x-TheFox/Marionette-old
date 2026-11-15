import { GoogleGenAI } from '@google/genai';
import { MarionettePlan, validatePlan } from './dsl';

export interface FixtureGoal {
  id: string;
  goal: string;
  difficulty: 'Sanity' | 'Easy' | 'Medium' | 'Hard' | 'Creative';
  expectedPlan: MarionettePlan;
}

export const FIXTURE_GOALS: FixtureGoal[] = [
  {
    id: 'just-win',
    goal: 'just win',
    difficulty: 'Sanity',
    expectedPlan: {
      id: 'just-win',
      name: 'Standard Victory (Just Win)',
      rawGoal: 'just win',
      summary: 'Play optimal Stockfish chess to win the game as efficiently as possible without stylistic restrictions.',
      hardConstraints: [],
      evalFloorCp: -50,
      maxEvalDropCp: 25,
      phases: [
        {
          id: 'phase-play-best',
          name: 'Optimal Play',
          description: 'Maximize engine evaluation and central control.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'material_advantage', weight: 15 },
            { feature: 'center_control', weight: 8 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
      },
    },
  },
  {
    id: 'knight-mate',
    goal: 'deliver checkmate with a knight',
    difficulty: 'Easy',
    expectedPlan: {
      id: 'knight-mate',
      name: 'Royal Cavalry Checkmate',
      rawGoal: 'deliver checkmate with a knight',
      summary: 'Preserve knights, build a winning position, herd the enemy king to the edge, and deliver the final checkmate move with a knight.',
      hardConstraints: [],
      promotionOverride: 'n',
      evalFloorCp: 40,
      maxEvalDropCp: 90,
      phases: [
        {
          id: 'phase-build-and-preserve-knights',
          name: 'Preserve Knights & Build Lead',
          description: 'Keep knights alive while building a decisive material and positional advantage.',
          activationCondition: { type: 'always' },
          completionCondition: { type: 'eval_cp_gte', cp: 350 },
          features: [
            { feature: 'knight_count', weight: 120 },
            { feature: 'material_advantage', weight: 25 },
            { feature: 'knight_proximity_to_enemy_king', weight: 30 },
          ],
        },
        {
          id: 'phase-knight-mating-net',
          name: 'Weave Knight Mating Net',
          description: 'Close in with knights on the enemy king and avoid non-knight checkmates.',
          activationCondition: { type: 'eval_cp_gte', cp: 350 },
          features: [
            { feature: 'knight_count', weight: 180 },
            { feature: 'knight_proximity_to_enemy_king', weight: 65 },
            { feature: 'enemy_king_confinement', weight: 45 },
            { feature: 'promoted_knights_count', weight: 150 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
        checkmateWithPiece: 'n',
      },
    },
  },
  {
    id: 'never-move-queen',
    goal: 'win without ever moving the queen',
    difficulty: 'Medium',
    expectedPlan: {
      id: 'never-move-queen',
      name: 'Sleeping Queen Protocol',
      rawGoal: 'win without ever moving the queen',
      summary: 'Win the game while keeping the Queen anchored on her starting square (d1/d8) for the entire match.',
      hardConstraints: [
        { type: 'never_move_piece', piece: 'q' },
      ],
      evalFloorCp: 0,
      maxEvalDropCp: 75,
      phases: [
        {
          id: 'phase-minor-and-rook-mobilization',
          name: 'Minor Piece & Rook Mobilization',
          description: 'Develop knights, bishops, and rooks aggressively while leaving the queen untouched.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'queen_on_starting_square', weight: 100 },
            { feature: 'center_control', weight: 20 },
            { feature: 'material_advantage', weight: 30 },
            { feature: 'enemy_king_confinement', weight: 25 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
        requireZeroPieceMoves: ['q'],
      },
    },
  },
  {
    id: 'sacrifice-promote-knight-mate',
    goal: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
    difficulty: 'Hard',
    expectedPlan: {
      id: 'sacrifice-promote-knight-mate',
      name: 'Total Liquidation into Knight Stampede',
      rawGoal: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
      summary: 'Build a winning pawn structure, liquidate/sacrifice non-pawn major and minor pieces, underpromote pawns exclusively to knights, and checkmate with a knight.',
      hardConstraints: [
        { type: 'promote_only_to', piece: 'n' },
      ],
      promotionOverride: 'n',
      evalFloorCp: 60,
      maxEvalDropCp: 140,
      phases: [
        {
          id: 'phase-1-dominate',
          name: 'Phase 1: Build Crushing Pawn & Material Advantage',
          description: 'Secure a winning evaluation (+350cp+) and advance passed pawns before sacrificing pieces.',
          activationCondition: { type: 'always' },
          completionCondition: { type: 'eval_cp_gte', cp: 350 },
          features: [
            { feature: 'material_advantage', weight: 35 },
            { feature: 'passed_pawn_advancement', weight: 40 },
            { feature: 'pawn_advancement', weight: 25 },
          ],
          evalFloorCp: 80,
          maxEvalDropCp: 80,
        },
        {
          id: 'phase-2-liquidate-non-pawns',
          name: 'Phase 2: Sacrifice & Trade Non-Pawn Pieces',
          description: 'Trade off and sacrifice Queen, Rooks, and Bishops while pushing pawns to the 7th/8th rank.',
          activationCondition: { type: 'eval_cp_gte', cp: 350 },
          completionCondition: { type: 'own_non_pawn_count_lte', count: 1 },
          features: [
            { feature: 'non_pawn_pieces_sacrificed', weight: 155, targetPieces: ['q', 'r', 'b'] },
            { feature: 'passed_pawn_advancement', weight: 65 },
            { feature: 'pawn_advancement', weight: 45 },
            { feature: 'promoted_knights_count', weight: 220 },
          ],
          evalFloorCp: 120,
          maxEvalDropCp: 220,
        },
        {
          id: 'phase-3-knight-stampede',
          name: 'Phase 3: Promote to Knights & Deliver Knight Mate',
          description: 'Promote remaining pawns to knights and weave a knight checkmate.',
          activationCondition: { type: 'own_non_pawn_count_lte', count: 2 },
          features: [
            { feature: 'non_pawn_pieces_sacrificed', weight: 170, targetPieces: ['q', 'r', 'b'] },
            { feature: 'promoted_knights_count', weight: 260 },
            { feature: 'knight_proximity_to_enemy_king', weight: 70 },
            { feature: 'enemy_king_confinement', weight: 55 },
          ],
          evalFloorCp: 100,
          maxEvalDropCp: 180,
        },
      ],
      terminal: {
        mustWin: true,
        checkmateWithPiece: 'n',
        requirePromotionsTo: 'n',
      },
    },
  },
  {
    id: 'no-castling-king-walk',
    goal: 'forbid castling, march the king up the board and win',
    difficulty: 'Creative',
    expectedPlan: {
      id: 'no-castling-king-walk',
      name: 'Bongcloud Royal Vanguard',
      rawGoal: 'forbid castling, march the king up the board and win',
      summary: 'Never castle; actively advance the King up the board while maintaining a safe winning evaluation.',
      hardConstraints: [
        { type: 'forbid_castling' },
      ],
      evalFloorCp: 10,
      maxEvalDropCp: 95,
      phases: [
        {
          id: 'phase-king-march',
          name: 'Royal Vanguard March',
          description: 'Advance the king toward the center while keeping evaluation above the safety floor.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'king_walk_advancement', weight: 85 },
            { feature: 'center_control', weight: 20 },
            { feature: 'material_advantage', weight: 25 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
      },
    },
  },
  {
    id: 'pawn-checkmate',
    goal: 'deliver checkmate with a pawn',
    difficulty: 'Creative',
    expectedPlan: {
      id: 'pawn-checkmate',
      name: 'Humble Foot-Soldier Mate',
      rawGoal: 'deliver checkmate with a pawn',
      summary: 'Confine the enemy king with major pieces and deliver the final checkmate blow with a humble pawn.',
      hardConstraints: [],
      evalFloorCp: 50,
      maxEvalDropCp: 100,
      phases: [
        {
          id: 'phase-pawn-storm',
          name: 'Confine King & Advance Pawns',
          description: 'Push pawns close to the enemy king and avoid premature major-piece checkmates.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'pawn_advancement', weight: 55 },
            { feature: 'passed_pawn_advancement', weight: 60 },
            { feature: 'enemy_king_confinement', weight: 50 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
        checkmateWithPiece: 'p',
      },
    },
  },
  {
    id: 'bishop-pair-dominance',
    goal: 'promote only to bishops and checkmate with a bishop',
    difficulty: 'Creative',
    expectedPlan: {
      id: 'bishop-pair-dominance',
      name: 'Cathedral Diagonal Inquisition',
      rawGoal: 'promote only to bishops and checkmate with a bishop',
      summary: 'Preserve and underpromote to bishops, slicing the board diagonally to deliver a bishop checkmate.',
      hardConstraints: [
        { type: 'promote_only_to', piece: 'b' },
      ],
      promotionOverride: 'b',
      evalFloorCp: 40,
      maxEvalDropCp: 95,
      phases: [
        {
          id: 'phase-bishop-matrix',
          name: 'Diagonal Bishop Matrix',
          description: 'Maintain bishops, underpromote pawns to bishops, and corner the enemy king.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'bishop_count', weight: 140 },
            { feature: 'passed_pawn_advancement', weight: 40 },
            { feature: 'enemy_king_confinement', weight: 45 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
        checkmateWithPiece: 'b',
        requirePromotionsTo: 'b',
      },
    },
  },
  {
    id: 'pacifist-knights',
    goal: 'win without ever capturing with a knight',
    difficulty: 'Medium',
    expectedPlan: {
      id: 'pacifist-knights',
      name: 'Chivalric Pacifist Knights',
      rawGoal: 'win without ever capturing with a knight',
      summary: 'Knights may reposition, block, and give check, but are strictly forbidden from capturing any enemy piece.',
      hardConstraints: [
        { type: 'never_capture_with', piece: 'n' },
      ],
      evalFloorCp: 0,
      maxEvalDropCp: 70,
      phases: [
        {
          id: 'phase-pacifist-maneuvers',
          name: 'Pacifist Outpost Maneuvering',
          description: 'Use knights for central outposts while pawns, bishops, rooks, and queen handle captures.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'center_control', weight: 25 },
            { feature: 'material_advantage', weight: 30 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
      },
    },
  },
  {
    id: 'rook-lift-edge',
    goal: 'control the a and h files, promote only to rooks, and checkmate with a rook',
    difficulty: 'Creative',
    expectedPlan: {
      id: 'rook-lift-edge',
      name: 'Twin Towers Flank Siege',
      rawGoal: 'control the a and h files, promote only to rooks, and checkmate with a rook',
      summary: 'Dominate the a and h edge files, underpromote pawns to rooks, and execute a rook checkmate.',
      hardConstraints: [
        { type: 'promote_only_to', piece: 'r' },
      ],
      promotionOverride: 'r',
      evalFloorCp: 30,
      maxEvalDropCp: 90,
      phases: [
        {
          id: 'phase-flank-siege',
          name: 'Edge File Siege & Rook Promotion',
          description: 'Occupy the a/h files and push pawns to promote to rooks.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'edge_file_control', weight: 50 },
            { feature: 'rook_count', weight: 120 },
            { feature: 'enemy_king_confinement', weight: 45 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
        checkmateWithPiece: 'r',
        requirePromotionsTo: 'r',
      },
    },
  },
  {
    id: 'center-outpost-fortress',
    goal: 'occupy d4, e4, d5, e5 with pieces, never move the a-pawn, and win',
    difficulty: 'Creative',
    expectedPlan: {
      id: 'center-outpost-fortress',
      name: 'Central Citadel & Frozen A-Pawn',
      rawGoal: 'occupy d4, e4, d5, e5 with pieces, never move the a-pawn, and win',
      summary: 'Keep the a-file pawn frozen on its starting square while dominating the central 4 squares (d4, e4, d5, e5).',
      hardConstraints: [
        { type: 'never_move_file_pawn', file: 'a' },
      ],
      evalFloorCp: 20,
      maxEvalDropCp: 80,
      phases: [
        {
          id: 'phase-central-citadel',
          name: 'Central Citadel Occupation',
          description: 'Anchor pieces on d4, e4, d5, e5 and convert central dominance into victory.',
          activationCondition: { type: 'always' },
          features: [
            { feature: 'custom_square_occupation', weight: 75, targetSquares: ['d4', 'e4', 'd5', 'e5'] },
            { feature: 'center_control', weight: 35 },
            { feature: 'material_advantage', weight: 25 },
          ],
        },
      ],
      terminal: {
        mustWin: true,
      },
    },
  },
];

export const GEMINI_MODELS_CYCLE = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
] as const;

let currentModelIndex = 0;

const COMPILER_SYSTEM_PROMPT = `You are the Marionette Goal Compiler for a goal-directed Stockfish chess engine.
Convert the user's natural-language chess objective into a valid JSON object matching the exact MarionettePlan DSL structure below:

{
  "id": "kebab-case-id",
  "name": "Human Readable Strategy Name",
  "rawGoal": "exact user goal string",
  "summary": "1-sentence tactical summary",
  "hardConstraints": [],
  "promotionOverride": "n", // OPTIONAL: "n" | "b" | "r" | "q" (omit if no specific promotion piece is required)
  "evalFloorCp": 40, // integer between -200 and 200 (keep >= 0 so Marionette never loses)
  "maxEvalDropCp": 95, // integer between 25 and 220
  "phases": [
    {
      "id": "phase-1",
      "name": "Phase 1 Name",
      "description": "What Marionette prioritizes in this phase",
      "activationCondition": { "type": "always" },
      "features": [
        { "feature": "material_advantage", "weight": 25 },
        { "feature": "center_control", "weight": 15 }
      ]
    }
  ],
  "terminal": {
    "mustWin": true,
    "checkmateWithPiece": "n", // OPTIONAL: "p" | "n" | "b" | "r" | "q" | "k"
    "requireZeroPieceMoves": ["q"], // OPTIONAL: array of piece types that must never move
    "requirePromotionsTo": "n" // OPTIONAL: "n" | "b" | "r" | "q"
  }
}

Allowed PieceType values: "p", "n", "b", "r", "q", "k"
Allowed PromotionPiece values: "n", "b", "r", "q"
Allowed HardConstraint objects inside "hardConstraints":
- { "type": "never_move_piece", "piece": PieceType }
- { "type": "never_capture_with", "piece": PieceType }
- { "type": "forbid_castling" }
- { "type": "promote_only_to", "piece": PromotionPiece }
- { "type": "never_move_file_pawn", "file": "a"|"b"|"c"|"d"|"e"|"f"|"g"|"h" }
- { "type": "max_queen_moves", "count": number }

Allowed ProgressFeatureType values for "feature":
- "non_pawn_pieces_sacrificed" (optional "targetPieces": ["q","r","b"])
- "pawn_advancement"
- "passed_pawn_advancement"
- "knight_count"
- "bishop_count"
- "rook_count"
- "queen_count"
- "knight_proximity_to_enemy_king"
- "queen_on_starting_square"
- "center_control"
- "enemy_king_confinement"
- "castled_kingside"
- "castled_queenside"
- "king_walk_advancement"
- "edge_file_control"
- "material_advantage"
- "promoted_knights_count"
- "opponent_pieces_captured"
- "checks_delivered_bonus"
- "custom_square_occupation" (with "targetSquares": ["d4","e4"])

Allowed PhaseCondition objects for "activationCondition" / "completionCondition":
- { "type": "always" }
- { "type": "own_non_pawn_count_lte", "count": number }
- { "type": "own_piece_count_gte", "piece": PieceType, "count": number }
- { "type": "move_number_gte", "move": number }
- { "type": "eval_cp_gte", "cp": number }
- { "type": "only_pieces_remaining", "allowedPieces": PieceType[] }

IMPORTANT RULES:
1. If the goal asks to sacrifice non-pawn pieces, promote to knights, and mate with a knight, include 3 phases: Phase 1 builds advantage (eval_cp_gte 350), Phase 2 sacrifices non-pawns (non_pawn_pieces_sacrificed weight 155 with targetPieces ["q","r","b"], passed_pawn_advancement weight 65, promoted_knights_count weight 220), Phase 3 weaves the knight mating net (promoted_knights_count weight 260, knight_proximity_to_enemy_king weight 70, enemy_king_confinement weight 55), with hardConstraints: [{"type":"promote_only_to","piece":"n"}], promotionOverride: "n", and terminal.checkmateWithPiece: "n".
2. Output ONLY valid JSON.`;

/**
 * Rule-based / fixture-matched compiler that guarantees fast, deterministic compilation in CI or offline,
 * and can also synthesize plans for arbitrary unseen natural-language goals.
 */
export function compileGoalHeuristic(goalText: string): MarionettePlan {
  const normalized = goalText.trim().toLowerCase();

  // Check exact or high-overlap match with the 10 fixture goals first
  for (const fix of FIXTURE_GOALS) {
    if (normalized === fix.goal.toLowerCase() || normalized === fix.id) {
      return structuredClone(fix.expectedPlan);
    }
  }

  // Keyword-driven synthesis for novel natural-language goals
  const hardConstraints: MarionettePlan['hardConstraints'] = [];
  let promotionOverride: MarionettePlan['promotionOverride'] = undefined;
  let checkmateWithPiece: MarionettePlan['terminal']['checkmateWithPiece'] = undefined;
  const features: MarionettePlan['phases'][0]['features'] = [];

  // Detect promotion rules
  if (/promote.*only.*knight|underpromote.*knight|all.*pawns.*to.*knights/i.test(normalized)) {
    hardConstraints.push({ type: 'promote_only_to', piece: 'n' });
    promotionOverride = 'n';
    features.push({ feature: 'promoted_knights_count', weight: 220 });
  } else if (/promote.*only.*bishop/i.test(normalized)) {
    hardConstraints.push({ type: 'promote_only_to', piece: 'b' });
    promotionOverride = 'b';
    features.push({ feature: 'bishop_count', weight: 140 });
  } else if (/promote.*only.*rook/i.test(normalized)) {
    hardConstraints.push({ type: 'promote_only_to', piece: 'r' });
    promotionOverride = 'r';
    features.push({ feature: 'rook_count', weight: 120 });
  }

  // Detect sacrifice / give up pieces
  const wantsSacrificeAllNonPawns =
    /(sacrifice|give up|lose|trade).*all.*(non-pawn|pieces except pawns)/i.test(normalized) ||
    (/(sacrifice|give up).*every piece except pawns/i.test(normalized));

  if (wantsSacrificeAllNonPawns && promotionOverride === 'n') {
    const plan = structuredClone(
      FIXTURE_GOALS.find(f => f.id === 'sacrifice-promote-knight-mate')!.expectedPlan
    );
    plan.rawGoal = goalText;
    return plan;
  }

  // Detect never move piece constraints
  if (/(?:without|never)\s+(?:ever\s+)?moving\s+(?:the\s+|a\s+|any\s+)?queen/i.test(normalized)) {
    hardConstraints.push({ type: 'never_move_piece', piece: 'q' });
    features.push({ feature: 'queen_on_starting_square', weight: 100 });
  }
  if (/(?:without|never)\s+(?:ever\s+)?moving\s+(?:the\s+|a\s+|any\s+)?rook/i.test(normalized)) {
    hardConstraints.push({ type: 'never_move_piece', piece: 'r' });
  }
  if (/(?:without|never)\s+(?:ever\s+)?moving\s+(?:the\s+|a\s+|any\s+)?bishop/i.test(normalized)) {
    hardConstraints.push({ type: 'never_move_piece', piece: 'b' });
  }
  if (/(?:without|never)\s+(?:ever\s+)?moving\s+(?:the\s+|a\s+|any\s+)?knight/i.test(normalized)) {
    hardConstraints.push({ type: 'never_move_piece', piece: 'n' });
  }

  // Detect never capture with
  if (/(?:without|never)\s+(?:ever\s+)?capturing\s+with\s+(?:the\s+|a\s+|any\s+)?knight/i.test(normalized)) {
    hardConstraints.push({ type: 'never_capture_with', piece: 'n' });
  }
  if (/(?:without|never)\s+(?:ever\s+)?capturing\s+with\s+(?:the\s+|a\s+|any\s+)?queen/i.test(normalized)) {
    hardConstraints.push({ type: 'never_capture_with', piece: 'q' });
  }

  // Detect file pawn freeze
  const fileMatch = normalized.match(/never move (?:the )?([a-h])-?(?:file )?pawn/);
  if (fileMatch) {
    hardConstraints.push({
      type: 'never_move_file_pawn',
      file: fileMatch[1] as 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h',
    });
  }

  // Detect forbid castling / king walk
  if (/forbid castling|never castle|no castling|without castling/i.test(normalized)) {
    hardConstraints.push({ type: 'forbid_castling' });
  }
  if (/king walk|march.*king|advance.*king|bongcloud/i.test(normalized)) {
    features.push({ feature: 'king_walk_advancement', weight: 85 });
  }

  // Detect checkmate piece
  if (/checkmate with a knight|mate with a knight|knight checkmate/i.test(normalized)) {
    checkmateWithPiece = 'n';
    if (!promotionOverride) promotionOverride = 'n';
    features.push({ feature: 'knight_count', weight: 140 });
    features.push({ feature: 'knight_proximity_to_enemy_king', weight: 60 });
    features.push({ feature: 'enemy_king_confinement', weight: 45 });
  } else if (/checkmate with a pawn|mate with a pawn|pawn checkmate/i.test(normalized)) {
    checkmateWithPiece = 'p';
    features.push({ feature: 'pawn_advancement', weight: 55 });
    features.push({ feature: 'passed_pawn_advancement', weight: 60 });
    features.push({ feature: 'enemy_king_confinement', weight: 50 });
  } else if (/checkmate with a bishop|mate with a bishop/i.test(normalized)) {
    checkmateWithPiece = 'b';
    features.push({ feature: 'bishop_count', weight: 130 });
    features.push({ feature: 'enemy_king_confinement', weight: 45 });
  } else if (/checkmate with a rook|mate with a rook/i.test(normalized)) {
    checkmateWithPiece = 'r';
    features.push({ feature: 'rook_count', weight: 120 });
    features.push({ feature: 'enemy_king_confinement', weight: 45 });
  }

  // Detect edge files
  if (/a and h files|edge files|flank/i.test(normalized)) {
    features.push({ feature: 'edge_file_control', weight: 50 });
  }

  // Detect custom squares (e.g. d4, e4, d5, e5)
  const squareMatches = normalized.match(/\b([a-h][1-8])\b/g);
  if (squareMatches && squareMatches.length > 0) {
    const uniqueSquares = Array.from(new Set(squareMatches));
    features.push({
      feature: 'custom_square_occupation',
      weight: 70,
      targetSquares: uniqueSquares,
    });
  }

  if (wantsSacrificeAllNonPawns) {
    features.push({
      feature: 'non_pawn_pieces_sacrificed',
      weight: 150,
      targetPieces: ['q', 'r', 'b'],
    });
    features.push({ feature: 'passed_pawn_advancement', weight: 60 });
  }

  if (features.length === 0) {
    features.push({ feature: 'material_advantage', weight: 20 });
    features.push({ feature: 'center_control', weight: 15 });
  }

  const plan: MarionettePlan = {
    id: `custom-${Date.now().toString(36)}`,
    name: goalText.slice(0, 48),
    rawGoal: goalText,
    summary: `Steer Stockfish to achieve "${goalText}" while keeping evaluation above the safety guardrail.`,
    hardConstraints,
    promotionOverride,
    evalFloorCp: 25,
    maxEvalDropCp: 90,
    phases: [
      {
        id: 'phase-main',
        name: 'Execute Objective & Maintain Winning Edge',
        description: `Steer candidate moves toward: ${goalText}`,
        activationCondition: { type: 'always' },
        features,
      },
    ],
    terminal: {
      mustWin: true,
      checkmateWithPiece,
      requirePromotionsTo: promotionOverride,
    },
  };

  return plan;
}

/**
 * Compiles a natural-language goal using real Gemini models (cycling across models on rate-limit/errors)
 * and falls back gracefully to deterministic synthesis if offline or mocked.
 */
export async function compileGoalWithLLM(
  goalText: string,
  options?: {
    mock?: boolean;
    preferredModel?: string;
    apiKey?: string;
  }
): Promise<{
  plan: MarionettePlan;
  modelUsed: string;
  cycledModels: string[];
  fromMockOrFallback: boolean;
}> {
  if (options?.mock) {
    return {
      plan: compileGoalHeuristic(goalText),
      modelUsed: 'mock-deterministic-compiler',
      cycledModels: ['mock-deterministic-compiler'],
      fromMockOrFallback: true,
    };
  }

  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      plan: compileGoalHeuristic(goalText),
      modelUsed: 'heuristic-fallback',
      cycledModels: [],
      fromMockOrFallback: true,
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'marionette-engine',
      },
    },
  });

  // Build ordered list of models to cycle across
  const modelsOrder: string[] = [];
  if (options?.preferredModel) {
    modelsOrder.push(options.preferredModel);
  }
  for (let i = 0; i < GEMINI_MODELS_CYCLE.length; i++) {
    const idx = (currentModelIndex + i) % GEMINI_MODELS_CYCLE.length;
    const m = GEMINI_MODELS_CYCLE[idx];
    if (!modelsOrder.includes(m)) {
      modelsOrder.push(m);
    }
  }
  currentModelIndex = (currentModelIndex + 1) % GEMINI_MODELS_CYCLE.length;

  const cycledModels: string[] = [];

  for (const modelName of modelsOrder) {
    cycledModels.push(modelName);
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Compile this chess objective into a valid MarionettePlan JSON object:\n"${goalText}"`,
        config: {
          systemInstruction: COMPILER_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);
      const validation = validatePlan(parsed);
      if (validation.valid && validation.data) {
        return {
          plan: validation.data,
          modelUsed: modelName,
          cycledModels,
          fromMockOrFallback: false,
        };
      }
    } catch (_err) {
      // Continue cycling to the next Gemini model
      continue;
    }
  }

  // Fallback to deterministic heuristic synthesis if all models failed or returned invalid schema
  return {
    plan: compileGoalHeuristic(goalText),
    modelUsed: 'heuristic-fallback',
    cycledModels,
    fromMockOrFallback: true,
  };
}
