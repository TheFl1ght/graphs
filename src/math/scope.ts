export type MathFn = (...args: any[]) => any;
export type ScopeValue = number | number[][];

export function isMatrix(val: any): val is number[][] {
  return Array.isArray(val) && val.length > 0 && Array.isArray(val[0]);
}

export function is2DVector(val: any): boolean {
  return isMatrix(val) && val.length === 2 && val[0].length === 1 &&
         typeof val[0][0] === 'number' && Number.isFinite(val[0][0]) &&
         typeof val[1][0] === 'number' && Number.isFinite(val[1][0]);
}

export function _createMatrix(rows: number, cols: number, ...elements: any[]): number[][] {
  const flat = elements.flat(Infinity);
  const res: number[][] = [];
  let k = 0;
  for (let i = 0; i < rows; i++) {
    res[i] = [];
    for (let j = 0; j < cols; j++) {
      const v = flat[k++];
      res[i][j] = (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    }
  }
  return res;
}

export function _matrixMul(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return a * b;
  if (typeof a === 'number' && isMatrix(b)) {
    return b.map(row => row.map(v => a * v));
  }
  if (isMatrix(a) && typeof b === 'number') {
    return a.map(row => row.map(v => v * b));
  }
  if (isMatrix(a) && isMatrix(b)) {
    const rowsA = a.length;
    const colsA = a[0].length;
    const rowsB = b.length;
    const colsB = b[0].length;
    if (colsA !== rowsB) return NaN;
    const res: number[][] = [];
    for (let i = 0; i < rowsA; i++) {
      res[i] = [];
      for (let j = 0; j < colsB; j++) {
        let sum = 0;
        for (let k = 0; k < colsA; k++) {
          sum += a[i][k] * b[k][j];
        }
        res[i][j] = sum;
      }
    }
    return res;
  }
  return NaN;
}

export function _matrixAdd(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (isMatrix(a) && isMatrix(b)) {
    if (a.length !== b.length || a[0].length !== b[0].length) return NaN;
    return a.map((row, i) => row.map((v, j) => v + b[i][j]));
  }
  return NaN;
}

export function _matrixSub(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (isMatrix(a) && isMatrix(b)) {
    if (a.length !== b.length || a[0].length !== b[0].length) return NaN;
    return a.map((row, i) => row.map((v, j) => v - b[i][j]));
  }
  return NaN;
}

export function _matrixNeg(a: any): any {
  if (typeof a === 'number') return -a;
  if (isMatrix(a)) {
    return a.map(row => row.map(v => -v));
  }
  return NaN;
}

export function _matrixDet(m: any): number {
  if (!isMatrix(m) || m.length !== m[0].length) return NaN;
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (n === 3) {
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }
  let det = 1;
  const a = m.map(r => [...r]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    }
    if (Math.abs(a[pivot][i]) < 1e-12) return 0;
    if (pivot !== i) {
      [a[i], a[pivot]] = [a[pivot], a[i]];
      det = -det;
    }
    det *= a[i][i];
    for (let j = i + 1; j < n; j++) {
      const factor = a[j][i] / a[i][i];
      for (let k = i + 1; k < n; k++) {
        a[j][k] -= factor * a[i][k];
      }
    }
  }
  return det;
}

export function _matrixInv(m: any): any {
  if (!isMatrix(m) || m.length !== m[0].length) return NaN;
  const d = _matrixDet(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return NaN;
  if (m.length === 1) {
    return [[1 / m[0][0]]];
  }
  if (m.length === 2) {
    return [
      [m[1][1] / d, -m[0][1] / d],
      [-m[1][0] / d, m[0][0] / d]
    ];
  }
  return NaN;
}

export function _matrixTranspose(m: any): any {
  if (!isMatrix(m)) return NaN;
  const rows = m.length;
  const cols = m[0].length;
  const res: number[][] = [];
  for (let j = 0; j < cols; j++) {
    res[j] = [];
    for (let i = 0; i < rows; i++) {
      res[j][i] = m[i][j];
    }
  }
  return res;
}

export function _matrixPow(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.pow(a, b);
  }
  if (isMatrix(a) && b === -1) {
    return _matrixInv(a);
  }
  if (isMatrix(a) && typeof b === 'number' && Number.isInteger(b) && b > 0) {
    let res = a;
    for (let i = 1; i < b; i++) {
      res = _matrixMul(res, a);
    }
    return res;
  }
  return NaN;
}

export function _matrixDiv(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return a / b;
  if (isMatrix(a) && typeof b === 'number') {
    return a.map(row => row.map(v => v / b));
  }
  if (isMatrix(a) && isMatrix(b)) {
    const invB = _matrixInv(b);
    return _matrixMul(a, invB);
  }
  return NaN;
}

