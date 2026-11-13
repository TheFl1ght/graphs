import { Parser } from '../math/parser';
import { Scope, isMatrix, is2DVector } from '../math/scope';
import { JITCompiler, CompiledFunction } from '../math/compiler-jit';
import { ASTNode, isNumericConstantNode } from '../math/ast';
import { GraphItem, LineStyle } from '../render/graph-renderer';
import { latexToMath } from '../math/latex-to-math';
import { RegressionType, computeRegression } from '../math/regression';

export interface TableColumn {
  id: string;
  name: string; // e.g. 'x_1', 'y_1', 'y_2', 'x_1^2', 'f(x_1)'
  color?: string;
  isFormula?: boolean;
  isErrorActive?: boolean;     // whether this column is active as an error column
  errorTargetColId?: string;   // the id of the base column (e.g. x_1) this column is error for
}

export interface TableRegression {
  id: string;
  type: RegressionType;
  polyDegree?: number;     // for polynomial (1 to 6, default 2)
  customFormula?: string;   // for custom regression (e.g. "a \sin(x) + b")
  xColIdx: number;         // Index of column for X
  yColIdx: number;         // Index of column for Y
  color: string;
  visible: boolean;
  lineStyle: LineStyle;
  rSquared?: number;
  equationLatex?: string;
  error?: string;
  fn?: (x: number) => number;
  params?: Record<string, number>;
  showKMinMax?: boolean;   // whether to compute and show k_min and k_max dashed lines
  kMin?: number;
  kMax?: number;
  bMin?: number;
  bMax?: number;
  deltaK?: number;
}

export function extractBaseVarFromDelta(name: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  // Strip formatting wrappers like \mathrm{}, \text{}
  const unstyled = trimmed
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\text\{([^}]+)\}/g, '$1');

  // Match prefix: \Delta, \delta, Delta, delta, Δ, optionally followed by _ or space
  const prefixMatch = unstyled.match(/^(?:\\Delta|\\delta|Delta|delta|Δ)[_]?\s*(.+)$/i);
  if (!prefixMatch) return null;

  let rest = prefixMatch[1].trim();
  // If wrapped in braces or parens: e.g. {p^2} or (p^2) or {x_1}
  if ((rest.startsWith('(') && rest.endsWith(')')) || (rest.startsWith('{') && rest.endsWith('}'))) {
    rest = rest.slice(1, -1).trim();
  }
  // Normalize internal braces around subscripts and superscripts: e.g. p^{2} -> p^2, x_{1} -> x_1
  const cleanRest = rest
    .replace(/_\{([a-zA-Z0-9]+)\}/g, '_$1')
    .replace(/\^\{([a-zA-Z0-9]+)\}/g, '^$1');

  if (cleanRest) {
    return cleanRest;
  }
  return null;
}

export function findMatchingBaseColumn(deltaColName: string, allCols: TableColumn[]): TableColumn | null {
  const baseVar = extractBaseVarFromDelta(deltaColName);
  if (!baseVar) return null;

  const normalize = (s: string) => s
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .toLowerCase();

  const normBase = normalize(baseVar);

  for (const c of allCols) {
    const normC = normalize(c.name);
    if (normC === normBase) return c;
    if (normC.replace(/_/g, '') === normBase.replace(/_/g, '')) return c;
  }
  return null;
}

export interface SimulationData {
  eqX: string;                 // dx/dt equation, e.g. "\sigma (y - x)"
  eqY: string;                 // dy/dt equation, e.g. "x (\rho - z) - y"
  eqZ?: string;                // dz/dt equation, e.g. "x y - \beta z"
  hasZ: boolean;               // 2D or 3D system
  x0: number;                  // initial condition x0
  y0: number;                  // initial condition y0
  z0: number;                  // initial condition z0
  currentX: number;
  currentY: number;
  currentZ: number;
  currentT: number;
  dt: number;                  // integration step (e.g. 0.01)
  stepsPerFrame: number;       // micro-steps per frame (e.g. 8)
  maxTrailLength: number;      // max points in buffer (e.g. 2500)
  isPlaying: boolean;          // running or paused
  projection: 'xy' | 'xz' | 'yz';
  pointsBuffer: { x: number; y: number; z?: number; t: number }[];
  compiledFnX?: (x: number, y: number, z: number, t: number) => number;
  compiledFnY?: (x: number, y: number, z: number, t: number) => number;
  compiledFnZ?: (x: number, y: number, z: number, t: number) => number;
}

export interface ExpressionEntry {
  id: string;
  rawText: string;     // LaTeX or raw math input
  mathText?: string;    // Transpiled to standard math
  color: string;
  visible?: boolean;
  lineStyle?: LineStyle;
  ast?: ASTNode;
  kind: 'expression' | 'table' | 'simulation';
  type: 'variable' | 'function' | 'graph' | 'evaluation' | 'matrix' | 'vector' | 'simulation' | 'invalid';
  varName?: string;
  fnName?: string;
  value?: number;
  matrixData?: number[][];
  vector?: { x: number; y: number };
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  isAnimating?: boolean;
  animationMode?: 'oscillate' | 'loop' | 'once' | 'forward';
  animationSpeed?: number; // steps per second
  animationDirection?: 1 | -1;
  animStepAccumulator?: number;
  layer?: number;
  compiledFn?: CompiledFunction;
  simulationData?: SimulationData;
  tableColumns?: TableColumn[];
  tableRows?: string[][];
  regressions?: TableRegression[];
  regressionsCollapsed?: boolean;
  missingParams?: string[]; // Undefined variables detected in expression (for slider prompt)
  graphOrientation?: 'y-of-x' | 'x-of-y';
  error?: string;
}

export interface HistorySnapshot {
  entries: {
    id: string;
    rawText: string;
    color: string;
    visible?: boolean;
    lineStyle?: LineStyle;
    kind: 'expression' | 'table' | 'simulation';
    sliderMin?: number;
    sliderMax?: number;
    sliderStep?: number;
    animationMode?: 'oscillate' | 'loop' | 'once' | 'forward';
    animationSpeed?: number;
    layer?: number;
    simulationData?: SimulationData;
    tableColumns?: TableColumn[];
    tableRows?: string[][];
    regressions?: TableRegression[];
    regressionsCollapsed?: boolean;
  }[];
}

export class ExpressionManager {
  public scope: Scope;
  public entries: ExpressionEntry[] = [];
  public onUpdate?: () => void;
  public colorPalette: string[] = [
    '#2d70b3', // Desmos Blue
    '#c74440', // Desmos Red
    '#388c46', // Desmos Green
    '#6042a6', // Desmos Purple
    '#fa7e19', // Desmos Orange
    '#000000'
  ];
  private colorIdx: number = 0;

  constructor() {
    this.scope = new Scope();
  }

