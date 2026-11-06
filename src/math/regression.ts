import { latexToMath } from './latex-to-math';
import { Parser } from './parser';
import { JITCompiler } from './compiler-jit';
import { Scope } from './scope';
import { ASTNode } from './ast';

export type RegressionType =
  | 'linear'
  | 'polynomial'
  | 'quadratic'
  | 'cubic'
  | 'exponential'
  | 'logarithmic'
  | 'power'
  | 'custom';

export interface RegressionResult {
  type: RegressionType;
  rSquared: number;
  equationLatex: string;
  fn: (x: number) => number;
  params: Record<string, number>;
  error?: string;
}

export interface RegressionOptions {
  polyDegree?: number;
  customFormula?: string;
  scope?: Scope;
}

export function formatNum(n: number, decimals: number = 4): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1e-10) return '0';
  // If integer or very close to integer
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toString();
  }
  // If large or very small, use scientific notation
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && Math.abs(n) > 0)) {
    return n.toExponential(3).replace('e+', '\\cdot 10^{').replace('e-', '\\cdot 10^{-') + '}';
  }
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(n * factor) / factor;
  return rounded.toString();
}

/**
 * Solves a square linear system Ax = B using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], B: number[]): number[] | null {
  const n = B.length;
  const M: number[][] = A.map((row, i) => [...row, B[i]]);

  for (let k = 0; k < n; k++) {
    // Find pivot
    let maxRow = k;
    let maxVal = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > maxVal) {
        maxVal = Math.abs(M[i][k]);
        maxRow = i;
      }
    }
    if (maxVal < 1e-12) return null; // Singular matrix

    // Swap rows
    if (maxRow !== k) {
      const temp = M[k];
      M[k] = M[maxRow];
      M[maxRow] = temp;
    }

    // Eliminate below
    for (let i = k + 1; i < n; i++) {
      const factor = M[i][k] / M[k][k];
      M[i][k] = 0;
      for (let j = k + 1; j <= n; j++) {
        M[i][j] -= factor * M[k][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }

  return x;
}

function calculateRSquared(pts: { x: number; y: number }[], fn: (x: number) => number): number {
  if (pts.length < 2) return 1;
  const meanY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of pts) {
    ssTot += (p.y - meanY) * (p.y - meanY);
    const pred = fn(p.x);
    if (!Number.isFinite(pred)) return 0;
    ssRes += (p.y - pred) * (p.y - pred);
  }
  if (ssTot < 1e-12) return ssRes < 1e-12 ? 1 : 0;
  const r2 = 1 - ssRes / ssTot;
  return Math.max(0, Math.min(1, r2));
}

/**
 * Fits a polynomial regression of degree d to given points.
 * Returns coefficients [c0, c1, ..., cd] for f(x) = c0 + c1*x + ... + cd*x^d
 */
function fitPolynomial(pts: { x: number; y: number }[], degree: number): number[] | null {
  const m = degree + 1;
  if (pts.length < m) return null;

  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const B: number[] = new Array(m).fill(0);

  // Precompute power sums of x: sum_{i} x_i^k for k = 0 ... 2*degree
  const powers = new Array(2 * degree + 1).fill(0);
  for (const p of pts) {
    let xp = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      powers[k] += xp;
      xp *= p.x;
    }
  }

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      A[i][j] = powers[i + j];
    }
    let bSum = 0;
    for (const p of pts) {
      bSum += p.y * Math.pow(p.x, i);
    }
    B[i] = bSum;
  }

  return solveLinearSystem(A, B);
}

/**
 * Nelder-Mead direct search optimization algorithm for non-linear least squares.
 */
