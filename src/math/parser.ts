import { Token, TokenType } from './token';
import { Lexer } from './lexer';
import {
  ASTNode,
  NumberLiteralNode,
  IdentifierNode,
  UnaryOpNode,
  BinaryOpNode,
  FunctionCallNode,
  VariableDeclNode,
  FunctionDeclNode,
  EquationNode,
  RestrictionNode,
  SumNode,
  ProductNode,
  DerivativeNode,
  IntegralNode,
  InverseNode,
  FactorialNode
} from './ast';

export class Parser {
  private tokens: Token[];
  private current: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public static parse(input: string): ASTNode {
    const lexer = new Lexer(input);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parseStatement();
  }

  public parseStatement(): ASTNode {
    // Check if it's a declaration:
    // Case 1: f(x) = ... or f(x, y) = ...
    // Case 2: a = ...
    // Case 3: y = ...
    if (this.check(TokenType.Identifier)) {
      const nextToken = this.peek(1);
      
      // Function declaration: ident(param1, param2) = ...
      if (nextToken.type === TokenType.LParen) {
        const savedPos = this.current;
        const fnName = this.advance().value;
        this.advance(); // consume '('
        
        const params: string[] = [];
        let isParamsList = true;

        if (!this.check(TokenType.RParen)) {
          while (true) {
            if (this.check(TokenType.Identifier)) {
              params.push(this.advance().value);
            } else {
              isParamsList = false;
              break;
            }

            if (this.match(TokenType.Comma)) {
              continue;
            } else if (this.check(TokenType.RParen)) {
              break;
            } else {
              isParamsList = false;
              break;
            }
          }
        }

        if (isParamsList && this.match(TokenType.RParen) && this.match(TokenType.Equals)) {
          const body = this.parseExpression();
          this.consume(TokenType.EOF, 'Expected end of input');
          const node: FunctionDeclNode = {
            type: 'FunctionDecl',
            name: fnName,
            params,
            body
          };
          return node;
        }

        // Backtrack if not a function declaration
        this.current = savedPos;
      }

      // Variable assignment: a = ... or Equation: y = ...
      if (nextToken.type === TokenType.Equals) {
        const varName = this.advance().value;
        this.advance(); // consume '='
        const expr = this.parseExpression();
        this.consume(TokenType.EOF, 'Expected end of input');

        if (varName === 'y' || varName === 'x') {
          // Standard equation y = f(x) or x = f(y)
          const eqNode: EquationNode = {
            type: 'Equation',
            left: { type: 'Identifier', name: varName },
            right: expr
          };
          return eqNode;
        }

        const declNode: VariableDeclNode = {
          type: 'VariableDecl',
          name: varName,
          value: expr
        };
        return declNode;
      }
    }

    // Default: expression or equation (e.g., y = sin(x) handled if parsed as equation)
    const expr = this.parseExpression();

    if (this.match(TokenType.Equals)) {
      const right = this.parseExpression();
      this.consume(TokenType.EOF, 'Expected end of input');
      const eqNode: EquationNode = {
        type: 'Equation',
        left: expr,
        right
      };
      return eqNode;
    }

    this.consume(TokenType.EOF, 'Expected end of input');
    return expr;
  }

  // Precedence levels:
  // 1: + -
  // 2: * /
  // 3: ^ (right associative)
  // 4: Unary + -
  public parseExpression(): ASTNode {
    return this.parseBinary(0);
  }

  private parseBinary(minPrecedence: number): ASTNode {
    let left = this.parseUnary();

    while (true) {
      // Check for implicit multiplication: e.g. 2x, 2(x), (x)(y), x y
      if (this.canBeImplicitMultiplication()) {
        const prec = 20; // multiplication precedence
        if (prec >= minPrecedence) {
          const right = this.parseBinary(prec + 1);
          left = {
            type: 'BinaryOp',
            op: '*',
            left,
            right
          };
          continue;
        }
      }

      const token = this.peek();
      const prec = this.getOperatorPrecedence(token.type);

      if (prec === 0 || prec < minPrecedence) {
        break;
      }

      this.advance(); // consume operator

      // Comparison operators (<, <=, >, >=) with chained comparison support (e.g. 0 < x < 5)
      if (
        token.type === TokenType.LessThan ||
        token.type === TokenType.LessThanOrEqual ||
        token.type === TokenType.GreaterThan ||
        token.type === TokenType.GreaterThanOrEqual
      ) {
        let mid = this.parseBinary(prec + 1);
        const op1 = token.value as '<' | '<=' | '>' | '>=';

        const isNextComparison = () => {
          const t = this.peek().type;
          return (
            t === TokenType.LessThan ||
            t === TokenType.LessThanOrEqual ||
            t === TokenType.GreaterThan ||
            t === TokenType.GreaterThanOrEqual
          );
        };

        if (isNextComparison()) {
          const comparisons: ASTNode[] = [
            { type: 'BinaryOp', op: op1, left, right: mid }
          ];

          while (isNextComparison()) {
            const nextTok = this.advance();
            const nextOp = nextTok.value as '<' | '<=' | '>' | '>=';
            const nextRight = this.parseBinary(prec + 1);
            comparisons.push({ type: 'BinaryOp', op: nextOp, left: mid, right: nextRight });
            mid = nextRight;
          }

          left = comparisons.reduce((acc, curr) => ({
            type: 'BinaryOp',
            op: '&&',
            left: acc,
            right: curr
          }));
          continue;
        }

        left = {
          type: 'BinaryOp',
          op: op1,
          left,
          right: mid
        };
        continue;
      }

      const isRightAssoc = token.type === TokenType.Caret;
      const nextMinPrec = isRightAssoc ? prec : prec + 1;
      const right = this.parseBinary(nextMinPrec);

      const op = token.value as '+' | '-' | '*' | '/' | '^' | '==' | '!=' | '&&' | '||';
      left = {
        type: 'BinaryOp',
        op,
        left,
        right
      };
    }

    return left;
  }

