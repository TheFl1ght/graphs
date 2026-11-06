import { Token, TokenType } from './token';

export class Lexer {
  private input: string;
  private pos: number = 0;
  private len: number;

  constructor(input: string) {
    this.input = input;
    this.len = input.length;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.len) {
      const ch = this.input[this.pos];

      // Whitespace
      if (/\s/.test(ch)) {
        this.pos++;
        continue;
      }

      const startPos = this.pos;

      // Numbers: 123, 123.45, .45, 1e-4
      if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek(1)))) {
        tokens.push(this.readNumber());
        continue;
      }

      // Identifiers / function names
      if (this.isAlpha(ch)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Operators and punctuation
      switch (ch) {
        case '+':
          tokens.push({ type: TokenType.Plus, value: '+', position: startPos });
          this.pos++;
          break;
        case '-':
          tokens.push({ type: TokenType.Minus, value: '-', position: startPos });
          this.pos++;
          break;
        case '*':
          tokens.push({ type: TokenType.Star, value: '*', position: startPos });
          this.pos++;
          break;
        case '/':
          tokens.push({ type: TokenType.Slash, value: '/', position: startPos });
          this.pos++;
          break;
        case '^':
          tokens.push({ type: TokenType.Caret, value: '^', position: startPos });
          this.pos++;
          break;
        case '=':
          if (this.peek(1) === '=') {
            tokens.push({ type: TokenType.DoubleEquals, value: '==', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.Equals, value: '=', position: startPos });
            this.pos++;
          }
          break;
        case '<':
          if (this.peek(1) === '=') {
            tokens.push({ type: TokenType.LessThanOrEqual, value: '<=', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.LessThan, value: '<', position: startPos });
            this.pos++;
          }
          break;
        case '>':
          if (this.peek(1) === '=') {
            tokens.push({ type: TokenType.GreaterThanOrEqual, value: '>=', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.GreaterThan, value: '>', position: startPos });
            this.pos++;
          }
          break;
        case '!':
          if (this.peek(1) === '=') {
            tokens.push({ type: TokenType.NotEquals, value: '!=', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.Exclamation, value: '!', position: startPos });
            this.pos++;
          }
          break;
        case '&':
          if (this.peek(1) === '&') {
            tokens.push({ type: TokenType.And, value: '&&', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.And, value: '&&', position: startPos });
            this.pos++;
          }
          break;
        case '|':
          if (this.peek(1) === '|') {
            tokens.push({ type: TokenType.Or, value: '||', position: startPos });
            this.pos += 2;
          } else {
            tokens.push({ type: TokenType.Or, value: '||', position: startPos });
            this.pos++;
          }
          break;
        case '(':
        case '{':
          tokens.push({ type: TokenType.LParen, value: '(', position: startPos });
          this.pos++;
          break;
        case ')':
        case '}':
          tokens.push({ type: TokenType.RParen, value: ')', position: startPos });
          this.pos++;
          break;
        case ',':
          tokens.push({ type: TokenType.Comma, value: ',', position: startPos });
          this.pos++;
          break;
        default:
          throw new Error(`Unexpected character '${ch}' at position ${startPos}`);
      }
    }

    tokens.push({ type: TokenType.EOF, value: '', position: this.pos });
    return tokens;
  }

  private readNumber(): Token {
    const start = this.pos;
    let hasDot = false;
    let hasExponent = false;

    if (this.input[this.pos] === '.') {
      hasDot = true;
      this.pos++;
    }

    while (this.pos < this.len) {
      const ch = this.input[this.pos];
      if (this.isDigit(ch)) {
        this.pos++;
      } else if (ch === '.' && !hasDot && !hasExponent) {
        hasDot = true;
        this.pos++;
      } else if ((ch === 'e' || ch === 'E') && !hasExponent) {
        hasExponent = true;
        this.pos++;
        if (this.pos < this.len && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
          this.pos++;
        }
      } else {
        break;
      }
    }

    return {
      type: TokenType.Number,
      value: this.input.substring(start, this.pos),
      position: start
    };
  }

  private static readonly KNOWN_FUNCTIONS: string[] = [
    'arcsin', 'arccos', 'arctan', 'arccot',
    'sinh', 'cosh', 'tanh',
    'asin', 'acos', 'atan', 'acot',
    'sqrt', 'cbrt',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'log10', 'log2', 'log', 'exp', 'abs', 'sgn', 'sign',
    'floor', 'ceil', 'round', 'min', 'max',
    'ln', 'gamma', 'Gamma',
    'sum', 'prod', 'derivative', 'integral', 'inverse', 'restriction', 'factorial', 'fact',
    'matrix', 'det', 'inv', 'transpose', 'dot', 'norm'
  ];

  private static readonly KNOWN_CONSTANTS: string[] = ['pi', 'tau', 'phi', 'infty', 'infinity', 'inf'];

  public static readonly GREEK_LETTERS: string[] = [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon',
    'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'varkappa',
    'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho',
    'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi',
    'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
    'Upsilon', 'Phi', 'Psi', 'Omega'
  ];

  private readIdentifier(): Token {
    const start = this.pos;
    const remaining = this.input.substring(start);

    // 1. Check known multi-letter functions (e.g. sin, cos, arctan)
    for (const fn of Lexer.KNOWN_FUNCTIONS) {
      if (remaining.startsWith(fn)) {
        this.pos = start + fn.length;
        return {
          type: TokenType.Identifier,
          value: fn,
          position: start
        };
      }
    }

    // 2. Check Greek letters (e.g. alpha, beta, gamma, theta...) and subscripted Greek letters (alpha_1)
    for (const g of Lexer.GREEK_LETTERS) {
      if (remaining.startsWith(g)) {
        let end = start + g.length;
        // Check if directly followed by subscript: alpha_1, theta_max
        if (end < this.len && this.input[end] === '_') {
          end++;
          while (end < this.len && this.isAlphaNumeric(this.input[end])) {
            end++;
          }
        }
        const val = this.input.substring(start, end);
        this.pos = end;
        return {
          type: TokenType.Identifier,
          value: val,
          position: start
        };
      }
    }

    // 3. Check known multi-letter constants (pi, tau, phi)
    for (const c of Lexer.KNOWN_CONSTANTS) {
      if (remaining.startsWith(c)) {
        const after = remaining.substring(c.length);
        if (after.length === 0 || !this.isAlpha(after[0])) {
          this.pos = start + c.length;
          return {
            type: TokenType.Identifier,
            value: c,
            position: start
          };
        }
      }
    }

    // 4. Subscripted identifiers: e.g. x_1, k_max, a_b
    if (this.isAlpha(this.input[this.pos])) {
      if (this.pos + 1 < this.len && this.input[this.pos + 1] === '_') {
        let end = this.pos + 2;
        while (end < this.len && this.isAlphaNumeric(this.input[end])) {
          end++;
        }
        const val = this.input.substring(start, end);
        this.pos = end;
        return {
          type: TokenType.Identifier,
          value: val,
          position: start
        };
      }

      // 5. Single-letter parameter/variable (e.g. 'm', 'a', 't' in 'mat')
      this.pos = start + 1;
      return {
        type: TokenType.Identifier,
        value: this.input[start],
        position: start
      };
    }

    // Fallback
    this.pos = start + 1;
    return {
      type: TokenType.Identifier,
      value: this.input[start],
      position: start
    };
  }

  private isDigit(ch: string): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_');
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private peek(offset: number = 0): string {
    return this.input[this.pos + offset];
  }
}
