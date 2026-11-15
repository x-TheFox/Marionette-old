#!/usr/bin/env npx tsx
import { StockfishEngine } from './stockfish-uci';
import { compileGoalWithLLM, FIXTURE_GOALS } from './compiler';
import { playMarionetteMatch } from './arena';

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0] || 'play';

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(`
Marionette — Goal-Directed Stockfish CLI
Usage:
  npx tsx src/marionette/cli.ts play --goal "<natural language goal>" [--elo 2000] [--depth 8] [--mock-llm]
  npx tsx src/marionette/cli.ts compile --goal "<natural language goal>"
  npx tsx src/marionette/cli.ts fixtures
`);
    return;
  }

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  if (subcommand === 'fixtures') {
    console.log(JSON.stringify(FIXTURE_GOALS, null, 2));
    return;
  }

  const goal =
    getArg('--goal') ||
    'sacrifice all non-pawn pieces, promote only to knights, mate with a knight';
  const elo = parseInt(getArg('--elo') || '2000', 10);
  const depth = parseInt(getArg('--depth') || '7', 10);
  const mockLlm = args.includes('--mock-llm');

  console.log(`[Marionette] Compiling objective: "${goal}"...`);
  const compiled = await compileGoalWithLLM(goal, { mock: mockLlm });
  console.log(
    `[Marionette] Plan "${compiled.plan.name}" compiled via ${compiled.modelUsed} (models tried: ${compiled.cycledModels.join(' -> ')})`
  );

  if (subcommand === 'compile') {
    console.log(JSON.stringify(compiled.plan, null, 2));
    return;
  }

  const engine = new StockfishEngine();
  await engine.init();

  console.log(`[Marionette] Starting match vs Stockfish (Elo ${elo}, depth ${depth})...`);
  const result = await playMarionetteMatch(engine, {
    plan: compiled.plan,
    opponentElo: elo,
    marionetteDepth: depth,
    marionetteMultiPv: 14,
    maxPlies: 150,
    onStep: step => {
      if (step.isMarionetteTurn && step.steeringDecision) {
        const d = step.steeringDecision;
        console.log(
          `  Move ${step.moveNumber}. ${step.san} (${step.uci}) | Eval: ${d.chosenMove.cp}cp | Bonus: +${d.chosenMove.featureBonusCp}cp | Phase: ${d.activePhase.name}`
        );
      }
    },
  });

  await engine.quit();

  console.log('\n=== MATCH SUMMARY ===');
  console.log(`Outcome:               ${result.outcome.toUpperCase()} (${result.terminationReason})`);
  console.log(`Goal Achieved:         ${result.goalAchieved ? 'YES' : 'NO'}${result.goalFailureReason ? ` (${result.goalFailureReason})` : ''}`);
  console.log(`Hard Constraints Viol: ${result.hardConstraintsViolated}`);
  console.log(`Guardrail Activations: ${result.guardrailActivations}`);
  console.log(`Promotion Overrides:   ${result.promotionOverridesCount}`);
  console.log(`Total Moves:           ${result.totalMoves}`);
  console.log(`Final FEN:             ${result.finalFen}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