export function nelderMead(
  costFn: (params: number[]) => number,
  initialParams: number[],
  maxIter: number = 350,
  tol: number = 1e-7
): number[] {
  const n = initialParams.length;
  if (n === 0) return [];

  // Create initial simplex of n + 1 vertices
  const simplex: { point: number[]; val: number }[] = [];
  simplex.push({ point: [...initialParams], val: costFn(initialParams) });

  for (let i = 0; i < n; i++) {
    const p = [...initialParams];
    const step = Math.abs(p[i]) > 1e-4 ? 0.08 * p[i] : 0.08;
    p[i] += step;
    simplex.push({ point: p, val: costFn(p) });
  }

  const alpha = 1.0;
  const gamma = 2.0;
  const rho = 0.5;
  const sigma = 0.5;

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.val - b.val);

    const best = simplex[0];
    const worst = simplex[n];
    const secondWorst = simplex[n - 1];

    let meanVal = 0;
    for (const v of simplex) meanVal += v.val;
    meanVal /= (n + 1);
    let variance = 0;
    for (const v of simplex) variance += (v.val - meanVal) * (v.val - meanVal);
    if (Math.sqrt(variance / (n + 1)) < tol) {
      break;
    }

    // Centroid of best n points
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        centroid[j] += simplex[i].point[j];
      }
    }
    for (let j = 0; j < n; j++) centroid[j] /= n;

    // 1. Reflection
    const xr = new Array(n);
    for (let j = 0; j < n; j++) {
      xr[j] = centroid[j] + alpha * (centroid[j] - worst.point[j]);
    }
    const fxr = costFn(xr);

    if (best.val <= fxr && fxr < secondWorst.val) {
      simplex[n] = { point: xr, val: fxr };
      continue;
    }

    // 2. Expansion
    if (fxr < best.val) {
      const xe = new Array(n);
      for (let j = 0; j < n; j++) {
        xe[j] = centroid[j] + gamma * (xr[j] - centroid[j]);
      }
      const fxe = costFn(xe);
      if (fxe < fxr) {
        simplex[n] = { point: xe, val: fxe };
      } else {
        simplex[n] = { point: xr, val: fxr };
      }
      continue;
    }

    // 3. Contraction
    const xc = new Array(n);
    if (fxr < worst.val) {
      for (let j = 0; j < n; j++) {
        xc[j] = centroid[j] + rho * (xr[j] - centroid[j]);
      }
      const fxc = costFn(xc);
      if (fxc <= fxr) {
        simplex[n] = { point: xc, val: fxc };
        continue;
      }
    } else {
      for (let j = 0; j < n; j++) {
        xc[j] = centroid[j] - rho * (centroid[j] - worst.point[j]);
      }
      const fxc = costFn(xc);
      if (fxc < worst.val) {
        simplex[n] = { point: xc, val: fxc };
        continue;
      }
    }

    // 4. Shrink
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        simplex[i].point[j] = best.point[j] + sigma * (simplex[i].point[j] - best.point[j]);
      }
      simplex[i].val = costFn(simplex[i].point);
    }
  }

  simplex.sort((a, b) => a.val - b.val);
  return simplex[0].point;
}

const BUILTIN_MATH_NAMES = new Set([
  'sin', 'cos', 'tan', 'cot', 'atan', 'arctan', 'asin', 'acos', 'acot', 'arcsin', 'arccos', 'arccot',
  'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'abs', 'exp',
  'ln', 'log', 'log10', 'log2', 'floor', 'ceil', 'round', 'sign', 'min', 'max',
  'factorial', 'fact', 'prod', 'sum', 'derivative', 'integral',
  'pi', 'PI', 'e', 'E', 'tau', 'phi'
]);