  public addExpression(rawText: string = '', kind: 'expression' | 'table' = 'expression'): ExpressionEntry {
    const tableCount = this.entries.filter(e => e.kind === 'table').length;
    const tableNum = tableCount + 1;
    const color = this.colorPalette[this.colorIdx % this.colorPalette.length];

    const entry: ExpressionEntry = {
      id: `expr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      rawText,
      color,
      visible: true,
      lineStyle: 'solid',
      kind,
      type: kind === 'table' ? 'graph' : 'invalid',
      tableColumns: kind === 'table' ? [
        { id: `c_${Date.now()}_0`, name: `x_{${tableNum}}` },
        { id: `c_${Date.now()}_1`, name: `y_{${tableNum}}`, color }
      ] : undefined,
      tableRows: kind === 'table' ? [
        ['', '']
      ] : undefined
    };
    this.colorIdx++;
    this.entries.push(entry);
    this.recompileAll();
    return entry;
  }

  public updateExpression(id: string, newRawText: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.rawText = newRawText;
    this.recompileAll();
  }

  public updateTable(id: string, rows: string[][], columns?: TableColumn[]): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.tableRows = rows;
    if (columns) {
      entry.tableColumns = columns;
    }
    this.evaluateTable(entry);
    this.recompileAll();
  }

  public createSnapshot(): HistorySnapshot {
    return {
      entries: this.entries.map(e => ({
        id: e.id,
        rawText: e.rawText,
        color: e.color,
        visible: e.visible !== false,
        lineStyle: e.lineStyle || 'solid',
        kind: e.kind,
        sliderMin: e.sliderMin,
        sliderMax: e.sliderMax,
        sliderStep: e.sliderStep,
        animationMode: e.animationMode,
        animationSpeed: e.animationSpeed,
        layer: e.layer,
        simulationData: e.simulationData ? JSON.parse(JSON.stringify(e.simulationData)) : undefined,
        tableColumns: e.tableColumns ? JSON.parse(JSON.stringify(e.tableColumns)) : undefined,
        tableRows: e.tableRows ? JSON.parse(JSON.stringify(e.tableRows)) : undefined,
        regressions: e.regressions ? JSON.parse(JSON.stringify(e.regressions.map(r => ({
          id: r.id,
          type: r.type,
          polyDegree: r.polyDegree,
          customFormula: r.customFormula,
          xColIdx: r.xColIdx,
          yColIdx: r.yColIdx,
          color: r.color,
          visible: r.visible !== false,
          lineStyle: r.lineStyle || 'solid',
          rSquared: r.rSquared,
          equationLatex: r.equationLatex,
          error: r.error,
          showKMinMax: r.showKMinMax,
          kMin: r.kMin,
          kMax: r.kMax,
          bMin: r.bMin,
          bMax: r.bMax,
          deltaK: r.deltaK
        })))) : undefined,
        regressionsCollapsed: e.regressionsCollapsed
      }))
    };
  }

  public restoreSnapshot(snapshot: HistorySnapshot): void {
    this.entries = snapshot.entries.map(s => {
      const entry: ExpressionEntry = {
        id: s.id,
        rawText: s.rawText,
        color: s.color,
        visible: s.visible !== false,
        lineStyle: s.lineStyle || 'solid',
        kind: s.kind,
        type: s.kind === 'table' ? 'graph' : s.kind === 'simulation' ? 'simulation' : 'invalid',
        sliderMin: s.sliderMin,
        sliderMax: s.sliderMax,
        sliderStep: s.sliderStep,
        animationMode: s.animationMode,
        animationSpeed: s.animationSpeed,
        layer: s.layer,
        simulationData: s.simulationData ? JSON.parse(JSON.stringify(s.simulationData)) : undefined,
        tableColumns: s.tableColumns ? JSON.parse(JSON.stringify(s.tableColumns)) : undefined,
        tableRows: s.tableRows ? JSON.parse(JSON.stringify(s.tableRows)) : undefined,
        regressions: s.regressions ? JSON.parse(JSON.stringify(s.regressions)) : undefined,
        regressionsCollapsed: s.regressionsCollapsed
      };
      return entry;
    });

    for (const entry of this.entries) {
      if (entry.kind === 'table') {
        this.evaluateTable(entry);
      }
    }
    this.recompileAll();
  }

  public parseColumnHeader(raw: string): { varName: string; formula?: string; hasExplicitAssignment?: boolean } {
    const trimmed = (raw || '').trim();
    if (!trimmed) return { varName: '' };

    // 1. Explicit assignment: e.g. "y_2 = x_1^2" or "y_1 = 2x_1"
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const left = trimmed.slice(0, eqIdx).trim().replace(/[{}]/g, '');
      const right = trimmed.slice(eqIdx + 1).trim();
      return { varName: left || 'y', formula: right, hasExplicitAssignment: true };
    }

    // 2. Check if this is an error column (e.g. \Delta x_1, Deltax1, Δy_1, Deltap^2)
    if (extractBaseVarFromDelta(trimmed)) {
      return { varName: trimmed };
    }

    // 3. Normalize simple identifier: e.g. "x_{1}" -> "x_1", "y_{2}" -> "y_2"
    const clean = trimmed
      .replace(/\\mathrm\{([^}]+)\}/g, '$1')
      .replace(/\\text\{([^}]+)\}/g, '$1')
      .replace(/([a-zA-Z])_\{([a-zA-Z0-9]+)\}/g, '$1_$2');

    // If clean is a single identifier like "x_1", "y_1", "x1", "t", "z"
    if (/^(?:\\[a-zA-Z]+|[a-zA-Zα-ωΑ-Ω])[a-zA-Z0-9α-ωΑ-Ω]*(?:_[a-zA-Z0-9]+)?$/.test(clean)) {
      return { varName: clean };
    }

    // Otherwise, it's an expression/formula: e.g. "x_1^2", "p^2", "f(x_1)", "\sin(x_1)", "2x_1", "x_1 + y_1"
    return { varName: clean, formula: trimmed, hasExplicitAssignment: false };
  }

  public evaluateTable(
    entry: ExpressionEntry,
    externalVars?: Map<string, { tableId: string; colIdx: number; entry: ExpressionEntry }>
  ): void {
    if (entry.kind !== 'table' || !entry.tableColumns || !entry.tableRows) return;
    const cols = entry.tableColumns;
    const rows = entry.tableRows;

    // Collect available variables up to this point:
    // If externalVars was not provided, collect from all preceding tables
    const availableVars = new Map<string, { tableId: string; colIdx: number; entry: ExpressionEntry }>();

    if (externalVars) {
      for (const [k, v] of externalVars.entries()) {
        availableVars.set(k, v);
      }
    } else {
      for (const other of this.entries) {
        if (other.id === entry.id) break;
        if (other.kind === 'table' && other.tableColumns) {
          other.tableColumns.forEach((oc, oIdx) => {
            const parsed = this.parseColumnHeader(oc.name);
            if (parsed.varName) {
              availableVars.set(parsed.varName, { tableId: other.id, colIdx: oIdx, entry: other });
            }
          });
        }
      }
    }

    for (let cIdx = 0; cIdx < cols.length; cIdx++) {
      const col = cols[cIdx];
      const parsed = this.parseColumnHeader(col.name);

      if (parsed.formula) {
        try {
          const mathText = latexToMath(parsed.formula);
          const ast = Parser.parse(mathText);

          // Find which variables from availableVars (or earlier columns in current table) are referenced
          const referencedVars: {
            name: string;
            isLocal: boolean;
            colIdx: number;
            sourceEntry: ExpressionEntry;
          }[] = [];

          for (const [vName, info] of availableVars.entries()) {
            if (this.hasFreeVariable(ast, vName)) {
              referencedVars.push({
                name: vName,
                isLocal: info.tableId === entry.id,
                colIdx: info.colIdx,
                sourceEntry: info.entry
              });
            }
          }

          // Also check aliases: e.g. if a table column is 'x_1', also allow referencing 'x'
          for (const [vName, info] of availableVars.entries()) {
            if (vName.includes('_')) {
              const baseVar = vName.split('_')[0];
              if (baseVar && !availableVars.has(baseVar) && this.hasFreeVariable(ast, baseVar)) {
                referencedVars.push({
                  name: baseVar,
                  isLocal: info.tableId === entry.id,
                  colIdx: info.colIdx,
                  sourceEntry: info.entry
                });
              }
            }
          }

          // If formula has explicit '=' OR references at least one available variable, it is computed!
          if (parsed.hasExplicitAssignment || referencedVars.length > 0) {
            col.isFormula = true;
            const paramNames = referencedVars.map(v => v.name);
            const compiled = JITCompiler.compile(ast, paramNames, this.scope);

            // If formula references external tables with more rows than current table, expand current rows
            let maxRows = rows.length;
            for (const rv of referencedVars) {
              if (!rv.isLocal && rv.sourceEntry.tableRows) {
                maxRows = Math.max(maxRows, rv.sourceEntry.tableRows.length);
              }
            }
            while (rows.length < maxRows) {
              rows.push(cols.map(() => ''));
            }

            // Evaluate each row
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r];
              while (row.length <= cIdx) row.push('');

              let canEval = true;
              const args: number[] = [];
              for (const rv of referencedVars) {
                let valStr = '';
                if (rv.isLocal) {
                  valStr = rows[r]?.[rv.colIdx] || '';
                } else if (rv.sourceEntry.tableRows) {
                  valStr = rv.sourceEntry.tableRows[r]?.[rv.colIdx] || '';
                }

                if (!valStr || valStr.trim() === '') {
                  canEval = false;
                  break;
                }
                const num = parseFloat(valStr);
                if (!Number.isFinite(num)) {
                  canEval = false;
                  break;
                }
                args.push(num);
              }

              if (canEval && (paramNames.length > 0 || referencedVars.length === 0)) {
                try {
                  const res = compiled(...args);
                  if (typeof res === 'number' && Number.isFinite(res)) {
                    row[cIdx] = this.formatCalculatedNumber(res);
                  } else {
                    row[cIdx] = '';
                  }
                } catch (_) {
                  row[cIdx] = '';
                }
              } else {
                row[cIdx] = '';
              }
            }
          } else {
            // Not an assignment and no referenced variables in scope: treat as user data column
            col.isFormula = false;
          }
        } catch (_) {
          // If formula fails to parse or compile, treat as data column
          col.isFormula = false;
        }
      } else {
        col.isFormula = false;
      }

      if (parsed.varName) {
        availableVars.set(parsed.varName, { tableId: entry.id, colIdx: cIdx, entry });
      }
    }

    // Export current table's columns back to externalVars if provided
    if (externalVars) {
      for (const [k, v] of availableVars.entries()) {
        externalVars.set(k, v);
      }
    }

    // Evaluate regressions for this table
    if (entry.regressions && entry.regressions.length > 0) {
      for (const reg of entry.regressions) {
        // Clamp indices if columns were removed
        if (reg.xColIdx >= cols.length) reg.xColIdx = 0;
        if (reg.yColIdx >= cols.length) reg.yColIdx = Math.min(1, cols.length - 1);

        const xCol = cols[reg.xColIdx];
        const yCol = cols[reg.yColIdx];
        const xLabel = xCol?.name || 'x_1';
        const yLabel = yCol?.name || 'y_1';

        const pts: { x: number; y: number }[] = [];
        if (rows) {
          for (const row of rows) {
            const xStr = row[reg.xColIdx];
            const yStr = row[reg.yColIdx];
            if (xStr !== undefined && yStr !== undefined && xStr.trim() !== '' && yStr.trim() !== '') {
              const xVal = parseFloat(xStr);
              const yVal = parseFloat(yStr);
              if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
                pts.push({ x: xVal, y: yVal });
              }
            }
          }
        }

        const res = computeRegression(pts, reg.type, xLabel, yLabel, {
          polyDegree: reg.polyDegree,
          customFormula: reg.customFormula,
          scope: this.scope
        });
        reg.rSquared = res.rSquared;
        reg.equationLatex = res.equationLatex;
        reg.fn = res.fn;
        reg.params = res.params;
        reg.error = res.error;

        // If linear regression, calculate k_min and k_max when error columns are available
        if (reg.type === 'linear') {
          const xErrCol = cols.find(c => c.isErrorActive && (c.errorTargetColId === xCol.id || findMatchingBaseColumn(c.name, cols)?.id === xCol.id));
          const xErrIdx = xErrCol ? cols.indexOf(xErrCol) : -1;

          const yErrCol = cols.find(c => c.isErrorActive && (c.errorTargetColId === yCol.id || findMatchingBaseColumn(c.name, cols)?.id === yCol.id));
          const yErrIdx = yErrCol ? cols.indexOf(yErrCol) : -1;

          if (xErrIdx !== -1 || yErrIdx !== -1) {
            const ptsWithErrors: { x: number; y: number; dx: number; dy: number }[] = [];
            if (rows) {
              for (const row of rows) {
                const xStr = row[reg.xColIdx];
                const yStr = row[reg.yColIdx];
                if (xStr !== undefined && yStr !== undefined && xStr.trim() !== '' && yStr.trim() !== '') {
                  const xVal = parseFloat(xStr);
                  const yVal = parseFloat(yStr);
                  if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
                    const dx = xErrIdx !== -1 && row[xErrIdx] ? parseFloat(row[xErrIdx]) : 0;
                    const dy = yErrIdx !== -1 && row[yErrIdx] ? parseFloat(row[yErrIdx]) : 0;
                    ptsWithErrors.push({
                      x: xVal,
                      y: yVal,
                      dx: Number.isFinite(dx) && dx > 0 ? dx : 0,
                      dy: Number.isFinite(dy) && dy > 0 ? dy : 0
                    });
                  }
                }
              }
            }

            if (ptsWithErrors.length >= 2) {
              const baseK = typeof res.params?.m === 'number' ? res.params.m : 0;
              const extreme = this.calculateExtremeSlopes(ptsWithErrors, baseK);
              if (extreme) {
                reg.kMin = extreme.kMin;
                reg.kMax = extreme.kMax;
                reg.bMin = extreme.bMin;
                reg.bMax = extreme.bMax;
                reg.deltaK = extreme.deltaK;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Calculates extreme slopes (k_min and k_max) that pass through all error crosses (or boxes),
   * if possible. If no straight line can pass through all crosses simultaneously, falls back
   * to lines that minimize maximum deviation from the crosses.
   */
  private calculateExtremeSlopes(
    pts: Array<{ x: number; y: number; dx: number; dy: number }>,
    baseK: number
  ): { kMin: number; kMax: number; bMin: number; bMax: number; deltaK: number } {
    pts.sort((a, b) => a.x - b.x);

    const evaluateSlopes = (mode: 'cross' | 'box') => {
      const getG = (k: number) => {
        let bLow = -Infinity;
        let bHigh = Infinity;
        for (const p of pts) {
          const delta = mode === 'cross'
            ? Math.max(p.dy, Math.abs(k) * p.dx)
            : (p.dy + Math.abs(k) * p.dx);
          const low = p.y - k * p.x - delta;
          const high = p.y - k * p.x + delta;
          if (low > bLow) bLow = low;
          if (high < bHigh) bHigh = high;
        }
        return { g: bLow - bHigh, bLow, bHigh };
      };

      const p1 = pts[0];
      const pn = pts[pts.length - 1];
      const xSpan = Math.max(1e-6, pn.x - p1.x);
      let ySpan = 0;
      for (const p of pts) {
        ySpan = Math.max(ySpan, Math.abs(p.y - p1.y));
      }
      const maxErr = pts.reduce((acc, p) => Math.max(acc, p.dy, p.dx), 0);
      const kSpan = Math.max(1, Math.abs(baseK) * 2, (ySpan + maxErr * 4) / xSpan);

      const kStart = baseK - kSpan * 3;
      const kEnd = baseK + kSpan * 3;
      const steps = 300;
      const step = (kEnd - kStart) / steps;

      let minG = Infinity;
      let bestK = baseK;

      for (let i = 0; i <= steps; i++) {
        const k = kStart + i * step;
        const { g } = getG(k);
        if (g < minG) {
          minG = g;
          bestK = k;
        }
      }

      let left = bestK - step * 2;
      let right = bestK + step * 2;
      for (let i = 0; i < 30; i++) {
        const m1 = left + (right - left) / 3;
        const m2 = right - (right - left) / 3;
        if (getG(m1).g < getG(m2).g) {
          right = m2;
        } else {
          left = m1;
        }
      }
      bestK = (left + right) / 2;
      minG = getG(bestK).g;

      return { getG, minG, bestK, kStart, kEnd };
    };

    let res = evaluateSlopes('cross');
    let targetG = 0;

    if (res.minG <= 1e-7) {
      targetG = 0;
    } else {
      const boxRes = evaluateSlopes('box');
      if (boxRes.minG <= 1e-7) {
        res = boxRes;
        targetG = 0;
      } else {
        const p1 = pts[0];
        const pn = pts[pts.length - 1];
        const dxDenom = (pn.x - p1.x);
        const heurDeltaK = dxDenom !== 0
          ? (p1.dy + pn.dy + Math.abs(res.bestK) * (p1.dx + pn.dx)) / dxDenom
          : 0.1;
        targetG = res.minG + Math.max(1e-4, heurDeltaK * (pn.x - p1.x) * 0.5);
      }
    }

    let l = res.kStart;
    let r = res.bestK;
    if (res.getG(l).g <= targetG) {
      l = res.bestK - 10 * (res.bestK - res.kStart);
    }
    for (let i = 0; i < 40; i++) {
      const m = (l + r) / 2;
      if (res.getG(m).g <= targetG) {
        r = m;
      } else {
        l = m;
      }
    }
    const kMin = r;

    l = res.bestK;
    let rMax = res.kEnd;
    if (res.getG(rMax).g <= targetG) {
      rMax = res.bestK + 10 * (res.kEnd - res.bestK);
    }
    for (let i = 0; i < 40; i++) {
      const m = (l + rMax) / 2;
      if (res.getG(m).g <= targetG) {
        l = m;
      } else {
        rMax = m;
      }
    }
    const kMax = l;

    const { bLow: bLowMin, bHigh: bHighMin } = res.getG(kMin);
    const bMin = (bLowMin + bHighMin) / 2;

    const { bLow: bLowMax, bHigh: bHighMax } = res.getG(kMax);
    const bMax = (bLowMax + bHighMax) / 2;

    const deltaK = Math.abs(kMax - kMin) / 2;

    return { kMin, kMax, bMin, bMax, deltaK };
  }

  public addTableRegression(
    tableId: string,
    type: RegressionType = 'linear',
    xColIdx: number = 0,
    yColIdx: number = 1,
    polyDegree: number = 2,
    customFormula: string = 'a \\sin(x) + b'
  ): TableRegression | null {
    const entry = this.entries.find(e => e.id === tableId && e.kind === 'table');
    if (!entry) return null;
    if (!entry.regressions) entry.regressions = [];

    const color = this.colorPalette[(this.colorIdx++) % this.colorPalette.length];
    const reg: TableRegression = {
      id: `reg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type,
      polyDegree,
      customFormula,
      xColIdx,
      yColIdx,
      color,
      visible: true,
      lineStyle: 'solid'
    };
    entry.regressions.push(reg);
    entry.regressionsCollapsed = false;
    this.evaluateTable(entry);
    this.onUpdate?.();
    return reg;
  }

