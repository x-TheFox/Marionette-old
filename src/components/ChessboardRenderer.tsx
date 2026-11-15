import React from 'react';
import { Chess, Square, PieceSymbol, Color } from 'chess.js';
import { HardConstraint, PromotionPiece } from '../marionette/dsl';

interface ChessboardRendererProps {
  fen: string;
  lastMoveUci?: string;
  engineBestUci?: string;
  chosenUci?: string;
  hardConstraints: HardConstraint[];
  promotionOverride?: PromotionPiece;
  flipped?: boolean;
  interactive?: boolean;
  onUserMove?: (from: string, to: string, promotion?: string) => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function PieceSvg({ type, color }: { type: PieceSymbol; color: Color }) {
  const isWhite = color === 'w';
  const fill = isWhite ? '#F8FAFC' : '#1E293B';
  const stroke = isWhite ? '#0F172A' : '#94A3B8';
  const innerStroke = isWhite ? '#334155' : '#CBD5E1';

  switch (type) {
    case 'p':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <path
            d="M 22.5,9 C 19.5,9 17,11.5 17,14.5 C 17,16.8 18.4,18.7 20.4,19.5 C 17.5,21 15.5,24 15.5,28 C 15.5,30 16.5,31.5 16.5,31.5 L 12,36 L 33,36 L 28.5,31.5 C 28.5,31.5 29.5,30 29.5,28 C 29.5,24 27.5,21 24.6,19.5 C 26.6,18.7 28,16.8 28,14.5 C 28,11.5 25.5,9 22.5,9 z"
            fill={fill}
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'r':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <g fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z" />
            <path d="M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z" />
            <path d="M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14" />
            <path d="M 34,14 L 31,17 L 14,17 L 11,14" />
            <path d="M 31,17 L 31,29.5 L 14,29.5 L 14,17" />
            <path d="M 14,29.5 L 12,32 L 33,32 L 31,29.5" />
          </g>
        </svg>
      );
    case 'n':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <g fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18" />
            <path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10" />
            <circle cx="15.5" cy="14.5" r="1.2" fill={innerStroke} />
          </g>
        </svg>
      );
    case 'b':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <g fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.646,38.99 6.677,38.97 6,38 C 7.354,36.06 9,36 9,36 z" />
            <path d="M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z" />
            <circle cx="22.5" cy="8" r="2.2" />
            <path d="M 17.5,26 L 27.5,26 M 15,30 L 30,30 M 22.5,15.5 L 22.5,20.5 M 20,18 L 25,18" stroke={innerStroke} strokeWidth="1.6" />
          </g>
        </svg>
      );
    case 'q':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <g fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z" />
            <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" />
            <circle cx="6" cy="12" r="1.8" />
            <circle cx="14" cy="9" r="1.8" />
            <circle cx="22.5" cy="8" r="1.8" />
            <circle cx="31" cy="9" r="1.8" />
            <circle cx="39" cy="12" r="1.8" />
          </g>
        </svg>
      );
    case 'k':
      return (
        <svg viewBox="0 0 45 45" className="w-full h-full drop-shadow-sm select-none pointer-events-none">
          <g fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M 22.5,11.63 L 22.5,6" />
            <path d="M 20,8 L 25,8" />
            <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" />
            <path d="M 11.5,37 C 17,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 11.5,29.5 11.5,29.5 L 11.5,37 z" />
            <path d="M 11.5,30 C 17,27 27,27 32.5,30" stroke={innerStroke} strokeWidth="1.6" />
            <path d="M 11.5,33.5 C 17,30.5 27,30.5 32.5,33.5" stroke={innerStroke} strokeWidth="1.6" />
          </g>
        </svg>
      );
  }
}

function squareCenterPercentage(sq: string, flipped: boolean): [number, number] {
  const f = FILES.indexOf(sq[0]);
  const r = RANKS.indexOf(sq[1]);
  if (f === -1 || r === -1) return [0, 0];
  const col = flipped ? 7 - f : f;
  const row = flipped ? 7 - r : r;
  return [(col + 0.5) * 12.5, (row + 0.5) * 12.5];
}