function findFreeVariables(node: ASTNode, bound: Set<string> = new Set()): Set<string> {
  const result = new Set<string>();

  const walk = (n: ASTNode, b: Set<string>) => {
    if (n.type === 'Identifier') {
      if (!b.has(n.name) && !BUILTIN_MATH_NAMES.has(n.name)) {
        result.add(n.name);
      }
    } else if (n.type === 'BinaryOp') {
      walk(n.left, b);
      walk(n.right, b);
    } else if (n.type === 'UnaryOp' || n.type === 'Factorial') {
      walk(n.argument, b);
    } else if (n.type === 'FunctionCall') {
      if (!BUILTIN_MATH_NAMES.has(n.name) && !b.has(n.name)) {
        result.add(n.name);
      }
      n.args.forEach(a => walk(a, b));
    } else if (n.type === 'Equation') {
      walk(n.left, b);
      walk(n.right, b);
    } else if (n.type === 'Sum' || n.type === 'Product' || n.type === 'Derivative' || n.type === 'Integral') {
      const nextB = new Set(b);
      nextB.add((n as any).variable);
      if ((n as any).start) walk((n as any).start, b);
      if ((n as any).end) walk((n as any).end, b);
      if ((n as any).lower) walk((n as any).lower, b);
      if ((n as any).upper) walk((n as any).upper, b);
      if ((n as any).order) walk((n as any).order, b);
      walk((n as any).body, nextB);
    } else if (n.type === 'Inverse') {
      walk(n.argument, b);
    } else if (n.type === 'Restriction') {
      walk(n.expr, b);
      walk(n.condition, b);
    }
  };

  walk(node, bound);
  return result;
}

