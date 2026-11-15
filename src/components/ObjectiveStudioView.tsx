import React from 'react';
import { MarionettePlan, validatePlan } from '../marionette/dsl';
import { FixtureGoal } from '../marionette/compiler';

interface ObjectiveStudioViewProps {
  fixtures: FixtureGoal[];
  models: string[];
  currentPlan: MarionettePlan;
  lastModelUsed: string;
  cycledModels: string[];
  onPlanSelected: (plan: MarionettePlan, modelUsed?: string, cycled?: string[]) => void;
  onLaunchInVisualizer: (plan: MarionettePlan) => void;
}

const NOVEL_OBJECTIVE_SUGGESTIONS = [
  'Never castle, march the king up the board, and deliver checkmate with a knight',
  'Win without ever moving the rook and deliver checkmate with a bishop',
  'Occupy d4, e4, d5, e5 with pieces, never move the a-pawn, and win',
  'Promote only to knights, never capture with a queen, and win',
  'Control the a and h files, promote only to rooks, and checkmate with a rook',
];

export const ObjectiveStudioView: React.FC<ObjectiveStudioViewProps> = ({
  fixtures,
  models,
  currentPlan,
  lastModelUsed,
  cycledModels,
  onPlanSelected,
  onLaunchInVisualizer,
}) => {
  const [goalInput, setGoalInput] = React.useState(currentPlan.rawGoal);
  const [preferredModel, setPreferredModel] = React.useState<string>('gemini-4-hydrogen');
  const [isCompiling, setIsCompiling] = React.useState(false);
  const [compileError, setCompileError] = React.useState<string | null>(null);
  const [jsonEditorText, setJsonEditorText] = React.useState(() =>
    JSON.stringify(currentPlan, null, 2)
  );
  const [validationStatus, setValidationStatus] = React.useState<{
    valid: boolean;
    errors?: string[];
  }>({ valid: true });

  React.useEffect(() => {
    setGoalInput(currentPlan.rawGoal);
    setJsonEditorText(JSON.stringify(currentPlan, null, 2));
    setValidationStatus({ valid: true });
  }, [currentPlan]);

  const handleCompileWithLLM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalInput.trim()) {
      setCompileError('Please enter a natural-language chess objective.');
      return;
    }
    setCompileError(null);
    setIsCompiling(true);
    try {
      const res = await fetch('/api/marionette/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goalInput.trim(),
          preferredModel,
          mock: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Compilation failed');
      }
      onPlanSelected(data.plan, data.modelUsed, data.cycledModels);
    } catch (err: any) {
      setCompileError(err.message || 'Failed to compile objective');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleJsonChange = (text: string) => {
    setJsonEditorText(text);
    try {
      const parsed = JSON.parse(text);
      const v = validatePlan(parsed);
      setValidationStatus(v);
      if (v.valid && v.data) {
        onPlanSelected(v.data, 'manual-dsl-edit', ['manual-dsl-edit']);
      }
    } catch (err: any) {
      setValidationStatus({
        valid: false,
        errors: [`Invalid JSON syntax: ${err.message}`],
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Natural Language Compiler & 10 Fixture Goals */}
      <div className="lg:col-span-6 flex flex-col gap-6">
        <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-5">
          <h2 className="text-base font-semibold text-slate-100">
            01. Natural-Language Objective Compiler (Multi-Model Gemini Cycling)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Write any custom chess objective—even rules not in the preset fixtures. The compiler cycles across Gemini models (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`, `gemini-4-argon`, `gemini-4-carbon`) and validates the resulting DSL plan.
          </p>

          <form onSubmit={handleCompileWithLLM} className="mt-4 flex flex-col gap-3">
            <div>
              <label
                htmlFor="natural-language-goal-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Natural-Language Chess Objective
              </label>
              <textarea
                id="natural-language-goal-input"
                rows={3}
                value={goalInput}
                onChange={e => setGoalInput(e.target.value)}
                placeholder="e.g. Win by giving up every piece except pawns, promote all of them to knights, then checkmate with a knight"
                className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="preferred-model-select" className="text-xs text-slate-400">
                  Primary Model:
                </label>
                <select
                  id="preferred-model-select"
                  value={preferredModel}
                  onChange={e => setPreferredModel(e.target.value)}
                  className="rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  {(models.length > 0
                    ? models
                    : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-4-argon', 'gemini-4-carbon']
                  ).map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isCompiling}
                  className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isCompiling ? 'Compiling via Gemini...' : 'Compile Objective to DSL'}
                </button>
                <button
                  type="button"
                  onClick={() => onLaunchInVisualizer(currentPlan)}
                  className="px-4 py-2 text-xs font-semibold bg-slate-800 text-slate-100 border border-slate-700 rounded-md hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  Watch in Live Arena
                </button>
              </div>
            </div>

            {compileError && (
              <div className="text-xs text-rose-400 font-mono mt-1">{compileError}</div>
            )}

            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
              <span>Active Compiler: {lastModelUsed}</span>
              <span aria-hidden="true">·</span>
              <span>Model Cycle Chain: {cycledModels.join(' → ')}</span>
            </div>
          </form>

          {/* Out-of-Distribution Prompts */}
          <div className="mt-4 pt-3 border-t border-slate-800">
            <div className="text-xs font-medium text-slate-300 mb-2">
              Try Out-of-Distribution / Creative Objectives:
            </div>
            <div className="flex flex-col gap-1.5">
              {NOVEL_OBJECTIVE_SUGGESTIONS.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setGoalInput(prompt)}
                  className="text-left text-xs text-slate-300 hover:text-amber-400 bg-slate-950/50 hover:bg-slate-950 border border-slate-800/80 rounded px-2.5 py-1.5 transition-colors truncate"
                >
                  &ldquo;{prompt}&rdquo;
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 10 Fixture Goals Library */}
        <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-100">
            02. Benchmark Fixture Library (10 Validated Objectives)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Click any of the 10 fixture objectives to inspect its compiled DSL specification or load it into the real-time Stockfish visualizer.
          </p>

          <div className="mt-3 divide-y divide-slate-800/70 border border-slate-800 rounded-md overflow-hidden">
            {fixtures.map((fx, i) => {
              const isSelected = currentPlan.id === fx.expectedPlan.id;
              return (
                <div
                  key={fx.id}
                  className={`p-3 flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-amber-500/10' : 'bg-slate-950/40 hover:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span>#{i + 1}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-400">{fx.difficulty}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-200 font-sans font-semibold truncate">
                        {fx.expectedPlan.name}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5 truncate">
                      &ldquo;{fx.goal}&rdquo;
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onPlanSelected(fx.expectedPlan, 'fixture-preset', ['fixture-preset'])
                      }
                      className="px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-200 rounded hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      Inspect DSL
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onPlanSelected(fx.expectedPlan, 'fixture-preset', ['fixture-preset']);
                        onLaunchInVisualizer(fx.expectedPlan);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded hover:bg-amber-500/30 transition-colors whitespace-nowrap shrink-0"
                    >
                      Load &amp; Watch
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Right Column: Live DSL Schema Validator & Interactive JSON Editor */}
      <div className="lg:col-span-6 flex flex-col gap-6">
        <section className="border border-slate-800 bg-slate-900/70 rounded-lg p-5">
          <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                03. Structured MarionettePlan DSL Inspector &amp; Validator
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Edit weights, phases, hard constraints, or `evalFloorCp` directly. The Zod schema + semantic validator checks contradictions in real time.
              </p>
            </div>
            <div
              className={`text-xs font-mono shrink-0 ${
                validationStatus.valid ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {validationStatus.valid ? 'VALID DSL SPEC' : 'INVALID SPEC'}
            </div>
          </div>

          {!validationStatus.valid && validationStatus.errors && (
            <div className="mt-3 p-3 rounded bg-rose-950/50 border border-rose-500/40 text-xs font-mono text-rose-200">
              <div className="font-semibold mb-1">DSL Validation Errors:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {validationStatus.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <label htmlFor="dsl-json-editor" className="sr-only">
              MarionettePlan DSL JSON Editor
            </label>
            <textarea
              id="dsl-json-editor"
              rows={26}
              value={jsonEditorText}
              onChange={e => handleJsonChange(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500 leading-relaxed"
            />
          </div>
        </section>
      </div>
    </div>
  );
};
