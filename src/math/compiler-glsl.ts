import { ASTNode } from './ast';

export class GLSLCompiler {
  /**
   * Compiles an AST node into a valid GLSL float expression string.
   * Suitable for WebGL2 / WebGPU fragment shaders.
   */
  public static toGLSL(node: ASTNode): string {
    switch (node.type) {
      case 'NumberLiteral': {
        const val = node.value.toString();
        // Ensure floating point literal in GLSL has a dot
        return val.includes('.') || val.includes('e') || val.includes('E') ? val : `${val}.0`;
      }

      case 'Identifier': {
        const name = node.name;
        if (name === 'pi' || name === 'PI') return '3.141592653589793';
        if (name === 'e' || name === 'E') return '2.718281828459045';
        // x, y or uniform name
        return name;
      }

      case 'UnaryOp': {
        const arg = GLSLCompiler.toGLSL(node.argument);
        return `${node.op}(${arg})`;
      }

      case 'BinaryOp': {
        const left = GLSLCompiler.toGLSL(node.left);
        const right = GLSLCompiler.toGLSL(node.right);

        if (node.op === '^') {
          return `pow(${left}, ${right})`;
        }
        return `(${left} ${node.op} ${right})`;
      }

      case 'FunctionCall': {
        const name = node.name;
        const argsGLSL = node.args.map(arg => GLSLCompiler.toGLSL(arg)).join(', ');

        const glslMap: Record<string, string> = {
          'sin': 'sin',
          'cos': 'cos',
          'tan': 'tan',
          'asin': 'asin',
          'acos': 'acos',
          'atan': 'atan',
          'arcsin': 'asin',
          'arccos': 'acos',
          'arctan': 'atan',
          'sinh': 'sinh',
          'cosh': 'cosh',
          'tanh': 'tanh',
          'sqrt': 'sqrt',
          'abs': 'abs',
          'exp': 'exp',
          'ln': 'log',
          'log': 'log',
          'floor': 'floor',
          'ceil': 'ceil',
          'sign': 'sign',
          'min': 'min',
          'max': 'max'
        };

        const targetFn = glslMap[name] || name;
        return `${targetFn}(${argsGLSL})`;
      }

      case 'Equation': {
        return GLSLCompiler.toGLSL(node.right);
      }

      case 'FunctionDecl': {
        return GLSLCompiler.toGLSL(node.body);
      }

      case 'VariableDecl': {
        return GLSLCompiler.toGLSL(node.value);
      }

      default:
        throw new Error(`Unsupported GLSL node type: ${(node as any).type}`);
    }
  }
}
