export enum TokenType {
  Number = 'Number',
  Identifier = 'Identifier',
  Plus = 'Plus',           // +
  Minus = 'Minus',         // -
  Star = 'Star',           // *
  Slash = 'Slash',         // /
  Caret = 'Caret',         // ^
  Equals = 'Equals',       // =
  LParen = 'LParen',       // (
  RParen = 'RParen',       // )
  Comma = 'Comma',         // ,
  Exclamation = 'Exclamation', // !
  LessThan = 'LessThan',                 // <
  LessThanOrEqual = 'LessThanOrEqual',   // <=
  GreaterThan = 'GreaterThan',           // >
  GreaterThanOrEqual = 'GreaterThanOrEqual', // >=
  DoubleEquals = 'DoubleEquals',         // ==
  NotEquals = 'NotEquals',               // !=
  And = 'And',                           // &&
  Or = 'Or',                             // ||
  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}
