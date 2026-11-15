import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { CandidateMoveEval } from './steerer';

export interface StockfishAnalysisOptions {
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
  limitStrengthElo?: number;
  skillLevel?: number;
}

function resolveStockfishBinary(): string {
  const candidates = [
    '/usr/games/stockfish',
    '/usr/local/bin/stockfish',
    '/usr/bin/stockfish',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'stockfish';
}

export class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private lineListeners: Array<(line: string) => void> = [];
  private isReady = false;

  async init(): Promise<void> {
    if (this.proc && this.isReady) return;

    const bin = resolveStockfishBinary();
    this.proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nlIndex: number;
      while ((nlIndex = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nlIndex).trim();
        this.buffer = this.buffer.slice(nlIndex + 1);
        if (line) {
          for (const listener of [...this.lineListeners]) {
            listener(line);
          }
        }
      }
    });

    await this.sendAndWait('uci', line => line === 'uciok');
    this.sendCommand('setoption name Threads value 2');
    this.sendCommand('setoption name Hash value 32');
    await this.sendAndWait('isready', line => line === 'readyok');
    this.isReady = true;
  }

  private sendCommand(cmd: string): void {
    if (!this.proc) throw new Error('Stockfish process not initialized');
    this.proc.stdin.write(`${cmd}\n`);
  }

  private sendAndWait(
    cmd: string,
    predicate: (line: string) => boolean,
    timeoutMs = 10000
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const collected: string[] = [];
      const timer = setTimeout(() => {
        this.removeListener(onLine);
        reject(new Error(`Timeout waiting for UCI command: ${cmd}`));
      }, timeoutMs);

      const onLine = (line: string) => {
        collected.push(line);
        if (predicate(line)) {
          clearTimeout(timer);
          this.removeListener(onLine);
          resolve(collected);
        }
      };

      this.lineListeners.push(onLine);
      this.sendCommand(cmd);
    });
  }

  private removeListener(fn: (line: string) => void): void {
    const idx = this.lineListeners.indexOf(fn);
    if (idx !== -1) {
      this.lineListeners.splice(idx, 1);
    }
  }

  async newGame(): Promise<void> {
    await this.init();
    this.sendCommand('ucinewgame');
    await this.sendAndWait('isready', line => line === 'readyok');
  }

  /**
   * Analyzes a FEN position with MultiPV and returns sorted CandidateMoveEval items.
   * Evaluations are always from the side-to-move's perspective ( as standard in Stockfish UCI).
   */
  async analyzeMultiPV(
    fen: string,
    options: StockfishAnalysisOptions = {}
  ): Promise<CandidateMoveEval[]> {
    await this.init();

    const multiPv = options.multiPv ?? 12;
    const depth = options.depth ?? 10;

    this.sendCommand('setoption name UCI_LimitStrength value false');
    this.sendCommand('setoption name Skill Level value 20');
    this.sendCommand(`setoption name MultiPV value ${multiPv}`);
    await this.sendAndWait('isready', line => line === 'readyok');

    this.sendCommand(`position fen ${fen}`);

    const goCmd = options.movetimeMs
      ? `go movetime ${options.movetimeMs}`
      : `go depth ${depth}`;

    const lines = await this.sendAndWait(goCmd, line => line.startsWith('bestmove'), 15000);

    // Parse latest info lines per multipv index
    const chess = new Chess(fen);
    const legalVerbose = chess.moves({ verbose: true });
    const uciToSan = new Map<string, string>();
    for (const m of legalVerbose) {
      uciToSan.set(`${m.from}${m.to}${m.promotion ?? ''}`, m.san);
    }

    const latestByPv = new Map<number, CandidateMoveEval>();

    for (const line of lines) {
      if (!line.startsWith('info ') || !line.includes(' pv ')) continue;
      // Extract multipv
      const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
      const mpv = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;

      // Extract score
      let cp = 0;
      let mateIn: number | undefined = undefined;
      const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
      const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);

      if (mateMatch) {
        mateIn = parseInt(mateMatch[1], 10);
        cp = mateIn > 0 ? 10000 - mateIn * 10 : -10000 - mateIn * 10;
      } else if (cpMatch) {
        cp = parseInt(cpMatch[1], 10);
      } else {
        continue;
      }

      // Extract PV moves
      const pvIndex = line.indexOf(' pv ');
      const pvStr = line.slice(pvIndex + 4).trim();
      const pvMoves = pvStr.split(/\s+/);
      const firstUci = pvMoves[0];
      if (!firstUci) continue;

      const san = uciToSan.get(firstUci) ?? firstUci;
      latestByPv.set(mpv, {
        uci: firstUci,
        san,
        cp,
        mateIn,
        pv: pvMoves.slice(0, 6),
      });
    }

    const results = Array.from(latestByPv.entries())
      .sort((a, b) => a[0] - b[0])
      .map(entry => entry[1]);

    // Fallback if bestmove line had a move not in info
    if (results.length === 0) {
      const bmLine = lines.find(l => l.startsWith('bestmove '));
      const bmUci = bmLine?.split(/\s+/)[1];
      if (bmUci && bmUci !== '(none)') {
        results.push({
          uci: bmUci,
          san: uciToSan.get(bmUci) ?? bmUci,
          cp: 0,
          pv: [bmUci],
        });
      }
    }

    return results;
  }

  /**
   * Plays a move as an opponent calibrated to a specific Elo rating (e.g. 1800, 2000, 2200, 2400).
   * Uses Stockfish's UCI_LimitStrength / UCI_Elo combined with calibrated depth and MultiPV sampling
   * so the opponent plays realistic, non-deterministic human/club/master games across multi-game arena matches.
   */
  async pickOpponentMove(
    fen: string,
    targetElo: number,
    options?: { seedOffset?: number }
  ): Promise<{ uci: string; san: string; cp: number }> {
    await this.init();
    const clampedElo = Math.max(1350, Math.min(2850, targetElo));

    // Configure depth and MultiPV based on Elo to model realistic tactical vision and opening variety
    const depth =
      targetElo >= 2400 ? 7 :
      targetElo >= 2200 ? 6 :
      targetElo >= 2000 ? 5 : 4;

    this.sendCommand('setoption name MultiPV value 5');
    this.sendCommand('setoption name UCI_LimitStrength value true');
    this.sendCommand(`setoption name UCI_Elo value ${clampedElo}`);
    await this.sendAndWait('isready', line => line === 'readyok');

    this.sendCommand(`position fen ${fen}`);
    const lines = await this.sendAndWait(`go depth ${depth}`, line => line.startsWith('bestmove'), 10000);

    const chess = new Chess(fen);
    const legalVerbose = chess.moves({ verbose: true });
    const uciToSan = new Map<string, string>();
    for (const m of legalVerbose) {
      uciToSan.set(`${m.from}${m.to}${m.promotion ?? ''}`, m.san);
    }

    const candidates: Array<{ uci: string; cp: number }> = [];
    for (const line of lines) {
      if (!line.startsWith('info ') || !line.includes(' pv ')) continue;
      const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
      const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
      let cp = 0;
      if (mateMatch) {
        const m = parseInt(mateMatch[1], 10);
        cp = m > 0 ? 10000 - m * 10 : -10000 - m * 10;
      } else if (cpMatch) {
        cp = parseInt(cpMatch[1], 10);
      }
      const pvIndex = line.indexOf(' pv ');
      const firstUci = line.slice(pvIndex + 4).trim().split(/\s+/)[0];
      if (firstUci && uciToSan.has(firstUci)) {
        const existingIdx = candidates.findIndex(c => c.uci === firstUci);
        if (existingIdx >= 0) {
          candidates[existingIdx].cp = cp;
        } else {
          candidates.push({ uci: firstUci, cp });
        }
      }
    }

    candidates.sort((a, b) => b.cp - a.cp);

    if (candidates.length > 0) {
      // Elo-calibrated temperature: higher Elo picks closer to top move, lower Elo allows slight inaccuracies
      const maxInaccuracyCp =
        targetElo >= 2400 ? 35 :
        targetElo >= 2200 ? 55 :
        targetElo >= 2000 ? 85 : 130;

      const bestCp = candidates[0].cp;
      const viable = candidates.filter(c => bestCp - c.cp <= maxInaccuracyCp);
      const idx =
        options?.seedOffset !== undefined
          ? options.seedOffset % viable.length
          : Math.floor(Math.random() * viable.length);
      const chosen = viable[idx] ?? candidates[0];
      return {
        uci: chosen.uci,
        san: uciToSan.get(chosen.uci) ?? chosen.uci,
        cp: chosen.cp,
      };
    }

    const bmLine = lines.find(l => l.startsWith('bestmove '));
    const bmUci = bmLine?.split(/\s+/)[1];
    if (bmUci && uciToSan.has(bmUci)) {
      return {
        uci: bmUci,
        san: uciToSan.get(bmUci)!,
        cp: 0,
      };
    }

    const fallback = legalVerbose[0];
    const fbUci = `${fallback.from}${fallback.to}${fallback.promotion ?? ''}`;
    return { uci: fbUci, san: fallback.san, cp: 0 };
  }

  async quit(): Promise<void> {
    if (!this.proc) return;
    try {
      this.sendCommand('quit');
      this.proc.kill();
    } catch {
      // ignore
    }
    this.proc = null;
    this.isReady = false;
  }
}
