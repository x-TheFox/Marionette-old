import fs from 'node:fs';
import path from 'node:path';
import { StockfishEngine } from './stockfish-uci';
import { FIXTURE_GOALS, compileGoalWithLLM } from './compiler';
import { playMarionetteMatch, MatchResult } from './arena';

export interface LadderRungConfig {
  id: string;
  title: string;
  goalText: string;
  elo: number;
  games: number;
  depth: number;
  multiPv: number;
  maxPlies: number;
}

export interface LadderRungSummary {
  config: LadderRungConfig;
  compiledModel: string;
  wins: number;
  draws: number;
  losses: number;
  goalSuccesses: number;
  winRatePct: number;
  goalRatePct: number;
  lossRatePct: number;
  totalHardViolations: number;
  totalGuardrailSaves: number;
  totalPromoOverrides: number;
  avgMoves: number;
  failureReasons: string[];
  matches: MatchResult[];
}

export const LADDER_CONFIGS: LadderRungConfig[] = [
  {
    id: 'sanity-2400',
    title: '1. Sanity Goal ("just win" vs Elo 2400)',
    goalText: 'just win',
    elo: 2400,
    games: 10,
    depth: 7,
    multiPv: 6,
    maxPlies: 130,
  },
  {
    id: 'easy-knight-mate-2000',
    title: '2a. Easy Style Goal ("deliver checkmate with a knight" vs Elo 2000)',
    goalText: 'deliver checkmate with a knight',
    elo: 2000,
    games: 5,
    depth: 7,
    multiPv: 12,
    maxPlies: 140,
  },
  {
    id: 'easy-knight-mate-2400',
    title: '2b. Easy Style Goal ("deliver checkmate with a knight" vs Elo 2400)',
    goalText: 'deliver checkmate with a knight',
    elo: 2400,
    games: 5,
    depth: 7,
    multiPv: 12,
    maxPlies: 140,
  },
  {
    id: 'medium-no-queen-2200',
    title: '3. Medium Goal ("win without ever moving the queen" vs Elo 2200)',
    goalText: 'win without ever moving the queen',
    elo: 2200,
    games: 5,
    depth: 7,
    multiPv: 12,
    maxPlies: 140,
  },
  {
    id: 'hard-headline-1800',
    title: '4a. Hard Headline Goal ("sacrifice all non-pawn pieces, promote only to knights, mate with a knight" vs Elo 1800)',
    goalText: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
    elo: 1800,
    games: 4,
    depth: 7,
    multiPv: 14,
    maxPlies: 160,
  },
  {
    id: 'hard-headline-2000',
    title: '4b. Hard Headline Goal ("sacrifice all non-pawn pieces, promote only to knights, mate with a knight" vs Elo 2000)',
    goalText: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
    elo: 2000,
    games: 4,
    depth: 7,
    multiPv: 14,
    maxPlies: 160,
  },
  {
    id: 'hard-headline-2200',
    title: '4c. Hard Headline Goal ("sacrifice all non-pawn pieces, promote only to knights, mate with a knight" vs Elo 2200)',
    goalText: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
    elo: 2200,
    games: 4,
    depth: 7,
    multiPv: 14,
    maxPlies: 160,
  },
  {
    id: 'hard-headline-2400',
    title: '4d. Hard Headline Goal ("sacrifice all non-pawn pieces, promote only to knights, mate with a knight" vs Elo 2400)',
    goalText: 'sacrifice all non-pawn pieces, promote only to knights, mate with a knight',
    elo: 2400,
    games: 4,
    depth: 7,
    multiPv: 14,
    maxPlies: 160,
  },
  {
    id: 'novel-unseen-kingwalk-2000',
    title: '5. Out-of-Distribution LLM Goal ("Never castle, march the king up the board, and deliver checkmate with a knight" vs Elo 2000)',
    goalText: 'Never castle, march the king up the board, and deliver checkmate with a knight',
    elo: 2000,
    games: 4,
    depth: 7,
    multiPv: 12,
    maxPlies: 140,
  },
];

