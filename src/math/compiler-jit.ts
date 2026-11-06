import { ASTNode } from './ast';
import {
  Scope,
  _createMatrix,
  _matrixMul,
  _matrixAdd,
  _matrixSub,
  _matrixNeg,
  _matrixPow,
  _matrixDiv,
  _matrixDet,
  _matrixInv,
  _matrixTranspose,
  _matrixDot,
  _matrixNorm
} from './scope';

export type CompiledFunction = (...args: any[]) => any;

export class JITCompiler {
  /**
   * Compiles an AST node into a high-performance native JavaScript function.
   * @param node The AST node to compile.
   * @param paramNames Formal parameters of the function (e.g. ['x'] for f(x)).
   * @param scope Scope to bind for constant/function lookups.
   */
  public static compile(
    node: ASTNode,
    paramNames: string[] = ['x'],
    scope: Scope
  ): CompiledFunction {
    const exprJs = JITCompiler.toJsCode(node, new Set(paramNames));

    // Construct the function: function(x, scope) { return ...; }
    // Parameters first, then the scope object
    const code = `"use strict"; return (${paramNames.join(', ')}) => { return (${exprJs}); };`;
    
    try {
      // Safe creation using new Function with strictly validated AST symbols
      const factory = new Function(
        'scope',
        'Math',
        '_createMatrix',
        '_matrixMul',
        '_matrixAdd',
        '_matrixSub',
        '_matrixNeg',
        '_matrixPow',
        '_matrixDiv',
        '_matrixDet',
        '_matrixInv',
        '_matrixTranspose',
        '_matrixDot',
        '_matrixNorm',
        code
      );
      const fn = factory(
        scope,
        Math,
        _createMatrix,
        _matrixMul,
        _matrixAdd,
        _matrixSub,
        _matrixNeg,
        _matrixPow,
        _matrixDiv,
        _matrixDet,
        _matrixInv,
        _matrixTranspose,
        _matrixDot,
        _matrixNorm
      ) as CompiledFunction;
      return fn;
    } catch (err) {
      throw new Error(`Failed to JIT compile expression: ${err}`);
    }
  }

  private static toJsCode(node: ASTNode, localParams: Set<string>): string {
    switch (node.type) {
      case 'NumberLiteral': {
        return node.value.toString();
      }

      case 'Identifier': {
        const name = node.name;
        // Validate identifier to prevent code injection
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          throw new Error(`Invalid identifier: ${name}`);
        }

        if (localParams.has(name)) {
          return name;
        }

        // Standard constants mapped to Math
        if (name === 'pi' || name === 'PI') return 'Math.PI';
        if (name === 'e' || name === 'E') return 'Math.E';
        if (name === 'infty' || name === 'infinity' || name === 'inf') return 'Infinity';

        // Dynamic lookup from scope
        return `(scope.getConstant("${name}") ?? NaN)`;
      }

      case 'UnaryOp': {
        const arg = JITCompiler.toJsCode(node.argument, localParams);
        if (node.op === '-') {
          return `_matrixNeg(${arg})`;
        }
        return `${node.op}(${arg})`;
      }

      case 'BinaryOp': {
        const left = JITCompiler.toJsCode(node.left, localParams);
        const right = JITCompiler.toJsCode(node.right, localParams);

        if (node.op === '*') {
          return `_matrixMul(${left}, ${right})`;
        }
        if (node.op === '+') {
          return `_matrixAdd(${left}, ${right})`;
        }
        if (node.op === '-') {
          return `_matrixSub(${left}, ${right})`;
        }
        if (node.op === '/') {
          return `_matrixDiv(${left}, ${right})`;
        }
        if (node.op === '^') {
          return `_matrixPow(${left}, ${right})`;
        }
        return `(${left} ${node.op} ${right})`;
      }

      case 'FunctionCall': {
        const name = node.name;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
          throw new Error(`Invalid function identifier: ${name}`);
        }

        const argsJs = node.args.map(arg => JITCompiler.toJsCode(arg, localParams)).join(', ');

        // Matrix / Linear Algebra functions
        if (name === 'matrix') {
          return `_createMatrix(${argsJs})`;
        }
        if (name === 'det') {
          return `_matrixDet(${argsJs})`;
        }
        if (name === 'inv') {
          return `_matrixInv(${argsJs})`;
        }
        if (name === 'transpose') {
          return `_matrixTranspose(${argsJs})`;
        }
        if (name === 'dot') {
          return `_matrixDot(${argsJs})`;
        }
        if (name === 'norm') {
          return `_matrixNorm(${argsJs})`;
        }

        // Built-in standard Math functions
        const mathFns = [
          'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
          'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'abs',
          'exp', 'floor', 'ceil', 'round', 'sign', 'min', 'max'
        ];

        if (mathFns.includes(name)) {
          return `Math.${name}(${argsJs})`;
        }
        if (name === 'gamma' || name === 'Gamma') {
          return `(scope.getFunction("${name}") ?? ((z) => NaN))(${argsJs})`;
        }
        if (name === 'arctan' || name === 'atan') {
          return `Math.atan(${argsJs})`;
        }
        if (name === 'arcsin' || name === 'asin') {
          return `Math.asin(${argsJs})`;
        }
        if (name === 'arccos' || name === 'acos') {
          return `Math.acos(${argsJs})`;
        }
        if (name === 'acot' || name === 'arccot') {
          return `(Math.PI / 2 - Math.atan(${argsJs}))`;
        }
        if (name === 'cot') {
          return `(1 / Math.tan(${argsJs}))`;
        }
        if (name === 'ln' || name === 'log') {
          return `Math.log(${argsJs})`;
        }
        if (name === 'log10') {
          return `Math.log10(${argsJs})`;
        }
        if (name === 'log2') {
          return `Math.log2(${argsJs})`;
        }

        // Custom function lookup from scope
        return `((scope.getFunction("${name}") ?? (() => NaN))(${argsJs}))`;
      }