  private canBeImplicitMultiplication(): boolean {
    const nextType = this.peek().type;
    return (
      nextType === TokenType.Identifier ||
      nextType === TokenType.Number ||
      nextType === TokenType.LParen
    );
  }

  private getOperatorPrecedence(type: TokenType): number {
    switch (type) {
      case TokenType.Or:
        return 2;
      case TokenType.And:
        return 4;
      case TokenType.DoubleEquals:
      case TokenType.NotEquals:
        return 6;
      case TokenType.LessThan:
      case TokenType.LessThanOrEqual:
      case TokenType.GreaterThan:
      case TokenType.GreaterThanOrEqual:
        return 8;
      case TokenType.Plus:
      case TokenType.Minus:
        return 10;
      case TokenType.Star:
      case TokenType.Slash:
        return 20;
      case TokenType.Caret:
        return 30; // exponentiation
      default:
        return 0;
    }
  }

  private parseUnary(): ASTNode {
    if (this.match(TokenType.Minus)) {
      const argument = this.parseBinary(35); // unary binds tighter than * /
      const node: UnaryOpNode = {
        type: 'UnaryOp',
        op: '-',
        argument
      };
      return node;
    }
    if (this.match(TokenType.Plus)) {
      const argument = this.parseBinary(35);
      const node: UnaryOpNode = {
        type: 'UnaryOp',
        op: '+',
        argument
      };
      return node;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    let node = this.parsePrimaryBase();
    while (this.match(TokenType.Exclamation)) {
      const factNode: FactorialNode = {
        type: 'Factorial',
        argument: node
      };
      node = factNode;
    }
    return node;
  }

  private parsePrimaryBase(): ASTNode {
    // Number
    if (this.check(TokenType.Number)) {
      const token = this.advance();
      const node: NumberLiteralNode = {
        type: 'NumberLiteral',
        value: parseFloat(token.value)
      };
      return node;
    }

    // Function call or Identifier
    if (this.check(TokenType.Identifier)) {
      const name = this.advance().value;

      // Special calculus constructs
      if (name === 'sum' && this.match(TokenType.LParen)) {
        if (!this.check(TokenType.Identifier)) {
          throw new Error("Expected variable name for summation, e.g. sum(k, 1, 10, ...)");
        }
        const variable = this.advance().value;
        this.consume(TokenType.Comma, "Expected ',' after summation variable");
        const start = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after summation start");
        const end = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after summation end");
        const body = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after summation body");
        const node: SumNode = {
          type: 'Sum',
          variable,
          start,
          end,
          body
        };
        return node;
      }

      if (name === 'prod' && this.match(TokenType.LParen)) {
        if (!this.check(TokenType.Identifier)) {
          throw new Error("Expected variable name for product, e.g. prod(k, 1, 10, ...)");
        }
        const variable = this.advance().value;
        this.consume(TokenType.Comma, "Expected ',' after product variable");
        const start = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after product start");
        const end = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after product end");
        const body = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after product body");
        const node: ProductNode = {
          type: 'Product',
          variable,
          start,
          end,
          body
        };
        return node;
      }

      if (name === 'derivative' && this.match(TokenType.LParen)) {
        if (!this.check(TokenType.Identifier)) {
          throw new Error("Expected variable name for derivative, e.g. derivative(x, 1, ...)");
        }
        const variable = this.advance().value;
        this.consume(TokenType.Comma, "Expected ',' after derivative variable");
        const order = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after derivative order");
        const body = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after derivative body");
        const node: DerivativeNode = {
          type: 'Derivative',
          variable,
          order,
          body
        };
        return node;
      }

      if (name === 'integral' && this.match(TokenType.LParen)) {
        if (!this.check(TokenType.Identifier)) {
          throw new Error("Expected variable name for integral, e.g. integral(x, 0, 1, ...)");
        }
        const variable = this.advance().value;
        this.consume(TokenType.Comma, "Expected ',' after integral variable");
        const lower = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after integral lower bound");
        const upper = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after integral upper bound");
        const body = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after integral body");
        const node: IntegralNode = {
          type: 'Integral',
          variable,
          lower,
          upper,
          body
        };
        return node;
      }

      if (name === 'inverse' && this.match(TokenType.LParen)) {
        if (!this.check(TokenType.Identifier)) {
          throw new Error("Expected function name for inverse, e.g. inverse(f, x)");
        }
        const fnName = this.advance().value;
        this.consume(TokenType.Comma, "Expected ',' after function name in inverse(f, x)");
        const argument = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after inverse argument");
        const node: InverseNode = {
          type: 'Inverse',
          name: fnName,
          argument
        };
        return node;
      }

      if (name === 'restriction' && this.match(TokenType.LParen)) {
        const expr = this.parseExpression();
        this.consume(TokenType.Comma, "Expected ',' after expression in restriction(expr, condition)");
        const condition = this.parseExpression();
        this.consume(TokenType.RParen, "Expected ')' after condition in restriction(expr, condition)");
        const node: RestrictionNode = {
          type: 'Restriction',
          expr,
          condition
        };
        return node;
      }

      // Function call with power: e.g. cos^2(x), cos^n(x), ln^2 x, cos^n x
      const trigLogPowerFns = [
        'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh',
        'asin', 'acos', 'atan', 'acot', 'arcsin', 'arccos', 'arctan', 'arccot',
        'ln', 'log', 'lg', 'exp'
      ];
      if (trigLogPowerFns.includes(name) && this.check(TokenType.Caret)) {
        this.advance(); // consume '^'
        const power = this.parseBinary(35); // parse exponent

        if (this.match(TokenType.LParen)) {
          const args: ASTNode[] = [];
          if (!this.check(TokenType.RParen)) {
            do {
              args.push(this.parseExpression());
            } while (this.match(TokenType.Comma));
          }
          this.consume(TokenType.RParen, "Expected ')' after arguments");
          const fnNode: FunctionCallNode = {
            type: 'FunctionCall',
            name,
            args
          };
          const powerNode: BinaryOpNode = {
            type: 'BinaryOp',
            op: '^',
            left: fnNode,
            right: power
          };
          return powerNode;
        } else if (this.canBeImplicitMultiplication()) {
          const arg = this.parseBinary(25);
          const fnNode: FunctionCallNode = {
            type: 'FunctionCall',
            name,
            args: [arg]
          };
          const powerNode: BinaryOpNode = {
            type: 'BinaryOp',
            op: '^',
            left: fnNode,
            right: power
          };
          return powerNode;
        }
      }

      // Function call: name(arg1, arg2, ...)
      if (this.match(TokenType.LParen)) {
        const args: ASTNode[] = [];
        if (!this.check(TokenType.RParen)) {
          do {
            args.push(this.parseExpression());
          } while (this.match(TokenType.Comma));
        }
        this.consume(TokenType.RParen, "Expected ')' after arguments");
        const node: FunctionCallNode = {
          type: 'FunctionCall',
          name,
          args
        };
        return node;
      }

      // Check if this is a known single-argument function call without parentheses: e.g. sin x, ln x, cot x
      const knownUnaryFns = [
        'sin', 'cos', 'tan', 'cot', 'atan', 'arctan', 'asin', 'acos', 'acot', 'arcsin', 'arccos', 'arccot',
        'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'ln', 'log', 'exp', 'abs'
      ];
      if (knownUnaryFns.includes(name) && this.canBeImplicitMultiplication()) {
        const arg = this.parseBinary(25); // binds tighter than multiplication
        const node: FunctionCallNode = {
          type: 'FunctionCall',
          name,
          args: [arg]
        };
        return node;
      }

      // Simple identifier
      const node: IdentifierNode = {
        type: 'Identifier',
        name
      };
      return node;
    }

    // Grouping (expr)
    if (this.match(TokenType.LParen)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RParen, "Expected ')' after expression");
      return expr;
    }

    const token = this.peek();
    throw new Error(`Unexpected token '${token.value || token.type}' at position ${token.position}`);
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === TokenType.EOF;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(offset: number = 0): Token {
    const idx = this.current + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1];
    }
    return this.tokens[idx];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const token = this.peek();
    throw new Error(`${message}. Found '${token.value || token.type}' at position ${token.position}`);
  }
}