export const ChessboardRenderer: React.FC<ChessboardRendererProps> = ({
  fen,
  lastMoveUci,
  engineBestUci,
  chosenUci,
  hardConstraints,
  promotionOverride,
  flipped = false,
  interactive = false,
  onUserMove,
}) => {
  const [selectedSquare, setSelectedSquare] = React.useState<string | null>(null);

  const chess = React.useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const board = chess.board();
  const displayRanks = flipped ? [...RANKS].reverse() : RANKS;
  const displayFiles = flipped ? [...FILES].reverse() : FILES;

  const lastFrom = lastMoveUci ? lastMoveUci.slice(0, 2) : null;
  const lastTo = lastMoveUci ? lastMoveUci.slice(2, 4) : null;

  // Identify squares with locked pieces due to hard constraints (for White / Marionette)
  const lockedSquares = React.useMemo(() => {
    const locked = new Map<string, string>();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (!p || p.color !== 'w') continue;
        for (const hc of hardConstraints) {
          if (hc.type === 'never_move_piece' && hc.piece === p.type) {
            locked.set(p.square, `LOCKED (${p.type.toUpperCase()})`);
          }
          if (hc.type === 'never_move_file_pawn' && p.type === 'p' && p.square[0] === hc.file) {
            locked.set(p.square, `LOCKED (${hc.file}-pawn)`);
          }
        }
      }
    }
    return locked;
  }, [board, hardConstraints]);

  const legalDestinations = React.useMemo(() => {
    if (!selectedSquare || !interactive) return new Set<string>();
    try {
      const moves = chess.moves({ square: selectedSquare as Square, verbose: true });
      return new Set(moves.map(m => m.to));
    } catch {
      return new Set<string>();
    }
  }, [chess, selectedSquare, interactive]);

  const handleSquareClick = (sq: string) => {
    if (!interactive || !onUserMove) return;
    if (selectedSquare && legalDestinations.has(sq)) {
      const promo = promotionOverride || 'q';
      onUserMove(selectedSquare, sq, promo);
      setSelectedSquare(null);
      return;
    }
    const piece = chess.get(sq as Square);
    if (piece && piece.color === chess.turn()) {
      setSelectedSquare(sq === selectedSquare ? null : sq);
    } else {
      setSelectedSquare(null);
    }
  };

  const renderVectorArrow = (
    uci: string | undefined,
    colorHex: string,
    dashed: boolean,
    markerId: string
  ) => {
    if (!uci || uci.length < 4) return null;
    const fromSq = uci.slice(0, 2);
    const toSq = uci.slice(2, 4);
    const [x1, y1] = squareCenterPercentage(fromSq, flipped);
    const [x2, y2] = squareCenterPercentage(toSq, flipped);
    if (x1 === x2 && y1 === y2) return null;

    // Shorten arrow tip slightly so arrowhead sits cleanly inside target square
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const shrink = 3.2;
    const tx = len > shrink ? x2 - (dx / len) * shrink : x2;
    const ty = len > shrink ? y2 - (dy / len) * shrink : y2;

    return (
      <g key={`${uci}-${markerId}`}>
        <line
          x1={`${x1}%`}
          y1={`${y1}%`}
          x2={`${tx}%`}
          y2={`${ty}%`}
          stroke={colorHex}
          strokeWidth="2.2%"
          strokeLinecap="round"
          strokeDasharray={dashed ? '3, 2.5' : undefined}
          markerEnd={`url(#${markerId})`}
          opacity={0.88}
        />
      </g>
    );
  };

  return (
    <div
      data-testid="marionette-chessboard"
      className="relative aspect-square w-full max-w-[520px] select-none rounded-lg overflow-hidden border border-slate-700/80 shadow-xl bg-slate-900"
    >
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {displayRanks.map((rank, rIdx) =>
          displayFiles.map((file, fIdx) => {
            const sq = `${file}${rank}` as Square;
            const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
            const piece = chess.get(sq);
            const isLastMove = sq === lastFrom || sq === lastTo;
            const isSelected = sq === selectedSquare;
            const isLegalDest = legalDestinations.has(sq);
            const lockLabel = lockedSquares.get(sq);
            const isKingInCheck =
              piece?.type === 'k' && piece.color === chess.turn() && chess.inCheck();

            let bgClass = isLight ? 'bg-[#CBD5E1]' : 'bg-[#475569]';
            if (isLastMove) {
              bgClass = isLight ? 'bg-[#FDE68A]' : 'bg-[#B45309]/80';
            }
            if (isSelected) {
              bgClass = 'bg-amber-400/90';
            }
            if (isKingInCheck) {
              bgClass = 'bg-rose-600/90';
            }

            return (
              <button
                key={sq}
                type="button"
                aria-label={`Square ${sq}${piece ? ` with ${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}` : ''}${lockLabel ? ` (${lockLabel})` : ''}`}
                onClick={() => handleSquareClick(sq)}
                className={`relative flex items-center justify-center p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${bgClass}`}
              >
                {/* Rank coordinate on left file */}
                {fIdx === 0 && (
                  <span
                    className={`absolute top-0.5 left-1 text-[10px] font-mono font-semibold leading-none ${
                      isLight ? 'text-slate-700' : 'text-slate-200'
                    }`}
                  >
                    {rank}
                  </span>
                )}

                {/* File coordinate on bottom rank */}
                {rIdx === 7 && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[10px] font-mono font-semibold leading-none ${
                      isLight ? 'text-slate-700' : 'text-slate-200'
                    }`}
                  >
                    {file}
                  </span>
                )}

                {/* Hard constraint lock indicator */}
                {lockLabel && (
                  <span
                    title={lockLabel}
                    className="absolute top-0.5 right-0.5 z-10 px-1 py-0.2 bg-rose-950/90 text-rose-200 border border-rose-500/50 rounded text-[8px] font-mono tracking-tighter leading-tight"
                  >
                    LOCK
                  </span>
                )}

                {/* Piece SVG */}
                {piece && (
                  <div className="w-[84%] h-[84%] z-[2]">
                    <PieceSvg type={piece.type} color={piece.color} />
                  </div>
                )}

                {/* Legal destination dot */}
                {isLegalDest && (
                  <span className="absolute w-3 h-3 rounded-full bg-emerald-500/80 ring-2 ring-slate-950/40 z-10" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Vector Arrows Overlay for Stockfish Top Choice vs Marionette Steered Choice */}
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      >
        <defs>
          <marker
            id="arrow-engine"
            markerWidth="3.5"
            markerHeight="3.5"
            refX="2.1"
            refY="1.75"
            orient="auto"
          >
            <polygon points="0 0, 3.5 1.75, 0 3.5" fill="#94A3B8" />
          </marker>
          <marker
            id="arrow-marionette"
            markerWidth="3.8"
            markerHeight="3.8"
            refX="2.2"
            refY="1.9"
            orient="auto"
          >
            <polygon points="0 0, 3.8 1.9, 0 3.8" fill="#F59E0B" />
          </marker>
        </defs>
        {engineBestUci &&
          engineBestUci !== chosenUci &&
          renderVectorArrow(engineBestUci, '#94A3B8', true, 'arrow-engine')}
        {chosenUci && renderVectorArrow(chosenUci, '#F59E0B', false, 'arrow-marionette')}
      </svg>
    </div>
  );
};