export function computeRegression(
  pts: { x: number; y: number }[],
  type: RegressionType,
  xLabel: string = 'x_1',
  yLabel: string = 'y_1',
  options?: RegressionOptions
): RegressionResult {
  const validPts = pts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (validPts.length < 2) {
    return {
      type,
      rSquared: 0,
      equationLatex: '\\text{Недостаточно точек (минимум 2)}',
      fn: () => NaN,
      params: {},
      error: 'Нужно минимум 2 точки с данными'
    };
  }

  switch (type) {
    case 'linear': {
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      const n = validPts.length;
      for (const p of validPts) {
        sumX += p.x;
        sumY += p.y;
        sumXX += p.x * p.x;
        sumXY += p.x * p.y;
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) < 1e-12) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Точки лежат на вертикальной прямой}',
          fn: () => NaN,
          params: {},
          error: 'Точки имеют одинаковую координату X'
        };
      }
      const m = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - m * sumX) / n;
      const fn = (x: number) => m * x + b;
      const r2 = calculateRSquared(validPts, fn);

      const mSign = m < 0 ? '-' : '';
      const mAbs = Math.abs(m);
      const bSign = b >= 0 ? '+' : '-';
      const bAbs = Math.abs(b);

      const eq = `${yLabel} = ${mSign}${formatNum(mAbs)}\\,${xLabel} ${bSign} ${formatNum(bAbs)}`;

      return {
        type,
        rSquared: r2,
        equationLatex: eq,
        fn,
        params: { m, b }
      };
    }

    case 'polynomial':
    case 'quadratic':
    case 'cubic': {
      let degree = 2;
      if (type === 'quadratic') degree = 2;
      else if (type === 'cubic') degree = 3;
      else if (options?.polyDegree) degree = Math.max(1, Math.min(6, options.polyDegree));

      if (validPts.length < degree + 1) {
        return {
          type,
          rSquared: 0,
          equationLatex: `\\text{Для степени } ${degree} \\text{ нужно минимум } ${degree + 1} \\text{ точек}`,
          fn: () => NaN,
          params: {},
          error: `Нужно минимум ${degree + 1} точек`
        };
      }

      const coeffs = fitPolynomial(validPts, degree);
      if (!coeffs) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Не удалось построить многочлен}',
          fn: () => NaN,
          params: {},
          error: 'Система уравнений вырождена'
        };
      }

      const fn = (x: number) => {
        let sum = 0;
        let xp = 1;
        for (let i = 0; i <= degree; i++) {
          sum += coeffs[i] * xp;
          xp *= x;
        }
        return sum;
      };
      const r2 = calculateRSquared(validPts, fn);

      const terms: string[] = [];
      const params: Record<string, number> = {};

      const paramLetterMap: Record<number, string[]> = {
        1: ['m', 'b'],
        2: ['a', 'b', 'c'],
        3: ['a', 'b', 'c', 'd'],
        4: ['a', 'b', 'c', 'd', 'e'],
        5: ['a', 'b', 'c', 'd', 'e', 'f'],
        6: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      };
      const letters = paramLetterMap[degree] || [];

      for (let p = degree; p >= 0; p--) {
        const coeff = coeffs[p];
        const pIdx = degree - p;
        const pName = letters[pIdx] || `c_{${p}}`;
        params[pName] = coeff;
        if (Math.abs(coeff) < 1e-9 && terms.length > 0 && p > 0) continue;

        const sign = coeff < 0 ? '-' : (terms.length > 0 ? '+' : '');
        const absCoeff = Math.abs(coeff);
        const coeffStr = (Math.abs(absCoeff - 1) < 1e-9 && p > 0) ? '' : formatNum(absCoeff);

        if (p === 0) {
          terms.push(`${sign} ${formatNum(absCoeff)}`);
        } else if (p === 1) {
          terms.push(`${sign} ${coeffStr ? coeffStr + '\\,' : ''}${xLabel}`);
        } else {
          terms.push(`${sign} ${coeffStr ? coeffStr + '\\,' : ''}${xLabel}^{${p}}`);
        }
      }

      const eq = `${yLabel} = ${terms.join(' ').trim()}`;

      return {
        type,
        rSquared: r2,
        equationLatex: eq,
        fn,
        params
      };
    }

    case 'exponential': {
      const positivePts = validPts.filter(p => p.y > 0);
      if (positivePts.length < 2) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Все значения } ' + yLabel + ' \\text{ должны быть } > 0',
          fn: () => NaN,
          params: {},
          error: 'Все значения Y должны быть строго больше нуля'
        };
      }
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      const n = positivePts.length;
      for (const p of positivePts) {
        const ly = Math.log(p.y);
        sumX += p.x;
        sumY += ly;
        sumXX += p.x * p.x;
        sumXY += p.x * ly;
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) < 1e-12) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Не удалось построить экспоненту}',
          fn: () => NaN,
          params: {},
          error: 'Вырожденные точки'
        };
      }
      const b = (n * sumXY - sumX * sumY) / denom;
      const lnA = (sumY - b * sumX) / n;
      const a = Math.exp(lnA);
      const fn = (x: number) => a * Math.exp(b * x);
      const r2 = calculateRSquared(positivePts, fn);

      const bSign = b < 0 ? '-' : '';
      const bAbs = Math.abs(b);
      const eq = `${yLabel} = ${formatNum(a)}\\,e^{${bSign}${formatNum(bAbs)}\\,${xLabel}}`;

      return {
        type,
        rSquared: r2,
        equationLatex: eq,
        fn,
        params: { a, b }
      };
    }

    case 'logarithmic': {
      const positivePts = validPts.filter(p => p.x > 0);
      if (positivePts.length < 2) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Все значения } ' + xLabel + ' \\text{ должны быть } > 0',
          fn: () => NaN,
          params: {},
          error: 'Все значения X должны быть строго больше нуля'
        };
      }
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      const n = positivePts.length;
      for (const p of positivePts) {
        const lx = Math.log(p.x);
        sumX += lx;
        sumY += p.y;
        sumXX += lx * lx;
        sumXY += lx * p.y;
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) < 1e-12) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Не удалось построить логарифм}',
          fn: () => NaN,
          params: {},
          error: 'Вырожденные точки'
        };
      }
      const a = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - a * sumX) / n;
      const fn = (x: number) => x > 0 ? a * Math.log(x) + b : NaN;
      const r2 = calculateRSquared(positivePts, fn);

      const aSign = a < 0 ? '-' : '';
      const aAbs = Math.abs(a);
      const bSign = b >= 0 ? '+' : '-';
      const bAbs = Math.abs(b);
      const eq = `${yLabel} = ${aSign}${formatNum(aAbs)}\\,\\ln(${xLabel}) ${bSign} ${formatNum(bAbs)}`;

      return {
        type,
        rSquared: r2,
        equationLatex: eq,
        fn,
        params: { a, b }
      };
    }

    case 'power': {
      const positivePts = validPts.filter(p => p.x > 0 && p.y > 0);
      if (positivePts.length < 2) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Все значения } ' + xLabel + ', ' + yLabel + ' \\text{ должны быть } > 0',
          fn: () => NaN,
          params: {},
          error: 'Все значения X и Y должны быть строго больше нуля'
        };
      }
      let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
      const n = positivePts.length;
      for (const p of positivePts) {
        const lx = Math.log(p.x);
        const ly = Math.log(p.y);
        sumX += lx;
        sumY += ly;
        sumXX += lx * lx;
        sumXY += lx * ly;
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) < 1e-12) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Не удалось построить степенную функцию}',
          fn: () => NaN,
          params: {},
          error: 'Вырожденные точки'
        };
      }
      const b = (n * sumXY - sumX * sumY) / denom;
      const lnA = (sumY - b * sumX) / n;
      const a = Math.exp(lnA);
      const fn = (x: number) => x > 0 ? a * Math.pow(x, b) : NaN;
      const r2 = calculateRSquared(positivePts, fn);

      const bSign = b < 0 ? '-' : '';
      const bAbs = Math.abs(b);
      const eq = `${yLabel} = ${formatNum(a)}\\,{${xLabel}}^{${bSign}${formatNum(bAbs)}}`;

      return {
        type,
        rSquared: r2,
        equationLatex: eq,
        fn,
        params: { a, b }
      };
    }

    case 'custom': {
      const formula = options?.customFormula?.trim();
      if (!formula) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Введите функцию } f(x)',
          fn: () => NaN,
          params: {},
          error: 'Введите формулу функции'
        };
      }

      try {
        const mathText = latexToMath(formula);
        const ast = Parser.parse(mathText);

        const freeVars = findFreeVariables(ast);
        const cleanX = xLabel.replace(/[{}]/g, '');
        const paramNames: string[] = [];
        for (const v of freeVars) {
          if (v !== 'x' && v !== cleanX && v !== 'x_1') {
            paramNames.push(v);
          }
        }

        const scope = options?.scope || new Scope();
        const compiled = JITCompiler.compile(ast, ['x', ...paramNames], scope);

        if (paramNames.length === 0) {
          const fn = (x: number) => {
            try {
              const res = compiled(x);
              return Number.isFinite(res) ? res : NaN;
            } catch (_) {
              return NaN;
            }
          };
          const r2 = calculateRSquared(validPts, fn);
          return {
            type,
            rSquared: r2,
            equationLatex: `${yLabel} = ${formula}`,
            fn,
            params: {}
          };
        }

        const costFn = (p: number[]) => {
          let sse = 0;
          for (const pt of validPts) {
            try {
              const yPred = compiled(pt.x, ...p);
              if (!Number.isFinite(yPred)) return 1e12;
              const diff = pt.y - yPred;
              sse += diff * diff;
            } catch (_) {
              return 1e12;
            }
          }
          return sse;
        };

        const candidates = [
          new Array(paramNames.length).fill(1.0),
          new Array(paramNames.length).fill(0.0),
          new Array(paramNames.length).fill(-1.0),
          new Array(paramNames.length).fill(0.5)
        ];

        let bestGuess = candidates[0];
        let minCost = costFn(bestGuess);
        for (let c = 1; c < candidates.length; c++) {
          const cost = costFn(candidates[c]);
          if (cost < minCost) {
            minCost = cost;
            bestGuess = candidates[c];
          }
        }

        const optimal = nelderMead(costFn, bestGuess, 350, 1e-7);
        const params: Record<string, number> = {};
        paramNames.forEach((name, i) => {
          params[name] = optimal[i];
        });

        const fn = (x: number) => {
          try {
            const res = compiled(x, ...optimal);
            return Number.isFinite(res) ? res : NaN;
          } catch (_) {
            return NaN;
          }
        };

        const r2 = calculateRSquared(validPts, fn);
        const eq = `${yLabel} = ${formula}`;

        return {
          type,
          rSquared: r2,
          equationLatex: eq,
          fn,
          params
        };
      } catch (err: any) {
        return {
          type,
          rSquared: 0,
          equationLatex: '\\text{Ошибка в формуле}',
          fn: () => NaN,
          params: {},
          error: err.message || 'Ошибка в формуле'
        };
      }
    }
  }
}