      case 'VariableDecl': {
        return JITCompiler.toJsCode(node.value, localParams);
      }

      case 'FunctionDecl': {
        return JITCompiler.toJsCode(node.body, localParams);
      }

      case 'Equation': {
        // If left is 'y', right is the function of x
        return JITCompiler.toJsCode(node.right, localParams);
      }

      case 'Sum': {
        const startJs = JITCompiler.toJsCode(node.start, localParams);
        const endJs = JITCompiler.toJsCode(node.end, localParams);
        const innerParams = new Set(localParams);
        innerParams.add(node.variable);
        const bodyJs = JITCompiler.toJsCode(node.body, innerParams);

        return `(() => {
          const _start = Math.round(${startJs});
          const _end = Math.round(${endJs});
          let _sum = 0;
          for (let ${node.variable} = _start; ${node.variable} <= _end; ${node.variable}++) {
            _sum += (${bodyJs});
          }
          return _sum;
        })()`;
      }

      case 'Product': {
        const startJs = JITCompiler.toJsCode(node.start, localParams);
        const endJs = JITCompiler.toJsCode(node.end, localParams);
        const innerParams = new Set(localParams);
        innerParams.add(node.variable);
        const bodyJs = JITCompiler.toJsCode(node.body, innerParams);

        return `(() => {
          const _start = Math.round(${startJs});
          const _end = Math.round(${endJs});
          let _prod = 1;
          for (let ${node.variable} = _start; ${node.variable} <= _end; ${node.variable}++) {
            _prod *= (${bodyJs});
          }
          return _prod;
        })()`;
      }

      case 'Factorial': {
        const argJs = JITCompiler.toJsCode(node.argument, localParams);
        return `scope.mathFactorial(${argJs})`;
      }

