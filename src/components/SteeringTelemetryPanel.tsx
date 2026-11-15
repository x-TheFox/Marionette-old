import React from 'react';
import { MarionettePlan } from '../marionette/dsl';
import { SteeringDecision } from '../marionette/steerer';
import { computeFeatureValue } from '../marionette/features';

interface SteeringTelemetryPanelProps {
  fen: string;
  plan: MarionettePlan;
  decision?: SteeringDecision;
  promotedKnightsCount: number;
  queenMovesCount: number;
}

function formatCp(cp: number): string {
  if (cp >= 9000) return `+M${Math.max(1, Math.round((10000 - cp) / 10))}`;
  if (cp <= -9000) return `-M${Math.max(1, Math.round((10000 + cp) / 10))}`;
  const sign = cp > 0 ? '+' : '';
  return `${sign}${(cp / 100).toFixed(2)}`;
}

export const SteeringTelemetryPanel: React.FC<SteeringTelemetryPanelProps> = ({
  fen,
  plan,
  decision,
  promotedKnightsCount,
  queenMovesCount,
}) => {
  const activePhase = decision?.activePhase ?? plan.phases[0];
  const candidates = decision?.candidates ?? [];
  const chosenMove = decision?.chosenMove;
  const bestEngine = decision?.bestEngineMove;

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Objective Priority & Phase Stepper */}
      <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Active Objective Plan · {plan.name}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{plan.summary}</p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
            Floor: {formatCp(activePhase.evalFloorCp ?? plan.evalFloorCp)} · Max Drop:{' '}
            {((activePhase.maxEvalDropCp ?? plan.maxEvalDropCp) / 100).toFixed(2)}
          </div>
        </div>

        {/* Phase Pipeline */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {plan.phases.map((phase, idx) => {
            const isActive = phase.id === activePhase.id;
            return (
              <div
                key={phase.id}
                className={`p-2.5 rounded border text-left transition-colors ${
                  isActive
                    ? 'border-amber-500/70 bg-amber-950/25 text-slate-100'
                    : 'border-slate-800/80 bg-slate-950/40 text-slate-400'
                }`}
              >
                <div className="text-[11px] font-mono tabular-nums text-amber-400/90">
                  0{idx + 1}. {isActive ? 'ACTIVE PHASE' : 'STAGE'}
                </div>
                <div className="text-xs font-semibold mt-0.5 truncate">{phase.name}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                  {phase.description}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hard Constraints & Promotion Override Row */}
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
          <span className="font-medium text-slate-400">Hard Invariants:</span>
          {plan.hardConstraints.length === 0 ? (
            <span className="font-mono text-slate-400">None (Unrestricted Chess Rules)</span>
          ) : (
            plan.hardConstraints.map((hc, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden="true" className="text-slate-600">·</span>}
                <span className="font-mono text-amber-300">
                  {hc.type}
                  {'piece' in hc ? `(${hc.piece.toUpperCase()})` : ''}
                  {'file' in hc ? `(${hc.file}-file)` : ''}
                  {'count' in hc ? `(${hc.count})` : ''}
                </span>
              </React.Fragment>
            ))
          )}
          {plan.promotionOverride && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono text-emerald-400">
                promotionOverride → {plan.promotionOverride.toUpperCase()}
              </span>
            </>
          )}
          {plan.terminal.checkmateWithPiece && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono text-sky-400">
                terminalMate → {plan.terminal.checkmateWithPiece.toUpperCase()}#
              </span>
            </>
          )}
        </div>

        {/* Live Feature Priorities Bar Breakdown */}
        <div className="mt-3 pt-3 border-t border-slate-800/80">
          <div className="text-xs font-medium text-slate-300 mb-2">
            Prioritized Steering Features (Current Position Breakdown)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {activePhase.features.map((wf, idx) => {
              const breakdownItem = chosenMove?.featureBreakdown.find(
                b => b.feature === wf.feature
              );
              const rawVal =
                breakdownItem?.rawValue ??
                computeFeatureValue(fen, wf.feature, {
                  color: 'w',
                  promotedKnightsCount,
                  queenMovesCount,
                });
              const contrib = breakdownItem?.contributionCp ?? Math.round(rawVal * wf.weight);
              const barPct = Math.min(100, Math.max(8, Math.abs(contrib) / 6));

              return (
                <div
                  key={`${wf.feature}-${idx}`}
                  className="bg-slate-950/60 border border-slate-800/80 rounded p-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <span className="text-slate-200 font-medium break-all">{wf.feature}</span>
                    <span className="text-amber-400 shrink-0">
                      {rawVal} × {wf.weight} = {contrib >= 0 ? `+${contrib}` : contrib}cp
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-transform duration-150 origin-left"
                      style={{ transform: `scaleX(${barPct / 100})` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. Stockfish Multi-PV vs Marionette Steering Matrix */}
      <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Stockfish Multi-PV vs. Marionette Steering Matrix
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {decision
                ? decision.reasoning
                : 'Step forward or press Play to inspect real-time Multi-PV candidate evaluations.'}
            </p>
          </div>
          {bestEngine && chosenMove && (
            <div className="text-xs font-mono tabular-nums text-slate-300 shrink-0">
              SF Best: <span className="text-slate-100">{bestEngine.san}</span> (
              {formatCp(bestEngine.cp)}) · Chosen:{' '}
              <span className="text-amber-400 font-semibold">{chosenMove.san}</span>
            </div>
          )}
        </div>

        {candidates.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No move telemetry at starting ply 0. Use the playback controls or click &ldquo;Step Forward&rdquo; to inspect Stockfish Multi-PV candidate scoring.
          </div>
        ) : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">Move</th>
                  <th className="py-2 px-3 font-medium text-right">Stockfish Eval</th>
                  <th className="py-2 px-3 font-medium text-right">Plan Bonus</th>
                  <th className="py-2 px-3 font-medium text-right">Composite</th>
                  <th className="py-2 pl-3 font-medium">Constraint &amp; Guardrail State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {candidates.slice(0, 8).map(cand => {
                  const isChosen = chosenMove?.uci === cand.uci;
                  const isSfBest = bestEngine?.uci === cand.uci;

                  let stateText = 'Compliant · Within Eval Floor';
                  let stateColor = 'text-emerald-400';
                  if (!cand.allowedByHardConstraints) {
                    stateText = `Blocked · Violates ${cand.violatedConstraint}`;
                    stateColor = 'text-rose-400';
                  } else if (cand.deliversTargetCheckmate) {
                    stateText = 'Target Checkmate Achieved';
                    stateColor = 'text-amber-300 font-semibold';
                  } else if (!cand.withinEvalGuardrail) {
                    stateText = 'Filtered · Below Eval Guardrail';
                    stateColor = 'text-slate-400';
                  } else if (cand.isSacrificeMove) {
                    stateText = 'Compliant · Tactical Piece Sacrifice';
                    stateColor = 'text-amber-400';
                  }

                  return (
                    <tr
                      key={cand.uci}
                      className={
                        isChosen
                          ? 'bg-amber-500/10 text-slate-100'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }
                    >
                      <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                        {cand.san}{' '}
                        <span className="text-slate-500 font-normal">({cand.uci})</span>
                        {isChosen && (
                          <span className="ml-2 text-[10px] text-amber-400 font-semibold">
                            ← STEERED
                          </span>
                        )}
                        {!isChosen && isSfBest && (
                          <span className="ml-2 text-[10px] text-slate-400 font-normal">
                            [SF #1]
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">{formatCp(cand.cp)}</td>
                      <td className="py-2 px-3 text-right text-amber-400">
                        {cand.featureBonusCp >= 0
                          ? `+${(cand.featureBonusCp / 100).toFixed(2)}`
                          : (cand.featureBonusCp / 100).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">
                        {(cand.compositeScoreCp / 100).toFixed(2)}
                      </td>
                      <td className={`py-2 pl-3 ${stateColor}`}>{stateText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
