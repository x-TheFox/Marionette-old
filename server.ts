import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';
import { Chess, PieceSymbol } from 'chess.js';
import { StockfishEngine } from './src/marionette/stockfish-uci';
import { compileGoalWithLLM, FIXTURE_GOALS, GEMINI_MODELS_CYCLE } from './src/marionette/compiler';
import { selectSteeredMove, MoveHistoryStats } from './src/marionette/steerer';
import { validatePlan, MarionettePlan } from './src/marionette/dsl';
import { playMarionetteMatch } from './src/marionette/arena';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // Shared Stockfish instance for interactive UI queries
  const sharedEngine = new StockfishEngine();
  await sharedEngine.init();

  // 1. Get all 10 fixture goals and available Gemini models
  app.get('/api/marionette/fixtures', (_req, res) => {
    res.json({
      fixtures: FIXTURE_GOALS,
      models: GEMINI_MODELS_CYCLE,
    });
  });

  // 2. Get pre-computed real arena ladder results + RESULTS.md content
  app.get('/api/marionette/results', (_req, res) => {
    try {
      const resultsPath = path.resolve(process.cwd(), 'src/marionette/ladder-results.json');
      const mdPath = path.resolve(process.cwd(), 'RESULTS.md');
      const ladderData = fs.existsSync(resultsPath)
        ? JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
        : null;
      const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
      res.json({ ladderData, markdown });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to read results' });
    }
  });

  // 3. Compile any natural-language chess objective via Gemini (cycling across models)
  app.post('/api/marionette/compile', async (req, res) => {
    try {
      const { goal, preferredModel, mock } = req.body || {};
      if (!goal || typeof goal !== 'string') {
        res.status(400).json({ error: 'Goal string is required' });
        return;
      }
      const result = await compileGoalWithLLM(goal, {
        preferredModel,
        mock: Boolean(mock),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Compilation failed' });
    }
  });

  // 4. Validate a custom edited DSL JSON plan
  app.post('/api/marionette/validate', (req, res) => {
    const { plan } = req.body || {};
    const validation = validatePlan(plan);
    res.json(validation);
  });

  // 5. Compute a single live step (either Marionette steered turn or Opponent Elo turn)
  app.post('/api/marionette/step', async (req, res) => {
    try {
      const {
        fen,
        plan,
        isMarionetteTurn,
        opponentElo = 2000,
        depth = 8,
        multiPv = 12,
        historyStats,
      } = req.body || {};

      if (!fen) {
        res.status(400).json({ error: 'FEN is required' });
        return;
      }

      const chess = new Chess(fen);
      if (chess.isGameOver()) {
        res.json({ gameOver: true, fen });
        return;
      }

      if (isMarionetteTurn) {
        const validPlan: MarionettePlan = plan || FIXTURE_GOALS[3].expectedPlan;
        const candidates = await sharedEngine.analyzeMultiPV(fen, {
          depth: Math.min(12, Math.max(4, Number(depth) || 8)),
          multiPv: Math.min(20, Math.max(4, Number(multiPv) || 12)),
        });

        const parsedStats: MoveHistoryStats = {
          queenMovesCount: historyStats?.queenMovesCount ?? 0,
          promotedKnightsCount: historyStats?.promotedKnightsCount ?? 0,
          totalPromotionsCount: historyStats?.totalPromotionsCount ?? 0,
          movedPieces: new Set<PieceSymbol>(historyStats?.movedPieces ?? []),
          moveNumber: historyStats?.moveNumber ?? 1,
        };

        const decision = selectSteeredMove(fen, candidates, validPlan, parsedStats);
        const uci = decision.chosenMove.uci;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci.length === 5 ? (uci[4] as PieceSymbol) : undefined;
        const moveObj = chess.move({ from, to, promotion });

        res.json({
          uci,
          san: moveObj?.san ?? decision.chosenMove.san,
          piece: moveObj?.piece,
          promotion: moveObj?.promotion,
          fenBefore: fen,
          fenAfter: chess.fen(),
          isMarionetteTurn: true,
          steeringDecision: decision,
          isCheckmate: chess.isCheckmate(),
          isGameOver: chess.isGameOver(),
        });
      } else {
        const opp = await sharedEngine.pickOpponentMove(fen, Number(opponentElo) || 2000);
        const from = opp.uci.slice(0, 2);
        const to = opp.uci.slice(2, 4);
        const promotion = opp.uci.length === 5 ? (opp.uci[4] as PieceSymbol) : undefined;
        const moveObj = chess.move({ from, to, promotion });

        res.json({
          uci: opp.uci,
          san: moveObj?.san ?? opp.san,
          piece: moveObj?.piece,
          promotion: moveObj?.promotion,
          fenBefore: fen,
          fenAfter: chess.fen(),
          isMarionetteTurn: false,
          opponentEvalCp: opp.cp,
          isCheckmate: chess.isCheckmate(),
          isGameOver: chess.isGameOver(),
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Step calculation failed' });
    }
  });

  // 6. Run a full rapid match on the server and return complete move-by-move telemetry
  app.post('/api/marionette/match', async (req, res) => {
    try {
      const { plan, opponentElo = 2000, depth = 7, maxPlies = 140 } = req.body || {};
      const validPlan: MarionettePlan = plan || FIXTURE_GOALS[3].expectedPlan;
      const matchEngine = new StockfishEngine();
      await matchEngine.init();
      const result = await playMarionetteMatch(matchEngine, {
        plan: validPlan,
        opponentElo: Number(opponentElo) || 2000,
        marionetteDepth: Number(depth) || 7,
        marionetteMultiPv: 12,
        maxPlies: Number(maxPlies) || 140,
      });
      await matchEngine.quit();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Match execution failed' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Marionette Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
