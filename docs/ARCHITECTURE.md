# Marionette Architecture & Steering Mechanics

Marionette decouples **strategic objective planning** from **tactical move calculation**. Rather than asking a language model to output raw algebraic chess moves—which degrades rapidly in tactical positions—Marionette compiles natural-language goals into a verified `MarionettePlan` state machine and uses Stockfish 15.1's Multi-PV search to evaluate and steer legal candidates on every ply.

---

## 1. End-to-End System Pipeline

```mermaid
flowchart LR
    subgraph Input ["1. Objective Layer"]
        NL["Natural-Language Goal<br/><i>'Sacrifice non-pawns, promote<br/>to knights, mate with a knight'</i>"]
    end

    subgraph Compiler ["2. Plan Compiler & Validator"]
        MC["Multi-Model Compiler<br/>(Model Cycling & Fallback)"]
        ZOD["Zod Schema +<br/>Semantic Validator"]
        DSL["MarionettePlan JSON<br/>(Phases, Features, Constraints)"]
        NL --> MC --> ZOD --> DSL
    end

    subgraph Engine ["3. Real-Time Steering Loop (Per Ply)"]
        FEN["Current Board FEN"]
        SF["Stockfish 15.1 UCI<br/>(MultiPV = 12..16)"]
        PO["Promotion Override<br/>(a7a8q → a7a8n)"]
        HC["Hard Constraint Filter<br/>(Zero Violations)"]
        FE["20 Positional Features<br/>+ Phase Selector"]
        EG["Dynamic Eval Guardrail<br/>(evalFloorCp & maxEvalDropCp)"]
        
        FEN --> SF --> PO --> HC --> FE --> EG
        DSL -.-> PO
        DSL -.-> HC
        DSL -.-> FE
        DSL -.-> EG
    end

    subgraph Output ["4. Execution & Telemetry"]
        MV["Chosen Steered Move"]
        UI["Live Visualizer &<br/>VCR Replay Timeline"]
        EG --> MV --> UI
    end
```

---

## 2. Four-Tier Candidate Selection Hierarchy

On every turn, `selectSteeredMove` (`src/marionette/steerer.ts`) receives the current FEN, Stockfish's top `MultiPV` candidates, and the active `MarionettePlan`. Each legal move is evaluated through a strict 4-tier hierarchy:

```mermaid
flowchart TD
    Start(["Stockfish Multi-PV Candidates + Full Legal Moves"]) --> Promo["Apply Promotion Override<br/>Rewrite 5-char UCI promotions to plan target (e.g. 'n')"]
    Promo --> FilterHC{"Passes All Hard<br/>Constraints?"}

    FilterHC -- "No" --> Blocked["Mark Violated<br/>(Excluded unless 0 compliant moves exist)"]
    FilterHC -- "Yes" --> CheckMate{"Delivers Target<br/>Checkmate?"}

    CheckMate -- "Yes (Tier 1)" --> Tier1["Tier 1: Immediate Target Checkmate<br/>(+50,000cp Priority)"]
    CheckMate -- "Wrong Piece Mate" --> Veto["Apply -50,000cp Veto<br/>(Prevents accidental Queen/Rook mate)"]
    CheckMate -- "Non-Mate Move" --> Score["Compute Composite Score:<br/>Stockfish_cp + PhaseScale × Σ(w_i · f_i) + TacticalBonuses"]

    Veto --> Guardrail{"Within Dynamic<br/>Eval Guardrail?"}
    Score --> Guardrail

    Guardrail -- "Yes (Tier 2)" --> Tier2["Tier 2: Steered Objective Move<br/>Pick highest Composite Score"]
    Guardrail -- "No (Tier 3)" --> Tier3["Tier 3: Guardrail Recovery<br/>Pick highest Stockfish_cp compliant move"]
```

### The Composite Scoring Equation

For any constraint-compliant move $m$ leading to post-move position $\text{FEN}(m)$:

$$\text{CompositeScore}(m) = \text{Eval}_{\text{SF}}(m) + \alpha_{\text{phase}} \sum_{i} w_i \cdot \phi_i(\text{FEN}(m)) + B_{\text{sacrifice}}(m) + B_{\text{promo}}(m) + B_{\text{threat}}(m) - P_{\text{veto}}(m)$$

Where:
- $\text{Eval}_{\text{SF}}(m)$: Stockfish centipawn evaluation from Marionette's perspective.
- $\alpha_{\text{phase}} \in [0.05, 1.0]$: Dynamic phase scaling factor ($0.35$ when $\text{Eval}_{\text{SF}} < +180\text{cp}$ so Marionette plays rock-solid openings before pursuing stylistic maneuvers).
- $w_i \cdot \phi_i(\text{FEN}(m))$: Weighted contribution of each active progress feature in the current phase.
- $B_{\text{sacrifice}}(m)$: Active piece-offering bonus when `non_pawn_pieces_sacrificed` is active, Marionette is ahead by $\ge +420\text{cp}$, and at least one pawn remains on the board.
- $B_{\text{promo}}(m)$: $+900\text{cp}$ bonus when $m$ underpromotes to the plan's target piece.
- $B_{\text{threat}}(m)$: $+1,500\text{cp}$ 2-ply lookahead bonus when $m$ sets up an unstoppable mate-in-1 with `terminal.checkmateWithPiece`.
- $P_{\text{veto}}(m)$: $-50,000\text{cp}$ penalty if $m$ delivers checkmate with the *wrong* piece, or $-25,000\text{cp}$ if $m$ triggers stalemate/draw while ahead.

---

## 3. Multi-Stage Phase Transitions

Complex goals—such as the headline challenge (*"sacrifice all non-pawn pieces, promote only to knights, mate with a knight"*)—cannot be expressed with static weights throughout an entire game. Sacrificing a Queen on move 6 simply loses the game.

Marionette solves this with sequential `PlanPhase` transitions:

```mermaid
stateDiagram-v2
    [*] --> Phase1
    state "Phase 1: Build Crushing Pawn & Material Advantage" as Phase1 {
        [*] --> OpeningAndMiddlegame
        OpeningAndMiddlegame: • material_advantage (w=35)\n• passed_pawn_advancement (w=40)\n• evalFloorCp = +80cp, maxDrop = 80cp
    }

    Phase1 --> Phase2: eval_cp_gte(350)

    state "Phase 2: Sacrifice & Trade Non-Pawn Pieces" as Phase2 {
        [*] --> Liquidation
        Liquidation: • non_pawn_pieces_sacrificed [Q,R,B] (w=155)\n• passed_pawn_advancement (w=65)\n• promoted_knights_count (w=220)\n• Active Sacrifice Gate (>= +420cp)
    }

    Phase2 --> Phase3: own_non_pawn_count_lte(1)

    state "Phase 3: Promote to Knights & Deliver Knight Mate" as Phase3 {
        [*] --> KnightStampede
        KnightStampede: • promoted_knights_count (w=260)\n• knight_proximity_to_enemy_king (w=70)\n• enemy_king_confinement (w=55)\n• 2-Ply Knight Mate Lookahead (+1500cp)
    }

    Phase3 --> [*]: checkmateWithPiece('n')
```