async function runLadder() {
  const engine = new StockfishEngine();
  await engine.init();

  const summaries: LadderRungSummary[] = [];

  for (const cfg of LADDER_CONFIGS) {
    console.log(`\n======================================================`);
    console.log(`Running: ${cfg.title}`);
    const compiled = await compileGoalWithLLM(cfg.goalText);
    console.log(`Compiled via model: ${compiled.modelUsed} (Plan: ${compiled.plan.name})`);

    const matches: MatchResult[] = [];
    for (let g = 0; g < cfg.games; g++) {
      const m = await playMarionetteMatch(engine, {
        plan: compiled.plan,
        opponentElo: cfg.elo,
        marionetteDepth: cfg.depth,
        marionetteMultiPv: cfg.multiPv,
        maxPlies: cfg.maxPlies,
        gameIndex: g,
      });
      matches.push(m);
      console.log(
        `  [Game ${g + 1}/${cfg.games}] Outcome: ${m.outcome.toUpperCase()} (${m.terminationReason}) | Goal Achieved: ${m.goalAchieved} | Moves: ${m.totalMoves} | Guardrails: ${m.guardrailActivations} | Violations: ${m.hardConstraintsViolated}`
      );
    }

    const wins = matches.filter(m => m.outcome === 'win').length;
    const draws = matches.filter(m => m.outcome === 'draw').length;
    const losses = matches.filter(m => m.outcome === 'loss').length;
    const goalSuccesses = matches.filter(m => m.goalAchieved).length;
    const totalHardViolations = matches.reduce((s, m) => s + m.hardConstraintsViolated, 0);
    const totalGuardrailSaves = matches.reduce((s, m) => s + m.guardrailActivations, 0);
    const totalPromoOverrides = matches.reduce((s, m) => s + m.promotionOverridesCount, 0);
    const avgMoves = Math.round(
      matches.reduce((s, m) => s + m.totalMoves, 0) / Math.max(1, matches.length)
    );
    const failureReasons = Array.from(
      new Set(matches.filter(m => !m.goalAchieved && m.goalFailureReason).map(m => m.goalFailureReason!))
    );

    summaries.push({
      config: cfg,
      compiledModel: compiled.modelUsed,
      wins,
      draws,
      losses,
      goalSuccesses,
      winRatePct: Math.round((wins / cfg.games) * 100),
      goalRatePct: Math.round((goalSuccesses / cfg.games) * 100),
      lossRatePct: Math.round((losses / cfg.games) * 100),
      totalHardViolations,
      totalGuardrailSaves,
      totalPromoOverrides,
      avgMoves,
      failureReasons,
      matches,
    });
  }

  await engine.quit();

  // Save compact showcase games & telemetry to src/marionette/ladder-results.json so UI can inspect and replay real arena games!
  const totalGames = summaries.reduce((s, r) => s + r.config.games, 0);
  const totalWins = summaries.reduce((s, r) => s + r.wins, 0);
  const totalDraws = summaries.reduce((s, r) => s + r.draws, 0);
  const totalLosses = summaries.reduce((s, r) => s + r.losses, 0);
  const totalGoalSuccess = summaries.reduce((s, r) => s + r.goalSuccesses, 0);
  const overallLossRatePct = Number(((totalLosses / totalGames) * 100).toFixed(1));

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    totals: {
      totalGames,
      totalWins,
      totalDraws,
      totalLosses,
      totalGoalSuccess,
      overallLossRatePct,
      overallWinRatePct: Number(((totalWins / totalGames) * 100).toFixed(1)),
      overallGoalRatePct: Number(((totalGoalSuccess / totalGames) * 100).toFixed(1)),
    },
    rungs: summaries.map(s => {
      const rawShowcase = s.matches.find(m => m.goalAchieved) ?? s.matches[0];
      const showcaseMatch = rawShowcase
        ? {
            ...rawShowcase,
            steps: rawShowcase.steps.map(st => ({
              ...st,
              steeringDecision: st.steeringDecision
                ? {
                    ...st.steeringDecision,
                    candidates: st.steeringDecision.candidates.slice(0, 6),
                  }
                : undefined,
            })),
          }
        : undefined;
      return {
        ...s,
        showcaseMatch,
        matches: s.matches.map(m => ({
          ...m,
          steps: undefined,
        })),
      };
    }),
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'src/marionette/ladder-results.json'),
    JSON.stringify(jsonPayload, null, 2)
  );

  console.log('\nSaved src/marionette/ladder-results.json successfully.');
}

runLadder().catch(err => {
  console.error(err);
  process.exit(1);
});