      case 'Derivative': {
        const wrt = node.variable;
        const innerParams = new Set(localParams);
        innerParams.add(wrt);
        const bodyJs = JITCompiler.toJsCode(node.body, innerParams);
        const orderJs = JITCompiler.toJsCode(node.order, localParams);
        const currentWrt = localParams.has(wrt) ? wrt : `(scope.getConstant("${wrt}") ?? 0)`;

        let isUserFnConstArg = false;
        let userFnName = '';
        let userFnArgJs = '';
        if (node.body.type === 'FunctionCall' && node.body.args.length === 1) {
          const fnArg = node.body.args[0];
          if (!JITCompiler.hasIdentifier(fnArg, wrt)) {
            isUserFnConstArg = true;
            userFnName = node.body.name;
            userFnArgJs = JITCompiler.toJsCode(fnArg, localParams);
          }
        }

        if (isUserFnConstArg) {
          return `((_ord, _targetVal) => {
            const _order = Math.max(0, Math.min(16, Math.round(_ord)));
            const _targetFn = (scope.getFunction("${userFnName}") ?? ((val) => NaN));
            function _nCr(n, r) {
              if (r < 0 || r > n) return 0;
              if (r === 0 || r === n) return 1;
              let res = 1;
              for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
              return res;
            }
            function _diffK(fn, x, k) {
              if (k === 0) return fn(x);
              const h = Math.pow(1e-14, 1 / (k + 2)) * Math.max(1, Math.abs(x));
              let sum = 0;
              for (let j = 0; j <= k; j++) {
                const coeff = ((k - j) % 2 === 0 ? 1 : -1) * _nCr(k, j);
                sum += coeff * fn(x + (j - k / 2) * h);
              }
              return sum / Math.pow(h, k);
            }
            return _diffK(_targetFn, _targetVal, _order);
          })(${orderJs}, ${userFnArgJs})`;
        }

        return `((_xVal, _ord) => {
          const _order = Math.max(0, Math.min(16, Math.round(_ord)));
          const _fn = (${wrt}) => (${bodyJs});
          function _nCr(n, r) {
            if (r < 0 || r > n) return 0;
            if (r === 0 || r === n) return 1;
            let res = 1;
            for (let i = 1; i <= r; i++) res = (res * (n - i + 1)) / i;
            return res;
          }
          function _diffK(fn, x, k) {
            if (k === 0) return fn(x);
            const h = Math.pow(1e-14, 1 / (k + 2)) * Math.max(1, Math.abs(x));
            let sum = 0;
            for (let j = 0; j <= k; j++) {
              const coeff = ((k - j) % 2 === 0 ? 1 : -1) * _nCr(k, j);
              sum += coeff * fn(x + (j - k / 2) * h);
            }
            return sum / Math.pow(h, k);
          }
          return _diffK(_fn, _xVal, _order);
        })(${currentWrt}, ${orderJs})`;
      }

      case 'Integral': {
        const lowerJs = JITCompiler.toJsCode(node.lower, localParams);
        const upperJs = JITCompiler.toJsCode(node.upper, localParams);
        const wrt = node.variable;
        const innerParams = new Set(localParams);
        innerParams.add(wrt);
        const bodyJs = JITCompiler.toJsCode(node.body, innerParams);

        return `((_lower, _upper) => {
          if (!Number.isFinite(_lower) && !Number.isFinite(_upper)) return NaN;
          if (_lower === _upper) return 0;
          const _integrand = (${wrt}) => (${bodyJs});

          // Improper integral: [lower, +Infinity)
          if (Number.isFinite(_lower) && _upper === Infinity) {
            const _n = 150;
            let _sum = 0;
            for (let _i = 0; _i < _n; _i++) {
              const _u = (_i + 0.5) / _n;
              const _denom = 1 - _u;
              const _t = _lower + _u / _denom;
              const _v = _integrand(_t);
              if (Number.isFinite(_v)) {
                _sum += _v / (_denom * _denom);
              }
            }
            return _sum / _n;
          }

          // Improper integral: (-Infinity, upper]
          if (_lower === -Infinity && Number.isFinite(_upper)) {
            const _n = 150;
            let _sum = 0;
            for (let _i = 0; _i < _n; _i++) {
              const _u = (_i + 0.5) / _n;
              const _denom = 1 - _u;
              const _t = _upper - _u / _denom;
              const _v = _integrand(_t);
              if (Number.isFinite(_v)) {
                _sum += _v / (_denom * _denom);
              }
            }
            return _sum / _n;
          }

          if (!Number.isFinite(_lower) || !Number.isFinite(_upper)) return NaN;

          const _n = 120;
          const _h = (_upper - _lower) / _n;
          let _sum = 0;
          for (let _i = 0; _i < _n; _i++) {
            const _t = _lower + (_i + 0.5) * _h;
            const _v = _integrand(_t);
            if (!Number.isFinite(_v)) return NaN;
            _sum += _v;
          }
          return _sum * _h;
        })(${lowerJs}, ${upperJs})`;
      }

