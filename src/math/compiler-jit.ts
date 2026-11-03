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
          if (!Number.isFinite(_lower) || !Number.isFinite(_upper)) return NaN;
          if (_lower === _upper) return 0;
          const _integrand = (${wrt}) => (${bodyJs});
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

          function _solve(target) {
            const eps = 1e-11;
            const guesses = [target, 0, target > 0 ? 1 : -1, target * 0.5, 10, -10];
            for (const g of guesses) {
              let cur = g;
              let ok = false;
              for (let iter = 0; iter < 25; iter++) {
                const val = _fn(cur) - target;
                if (Math.abs(val) < eps) return cur;
                const h = Math.max(1e-6, Math.abs(cur) * 1e-6);
                const deriv = (_fn(cur + h) - _fn(cur - h)) / (2 * h);
                if (Math.abs(deriv) < 1e-12 || !Number.isFinite(deriv)) break;
                const next = cur - val / deriv;
                if (!Number.isFinite(next) || Math.abs(next) > 1e9) break;
                if (Math.abs(next - cur) < eps) {
                  cur = next;
                  ok = true;
                  break;
                }
                cur = next;
              }
              if (ok && Math.abs(_fn(cur) - target) < 1e-5) return cur;
            }

            let left = -100, right = 100;
            let fL = _fn(left) - target;
            let fR = _fn(right) - target;
            if (fL * fR > 0) {
              for (let step = 200; step <= 10000; step *= 2) {
                if ((_fn(-step) - target) * (_fn(step) - target) <= 0) {
                  left = -step;
                  right = step;
                  fL = _fn(left) - target;
                  fR = _fn(right) - target;
                  break;
                }
              }
            }

            if (fL * fR <= 0) {
              for (let i = 0; i < 60; i++) {
                const mid = (left + right) / 2;
                const fMid = _fn(mid) - target;
                if (Math.abs(fMid) < eps || (right - left) < eps) return mid;
                if (fL * fMid <= 0) {
                  right = mid;
                  fR = fMid;
                } else {
                  left = mid;
                  fL = fMid;
                }
              }
              return (left + right) / 2;
            }

            return NaN;
          }

          return _solve(_targetX);
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
