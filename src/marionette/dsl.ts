import { z } from 'zod';

export const PieceTypeSchema = z.enum(['p', 'n', 'b', 'r', 'q', 'k']);
export type PieceType = z.infer<typeof PieceTypeSchema>;

export const PromotionPieceSchema = z.enum(['n', 'b', 'r', 'q']);
export type PromotionPiece = z.infer<typeof PromotionPieceSchema>;

export const HardConstraintSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('never_move_piece'),
    piece: PieceTypeSchema,
  }),
  z.object({
    type: z.literal('never_capture_with'),
    piece: PieceTypeSchema,
  }),
  z.object({
    type: z.literal('forbid_castling'),
  }),
  z.object({
    type: z.literal('promote_only_to'),
    piece: PromotionPieceSchema,
  }),
  z.object({
    type: z.literal('never_move_file_pawn'),
    file: z.enum(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
  }),
  z.object({
    type: z.literal('max_queen_moves'),
    count: z.number().int().min(0).max(50),
  }),
]);

export type HardConstraint = z.infer<typeof HardConstraintSchema>;

export const ProgressFeatureTypeSchema = z.enum([
  'non_pawn_pieces_sacrificed',
  'pawn_advancement',
  'passed_pawn_advancement',
  'knight_count',
  'bishop_count',
  'rook_count',
  'queen_count',
  'knight_proximity_to_enemy_king',
  'queen_on_starting_square',
  'center_control',
  'enemy_king_confinement',
  'castled_kingside',
  'castled_queenside',
  'king_walk_advancement',
  'edge_file_control',
  'material_advantage',
  'promoted_knights_count',
  'opponent_pieces_captured',
  'checks_delivered_bonus',
  'custom_square_occupation',
]);

export type ProgressFeatureType = z.infer<typeof ProgressFeatureTypeSchema>;

export const WeightedFeatureSchema = z.object({
  feature: ProgressFeatureTypeSchema,
  weight: z.number().min(-500).max(500),
  targetPieces: z.array(PieceTypeSchema).optional(),
  targetSquares: z.array(z.string().regex(/^[a-h][1-8]$/)).optional(),
});

export type WeightedFeature = z.infer<typeof WeightedFeatureSchema>;

export const PhaseConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('always') }),
  z.object({ type: z.literal('own_non_pawn_count_lte'), count: z.number().int().min(0).max(7) }),
  z.object({ type: z.literal('own_piece_count_gte'), piece: PieceTypeSchema, count: z.number().int().min(0).max(10) }),
  z.object({ type: z.literal('move_number_gte'), move: z.number().int().min(1).max(200) }),
  z.object({ type: z.literal('eval_cp_gte'), cp: z.number().int().min(-2000).max(5000) }),
  z.object({ type: z.literal('only_pieces_remaining'), allowedPieces: z.array(PieceTypeSchema).min(1) }),
]);

export type PhaseCondition = z.infer<typeof PhaseConditionSchema>;

export const PlanPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  activationCondition: PhaseConditionSchema,
  completionCondition: PhaseConditionSchema.optional(),
  features: z.array(WeightedFeatureSchema),
  evalFloorCp: z.number().int().min(-1500).max(2000).optional(),
  maxEvalDropCp: z.number().int().min(0).max(1500).optional(),
});

export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const TerminalConditionSchema = z.object({
  mustWin: z.boolean().default(true),
  checkmateWithPiece: PieceTypeSchema.optional(),
  checkmateOnSquare: z.string().regex(/^[a-h][1-8]$/).optional(),
  requiredMaxMoves: z.number().int().min(1).max(300).optional(),
  requireZeroPieceMoves: z.array(PieceTypeSchema).optional(),
  requireOnlyPiecesRemaining: z.array(PieceTypeSchema).optional(),
  requirePromotionsTo: PromotionPieceSchema.optional(),
  minPromotionsCount: z.number().int().min(0).max(8).optional(),
});

export type TerminalCondition = z.infer<typeof TerminalConditionSchema>;

export const MarionettePlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rawGoal: z.string().min(1),
  summary: z.string().min(1),
  hardConstraints: z.array(HardConstraintSchema),
  promotionOverride: PromotionPieceSchema.optional(),
  evalFloorCp: z.number().int().min(-1000).max(1000),
  maxEvalDropCp: z.number().int().min(10).max(1000),
  phases: z.array(PlanPhaseSchema).min(1),
  terminal: TerminalConditionSchema,
}).superRefine((plan, ctx) => {
  // Semantic cross-field validations
  // 1. If promotionOverride is set and promote_only_to constraint exists, they must match
  const promoConstraint = plan.hardConstraints.find(c => c.type === 'promote_only_to');
  if (promoConstraint && plan.promotionOverride && promoConstraint.piece !== plan.promotionOverride) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Conflicting promotion override (${plan.promotionOverride}) and promote_only_to constraint (${promoConstraint.piece})`,
      path: ['promotionOverride'],
    });
  }

  // 2. You can never forbid king moves AND require king walkcheckmate contradictions
  const neverMoveKing = plan.hardConstraints.find(c => c.type === 'never_move_piece' && c.piece === 'k');
  const forbidCastling = plan.hardConstraints.find(c => c.type === 'forbid_castling');
  // Valid, just ensure phase IDs are unique
  const ids = new Set<string>();
  for (const phase of plan.phases) {
    if (ids.has(phase.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate phase id: ${phase.id}`,
        path: ['phases'],
      });
    }
    ids.add(phase.id);
  }

  // 3. Cannot require checkmateWithPiece X if never_move_piece X is active (except p/r/b/q discovered mate is ultra-rare, if never_move_piece == checkmateWithPiece and piece === 'n' or 'k', reject as contradictory)
  if (plan.terminal.checkmateWithPiece) {
    const matePiece = plan.terminal.checkmateWithPiece;
    const forbiddenMove = plan.hardConstraints.find(
      c => c.type === 'never_move_piece' && c.piece === matePiece
    );
    if (forbiddenMove) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Contradictory spec: cannot require checkmateWithPiece '${matePiece}' while forbidding moving '${matePiece}'`,
        path: ['terminal', 'checkmateWithPiece'],
      });
    }
  }
});

export type MarionettePlan = z.infer<typeof MarionettePlanSchema>;

export function validatePlan(input: unknown): {
  valid: boolean;
  data?: MarionettePlan;
  errors?: string[];
} {
  const result = MarionettePlanSchema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  const errors = result.error.issues.map(
    issue => `${issue.path.join('.') || 'root'}: ${issue.message}`
  );
  return { valid: false, errors };
}