  public removeTableRegression(tableId: string, regId: string): void {
    const entry = this.entries.find(e => e.id === tableId && e.kind === 'table');
    if (!entry || !entry.regressions) return;
    entry.regressions = entry.regressions.filter(r => r.id !== regId);
    this.evaluateTable(entry);
    this.onUpdate?.();
  }

  public updateTableRegression(tableId: string, regId: string, updates: Partial<TableRegression>): void {
    const entry = this.entries.find(e => e.id === tableId && e.kind === 'table');
    if (!entry || !entry.regressions) return;
    const reg = entry.regressions.find(r => r.id === regId);
    if (!reg) return;
    Object.assign(reg, updates);
    this.evaluateTable(entry);
    this.onUpdate?.();
  }

  public toggleTableRegressionsCollapsed(tableId: string): boolean {
    const entry = this.entries.find(e => e.id === tableId && e.kind === 'table');
    if (!entry) return false;
    entry.regressionsCollapsed = !entry.regressionsCollapsed;
    return entry.regressionsCollapsed;
  }

  public formatCalculatedNumber(val: number): string {
    if (!Number.isFinite(val)) return '';
    // Round tiny float errors: e.g. 4.999999999999999 -> 5
    const rounded = Math.round(val * 1e10) / 1e10;
    if (Number.isInteger(rounded)) {
      return rounded.toString();
    }
    const fixed = rounded.toFixed(6);
    return parseFloat(fixed).toString();
  }

