export type MathFn = (...args: number[]) => number;

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
  private constants: Map<string, number> = new Map();
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
  }

  public setConstant(name: string, val: number): void {
    this.constants.set(name, val);
  }

  public setFunction(name: string, fn: MathFn): void {
    this.functions.set(name, fn);
  }

  public getConstant(name: string): number | undefined {
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
