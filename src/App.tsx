import React from 'react';
import { Chess, PieceSymbol } from 'chess.js';
import { MarionettePlan } from './marionette/dsl';
import { FIXTURE_GOALS, GEMINI_MODELS_CYCLE } from './marionette/compiler';
import { GameStepTelemetry, MatchResult } from './marionette/arena';
import { ChessboardRenderer } from './components/ChessboardRenderer';
import { SteeringTelemetryPanel } from './components/SteeringTelemetryPanel';
import { ObjectiveStudioView } from './components/ObjectiveStudioView';
import { ArenaLadderResultsView } from './components/ArenaLadderResultsView';
import ladderDataStatic from './marionette/ladder-results.json';

type ActiveTab = 'arena' | 'studio' | 'ladder' | 'docs';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function formatEvalBarPercent(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return Math.round(((clamped + 1000) / 2000) * 100);
}

function formatCpDisplay(cp: number): string {
  if (cp >= 9000) return `+M${Math.max(1, Math.round((10000 - cp) / 10))}`;
  if (cp <= -9000) return `-M${Math.max(1, Math.round((10000 + cp) / 10))}`;
  const sign = cp > 0 ? '+' : '';
  return `${sign}${(cp / 100).toFixed(2)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = React.useState<ActiveTab>('arena');

  // Active plan & compiler state
  const [currentPlan, setCurrentPlan] = React.useState<MarionettePlan>(
    FIXTURE_GOALS[3].expectedPlan // Headline hard objective by default
  );
  const [lastModelUsed, setLastModelUsed] = React.useState<string>('gemini-4-hydrogen');
  const [cycledModels, setCycledModels] = React.useState<string[]>([
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
    'gemini-4-argon',
    'gemini-4-carbon',
  ]);

  // Quick-compile bar in Live Arena
  const [quickGoalInput, setQuickGoalInput] = React.useState<string>(
    FIXTURE_GOALS[3].goal
  );
  const [isQuickCompiling, setIsQuickCompiling] = React.useState(false);

  // Opponent & Engine parameters
  const [opponentElo, setOpponentElo] = React.useState<number>(2000);
  const [engineDepth, setEngineDepth] = React.useState<number>(7);
  const [playbackSpeedMs, setPlaybackSpeedMs] = React.useState<number>(450);

  // Game steps & VCR timeline state
  const [steps, setSteps] = React.useState<GameStepTelemetry[]>(() => {
    // Pre-populate with showcase match from the headline goal so the user immediately sees a rich game ready to scrub or play!
    const rungs = (ladderDataStatic as any)?.rungs ?? [];
    const hardRung = rungs.find((r: any) => r.config?.id === 'hard-headline-1800' && r.showcaseMatch?.steps?.length);
    const fallbackRung = rungs.find((r: any) => r.showcaseMatch?.steps?.length);
    const match = hardRung?.showcaseMatch ?? fallbackRung?.showcaseMatch;
    return match?.steps ?? [];
  });
  const [currentPly, setCurrentPly] = React.useState<number>(() => {
    const rungs = (ladderDataStatic as any)?.rungs ?? [];
    const hardRung = rungs.find((r: any) => r.config?.id === 'hard-headline-1800' && r.showcaseMatch?.steps?.length);
    const st = hardRung?.showcaseMatch?.steps ?? [];
    return st.length > 0 ? Math.min(25, st.length) : 0;
  });

  // Playback / Live simulation status
  const [isPlaying, setIsPlaying] = React.useState<boolean>(false);
  const [isSimulatingStep, setIsSimulatingStep] = React.useState<boolean>(false);
  const [flippedBoard, setFlippedBoard] = React.useState<boolean>(false);
  const [ladderData, setLadderData] = React.useState<any>(ladderDataStatic);

  // Fetch latest ladder results from server on mount
  React.useEffect(() => {
    fetch('/api/marionette/results')
      .then(r => r.json())
      .then(data => {
        if (data?.ladderData) {
          setLadderData(data.ladderData);
        }
      })
      .catch(() => {
        // Fallback to static import
      });
  }, []);

  // Derive current board state at `currentPly`
  const activeStep: GameStepTelemetry | undefined =
    currentPly > 0 ? steps[currentPly - 1] : undefined;

  const currentFen = activeStep ? activeStep.fenAfter : STARTING_FEN;

  // Find latest Marionette steering decision at or before `currentPly`
  const latestMarionetteStep = React.useMemo(() => {
    for (let i = currentPly - 1; i >= 0; i--) {
      if (steps[i]?.isMarionetteTurn && steps[i]?.steeringDecision) {
        return steps[i];
      }
    }
    return undefined;
  }, [steps, currentPly]);

  // Compute cumulative history stats up to `currentPly`
  const historyStatsAtPly = React.useMemo(() => {
    let queenMovesCount = 0;
    let promotedKnightsCount = 0;
    let totalPromotionsCount = 0;
    const movedPieces = new Set<PieceSymbol>();
    let guardrailCount = 0;
    let promoOverridesCount = 0;

    for (let i = 0; i < currentPly; i++) {
      const s = steps[i];
      if (!s) continue;
      if (s.isMarionetteTurn) {
        if (s.steeringDecision?.guardrailTriggered) guardrailCount++;
        if (s.steeringDecision?.promotionOverrideApplied) promoOverridesCount++;
        if (s.uci.length === 5) {
          totalPromotionsCount++;
          if (s.uci[4] === 'n') promotedKnightsCount++;
        }
        if (s.san.startsWith('Q')) queenMovesCount++;
      }
    }

    return {
      queenMovesCount,
      promotedKnightsCount,
      totalPromotionsCount,
      movedPieces: Array.from(movedPieces),
      guardrailCount,
      promoOverridesCount,
      moveNumber: Math.floor(currentPly / 2) + 1,
    };
  }, [steps, currentPly]);

  const currentEvalCp =
    latestMarionetteStep?.steeringDecision?.chosenMove.cp ??
    activeStep?.opponentEvalCp ??
    25;

  const chessInstance = React.useMemo(() => {
    try {
      return new Chess(currentFen);
    } catch {
      return new Chess();
    }
  }, [currentFen]);

  const isGameOverAtPly = chessInstance.isGameOver();

  // Execute one live Stockfish step from `currentPly`
  const stepForwardLiveOrReplay = React.useCallback(async () => {
    // If we are rewound behind existing steps, simply advance the VCR cursor!
    if (currentPly < steps.length) {
      setCurrentPly(p => p + 1);
      return;
    }

    if (isGameOverAtPly || isSimulatingStep) {
      setIsPlaying(false);
      return;
    }

    setIsSimulatingStep(true);
    try {
      const side = chessInstance.turn();
      const isMarionetteTurn = side === 'w';
      const res = await fetch('/api/marionette/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: currentFen,
          plan: currentPlan,
          isMarionetteTurn,
          opponentElo,
          depth: engineDepth,
          multiPv: 12,
          historyStats: historyStatsAtPly,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || data.gameOver) {
        setIsPlaying(false);
        return;
      }

      const newStep: GameStepTelemetry = {
        ply: steps.length + 1,
        moveNumber: Math.floor(steps.length / 2) + 1,
        side,
        uci: data.uci,
        san: data.san,
        fenBefore: data.fenBefore,
        fenAfter: data.fenAfter,
        isMarionetteTurn: data.isMarionetteTurn,
        steeringDecision: data.steeringDecision,
        opponentEvalCp: data.opponentEvalCp,
      };

      setSteps(prev => [...prev, newStep]);
      setCurrentPly(prev => prev + 1);
    } catch {
      setIsPlaying(false);
    } finally {
      setIsSimulatingStep(false);
    }
  }, [
    currentPly,
    steps.length,
    isGameOverAtPly,
    isSimulatingStep,
    chessInstance,
    currentFen,
    currentPlan,
    opponentElo,
    engineDepth,
    historyStatsAtPly,
  ]);

  // Auto-play loop when `isPlaying` is true
  React.useEffect(() => {
    if (!isPlaying) return;
    if (isGameOverAtPly && currentPly >= steps.length) {
      setIsPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      stepForwardLiveOrReplay();
    }, playbackSpeedMs);
    return () => clearTimeout(timer);
  }, [isPlaying, isGameOverAtPly, currentPly, steps.length, playbackSpeedMs, stepForwardLiveOrReplay]);

  const handleStartFreshLiveGame = (planToUse: MarionettePlan = currentPlan) => {
    setIsPlaying(false);
    setSteps([]);
    setCurrentPly(0);
    setCurrentPlan(planToUse);
    setQuickGoalInput(planToUse.rawGoal);
    setActiveTab('arena');
    setTimeout(() => {
      setIsPlaying(true);
    }, 100);
  };

  const handleQuickCompileAndPlay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickGoalInput.trim()) return;
    setIsQuickCompiling(true);
    setIsPlaying(false);
    try {
      const res = await fetch('/api/marionette/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: quickGoalInput.trim(), mock: false }),
      });
      const data = await res.json();
      if (res.ok && data.plan) {
        setCurrentPlan(data.plan);
        setLastModelUsed(data.modelUsed || 'gemini-4-hydrogen');
        if (data.cycledModels) setCycledModels(data.cycledModels);
        setSteps([]);
        setCurrentPly(0);
        setIsPlaying(true);
      }
    } finally {
      setIsQuickCompiling(false);
    }
  };

  const handleReplayShowcaseMatch = (match: MatchResult) => {
    setIsPlaying(false);
    const matchingFixture = FIXTURE_GOALS.find(
      f => f.id === match.planId || f.goal.toLowerCase() === match.rawGoal.toLowerCase()
    );
    if (matchingFixture) {
      setCurrentPlan(matchingFixture.expectedPlan);
    }
    setQuickGoalInput(match.rawGoal);
    setOpponentElo(match.opponentElo);
    if (match.steps && match.steps.length > 0) {
      setSteps(match.steps);
      setCurrentPly(match.steps.length);
    }
    setActiveTab('arena');
  };

  const handleManualBoardMove = (from: string, to: string, promotion?: string) => {
    try {
      const c = new Chess(currentFen);
      const moveObj = c.move({ from, to, promotion: promotion as PieceSymbol });
      if (!moveObj) return;
      const truncated = steps.slice(0, currentPly);
      const newStep: GameStepTelemetry = {
        ply: truncated.length + 1,
        moveNumber: Math.floor(truncated.length / 2) + 1,
        side: moveObj.color,
        uci: `${from}${to}${moveObj.promotion ?? ''}`,
        san: moveObj.san,
        fenBefore: currentFen,
        fenAfter: c.fen(),
        isMarionetteTurn: moveObj.color === 'w',
      };
      setSteps([...truncated, newStep]);
      setCurrentPly(truncated.length + 1);
    } catch {
      // ignore invalid manual move
    }
  };

  // Group moves into pairs (White / Black) for the live PGN move table
  const movePairs = React.useMemo(() => {
    const pairs: Array<{
      moveNumber: number;
      white?: GameStepTelemetry;
      black?: GameStepTelemetry;
    }> = [];
    for (let i = 0; i < steps.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: steps[i],
        black: steps[i + 1],
      });
    }
    return pairs;
  }, [steps]);

  const evalPercent = formatEvalBarPercent(currentEvalCp);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800/90 bg-[#0B0F17]/95 sticky top-0 z-30">
        {/* Zone 1: Brand Title (single text element) */}
        <a
          href="#arena"
          onClick={e => {
            e.preventDefault();
            setActiveTab('arena');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-serif"
        >
          Marionette
        </a>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav aria-label="Main Navigation" className="flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('arena')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'arena'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-slate-400'
            }`}
          >
            Live Visualizer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'studio'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-slate-400'
            }`}
          >
            Objective Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ladder')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'ladder'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-slate-400'
            }`}
          >
            Arena Ladder
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeTab === 'docs'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-slate-400'
            }`}
          >
            DSL Guide
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => handleStartFreshLiveGame(currentPlan)}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            New Steered Match
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-5">
        {activeTab === 'arena' && (
          <div className="flex flex-col gap-5">
            {/* Quick Objective Compiler & Preset Selector Bar */}
            <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-4">
              <form
                onSubmit={handleQuickCompileAndPlay}
                className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3"
              >
                <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <label
                    htmlFor="arena-goal-input"
                    className="text-xs font-semibold text-slate-300 whitespace-nowrap shrink-0"
                  >
                    Natural-Language Goal:
                  </label>
                  <input
                    id="arena-goal-input"
                    type="text"
                    value={quickGoalInput}
                    onChange={e => setQuickGoalInput(e.target.value)}
                    placeholder="Enter any chess objective (e.g. sacrifice all non-pawn pieces, promote only to knights, mate with a knight)"
                    className="flex-1 rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <label htmlFor="preset-fixture-select" className="text-xs text-slate-400">
                    Preset:
                  </label>
                  <select
                    id="preset-fixture-select"
                    value={
                      FIXTURE_GOALS.some(f => f.expectedPlan.id === currentPlan.id)
                        ? currentPlan.id
                        : 'custom'
                    }
                    onChange={e => {
                      const found = FIXTURE_GOALS.find(f => f.id === e.target.value);
                      if (found) {
                        setCurrentPlan(found.expectedPlan);
                        setQuickGoalInput(found.goal);
                        // Also check if ladderData has a pre-recorded showcase game for this fixture
                        const rung = ladderData?.rungs?.find(
                          (r: any) => r.config?.goalText?.toLowerCase() === found.goal.toLowerCase()
                        );
                        if (rung?.showcaseMatch?.steps?.length) {
                          setIsPlaying(false);
                          setSteps(rung.showcaseMatch.steps);
                          setCurrentPly(rung.showcaseMatch.steps.length);
                        } else {
                          handleStartFreshLiveGame(found.expectedPlan);
                        }
                      }
                    }}
                    className="rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 max-w-[210px] truncate"
                  >
                    {!FIXTURE_GOALS.some(f => f.expectedPlan.id === currentPlan.id) && (
                      <option value="custom">Custom: {currentPlan.name}</option>
                    )}
                    {FIXTURE_GOALS.map(fx => (
                      <option key={fx.id} value={fx.id}>
                        [{fx.difficulty}] {fx.expectedPlan.name}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="opponent-elo-select" className="text-xs text-slate-400 ml-1">
                    Vs Elo:
                  </label>
                  <select
                    id="opponent-elo-select"
                    value={opponentElo}
                    onChange={e => setOpponentElo(Number(e.target.value))}
                    className="rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value={1800}>1800</option>
                    <option value={2000}>2000</option>
                    <option value={2200}>2200</option>
                    <option value={2400}>2400</option>
                  </select>

                  <button
                    type="submit"
                    disabled={isQuickCompiling}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isQuickCompiling ? 'Compiling...' : 'Compile & Play Live'}
                  </button>
                </div>
              </form>
            </section>

            {/* 3-Column Real-Time Game Visualization & Telemetry Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column (5 cols): Board + Eval Bar + VCR Timeline Controls */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                <div className="border border-slate-800 bg-slate-900/70 rounded-lg p-4">
                  {/* Match Status Header */}
                  <div className="flex items-center justify-between gap-2 mb-3 text-xs font-mono tabular-nums">
                    <div className="text-slate-300">
                      <span className="font-semibold text-amber-400">Marionette (W)</span> vs{' '}
                      <span className="text-slate-200">Stockfish {opponentElo} (B)</span>
                    </div>
                    <div className="text-slate-400">
                      Ply {currentPly}/{steps.length} · Eval{' '}
                      <span className="text-slate-100 font-semibold">
                        {formatCpDisplay(currentEvalCp)}
                      </span>
                    </div>
                  </div>

                  {/* Board + Vertical Centipawn Bar */}
                  <div className="flex items-stretch gap-3 justify-center">
                    {/* Vertical Centipawn Thermometer */}
                    <div
                      aria-label={`Stockfish Evaluation ${formatCpDisplay(currentEvalCp)}`}
                      className="w-6 rounded bg-slate-800 border border-slate-700 overflow-hidden flex flex-col justify-end relative shrink-0"
                    >
                      <div
                        className="w-full bg-slate-200 transition-all duration-150"
                        style={{ height: `${evalPercent}%` }}
                      />
                      {/* Guardrail threshold line */}
                      <div
                        title={`Eval Floor Guardrail (${currentPlan.evalFloorCp}cp)`}
                        className="absolute left-0 right-0 border-t-2 border-dashed border-amber-500 z-10"
                        style={{
                          bottom: `${formatEvalBarPercent(currentPlan.evalFloorCp)}%`,
                        }}
                      />
                    </div>

                    {/* Interactive SVG Chessboard */}
                    <ChessboardRenderer
                      fen={currentFen}
                      lastMoveUci={activeStep?.uci}
                      engineBestUci={
                        activeStep?.isMarionetteTurn
                          ? activeStep.steeringDecision?.bestEngineMove.uci
                          : undefined
                      }
                      chosenUci={
                        activeStep?.isMarionetteTurn
                          ? activeStep.steeringDecision?.chosenMove.uci
                          : undefined
                      }
                      hardConstraints={currentPlan.hardConstraints}
                      promotionOverride={currentPlan.promotionOverride}
                      flipped={flippedBoard}
                      interactive={!isPlaying}
                      onUserMove={handleManualBoardMove}
                    />
                  </div>

                  {/* Legend for Vector Arrows */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
                    <div className="flex items-center gap-4">
                      <span>Solid Gold Arrow: Steered Move</span>
                      <span>·</span>
                      <span>Dashed Slate Arrow: Raw Stockfish #1</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFlippedBoard(f => !f)}
                      className="text-slate-300 hover:text-amber-400 underline whitespace-nowrap shrink-0"
                    >
                      Flip Board
                    </button>
                  </div>

                  {/* VCR Scrubber Slider & Transport Controls */}
                  <div className="mt-4 pt-3 border-t border-slate-800">
                    <div className="flex items-center gap-3 mb-3">
                      <label htmlFor="ply-timeline-scrubber" className="text-xs font-mono text-slate-400 shrink-0">
                        Timeline:
                      </label>
                      <input
                        id="ply-timeline-scrubber"
                        type="range"
                        min={0}
                        max={Math.max(0, steps.length)}
                        value={currentPly}
                        onChange={e => {
                          setIsPlaying(false);
                          setCurrentPly(Number(e.target.value));
                        }}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Rewind to Start"
                          onClick={() => {
                            setIsPlaying(false);
                            setCurrentPly(0);
                          }}
                          className="px-2.5 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          |&lt; Start
                        </button>
                        <button
                          type="button"
                          aria-label="Step Back"
                          onClick={() => {
                            setIsPlaying(false);
                            setCurrentPly(p => Math.max(0, p - 1));
                          }}
                          disabled={currentPly === 0}
                          className="px-2.5 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          &lt; Prev
                        </button>
                        <button
                          type="button"
                          aria-label={isPlaying ? 'Pause Game' : 'Play Game'}
                          onClick={() => setIsPlaying(p => !p)}
                          className="px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          {isPlaying ? 'Pause' : currentPly < steps.length ? 'Resume Replay' : 'Play Live'}
                        </button>
                        <button
                          type="button"
                          aria-label="Step Forward"
                          onClick={() => {
                            setIsPlaying(false);
                            stepForwardLiveOrReplay();
                          }}
                          disabled={isSimulatingStep}
                          className="px-2.5 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          {isSimulatingStep ? 'Thinking...' : 'Next >'}
                        </button>
                        <button
                          type="button"
                          aria-label="Jump to End"
                          onClick={() => {
                            setIsPlaying(false);
                            setCurrentPly(steps.length);
                          }}
                          disabled={currentPly >= steps.length}
                          className="px-2.5 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          End &gt;|
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <label htmlFor="speed-select" className="text-[11px] text-slate-400">
                          Speed:
                        </label>
                        <select
                          id="speed-select"
                          value={playbackSpeedMs}
                          onChange={e => setPlaybackSpeedMs(Number(e.target.value))}
                          className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs font-mono text-slate-200"
                        >
                          <option value={900}>0.5x</option>
                          <option value={450}>1.0x</option>
                          <option value={200}>2.0x</option>
                          <option value={80}>Max</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Move Feed & Telemetry History Table */}
                <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-4">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                    <h3 className="text-xs font-semibold text-slate-200">
                      Live Move Feed &amp; Decision History (Click Any Ply to Inspect)
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      Guardrails: {historyStatsAtPly.guardrailCount} · Overrides:{' '}
                      {historyStatsAtPly.promoOverridesCount}
                    </span>
                  </div>

                  <div className="mt-2 max-h-[210px] overflow-y-auto pr-1 font-mono text-xs tabular-nums">
                    {movePairs.length === 0 ? (
                      <div className="py-6 text-center text-slate-500 font-sans">
                        No moves played yet. Press &ldquo;Play Live&rdquo; or &ldquo;Next &gt;&rdquo; to step Stockfish.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse">
                        <tbody>
                          {movePairs.map(pair => {
                            const wSelected = pair.white?.ply === currentPly;
                            const bSelected = pair.black?.ply === currentPly;
                            const wSteered =
                              pair.white?.steeringDecision &&
                              pair.white.steeringDecision.chosenMove.uci !==
                                pair.white.steeringDecision.bestEngineMove.uci;

                            return (
                              <tr
                                key={pair.moveNumber}
                                className="border-b border-slate-800/50 hover:bg-slate-800/30"
                              >
                                <td className="py-1.5 pr-2 text-slate-500 w-10">
                                  {pair.moveNumber}.
                                </td>
                                <td className="py-1 px-2">
                                  {pair.white && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsPlaying(false);
                                        setCurrentPly(pair.white!.ply);
                                      }}
                                      className={`w-full text-left px-2 py-0.5 rounded transition-colors ${
                                        wSelected
                                          ? 'bg-amber-500 text-slate-950 font-semibold'
                                          : 'text-slate-200 hover:bg-slate-800'
                                      }`}
                                    >
                                      <span>{pair.white.san}</span>
                                      {wSteered && (
                                        <span
                                          className={`ml-1.5 text-[10px] ${
                                            wSelected ? 'text-slate-900' : 'text-amber-400'
                                          }`}
                                        >
                                          [steered]
                                        </span>
                                      )}
                                    </button>
                                  )}
                                </td>
                                <td className="py-1 pl-2">
                                  {pair.black && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsPlaying(false);
                                        setCurrentPly(pair.black!.ply);
                                      }}
                                      className={`w-full text-left px-2 py-0.5 rounded transition-colors ${
                                        bSelected
                                          ? 'bg-amber-500 text-slate-950 font-semibold'
                                          : 'text-slate-300 hover:bg-slate-800'
                                      }`}
                                    >
                                      {pair.black.san}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </div>

              {/* Right Column (7 cols): Steering Telemetry, Multi-PV Matrix & Objective Progress */}
              <div className="lg:col-span-7">
                <SteeringTelemetryPanel
                  fen={currentFen}
                  plan={currentPlan}
                  decision={latestMarionetteStep?.steeringDecision}
                  promotedKnightsCount={historyStatsAtPly.promotedKnightsCount}
                  queenMovesCount={historyStatsAtPly.queenMovesCount}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'studio' && (
          <ObjectiveStudioView
            fixtures={FIXTURE_GOALS}
            models={[...GEMINI_MODELS_CYCLE]}
            currentPlan={currentPlan}
            lastModelUsed={lastModelUsed}
            cycledModels={cycledModels}
            onPlanSelected={(plan, model, cycled) => {
              setCurrentPlan(plan);
              setQuickGoalInput(plan.rawGoal);
              if (model) setLastModelUsed(model);
              if (cycled) setCycledModels(cycled);
            }}
            onLaunchInVisualizer={plan => {
              handleStartFreshLiveGame(plan);
            }}
          />
        )}

        {activeTab === 'ladder' && (
          <ArenaLadderResultsView
            ladderData={ladderData}
            onReplayShowcaseMatch={handleReplayShowcaseMatch}
          />
        )}

        {activeTab === 'docs' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 border border-slate-800 bg-slate-900/70 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-100">
                01. Marionette Architecture &amp; Steering Equation
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Marionette bridges natural-language intent and superhuman UCI chess analysis. Instead of asking an LLM to pick chess moves directly (which causes illegal or blundering play), an LLM compiles the user&apos;s goal into a strongly-typed <strong>MarionettePlan DSL</strong>. On every turn, Stockfish 15.1 evaluates the top <code className="font-mono text-amber-300">MultiPV=14</code> candidate moves, and the steering layer scores each move:
              </p>
              <pre className="p-4 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-amber-300 overflow-x-auto">
{`CompositeScore(move) =
  StockfishEval_cp(move)
  + PhaseScale * Σ [ Weight_i * Feature_i(fen_after_move) ]
  + TacticalSacrificeBonus(move)
  + PromotionOverrideBonus(move)
  + TargetCheckmateBonus(move)`}
              </pre>
              <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                <div>
                  <strong className="text-slate-100">Hard Invariants (Never Violated):</strong> Moves that violate <code className="font-mono text-amber-300">never_move_piece</code>, <code className="font-mono text-amber-300">never_capture_with</code>, <code className="font-mono text-amber-300">forbid_castling</code>, <code className="font-mono text-amber-300">promote_only_to</code>, or <code className="font-mono text-amber-300">never_move_file_pawn</code> are strictly filtered out before candidate selection.
                </div>
                <div>
                  <strong className="text-slate-100">Promotion Override:</strong> When Stockfish outputs <code className="font-mono text-amber-300">a7a8q</code> in its principal variation, <code className="font-mono text-amber-300">applyPromotionOverride</code> rewrites the UCI move to <code className="font-mono text-amber-300">a7a8n</code> (or the plan&apos;s target underpromotion piece) and verifies legality.
                </div>
                <div>
                  <strong className="text-slate-100">Evaluation Guardrail:</strong> To keep Marionette&apos;s loss rate below 5%, candidate moves are only steered if they remain above <code className="font-mono text-amber-300">evalFloorCp</code> and drop at most <code className="font-mono text-amber-300">maxEvalDropCp</code> from Stockfish&apos;s #1 choice (scaling dynamically when Marionette holds an overwhelming &gt; +450cp advantage).
                </div>
              </div>
            </section>

            <section className="lg:col-span-5 border border-slate-800 bg-slate-900/70 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-100">
                02. CLI Usage &amp; Adding New Objectives
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Run Marionette directly from the terminal with a real Gemini model and Stockfish 15.1:
              </p>
              <pre className="p-3.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
{`# Play a match with any natural-language goal
npx tsx src/marionette/cli.ts play \\
  --goal "sacrifice all non-pawn pieces, promote only to knights, mate with a knight" \\
  --elo 2000 --depth 8

# Compile a goal to inspect the JSON DSL
npx tsx src/marionette/cli.ts compile \\
  --goal "win without ever moving the queen"

# Run the unit, property, and LLM test suite
npm test`}
              </pre>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
