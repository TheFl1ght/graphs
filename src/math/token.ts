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
  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}