  public setVariableValue(name: string, value: number): void {
    // 1. Direct update to scope
    this.scope.setConstant(name, value);

    // 2. Update entry definition without overwriting value in next recompile
    for (const entry of this.entries) {
      if (entry.varName === name) {
        entry.value = value;
        entry.rawText = `${name} = ${value}`;
      }
    }

    // 3. Re-evaluate expressions with the new constant
    this.recompileAll();
  }

  public setVariableValueFast(name: string, value: number): void {
    this.scope.setConstant(name, value);
    for (const entry of this.entries) {
      if (entry.type === 'variable' && entry.varName === name) {
        entry.value = value;
      }
    }
  }

  public getActiveParameters(): Record<string, number> {
    return this.scope.getParameters();
  }

  public setActiveParameters(params: Record<string, number>): void {
    this.scope.setParameters(params);
    for (const [k, v] of Object.entries(params)) {
      for (const entry of this.entries) {
        if (entry.type === 'variable' && entry.varName === k) {
          entry.value = v;
        }
      }
    }
  }

  public addSimulation(preset: 'lorenz' | 'vanderpol' | 'lotka' | 'custom' = 'lorenz'): ExpressionEntry {
    const color = this.colorPalette[this.colorIdx % this.colorPalette.length];
    this.colorIdx++;

    let simData: SimulationData;
    if (preset === 'lorenz') {
      simData = {
        eqX: '\\sigma (y - x)',
        eqY: 'x (\\rho - z) - y',
        eqZ: 'x y - \\beta z',
        hasZ: true,
        x0: 0.1,
        y0: 0,
        z0: 0,
        currentX: 0.1,
        currentY: 0,
        currentZ: 0,
        currentT: 0,
        dt: 0.01,
        stepsPerFrame: 8,
        maxTrailLength: 3000,
        isPlaying: true,
        projection: 'xz',
        pointsBuffer: [{ x: 0.1, y: 0, z: 0, t: 0 }]
      };
      if (!this.entries.some(e => e.type === 'variable' && (e.varName === '\\sigma' || e.varName === 'sigma'))) {
        this.addExpression('\\sigma = 10');
      }
      if (!this.entries.some(e => e.type === 'variable' && (e.varName === '\\rho' || e.varName === 'rho'))) {
        this.addExpression('\\rho = 28');
      }
      if (!this.entries.some(e => e.type === 'variable' && (e.varName === '\\beta' || e.varName === 'beta'))) {
        this.addExpression('\\beta = 2.667');
      }
    } else if (preset === 'vanderpol') {
      simData = {
        eqX: 'y',
        eqY: '\\mu (1 - x^2) y - x',
        hasZ: false,
        x0: 1,
        y0: 0,
        z0: 0,
        currentX: 1,
        currentY: 0,
        currentZ: 0,
        currentT: 0,
        dt: 0.02,
        stepsPerFrame: 5,
        maxTrailLength: 2500,
        isPlaying: true,
        projection: 'xy',
        pointsBuffer: [{ x: 1, y: 0, z: 0, t: 0 }]
      };
      if (!this.entries.some(e => e.type === 'variable' && (e.varName === '\\mu' || e.varName === 'mu'))) {
        this.addExpression('\\mu = 1');
      }
    } else if (preset === 'lotka') {
      simData = {
        eqX: 'a x - b x y',
        eqY: 'c x y - d y',
        hasZ: false,
        x0: 10,
        y0: 5,
        z0: 0,
        currentX: 10,
        currentY: 5,
        currentZ: 0,
        currentT: 0,
        dt: 0.01,
        stepsPerFrame: 6,
        maxTrailLength: 2500,
        isPlaying: true,
        projection: 'xy',
        pointsBuffer: [{ x: 10, y: 5, z: 0, t: 0 }]
      };
      if (!this.entries.some(e => e.type === 'variable' && e.varName === 'a')) this.addExpression('a = 1.1');
      if (!this.entries.some(e => e.type === 'variable' && e.varName === 'b')) this.addExpression('b = 0.4');
      if (!this.entries.some(e => e.type === 'variable' && e.varName === 'c')) this.addExpression('c = 0.1');
      if (!this.entries.some(e => e.type === 'variable' && e.varName === 'd')) this.addExpression('d = 0.4');
    } else {
      simData = {
        eqX: 'y',
        eqY: '-x',
        hasZ: false,
        x0: 1,
        y0: 0,
        z0: 0,
        currentX: 1,
        currentY: 0,
        currentZ: 0,
        currentT: 0,
        dt: 0.02,
        stepsPerFrame: 5,
        maxTrailLength: 2000,
        isPlaying: true,
        projection: 'xy',
        pointsBuffer: [{ x: 1, y: 0, z: 0, t: 0 }]
      };
    }

    const entry: ExpressionEntry = {
      id: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      rawText: '',
      color,
      visible: true,
      kind: 'simulation',
      type: 'simulation',
      simulationData: simData
    };

    this.entries.push(entry);
    this.recompileAll();
    return entry;
  }

