export type ASTNode =
  | NumberLiteralNode
  | IdentifierNode
  | UnaryOpNode
  | BinaryOpNode
  | FunctionCallNode
  | VariableDeclNode
  | FunctionDeclNode
  | EquationNode
  | RestrictionNode
  | SumNode
  | ProductNode
  | DerivativeNode
  | IntegralNode
  | InverseNode
  | FactorialNode;

export interface RestrictionNode {
  type: 'Restriction';
  expr: ASTNode;
  condition: ASTNode;
}

export interface InverseNode {
  type: 'Inverse';
  name: string;
  argument: ASTNode;
}

export interface SumNode {
  type: 'Sum';
  variable: string;
  start: ASTNode;
  end: ASTNode;
  body: ASTNode;
}

export interface ProductNode {
  type: 'Product';
  variable: string;
  start: ASTNode;
  end: ASTNode;
  body: ASTNode;
}

export interface DerivativeNode {
  type: 'Derivative';
  variable: string;
  order: ASTNode;
  body: ASTNode;
}

export interface FactorialNode {
  type: 'Factorial';
  argument: ASTNode;
}

export interface IntegralNode {
  type: 'Integral';
  variable: string;
  lower: ASTNode;
  upper: ASTNode;
  body: ASTNode;
}

export interface NumberLiteralNode {
  type: 'NumberLiteral';
  value: number;
}

export interface IdentifierNode {
  type: 'Identifier';
  name: string;
}

export interface UnaryOpNode {
  type: 'UnaryOp';
  op: '+' | '-';
  argument: ASTNode;
}

export interface BinaryOpNode {
  type: 'BinaryOp';
  op: '+' | '-' | '*' | '/' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';
  left: ASTNode;
  right: ASTNode;
}

export interface FunctionCallNode {
  type: 'FunctionCall';
  name: string;
  args: ASTNode[];
}

export interface VariableDeclNode {
  type: 'VariableDecl';
  name: string;
  value: ASTNode;
}

export interface FunctionDeclNode {
  type: 'FunctionDecl';
  name: string;
  params: string[];
  body: ASTNode;
}

export interface EquationNode {
  type: 'Equation';
  left: ASTNode;
  right: ASTNode;
}

export function isNumericConstantNode(node?: ASTNode): boolean {
  if (!node) return false;
  switch (node.type) {
    case 'NumberLiteral':
      return true;
    case 'UnaryOp':
      return (node.op === '+' || node.op === '-') && isNumericConstantNode(node.argument);
    case 'BinaryOp':
      if (['+', '-', '*', '/', '^'].includes(node.op)) {
        return isNumericConstantNode(node.left) && isNumericConstantNode(node.right);
      }
      return false;
    case 'Identifier':
      return node.name === 'pi' || node.name === 'e';
    default:
      return false;
  }
}
