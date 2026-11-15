# Marionette — Arena Ladder & Guardrail Evaluation Results

**Engine:** Stockfish 15.1 (`UCI_LimitStrength` + `UCI_Elo` calibrated opponent vs. Marionette Multi-PV Steerer)  
**LLM Compiler Cycling:** `gemini-4-hydrogen` → `gemini-3.1-flash-lite` → `gemini-4-argon` → `gemini-4-carbon`  
**Total Arena Matches Run (Final Calibrated Pass):** 45 games (plus 45 games in Initial Pass 1)  

---

## 1. Summary Metrics (Final Calibrated Pass)

| Metric | Target | Actual Result | Status |
| :--- | :--- | :--- | :--- |
| **Sanity Goal ("just win" vs Elo 2400)** | $\ge 90\%$ Win Rate | **100.0%** (10W / 0D / 0L) | PASS |
| **Guardrail Loss Rate (Across All Runs)** | $< 5.0\%$ vs Elo 2200 | **0.0%** in Pass 2 (**2.2%** in Pass 1) | PASS |
| **Hard Constraint Violations** | $0$ Violations | **0 Violations** across 45 games | PASS |
| **Overall Win Rate** | — | **62.2%** (28W / 17D / 0L) | PASS |
| **Overall Full Objective Completion Rate** | — | **62.2%** (28 / 45 games) | PASS |

---

## 2. Full Integration Ladder Breakdown

Below are the unfiltered numbers from the 9-rung arena ladder (`src/marionette/ladder-results.json`), where every match was compiled by a real Gemini model and played against Stockfish 15.1:

| Ladder Rung | Objective Prompt | Opp Elo | Compiler Model Used | W / D / L | Win % | Goal Achieved % | Loss % | Hard Violations |
| :--- | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Sanity** | `"just win"` | 2400 | `gemini-4-hydrogen` | 10 / 0 / 0 | **100%** | **100%** | **0%** | 0 |
| **2a. Easy Style** | `"deliver checkmate with a knight"` | 2000 | `gemini-3.1-flash-lite` | 2 / 3 / 0 | **40%** | **40%** | **0%** | 0 |
| **2b. Easy Style** | `"deliver checkmate with a knight"` | 2400 | `gemini-4-hydrogen` | 3 / 2 / 0 | **60%** | **60%** | **0%** | 0 |
| **3. Medium** | `"win without ever moving the queen"` | 2200 | `gemini-4-hydrogen` | 4 / 1 / 0 | **80%** | **80%** | **0%** | 0 |
| **4a. Hard (Headline)** | `"sacrifice all non-pawn pieces, promote only to knights, mate with a knight"` | 1800 | `gemini-4-hydrogen` | 3 / 1 / 0 | **75%** | **75%** | **0%** | 0 |
| **4b. Hard (Headline)** | `"sacrifice all non-pawn pieces, promote only to knights, mate with a knight"` | 2000 | `gemini-3.1-flash-lite` | 2 / 2 / 0 | **50%** | **50%** | **0%** | 0 |
| **4c. Hard (Headline)** | `"sacrifice all non-pawn pieces, promote only to knights, mate with a knight"` | 2200 | `gemini-4-hydrogen` | 1 / 3 / 0 | **25%** | **25%** | **0%** | 0 |
| **4d. Hard (Headline)** | `"sacrifice all non-pawn pieces, promote only to knights, mate with a knight"` | 2400 | `gemini-4-hydrogen` | 1 / 3 / 0 | **25%** | **25%** | **0%** | 0 |
| **5. Out-of-Distribution** | `"Never castle, march the king up the board, and deliver checkmate with a knight"` | 2000 | `gemini-4-hydrogen` | 2 / 2 / 0 | **50%** | **50%** | **0%** | 0 |

---

## 3. Iterative Engineering Log: Raising the Guardrail vs. Stylistic Ambition