  public resetSimulation(id: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry || !entry.simulationData) return;
    const sim = entry.simulationData;
    sim.currentX = sim.x0;
    sim.currentY = sim.y0;
    sim.currentZ = sim.hasZ ? sim.z0 : 0;
    sim.currentT = 0;
    sim.pointsBuffer = [{
      x: sim.currentX,
      y: sim.currentY,
      z: sim.currentZ,
      t: sim.currentT
    }];
    this.onUpdate?.();
  }

  public updateSimulationEquations(id: string, eqX: string, eqY: string, eqZ?: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry || !entry.simulationData) return;
    entry.simulationData.eqX = eqX;
    entry.simulationData.eqY = eqY;
    if (eqZ !== undefined) {
      entry.simulationData.eqZ = eqZ;
    }
    this.compileSimulation(entry);
    this.resetSimulation(id);
    this.onUpdate?.();
  }

  public updateSimulationInitials(id: string, x0: number, y0: number, z0?: number): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry || !entry.simulationData) return;
    entry.simulationData.x0 = x0;
    entry.simulationData.y0 = y0;
    if (z0 !== undefined) {
      entry.simulationData.z0 = z0;
    }
    this.resetSimulation(id);
  }

  public removeExpression(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
    this.recompileAll();
  }

  /**
   * Recompiles all expressions in order.
   * If an entry is a variable with an existing value, preserves the value.
   */
  public recompileAll(): void {
    // Preserve existing variable values from sliders
    const currentVarValues = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.type === 'variable' && entry.varName && typeof entry.value === 'number') {
        currentVarValues.set(entry.varName, entry.value);
      }
    }

    // Reset scope with fresh builtins
    this.scope = new Scope();

    // --- PASS 1: Parse ASTs and register all variable and function declarations in scope ---
    for (const entry of this.entries) {
      entry.error = undefined;
      entry.missingParams = undefined;
      entry.graphOrientation = undefined;
      if (entry.type !== 'variable') {
        entry.value = undefined;
      }

      if (entry.kind === 'table') {
        entry.type = 'graph';
        continue;
      }

      if (entry.kind === 'simulation') {
        entry.type = 'simulation';
        continue;
      }

      const raw = entry.rawText.trim();
      if (!raw) {
        entry.type = 'invalid';
        entry.ast = undefined;
        entry.value = undefined;
        entry.compiledFn = undefined;
        entry.varName = undefined;
        entry.fnName = undefined;
        continue;
      }

      try {
        const mathText = latexToMath(raw);
        entry.mathText = mathText;
        const ast = Parser.parse(mathText);
        entry.ast = ast;

        const hasMatrix = /\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}/.test(raw) || /\bmatrix\b/.test(raw) || /\bmatrix\b/.test(mathText);

        if (ast.type === 'VariableDecl') {
          entry.varName = ast.name;

          if (hasMatrix) {
            entry.type = 'matrix';
            entry.value = undefined;
            entry.sliderMin = undefined;
            entry.sliderMax = undefined;
            entry.sliderStep = undefined;
            try {
              const compiled = JITCompiler.compile(ast.value, [], this.scope);
              const val = compiled();
              this.scope.setConstant(ast.name, val);
              if (isMatrix(val)) {
                entry.matrixData = val;
                if (is2DVector(val)) {
                  entry.vector = { x: val[0][0], y: val[1][0] };
                  entry.type = 'vector';
                } else {
                  entry.type = 'matrix';
                }
              }
            } catch {
              // Incomplete matrix or placeholder
              entry.type = 'matrix';
              entry.value = undefined;
            }
          } else if (isNumericConstantNode(ast.value)) {
            entry.type = 'variable';

            const isIntParam = ['n', 'N', 'k', 'K', 'm', 'M'].includes(ast.name);
            entry.sliderMin = entry.sliderMin ?? (isIntParam ? 0 : -10);
            entry.sliderMax = entry.sliderMax ?? 10;
            entry.sliderStep = entry.sliderStep ?? (isIntParam ? 1 : 0.05);

            if (currentVarValues.has(ast.name)) {
              const preserved = currentVarValues.get(ast.name)!;
              this.scope.setConstant(ast.name, preserved);
              entry.value = preserved;
            } else {
              // Attempt initial evaluation
              try {
                const compiled = JITCompiler.compile(ast.value, [], this.scope);
                const val = compiled();
                if (typeof val === 'number' && Number.isFinite(val)) {
                  this.scope.setConstant(ast.name, val);
                  entry.value = val;
                } else {
                  this.scope.setConstant(ast.name, 1);
                  entry.value = 1;
                }
              } catch {
                this.scope.setConstant(ast.name, 1);
                entry.value = 1;
              }
            }

            if (typeof entry.value === 'number') {
              if (entry.value < entry.sliderMin) {
                entry.sliderMin = Math.floor(entry.value - 5);
              }
              if (entry.value > entry.sliderMax) {
                entry.sliderMax = Math.ceil(entry.value + 5);
              }
            }
          } else {
            // Dependent/evaluated variable (e.g. a = b + 1 or a = sin(x)), not a slider constant
            entry.type = 'variable';
            entry.sliderMin = undefined;
            entry.sliderMax = undefined;
            entry.sliderStep = undefined;
            try {
              const compiled = JITCompiler.compile(ast.value, [], this.scope);
              const val = compiled();
              this.scope.setConstant(ast.name, val);
              if (typeof val === 'number') {
                entry.value = val;
              } else if (isMatrix(val)) {
                entry.matrixData = val;
                if (is2DVector(val)) {
                  entry.vector = { x: val[0][0], y: val[1][0] };
                  entry.type = 'vector';
                } else {
                  entry.type = 'matrix';
                }
              }
            } catch {
              // Depends on other variables, evaluate in pass 2
              entry.value = undefined;
            }
          }
        } else if (ast.type === 'FunctionDecl') {
          entry.type = 'function';
          entry.fnName = ast.name;
          const compiled = JITCompiler.compile(ast.body, ast.params, this.scope);
          this.scope.setFunction(ast.name, compiled);
          if (ast.params.length === 1 && ast.params[0] === 'x') {
            entry.compiledFn = compiled;
          }
        }
      } catch (err: any) {
        entry.type = 'invalid';
        entry.ast = undefined;
        entry.value = undefined;
        entry.compiledFn = undefined;
        entry.missingParams = undefined;
        entry.error = err.message || 'Синтаксическая ошибка';
      }
    }

    // --- PASS 2: Compile curves/equations and detect missing parameters against full scope ---
    for (const entry of this.entries) {
      if (entry.kind === 'table') continue;
      if (entry.kind === 'simulation') {
        this.compileSimulation(entry);
        continue;
      }
      if (!entry.ast) continue;

      const ast = entry.ast;
      try {
        if (ast.type === 'VariableDecl') {
          const rawEntry = entry.rawText || '';
          const hasMat = /\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}/.test(rawEntry) || /\bmatrix\b/.test(rawEntry);
          if (hasMat) {
            entry.type = 'matrix';
            entry.value = undefined;
            entry.sliderMin = undefined;
            entry.sliderMax = undefined;
            entry.sliderStep = undefined;
            try {
              const compiled = JITCompiler.compile(ast.value, [], this.scope);
              const val = compiled();
              if (isMatrix(val)) {
                this.scope.setConstant(ast.name, val);
                entry.matrixData = val;
                if (is2DVector(val)) {
                  entry.vector = { x: val[0][0], y: val[1][0] };
                  entry.type = 'vector';
                } else {
                  entry.vector = undefined;
                  entry.type = 'matrix';
                }
              }
            } catch {}
            continue;
          }

          // If value was not a slider constant, re-evaluate against full scope
          if (!currentVarValues.has(ast.name)) {
            const compiled = JITCompiler.compile(ast.value, [], this.scope);
            const val = compiled();
            if (typeof val === 'number' && Number.isFinite(val)) {
              this.scope.setConstant(ast.name, val);
              entry.value = val;
              entry.matrixData = undefined;
              entry.vector = undefined;
              entry.type = 'variable';
            } else if (isMatrix(val)) {
              this.scope.setConstant(ast.name, val);
              entry.matrixData = val;
              entry.value = undefined;
              if (is2DVector(val)) {
                entry.vector = { x: val[0][0], y: val[1][0] };
                entry.type = 'vector';
              } else {
                entry.vector = undefined;
                entry.type = 'matrix';
              }
            }
          }
          this.detectMissingParams(entry, ast.value, new Set());
        } else if (ast.type === 'FunctionDecl') {
          const compiled = JITCompiler.compile(ast.body, ast.params, this.scope);
          this.scope.setFunction(ast.name, compiled);
          if (ast.params.length === 1 && ast.params[0] === 'x') {
            entry.compiledFn = compiled;
          }
          this.detectMissingParams(entry, ast.body, new Set(ast.params));
        } else if (ast.type === 'Equation') {
          entry.type = 'graph';
          const isXOfY = (ast.left.type === 'Identifier' && ast.left.name === 'x') ||
                         (ast.right.type === 'Identifier' && ast.right.name === 'x' && ast.left.type !== 'Identifier');

          if (isXOfY) {
            entry.graphOrientation = 'x-of-y';
            const formulaAst = (ast.left.type === 'Identifier' && ast.left.name === 'x') ? ast.right : ast.left;
            const compiled = JITCompiler.compile(formulaAst, ['y'], this.scope);
            entry.compiledFn = compiled;
            this.detectMissingParams(entry, formulaAst, new Set(['y', 'x']));
          } else {
            entry.graphOrientation = 'y-of-x';
            const formulaAst = (ast.left.type === 'Identifier' && ast.left.name === 'y') ? ast.right : ast.left;
            const compiled = JITCompiler.compile(formulaAst, ['x'], this.scope);
            entry.compiledFn = compiled;
            this.detectMissingParams(entry, formulaAst, new Set(['x', 'y']));
          }
        } else {
          entry.type = 'graph';
          const isYOnly = !this.hasFreeVariable(ast, 'x') && this.hasFreeVariable(ast, 'y');
          if (isYOnly) {
            entry.graphOrientation = 'x-of-y';
            const compiled = JITCompiler.compile(ast, ['y'], this.scope);
            entry.compiledFn = compiled;
            this.detectMissingParams(entry, ast, new Set(['y']));
          } else {
            entry.graphOrientation = 'y-of-x';
            const compiled = JITCompiler.compile(ast, ['x'], this.scope);
            entry.compiledFn = compiled;
            this.detectMissingParams(entry, ast, new Set(['x']));

            // Standalone numerical evaluation or matrix / vector evaluation
            if ((!entry.missingParams || entry.missingParams.length === 0) && !this.hasFreeVariable(ast, 'x')) {
              try {
                const val = compiled(0);
                if (typeof val === 'number' && Number.isFinite(val)) {
                  entry.value = val;
                  entry.type = 'evaluation';
                } else if (isMatrix(val)) {
                  entry.matrixData = val;
                  entry.value = undefined;
                  if (is2DVector(val)) {
                    entry.vector = { x: val[0][0], y: val[1][0] };
                    entry.type = 'vector';
                  } else {
                    entry.vector = undefined;
                    entry.type = 'matrix';
                  }
                } else {
                  entry.value = undefined;
                }
              } catch (_) {
                entry.value = undefined;
              }
            } else {
              entry.value = undefined;
            }
          }
        }
      } catch (err: any) {
        entry.type = 'invalid';
        entry.value = undefined;
        entry.compiledFn = undefined;
        entry.missingParams = undefined;
        entry.error = err.message || 'Ошибка компиляции';
      }
    }

    // --- PASS 3: Evaluate computed columns in tables (with cross-table referencing) ---
    const availableVars = new Map<string, { tableId: string; colIdx: number; entry: ExpressionEntry }>();
    for (const entry of this.entries) {
      if (entry.kind === 'table') {
        this.evaluateTable(entry, availableVars);
      }
    }

    this.onUpdate?.();
  }

  public compileSimulation(entry: ExpressionEntry): void {
    if (!entry.simulationData) return;
    const sim = entry.simulationData;
    entry.error = undefined;
    const missing = new Set<string>();
    const boundParams = new Set(['x', 'y', 'z', 't']);

    const compileComp = (latex: string) => {
      const math = latexToMath(latex);
      const ast = Parser.parse(math);
      this.collectMissingParamsFromAST(ast, boundParams, missing);
      return JITCompiler.compile(ast, ['x', 'y', 'z', 't'], this.scope) as (x: number, y: number, z: number, t: number) => number;
    };

    try {
      if (sim.eqX) {
        sim.compiledFnX = compileComp(sim.eqX);
      }
      if (sim.eqY) {
        sim.compiledFnY = compileComp(sim.eqY);
      }
      if (sim.hasZ && sim.eqZ) {
        sim.compiledFnZ = compileComp(sim.eqZ);
      } else {
        sim.compiledFnZ = undefined;
      }

      if (missing.size > 0) {
        entry.missingParams = Array.from(missing);
      } else {
        entry.missingParams = undefined;
      }
    } catch (err: any) {
      entry.error = err.message || 'Ошибка компиляции дифференциальных уравнений';
    }
  }

  private collectMissingParamsFromAST(node: ASTNode, boundParams: Set<string>, missing: Set<string>): void {
    const knownFunctions = new Set([
      'sin', 'cos', 'tan', 'cot', 'atan', 'arctan', 'asin', 'acos', 'acot', 'arcsin', 'arccos', 'arccot',
      'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'abs', 'exp',
      'ln', 'log', 'log10', 'log2', 'floor', 'ceil', 'round', 'sign', 'min', 'max',
      'factorial', 'fact', 'prod', 'sum', 'derivative', 'integral',
      'matrix', 'det', 'inv', 'transpose', 'dot', 'norm'
    ]);

    const walk = (n: ASTNode) => {
      if (n.type === 'Identifier') {
        const name = n.name;
        if (
          !boundParams.has(name) &&
          !knownFunctions.has(name) &&
          name !== 'pi' && name !== 'PI' &&
          name !== 'e' && name !== 'E' &&
          name !== 'tau' && name !== 'phi' &&
          !this.scope.has(name)
        ) {
          missing.add(name);
        }
      } else if (n.type === 'BinaryOp') {
        walk(n.left);
        walk(n.right);
      } else if (n.type === 'UnaryOp') {
        walk(n.argument);
      } else if (n.type === 'Factorial') {
        walk(n.argument);
      } else if (n.type === 'FunctionCall') {
        if (!knownFunctions.has(n.name) && !this.scope.has(n.name)) {
          missing.add(n.name);
        }
        n.args.forEach(walk);
      } else if (n.type === 'Equation') {
        walk(n.left);
        walk(n.right);
      } else if (n.type === 'Sum' || n.type === 'Product') {
        walk(n.start);
        walk(n.end);
        const innerBound = new Set(boundParams);
        innerBound.add(n.variable);
        const savedBound = boundParams;
        boundParams = innerBound;
        walk(n.body);
        boundParams = savedBound;
      } else if (n.type === 'Derivative') {
        walk(n.order);
        const innerBound = new Set(boundParams);
        innerBound.add(n.variable);
        const savedBound = boundParams;
        boundParams = innerBound;
        walk(n.body);
        boundParams = savedBound;
      } else if (n.type === 'Integral') {
        walk(n.lower);
        walk(n.upper);
        const innerBound = new Set(boundParams);
        innerBound.add(n.variable);
        const savedBound = boundParams;
        boundParams = innerBound;
        walk(n.body);
        boundParams = savedBound;
      } else if (n.type === 'Inverse') {
        if (!this.scope.hasFunction(n.name)) {
          missing.add(n.name);
        }
        walk(n.argument);
      } else if (n.type === 'Restriction') {
        walk(n.expr);
        const innerBound = new Set(boundParams);
        if (boundParams.has('x')) innerBound.add('y');
        if (boundParams.has('y')) innerBound.add('x');
        const savedBound = boundParams;
        boundParams = innerBound;
        walk(n.condition);
        boundParams = savedBound;
      }
    };

    walk(node);
  }

  private detectMissingParams(entry: ExpressionEntry, node: ASTNode, boundParams: Set<string>): void {
    const missing = new Set<string>();
    this.collectMissingParamsFromAST(node, boundParams, missing);
    if (missing.size > 0) {
      entry.missingParams = Array.from(missing);
    }
  }

  private hasFreeVariable(node: ASTNode, varName: string): boolean {
    switch (node.type) {
      case 'NumberLiteral':
        return false;
      case 'Identifier':
        return node.name === varName;
      case 'UnaryOp':
        return this.hasFreeVariable(node.argument, varName);
      case 'Factorial':
        return this.hasFreeVariable(node.argument, varName);
      case 'BinaryOp':
        return this.hasFreeVariable(node.left, varName) || this.hasFreeVariable(node.right, varName);
      case 'FunctionCall':
        return node.args.some(arg => this.hasFreeVariable(arg, varName));
      case 'Equation':
        return this.hasFreeVariable(node.left, varName) || this.hasFreeVariable(node.right, varName);
      case 'Sum':
      case 'Product':
        if (this.hasFreeVariable(node.start, varName) || this.hasFreeVariable(node.end, varName)) {
          return true;
        }
        return node.variable !== varName && this.hasFreeVariable(node.body, varName);
      case 'Derivative':
        if (this.hasFreeVariable(node.order, varName)) return true;
        return node.variable === varName || this.hasFreeVariable(node.body, varName);
      case 'Integral':
        if (this.hasFreeVariable(node.lower, varName) || this.hasFreeVariable(node.upper, varName)) {
          return true;
        }
        return node.variable !== varName && this.hasFreeVariable(node.body, varName);
      case 'Inverse':
        return this.hasFreeVariable(node.argument, varName);
      case 'Restriction':
        return this.hasFreeVariable(node.expr, varName) || this.hasFreeVariable(node.condition, varName);
      default:
        return false;
    }
  }

  public toggleVisibility(id: string): boolean {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return false;
    entry.visible = entry.visible === false ? true : false;
    this.onUpdate?.();
    return entry.visible;
  }

  public setEntryColor(id: string, color: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.color = color;
    this.onUpdate?.();
  }

  public setEntryLineStyle(id: string, style: LineStyle): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.lineStyle = style;
    this.onUpdate?.();
  }

  public getPlottableItems(): GraphItem[] {
    const items: GraphItem[] = [];
    for (const entry of this.entries) {
      if (entry.kind === 'table' && entry.tableRows) {
        const cols = entry.tableColumns || [
          { id: 'c0', name: 'x_1' },
          { id: 'c1', name: 'y_1', color: entry.color }
        ];
        const rows = entry.tableRows;
        const xCol = cols[0];
        const xErrCol = cols.find(c => c.isErrorActive && (c.errorTargetColId === xCol.id || findMatchingBaseColumn(c.name, cols)?.id === xCol.id));
        const xErrColIdx = xErrCol ? cols.indexOf(xErrCol) : -1;

        for (let colIdx = 1; colIdx < cols.length; colIdx++) {
          const col = cols[colIdx];
          // If this column is active as an error column itself, do not plot it as standalone Y points
          if (col.isErrorActive) continue;

          const colColor = col.color || entry.color;
          const yErrCol = cols.find(c => c.isErrorActive && (c.errorTargetColId === col.id || findMatchingBaseColumn(c.name, cols)?.id === col.id));
          const yErrColIdx = yErrCol ? cols.indexOf(yErrCol) : -1;

          const pts = rows
            .map(r => {
              const xVal = parseFloat(r[0]);
              const yVal = parseFloat(r[colIdx]);
              const dxVal = xErrColIdx !== -1 && r[xErrColIdx] ? parseFloat(r[xErrColIdx]) : undefined;
              const dyVal = yErrColIdx !== -1 && r[yErrColIdx] ? parseFloat(r[yErrColIdx]) : undefined;
              return {
                x: xVal,
                y: yVal,
                dx: typeof dxVal === 'number' && Number.isFinite(dxVal) && dxVal > 0 ? dxVal : undefined,
                dy: typeof dyVal === 'number' && Number.isFinite(dyVal) && dyVal > 0 ? dyVal : undefined
              };
            })
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

          if (pts.length > 0) {
            items.push({
              type: 'points',
              id: `${entry.id}_col_${colIdx}`,
              color: colColor,
              points: pts,
              visible: entry.visible !== false,
              layer: entry.layer ?? 1
            });
          }
        }

        // Regression lines and curves
        if (entry.regressions && entry.visible !== false) {
          for (const reg of entry.regressions) {
            if (reg.visible !== false && reg.fn && !reg.error) {
              items.push({
                type: 'curve',
                id: `${entry.id}_reg_${reg.id}`,
                color: reg.color,
                fn: reg.fn,
                visible: true,
                lineStyle: reg.lineStyle || 'solid',
                layer: entry.layer ?? 1
              });

              // If k_min and k_max dashed lines are enabled
              if (reg.type === 'linear' && reg.showKMinMax && typeof reg.kMin === 'number' && typeof reg.kMax === 'number' && typeof reg.bMin === 'number' && typeof reg.bMax === 'number') {
                items.push({
                  type: 'curve',
                  id: `${entry.id}_reg_${reg.id}_kmin`,
                  color: reg.color,
                  fn: (x: number) => reg.kMin! * x + reg.bMin!,
                  visible: true,
                  lineStyle: 'dashed',
                  layer: entry.layer ?? 1
                });
                items.push({
                  type: 'curve',
                  id: `${entry.id}_reg_${reg.id}_kmax`,
                  color: reg.color,
                  fn: (x: number) => reg.kMax! * x + reg.bMax!,
                  visible: true,
                  lineStyle: 'dashed',
                  layer: entry.layer ?? 1
                });
              }
            }
          }
        }
      } else if (entry.kind === 'simulation' && entry.simulationData) {
        const sim = entry.simulationData;
        if (entry.visible !== false && sim.pointsBuffer && sim.pointsBuffer.length > 0) {
          const proj = sim.projection || 'xy';
          let headX = sim.currentX;
          let headY = sim.currentY;
          if (proj === 'xz') {
            headY = sim.currentZ;
          } else if (proj === 'yz') {
            headX = sim.currentY;
            headY = sim.currentZ;
          }

          items.push({
            type: 'trajectory',
            id: entry.id,
            color: entry.color,
            points: sim.pointsBuffer,
            currentPoint: { x: headX, y: headY },
            projection: proj,
            visible: true,
            layer: entry.layer ?? 2
          });
        }
      } else if (entry.type === 'vector' && entry.vector) {
        items.push({
          type: 'vector',
          id: entry.id,
          color: entry.color,
          target: entry.vector,
          label: entry.varName || undefined,
          visible: entry.visible !== false,
          layer: entry.layer ?? 1
        });
      } else if (entry.compiledFn && (entry.type === 'graph' || entry.type === 'function')) {
        items.push({
          type: 'curve',
          id: entry.id,
          color: entry.color,
          fn: entry.compiledFn,
          visible: entry.visible !== false,
          lineStyle: entry.lineStyle || 'solid',
          orientation: entry.graphOrientation,
          layer: entry.layer ?? 1
        });
      }
    }
    // Stable sort items by layer so higher layers render on top
    items.sort((a, b) => (a.layer ?? 1) - (b.layer ?? 1));
    return items;
  }
}