export function _matrixDot(a: any, b: any): number {
  if (isMatrix(a) && isMatrix(b)) {
    const flatA = a.flat();
    const flatB = b.flat();
    if (flatA.length !== flatB.length) return NaN;
    return flatA.reduce((acc, v, i) => acc + v * flatB[i], 0);
  }
  return NaN;
}

export function _matrixNorm(v: any): number {
  if (isMatrix(v)) {
    const flat = v.flat();
    return Math.hypot(...flat);
  }
  if (typeof v === 'number') return Math.abs(v);
  return NaN;
}

function gamma(z: number): number {
  const g = 7;
  const C = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.138571095836524,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }

  z -= 1;
  let x = C[0];
  for (let i = 1; i < g + 2; i++) {
    x += C[i] / (z + i);
  }

  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function mathFactorial(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    if (n > 170) return Infinity;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
  }
  return gamma(n + 1);
}

export class Scope {
  private constants: Map<string, ScopeValue> = new Map();
  private functions: Map<string, MathFn> = new Map();
  public parent?: Scope;

  constructor(parent?: Scope) {
    this.parent = parent;
    if (!parent) {
      this.initBuiltins();
    }
  }

  public mathFactorial(n: number): number {
    return mathFactorial(n);
  }

  private initBuiltins(): void {
    // Constants
    this.constants.set('pi', Math.PI);
    this.constants.set('PI', Math.PI);
    this.constants.set('e', Math.E);
    this.constants.set('E', Math.E);
    this.constants.set('tau', Math.PI * 2);
    this.constants.set('phi', (1 + Math.sqrt(5)) / 2);

    // Standard Math Functions
    this.functions.set('sin', Math.sin);
    this.functions.set('cos', Math.cos);
    this.functions.set('tan', Math.tan);
    this.functions.set('cot', (x: number) => 1 / Math.tan(x));
    this.functions.set('asin', Math.asin);
    this.functions.set('acos', Math.acos);
    this.functions.set('atan', Math.atan);
    this.functions.set('arctan', Math.atan);
    this.functions.set('acot', (x: number) => Math.PI / 2 - Math.atan(x));
    this.functions.set('arccot', (x: number) => Math.PI / 2 - Math.atan(x));
    this.functions.set('arcsin', Math.asin);
    this.functions.set('arccos', Math.acos);
    this.functions.set('sinh', Math.sinh);
    this.functions.set('cosh', Math.cosh);
    this.functions.set('tanh', Math.tanh);
    this.functions.set('sqrt', Math.sqrt);
    this.functions.set('cbrt', Math.cbrt);
    this.functions.set('abs', Math.abs);
    this.functions.set('exp', Math.exp);
    this.functions.set('ln', Math.log);
    this.functions.set('log', Math.log);
    this.functions.set('log10', Math.log10);
    this.functions.set('log2', Math.log2);
    this.functions.set('floor', Math.floor);
    this.functions.set('ceil', Math.ceil);
    this.functions.set('round', Math.round);
    this.functions.set('sign', Math.sign);
    this.functions.set('min', Math.min);
    this.functions.set('max', Math.max);
    this.functions.set('factorial', (n: number) => mathFactorial(n));
    this.functions.set('fact', (n: number) => mathFactorial(n));

    // Matrix / Vector Functions
    this.functions.set('matrix', (rows: number, cols: number, ...elements: number[]) => _createMatrix(rows, cols, elements));
    this.functions.set('det', _matrixDet);
    this.functions.set('inv', _matrixInv);
    this.functions.set('transpose', _matrixTranspose);
    this.functions.set('dot', _matrixDot);
    this.functions.set('norm', _matrixNorm);
  }

  public setConstant(name: string, val: ScopeValue): void {
    this.constants.set(name, val);
  }

  public setFunction(name: string, fn: MathFn): void {
    this.functions.set(name, fn);
  }

  public getConstant(name: string): ScopeValue | undefined {
    if (this.constants.has(name)) {
      return this.constants.get(name);
    }
    return this.parent?.getConstant(name);
  }

  public getFunction(name: string): MathFn | undefined {
    if (this.functions.has(name)) {
      return this.functions.get(name);
    }
    return this.parent?.getFunction(name);
  }

  public hasFunction(name: string): boolean {
    return this.functions.has(name) || (this.parent?.hasFunction(name) ?? false);
  }

  public has(name: string): boolean {
    return (
      this.constants.has(name) ||
      this.functions.has(name) ||
      (this.parent?.has(name) ?? false)
    );
  }

  public createChild(): Scope {
    return new Scope(this);
  }
}