      case 'Inverse': {
        const argJs = JITCompiler.toJsCode(node.argument, localParams);
        const fnName = node.name;

        return `((_targetX) => {
          if (!Number.isFinite(_targetX)) return NaN;
          const _fn = (scope.getFunction("${fnName}") ?? ((val) => NaN));

          // Fast cached tabulation solver for inverse functions
          if (!scope._invCache) scope._invCache = new Map();
          let _solver = scope._invCache.get("${fnName}");
          if (!_solver || _solver.fn !== _fn) {
            _solver = {
              fn: _fn,
              tableY: [],
              tableX: [],
              minY: -80,
              maxY: 80,
              step: 0.25,
              build() {
                const step = this.step;
                for (let y = this.minY; y <= this.maxY; y += step) {
                  const x = this.fn(y);
                  if (Number.isFinite(x)) {
                    this.tableY.push(y);
                    this.tableX.push(x);
                  }
                }
              },
              solve(target) {
                if (this.tableY.length === 0) this.build();
                const n = this.tableY.length;
                if (n < 2) return NaN;

                if ((target < this.tableX[0] || target > this.tableX[n - 1]) && this.maxY < 1000) {
                  const oldMax = this.maxY;
                  const oldMin = this.minY;
                  this.maxY += 80;
                  this.minY -= 80;
                  for (let y = oldMax + this.step; y <= this.maxY; y += this.step) {
                    const x = this.fn(y);
                    if (Number.isFinite(x)) { this.tableY.push(y); this.tableX.push(x); }
                  }
                  for (let y = oldMin - this.step; y >= this.minY; y -= this.step) {
                    const x = this.fn(y);
                    if (Number.isFinite(x)) { this.tableY.unshift(y); this.tableX.unshift(x); }
                  }
                }

                const crossings = [];
                const len = this.tableY.length;
                for (let i = 0; i < len - 1; i++) {
                  const x0 = this.tableX[i];
                  const x1 = this.tableX[i + 1];
                  const y0 = this.tableY[i];
                  const y1 = this.tableY[i + 1];

                  if (Math.abs(y1 - y0) > 0.6) continue;

                  if ((x0 <= target && target <= x1) || (x1 <= target && target <= x0)) {
                    const denom = x1 - x0;
                    const t = Math.abs(denom) > 1e-12 ? (target - x0) / denom : 0.5;
                    crossings.push(y0 + t * (y1 - y0));
                  }
                }

                if (crossings.length === 0) return NaN;

                const pos = [];
                const neg = [];
                for (let i = 0; i < crossings.length; i++) {
                  if (crossings[i] > 0.05) pos.push(crossings[i]);
                  else if (crossings[i] < -0.05) neg.push(crossings[i]);
                }

                if (pos.length > 1 || neg.length > 1) {
                  return NaN; // Non-injective on branch!
                }

                if (pos.length === 1 && neg.length === 1) {
                  if (Math.abs(pos[0] + neg[0]) > 0.25) return NaN;
                  return target >= 0 ? pos[0] : neg[0];
                }

                if (crossings.length > 2) return NaN;

                let cur = crossings[0];
                const h = 1e-5;
                const val = this.fn(cur) - target;
                const deriv = (this.fn(cur + h) - this.fn(cur - h)) / (2 * h);
                if (Math.abs(deriv) > 1e-10) {
                  const next = cur - val / deriv;
                  if (Number.isFinite(next) && Math.abs(next - cur) < 0.25) {
                    cur = next;
                  }
                }
                return cur;
              }
            };
            scope._invCache.set("${fnName}", _solver);
          }

          return _solver.solve(_targetX);
        })(${argJs})`;
      }

      default:
        throw new Error(`Unsupported AST node type: ${(node as any).type}`);
    }
  }

  private static hasIdentifier(node: ASTNode, id: string): boolean {
    switch (node.type) {
      case 'NumberLiteral':
        return false;
      case 'Identifier':
        return node.name === id;
      case 'UnaryOp':
        return JITCompiler.hasIdentifier(node.argument, id);
      case 'BinaryOp':
        return JITCompiler.hasIdentifier(node.left, id) || JITCompiler.hasIdentifier(node.right, id);
      case 'FunctionCall':
        return node.args.some(arg => JITCompiler.hasIdentifier(arg, id));
      case 'Factorial':
        return JITCompiler.hasIdentifier(node.argument, id);
      case 'Sum':
      case 'Product':
        return (
          (node.variable === id ? false : JITCompiler.hasIdentifier(node.body, id)) ||
          JITCompiler.hasIdentifier(node.start, id) ||
          JITCompiler.hasIdentifier(node.end, id)
        );
      case 'Integral':
        return (
          (node.variable === id ? false : JITCompiler.hasIdentifier(node.body, id)) ||
          JITCompiler.hasIdentifier(node.lower, id) ||
          JITCompiler.hasIdentifier(node.upper, id)
        );
      case 'Derivative':
        return node.variable === id ? false : JITCompiler.hasIdentifier(node.body, id);
      case 'Inverse':
        return JITCompiler.hasIdentifier(node.argument, id);
      default:
        return false;
    }
  }
}