### Pass 1 Diagnosis (Before Guardrail Floor Raise & Wrong-Mate Veto)
In our initial 45-game run (`Pass 1`), we observed three specific failure modes:
1. **Premature Wrong-Piece Checkmates**: In Rung 2a (`"deliver checkmate with a knight"` vs 2000), Marionette won 60% of its games (3W / 2D / 0L), but in 2 of those wins, the evaluation guardrail triggered (Tier 3) or a +9990cp mate-in-1 score overpowered the `-8,000cp` penalty, causing Marionette to deliver checkmate with a Queen or Rook instead of waiting one move to mate with the Knight.
2. **A Single Guardrail Loss vs Elo 2400**: In Rung 2b vs Elo 2400 (`Pass 1`), allowing `maxEvalDropCp = 90` when the position was near `0.00cp` allowed 3 consecutive sub-optimal knight maneuvers in a sharp tactical position, resulting in 1 loss (overall loss rate `2.2%`, 1/45 games).
3. **Insufficient Material / Repetition in Hard Rung 4d vs 2400**: When Marionette sacrificed all non-pawn pieces before securing a protected passed pawn against Elo 2400, Black sacrificed its own minor piece for White's last pawn, forcing a `KNN vs K` or `KN vs K` insufficient-material draw.

### Pass 2 Engineering Fixes
Rather than hiding losses or tuning opponent randomness, we strengthened the steering layer in `src/marionette/steerer.ts`:
1. **Raised the Dynamic Evaluation Floor (`evalFloorCp`)**:
   - Raised the baseline `effectiveEvalFloor` to `+50cp` (and `+120cp` once Marionette reaches a `+200cp` lead).
   - Tightened `effectiveMaxDrop` to $\le 35\text{cp}$ whenever the position is below `+220cp`, and $\le 12\text{cp}$ for pure win objectives (`"just win"`).
   - **Result**: Loss rate dropped from `2.2%` to **`0.0%` (0 losses across 45 games)**, and `"just win"` vs Elo 2400 achieved **10/10 (100%) wins**.
2. **Strict Non-Target Checkmate Veto (`-50,000cp`) + 2-Ply Target-Mate Lookahead**:
   - Applied a `-50,000cp` penalty across both Tier 2 and Tier 3 whenever a move delivers checkmate with a piece other than `terminal.checkmateWithPiece`, and added a 2-ply lookahead bonus (`+1,500cp`) for moves that create an unstoppable mate-in-1 with the required piece.
   - **Result**: Every single win in Rungs 2a, 2b, 4a–4d, and 5 was delivered by a **Knight checkmate (`N#`)**, eliminating accidental Queen/Rook checkmates completely.
3. **Pawn-Preserving Sacrifice Gate**:
   - Gated the active piece-offering bonus (`tacticalSacrificeBonus`) so Marionette only intentionally hangs its Queen/Rooks/Bishops when `bestEngineMove.cp >= 420` and White has at least one surviving pawn on the board to underpromote to a Knight.
   - **Result**: Headline hard goal completion reached **75% vs Elo 1800**, **50% vs Elo 2000**, and **25% vs Elo 2200 and 2400** with **0% losses**.

---

## 4. Analysis: Why Hard Goals Still Draw When They Do

Even with multi-phase plans and promotion overrides, hard multi-stage objectives (like sacrificing all major pieces, promoting only to knights, and mating with a knight) end in a **draw** in 25%–75% of games against 1800–2400 Elo opponents for three fundamental chess reasons:

1. **The Safety Guardrail Refuses to Throw Tight Games**:
   Against a 2200–2400 Elo opponent, some openings remain within `+80cp` to `+250cp` into move 30. Because Marionette's primary directive is to *never throw the game* (loss rate $< 5\%$), the evaluation guardrail blocks uncompensated Queen or Rook sacrifices until White's evaluation exceeds `+350cp` to `+420cp`. If the opponent defends tenaciously, the game reaches the 140–160 ply limit as a high-evaluation stalemate/adjudication draw rather than risking a loss.
2. **Opponent Counter-Sacrifices & Fortress Defenses**:
   Once Marionette liquidates its Queen and Rooks and underpromotes pawns to Knights (`a8=N`, `c8=N`), a 2200–2400 Stockfish opponent recognizes it is losing and actively plays for **threefold repetition**, **stalemate traps** in the corner, or sacrifices a Rook for White's last pawn to leave `K+N+N vs K` (which cannot force checkmate against best defense).
3. **The Non-Target Mate Horizon**:
   When Marionette has a Queen/Rook plus a Knight on the board and is forbidden from delivering checkmate with the Queen or Rook, it must Side-step forced Queen mates (`Qf7#`) in favor of maneuvering the Knight (`Nf6#`). In cramped endgame positions with high move counts, sidestepping forced Queen mates while avoiding threefold repetition occasionally exhausts the 140–160 ply window.
