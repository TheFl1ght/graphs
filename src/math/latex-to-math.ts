/**
 * Normalizes LaTeX expressions into standard math strings understandable by the Lexer & Parser.
 * E.g.:
 * \frac{1}{x - 2} -> ((1)/(x - 2))
 * \sin x -> sin(x)
 * \cos x -> cos(x)
 * \ln x -> ln(x)
 * \arctan x -> atan(x)
 * \cot x -> cot(x)
 * k_{max} = -\frac{0.42-0.06}{0.4-0.1} -> k_max = -(((0.42-0.06))/(0.4-0.1))
 * \sin\left(\frac{x}{a}\right) -> sin(((x)/(a)))
 * 2\cdot x -> 2 * x
 * x^{2} -> x^(2)
 * \sqrt{x + 1} -> sqrt(x + 1)
 */
export function latexToMath(latex: string): string {
  let s = latex.trim();
  if (!s) return '';

  // Clean phantom / empty placeholders and formatting noise early
  s = s.replace(/\\placeholder\{[^}]*\}/g, '');
  s = s.replace(/\\placeholder/g, '');
  s = s.replace(/\\displaystyle/g, '');
  s = s.replace(/\\right\./g, '');
  s = s.replace(/\\left\./g, '');
  s = s.replace(/\{\s*\}/g, '');
  s = s.replace(/\{\s*\?\s*\}/g, '');
  s = s.replace(/\?/g, '');
  s = s.replace(/\\(?:,|:|;|!|quad|qquad)/g, ' ');

  // 0. Handle absolute values first: |...|, \left|...\right|, \lvert...\rvert, etc. -> abs(...)
  s = replaceAbsoluteValues(s);

  // 0.1. Handle calculus operations before powers, fractions, and bracket removal
  s = replaceDerivatives(s);
  s = replaceSummations(s);
  s = replaceProducts(s);
  s = replaceIntegrals(s);

  // 0.2. Handle Lagrange prime derivatives: f'(x), f''(x), f'''(x), f^\prime(x)
  s = replaceLagrangePrimes(s);

  // 0.3. Handle inverse functions: f^{-1}(x), f^-1(x), \sin^{-1}(x)
  s = replaceInverseFunctions(s);

  // 0.5. Handle powers on trigonometric and logarithmic functions: \cos^n x -> (cos(x))^n, \ln^2 x -> (ln(x))^2
  s = replaceTrigAndLogPowers(s);

  // If calculus commands remain incomplete, handle gracefully
  if (/\\int(?![a-zA-Z])/.test(s)) {
    throw new Error('Укажите переменную интегрирования (например, dx)');
  }
  if (/\\sum(?![a-zA-Z])/.test(s)) {
    throw new Error('Неполная сумма (укажите пределы, например \\sum_{n=1}^5)');
  }
  if (/\\prod(?![a-zA-Z])/.test(s)) {
    throw new Error('Неполное произведение (укажите пределы, например \\prod_{n=1}^5)');
  }
  if (/\\frac\s*\{\s*\\?(?:mathrm\{d\}|differentialD|d)\s*\}\s*\{\s*\\?(?:mathrm\{d\}|differentialD|d)/.test(s)) {
    throw new Error('Неполная производная (например, \\frac{d}{dx} x^2)');
  }

  // 1. Handle fractions first before removing \left \right, but preserve \left( \right) sizing if needed
  // Handle \frac{num}{den} recursively
  s = replaceFractions(s);

  // 2. Remove layout/formatting commands, empty groups, and phantom delimiters
  s = s.replace(/\\left\s*/g, '');
  s = s.replace(/\\right\s*/g, '');
  s = s.replace(/\\mleft\s*/g, '');
  s = s.replace(/\\mright\s*/g, '');
  s = s.replace(/\\text\{\s*!\s*\}/g, '!');
  s = s.replace(/\\text\{[^}]*\}/g, '');
  s = s.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  s = s.replace(/\\mathbf\{([^}]*)\}/g, '$1');

  // Replace multiplication symbols
  s = s.replace(/\\cdot/g, '*');
  s = s.replace(/\\times/g, '*');
  s = s.replace(/\\ast/g, '*');

  // Replace \div with /
  s = s.replace(/\\div/g, '/');

  // Handle subscripts: k_{max} -> k_max, x_1 -> x_1, d_{y} -> d_y, \alpha_{0} -> alpha_0
  s = s.replace(/\\?([a-zA-Z]+)_\{([a-zA-Z0-9_]+)\}/g, '$1_$2');
  s = s.replace(/\\?([a-zA-Z]+)_([a-zA-Z0-9])/g, '$1_$2');

  // Handle Greek letters followed directly by digits: alpha0 -> alpha_0, \alpha0 -> alpha_0
  const greekNames = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|varkappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega';
  const greekDigitsRegex = new RegExp(`(?<![a-zA-Z])\\\\?(${greekNames})\\s*([0-9]+)(?![a-zA-Z])`, 'g');
  s = s.replace(greekDigitsRegex, '$1_$2');

  // Auto-convert single letters directly followed by digits: y1 -> y_1, x2 -> x_2, a1 -> a_1
  s = s.replace(/(?<![a-zA-Z\\_])([a-zA-Z])(?:\s*|\\cdot\s*)([0-9]+)(?![a-zA-Z])/g, '$1_$2');

  // Handle domain restrictions in braces at the end if any: {y_1 - d_y \le y ...}, { |x| \le \frac{\pi}{2} }
  s = stripTrailingDomainRestriction(s);

  // Handle \sqrt[n]{x} and \sqrt{x}
  s = replaceSquareRoots(s);

  // Normalize \varphi to \phi so both forms are treated identically
  s = s.replace(/\\varphi\b/g, '\\phi');
  s = s.replace(/\bvarphi\b/g, 'phi');

  // Replace Greek letters (case-insensitive for lowercase and uppercase Greek)
  // Ensure we replace full backslashed names with their plain identifier: e.g. \alpha -> alpha, \beta -> beta
  s = s.replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|varkappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b/g, '$1');

  // Handle typing 'arc' or 'a r c' before trig functions: e.g. arc\sin, a r c \sin, \arc\sin, arcsin, a r c s i n
  s = s.replace(/\b(?:a\s*r\s*c\s*s\s*i\s*n|arcsin)\b/gi, '\\arcsin');
  s = s.replace(/\b(?:a\s*r\s*c\s*c\s*o\s*s|arccos)\b/gi, '\\arccos');
  s = s.replace(/\b(?:a\s*r\s*c\s*t\s*a\s*n|arctan)\b/gi, '\\arctan');
  s = s.replace(/\b(?:a\s*r\s*c\s*c\s*o\s*t|arccot)\b/gi, '\\arccot');
  s = s.replace(/\b(?:a\s*r\s*c\s*c\s*t\s*g|arcctg)\b/gi, '\\arccot');
  s = s.replace(/\b(?:a\s*r\s*c\s*t\s*g|arctg)\b/gi, '\\arctan');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?sin\b/gi, '\\arcsin');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?cos\b/gi, '\\arccos');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?tan\b/gi, '\\arctan');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?cot\b/gi, '\\arccot');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?ctg\b/gi, '\\arccot');
  s = s.replace(/\b(?:arc|a\s*r\s*c)\s*\\?tg\b/gi, '\\arctan');

  // Handle spaced letters for other standard functions: 's i n', 'c o s', etc.
  s = s.replace(/\b(?:s\s+i\s+n)\b/gi, '\\sin');
  s = s.replace(/\b(?:c\s+o\s+s)\b/gi, '\\cos');
  s = s.replace(/\b(?:t\s+a\s+n)\b/gi, '\\tan');
  s = s.replace(/\b(?:c\s+o\s+t)\b/gi, '\\cot');
  s = s.replace(/\b(?:c\s+t\s+g)\b/gi, '\\cot');
  s = s.replace(/\b(?:t\s+g)\b/gi, '\\tan');
  s = s.replace(/\b(?:l\s+n)\b/gi, '\\ln');
  s = s.replace(/\b(?:l\s+o\s+g)\b/gi, '\\log');

  // Replace standard and inverse trigonometric functions without parens or with parens
  // E.g. \sin x -> sin(x), \sin(x) -> sin(x), \cot x -> cot(x), \arctan x -> atan(x)
  // Standardize names:
  s = s.replace(/\\arctan\b/g, 'atan');
  s = s.replace(/\\arcsin\b/g, 'asin');
  s = s.replace(/\\arccos\b/g, 'acos');
  s = s.replace(/\\arccot\b/g, 'acot');
  s = s.replace(/\\cot\b/g, 'cot');
  s = s.replace(/\\ctg\b/g, 'cot');
  s = s.replace(/\\tg\b/g, 'tan');

  // Replace remaining backslashed math functions
  s = s.replace(/\\(sin|cos|tan|atan|asin|acos|acot|cot|sinh|cosh|tanh|ln|log|exp|abs|min|max|round|floor|ceil|sign)\b/g, '$1');

  // Handle function calls without parentheses: sin x -> sin(x), cos x -> cos(x), ln x -> ln(x), cot x -> cot(x)
  // Matches function name followed by space or identifier/number without '('
  const fnRegex = /\b(sin|cos|tan|cot|atan|asin|acos|acot|arcsin|arccos|arctan|arccot|sinh|cosh|tanh|ln|log|exp|sqrt)\s*([a-zA-Z0-9_]+)(?!\()/g;
  s = s.replace(fnRegex, '$1($2)');

  // Clean superscripts: x^{2+a} -> x^(2+a)
  s = replaceSuperscripts(s);

  // Clean curly braces into parentheses: {x} -> (x)
  s = s.replace(/\{([^{}]+)\}/g, '($1)');

  // Clean remaining backslashes
  s = s.replace(/\\/g, '');

  // Auto-balance any unclosed open parentheses from phantom delimiters
  let openCount = 0;
  for (const ch of s) {
    if (ch === '(') openCount++;
    else if (ch === ')') openCount = Math.max(0, openCount - 1);
  }
  while (openCount > 0) {
    s += ')';
    openCount--;
  }

  return s;
}

function replaceFractions(input: string): string {
  let res = input;
  let changed = true;
  let safety = 0;

  while (changed && safety++ < 20) {
    changed = false;
    const fracIdx = res.indexOf('\\frac');
    if (fracIdx === -1) break;

    const afterFrac = fracIdx + 5;
    // Find first group {num}
    const numGroup = extractGroup(res, afterFrac);
    if (!numGroup) break;

    // Find second group {den}
    const denGroup = extractGroup(res, numGroup.endIndex);
    if (!denGroup) break;

    const numParsed = replaceFractions(numGroup.content);
    const denParsed = replaceFractions(denGroup.content);

    const replacement = `((${numParsed})/(${denParsed}))`;
    res = res.substring(0, fracIdx) + replacement + res.substring(denGroup.endIndex);
    changed = true;
  }

  return res;
}

function replaceSquareRoots(input: string): string {
  let res = input;
  let changed = true;
  let safety = 0;

  while (changed && safety++ < 20) {
    changed = false;
    const sqrtIdx = res.indexOf('\\sqrt');
    if (sqrtIdx === -1) break;

    let afterSqrt = sqrtIdx + 5;
    // Check if there is an optional degree [n]
    if (res[afterSqrt] === '[') {
      const closeBracket = res.indexOf(']', afterSqrt);
      if (closeBracket !== -1) {
        afterSqrt = closeBracket + 1;
      }
    }

    const group = extractGroup(res, afterSqrt);
    if (!group) break;

    const inner = replaceSquareRoots(group.content);
    const replacement = `sqrt(${inner})`;
    res = res.substring(0, sqrtIdx) + replacement + res.substring(group.endIndex);
    changed = true;
  }

  return res;
}

function replaceSuperscripts(input: string): string {
  let res = input;
  let changed = true;
  let safety = 0;

  while (changed && safety++ < 20) {
    changed = false;
    const caretIdx = res.indexOf('^{');
    if (caretIdx === -1) break;

    const group = extractGroup(res, caretIdx + 1);
    if (!group) break;

    const inner = group.content;
    const replacement = `^(${inner})`;
    res = res.substring(0, caretIdx) + replacement + res.substring(group.endIndex);
    changed = true;
  }

  return res;
}

function extractGroup(str: string, startIndex: number): { content: string; endIndex: number } | null {
  let i = startIndex;
  while (i < str.length && /\s/.test(str[i])) {
    i++;
  }
  if (i >= str.length) return null;

  if (str[i] !== '{') {
    // Single character group without braces: e.g. \frac 1 2
    if (/[a-zA-Z0-9]/.test(str[i])) {
      return { content: str[i], endIndex: i + 1 };
    }
    return null;
  }

  let depth = 0;
  const contentStart = i + 1;
  while (i < str.length) {
    if (str[i] === '{') {
      depth++;
    } else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: str.substring(contentStart, i),
          endIndex: i + 1
        };
      }
    }
    i++;
  }

  return null;
}

function replaceDerivatives(str: string): string {
  // Matches \frac{d}{dx}, \frac{d^k}{dx^k}, \frac{d^{k}}{dx^{k}}, \frac{\mathrm{d}^k}{\mathrm{d}x^k}, \frac{\differentialD^k}{\differentialD x^k}, etc.
  const diffRegex = /\\frac\{\s*(?:\\differentialD|\\mathrm\{d\}|d)(?:\^\{([^}]+)\}|\^([a-zA-Z0-9_]+))?\s*\}\{\s*(?:\\differentialD|\\mathrm\{d\}|d)\s*([a-zA-Z])(?:\^\{[^}]+\}|\^[a-zA-Z0-9_]+)?\s*\}/g;
  let match: RegExpExecArray | null;
  let s = str;
  while ((match = diffRegex.exec(s)) !== null) {
    const fullMatch = match[0];
    const order = match[1] || match[2] || '1';
    const wrt = match[3];
    const startIndex = match.index;
    const afterIndex = startIndex + fullMatch.length;
    const rest = s.slice(afterIndex).trimStart();
    let body = '';
    let endIndex = afterIndex + (s.slice(afterIndex).length - rest.length);

    if (rest.startsWith('{')) {
      let depth = 0, i = 0;
      for (; i < rest.length; i++) {
        if (rest[i] === '{') depth++;
        else if (rest[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      }
      body = rest.slice(1, i - 1);
      endIndex += i;
    } else if (rest.startsWith('\\left(')) {
      let depth = 0, i = 0;
      for (; i < rest.length; i++) {
        if (rest.slice(i).startsWith('\\left(')) { depth++; i += 5; }
        else if (rest.slice(i).startsWith('\\right)')) { depth--; i += 6; if (depth === 0) { i++; break; } }
      }
      body = rest.slice(6, i - 7);
      endIndex += i;
    } else if (rest.startsWith('(')) {
      let depth = 0, i = 0;
      for (; i < rest.length; i++) {
        if (rest[i] === '(') depth++;
        else if (rest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      body = rest.slice(1, i - 1);
      endIndex += i;
    } else {
      let i = 0, depth = 0;
      while (i < rest.length) {
        const ch = rest[i];
        if (ch === '(' || ch === '{' || rest.slice(i).startsWith('\\left')) {
          depth++;
        } else if (ch === ')' || ch === '}' || rest.slice(i).startsWith('\\right')) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && (ch === '=')) {
          break;
        }
        i++;
      }
      body = rest.slice(0, i).trim();
      endIndex += i;
    }

    const replacement = `derivative(${wrt}, ${latexToMath(order)}, ${latexToMath(body)})`;
    s = s.slice(0, startIndex) + replacement + s.slice(endIndex);
    diffRegex.lastIndex = startIndex + replacement.length;
  }
  return s;
}

function replaceSummations(str: string): string {
  const sumRegex1 = /\\sum(?:_\{([a-zA-Z])\s*=\s*([^}]+)\}|_([a-zA-Z])\s*=\s*([a-zA-Z0-9]))(?:\^\{([^}]+)\}|\^([a-zA-Z0-9]))/g;
  const sumRegex2 = /\\sum(?:\^\{([^}]+)\}|\^([a-zA-Z0-9]))(?:_\{([a-zA-Z])\s*=\s*([^}]+)\}|_([a-zA-Z])\s*=\s*([a-zA-Z0-9]))/g;

  const processSum = (strVal: string, regex: RegExp, isFlipped: boolean) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(strVal)) !== null) {
      const fullMatch = match[0];
      const wrt = isFlipped ? (match[3] || match[4]) : (match[1] || match[3]);
      const start = isFlipped ? (match[4] || match[5]) : (match[2] || match[4]);
      const end = isFlipped ? (match[1] || match[2]) : (match[5] || match[6]);

      const startIndex = match.index;
      const afterIndex = startIndex + fullMatch.length;
      const rest = strVal.slice(afterIndex).trimStart();
      let body = '';
      let endIndex = afterIndex + (strVal.slice(afterIndex).length - rest.length);

      if (rest.startsWith('{')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest[i] === '{') depth++;
          else if (rest[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(1, i - 1);
        endIndex += i;
      } else if (rest.startsWith('\\left(')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest.slice(i).startsWith('\\left(')) { depth++; i += 5; }
          else if (rest.slice(i).startsWith('\\right)')) { depth--; i += 6; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(6, i - 7);
        endIndex += i;
      } else if (rest.startsWith('(')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest[i] === '(') depth++;
          else if (rest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(1, i - 1);
        endIndex += i;
      } else {
        let i = 0, depth = 0;
        while (i < rest.length) {
          const ch = rest[i];
          if (ch === '(' || ch === '{' || rest.slice(i).startsWith('\\left')) {
            depth++;
          } else if (ch === ')' || ch === '}' || rest.slice(i).startsWith('\\right')) {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (ch === '=')) {
            break;
          }
          i++;
        }
        body = rest.slice(0, i).trim();
        endIndex += i;
      }

      const replacement = `sum(${wrt}, ${latexToMath(start)}, ${latexToMath(end)}, ${latexToMath(body)})`;
      strVal = strVal.slice(0, startIndex) + replacement + strVal.slice(endIndex);
      regex.lastIndex = startIndex + replacement.length;
    }
    return strVal;
  };

  let res = processSum(str, sumRegex1, false);
  res = processSum(res, sumRegex2, true);
  return res;
}

function replaceProducts(str: string): string {
  const prodRegex1 = /\\prod(?:_\{([a-zA-Z])\s*=\s*([^}]+)\}|_([a-zA-Z])\s*=\s*([a-zA-Z0-9]))(?:\^\{([^}]+)\}|\^([a-zA-Z0-9]))/g;
  const prodRegex2 = /\\prod(?:\^\{([^}]+)\}|\^([a-zA-Z0-9]))(?:_\{([a-zA-Z])\s*=\s*([^}]+)\}|_([a-zA-Z])\s*=\s*([a-zA-Z0-9]))/g;

  const processProd = (strVal: string, regex: RegExp, isFlipped: boolean) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(strVal)) !== null) {
      const fullMatch = match[0];
      const wrt = isFlipped ? (match[3] || match[4]) : (match[1] || match[3]);
      const start = isFlipped ? (match[4] || match[5]) : (match[2] || match[4]);
      const end = isFlipped ? (match[1] || match[2]) : (match[5] || match[6]);

      const startIndex = match.index;
      const afterIndex = startIndex + fullMatch.length;
      const rest = strVal.slice(afterIndex).trimStart();
      let body = '';
      let endIndex = afterIndex + (strVal.slice(afterIndex).length - rest.length);

      if (rest.startsWith('{')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest[i] === '{') depth++;
          else if (rest[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(1, i - 1);
        endIndex += i;
      } else if (rest.startsWith('\\left(')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest.slice(i).startsWith('\\left(')) { depth++; i += 5; }
          else if (rest.slice(i).startsWith('\\right)')) { depth--; i += 6; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(6, i - 7);
        endIndex += i;
      } else if (rest.startsWith('(')) {
        let depth = 0, i = 0;
        for (; i < rest.length; i++) {
          if (rest[i] === '(') depth++;
          else if (rest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        body = rest.slice(1, i - 1);
        endIndex += i;
      } else {
        let i = 0, depth = 0;
        while (i < rest.length) {
          const ch = rest[i];
          if (ch === '(' || ch === '{' || rest.slice(i).startsWith('\\left')) {
            depth++;
          } else if (ch === ')' || ch === '}' || rest.slice(i).startsWith('\\right')) {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (ch === '=')) {
            break;
          }
          i++;
        }
        body = rest.slice(0, i).trim();
        endIndex += i;
      }

      const replacement = `prod(${wrt}, ${latexToMath(start)}, ${latexToMath(end)}, ${latexToMath(body)})`;
      strVal = strVal.slice(0, startIndex) + replacement + strVal.slice(endIndex);
      regex.lastIndex = startIndex + replacement.length;
    }
    return strVal;
  };

  let res = processProd(str, prodRegex1, false);
  res = processProd(res, prodRegex2, true);
  return res;
}

function replaceLagrangePrimes(str: string): string {
  // Matches f'(x), f''(x), f'''(x), f^\prime(x), f^{\prime\prime}(x), f^{(2)}(x), f_1'(x), etc.
  const primeRegex = /\b([a-zA-Z][a-zA-Z0-9_]*)(?:('+)|(?:\^\{?((?:\\prime)+)\}?)|(?:\^\((\d+)\))|(?:\^\{?\((\d+)\)\}?))/g;

  let res = str;
  let match: RegExpExecArray | null;

  while ((match = primeRegex.exec(res)) !== null) {
    const rawFnName = match[1];
    let order = 1;
    if (match[2]) {
      order = match[2].length;
    } else if (match[3]) {
      order = (match[3].match(/\\prime/g) || []).length;
    } else if (match[4]) {
      order = parseInt(match[4], 10);
    } else if (match[5]) {
      order = parseInt(match[5], 10);
    }

    const startIndex = match.index;
    const afterIndex = startIndex + match[0].length;
    const rest = res.slice(afterIndex);

    let body = 'x';
    let endIndex = afterIndex;

    const trimmedRest = rest.trimStart();
    const leadingSpaces = rest.length - trimmedRest.length;

    if (trimmedRest.startsWith('\\left(')) {
      let depth = 0, i = 0;
      for (; i < trimmedRest.length; i++) {
        if (trimmedRest.slice(i).startsWith('\\left(')) { depth++; i += 5; }
        else if (trimmedRest.slice(i).startsWith('\\right)')) { depth--; i += 6; if (depth === 0) { break; } }
      }
      body = trimmedRest.slice(6, i - 6).trim();
      endIndex = afterIndex + leadingSpaces + i + 1;
    } else if (trimmedRest.startsWith('(')) {
      let depth = 0, i = 0;
      for (; i < trimmedRest.length; i++) {
        if (trimmedRest[i] === '(') depth++;
        else if (trimmedRest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      body = trimmedRest.slice(1, i - 1).trim();
      endIndex = afterIndex + leadingSpaces + i;
    }

    const fnName = rawFnName.replace(/^\\/, '');
    const wrt = /^[a-zA-Z]$/.test(body) ? body : 'x';
    const replacement = `derivative(${wrt}, ${order}, ${fnName}(${body}))`;

    res = res.slice(0, startIndex) + replacement + res.slice(endIndex);
    primeRegex.lastIndex = startIndex + replacement.length;
  }

  return res;
}

function replaceInverseFunctions(str: string): string {
  // Matches f^{-1}(x), f^-1(x), f^{-1}\left(x\right), \sin^{-1}(x), etc.
  const invRegex = /\\?\b([a-zA-Z][a-zA-Z0-9_]*)(?:\^\{-1\}|\^-1)/g;

  let res = str;
  let match: RegExpExecArray | null;

  while ((match = invRegex.exec(res)) !== null) {
    const rawFnName = match[1].replace(/^\\/, '');
    const startIndex = match.index;
    const afterIndex = startIndex + match[0].length;
    const rest = res.slice(afterIndex);

    let body = 'x';
    let endIndex = afterIndex;

    const trimmedRest = rest.trimStart();
    const leadingSpaces = rest.length - trimmedRest.length;

    if (trimmedRest.startsWith('\\left(')) {
      let depth = 0, i = 0;
      for (; i < trimmedRest.length; i++) {
        if (trimmedRest.slice(i).startsWith('\\left(')) { depth++; i += 5; }
        else if (trimmedRest.slice(i).startsWith('\\right)')) { depth--; i += 6; if (depth === 0) { break; } }
      }
      body = trimmedRest.slice(6, i - 6).trim();
      endIndex = afterIndex + leadingSpaces + i + 1;
    } else if (trimmedRest.startsWith('(')) {
      let depth = 0, i = 0;
      for (; i < trimmedRest.length; i++) {
        if (trimmedRest[i] === '(') depth++;
        else if (trimmedRest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      }
      body = trimmedRest.slice(1, i - 1).trim();
      endIndex = afterIndex + leadingSpaces + i;
    }

    let replacement = '';
    const fn = rawFnName.toLowerCase();
    if (fn === 'sin') replacement = `asin(${body})`;
    else if (fn === 'cos') replacement = `acos(${body})`;
    else if (fn === 'tan' || fn === 'tg') replacement = `atan(${body})`;
    else if (fn === 'cot' || fn === 'ctg') replacement = `acot(${body})`;
    else if (fn === 'sinh') replacement = `asinh(${body})`;
    else if (fn === 'cosh') replacement = `acosh(${body})`;
    else if (fn === 'tanh') replacement = `atanh(${body})`;
    else if (fn === 'ln' || fn === 'log') replacement = `exp(${body})`;
    else if (fn === 'exp') replacement = `ln(${body})`;
    else if (fn === 'sqrt') replacement = `((${body})^2)`;
    else replacement = `inverse(${rawFnName}, ${body})`;

    res = res.slice(0, startIndex) + replacement + res.slice(endIndex);
    invRegex.lastIndex = startIndex + replacement.length;
  }

  return res;
}

function replaceTrigAndLogPowers(str: string): string {
  // Functions that support powers: cos^n x, sin^2 x, ln^2 x, log^2 x, etc.
  const fns = 'sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|ln|log|lg|tg|ctg|arcsin|arccos|arctan|arccot';

  let res = str;

  // 1. With \left( ... \right): e.g. \cos^{n}\left(x\right) or \cos^2\left(x\right)
  const leftRightRegex = new RegExp('(\\\\?(?:' + fns + '))(?:_(?:\\{([^{}]+)\\}|([a-zA-Z0-9])))?\\s*(?:\\^\\{([^{}]+)\\}|\\^([a-zA-Z0-9]))\\s*\\\\left\\(([\\s\\S]*?)\\\\right\\)', 'g');
  res = res.replace(leftRightRegex, (_m, fn, base1, base2, p1, p2, arg) => {
    const base = base1 || base2;
    const power = p1 || p2;
    const basePart = base ? '_{' + base + '}' : '';
    return '((' + fn + basePart + '\\left(' + arg + '\\right))^(' + power + '))';
  });

  // 2. With parentheses (...): e.g. \cos^{n}(x) or \cos^2(x)
  const parenRegex = new RegExp('(\\\\?(?:' + fns + '))(?:_(?:\\{([^{}]+)\\}|([a-zA-Z0-9])))?\\s*(?:\\^\\{([^{}]+)\\}|\\^([a-zA-Z0-9]))\\s*\\(([^()]*)\\)', 'g');
  res = res.replace(parenRegex, (_m, fn, base1, base2, p1, p2, arg) => {
    const base = base1 || base2;
    const power = p1 || p2;
    const basePart = base ? '_{' + base + '}' : '';
    return '((' + fn + basePart + '(' + arg + '))^(' + power + '))';
  });

  // 3. With braces {...}: e.g. \cos^{n}{x}
  const braceRegex = new RegExp('(\\\\?(?:' + fns + '))(?:_(?:\\{([^{}]+)\\}|([a-zA-Z0-9])))?\\s*(?:\\^\\{([^{}]+)\\}|\\^([a-zA-Z0-9]))\\s*\\{([^{}]+)\\}', 'g');
  res = res.replace(braceRegex, (_m, fn, base1, base2, p1, p2, arg) => {
    const base = base1 || base2;
    const power = p1 || p2;
    const basePart = base ? '_{' + base + '}' : '';
    return '((' + fn + basePart + '(' + arg + '))^(' + power + '))';
  });

  // 4. With single token argument: e.g. \cos^2 x or \cos^{n} x or \ln^2 x
  const simpleArgRegex = new RegExp('(\\\\?(?:' + fns + '))(?:_(?:\\{([^{}]+)\\}|([a-zA-Z0-9])))?\\s*(?:\\^\\{([^{}]+)\\}|\\^([a-zA-Z0-9]))\\s*([a-zA-Z0-9_]+)(?!\\()', 'g');
  res = res.replace(simpleArgRegex, (_m, fn, base1, base2, p1, p2, arg) => {
    const base = base1 || base2;
    const power = p1 || p2;
    const basePart = base ? '_{' + base + '}' : '';
    // If argument ends with attached differential, e.g. 'xdx', 'tdt', 'ydy':
    const diffSuffixMatch = arg.match(/^([a-zA-Z0-9_]+?)(d[a-zA-Z])$/);
    if (diffSuffixMatch) {
      return '((' + fn + basePart + '(' + diffSuffixMatch[1] + '))^(' + power + ')) ' + diffSuffixMatch[2];
    }
    return '((' + fn + basePart + '(' + arg + '))^(' + power + '))';
  });

  return res;
}

function replaceAbsoluteValues(str: string): string {
  // Normalize MathLive and LaTeX absolute value delimiters
  let s = str;
  s = s.replace(/\\left\s*\\lvert/g, ' [OPEN_ABS] ');
  s = s.replace(/\\right\s*\\rvert/g, ' [CLOSE_ABS] ');
  s = s.replace(/\\left\s*\|/g, ' [OPEN_ABS] ');
  s = s.replace(/\\right\s*\|/g, ' [CLOSE_ABS] ');
  s = s.replace(/\\left\s*\\vert/g, ' [OPEN_ABS] ');
  s = s.replace(/\\right\s*\\vert/g, ' [CLOSE_ABS] ');
  s = s.replace(/\\lvert/g, ' [OPEN_ABS] ');
  s = s.replace(/\\rvert/g, ' [CLOSE_ABS] ');

  // Scan and pair bare '|' and '\vert'
  let result = '';
  let absDepth = 0;
  let i = 0;

  while (i < s.length) {
    if (s.slice(i).startsWith('[OPEN_ABS]')) {
      result += 'abs(';
      absDepth++;
      i += 10;
      continue;
    }
    if (s.slice(i).startsWith('[CLOSE_ABS]')) {
      result += ')';
      if (absDepth > 0) absDepth--;
      i += 11;
      continue;
    }

    const isBarePipe = s[i] === '|';
    const isSlashVert = s.slice(i).startsWith('\\vert');

    if (isBarePipe || isSlashVert) {
      const skipLen = isBarePipe ? 1 : 5;
      const prevTrimmed = result.trimEnd();
      const lastChar = prevTrimmed.length > 0 ? prevTrimmed[prevTrimmed.length - 1] : '';

      const isPrecededByOp = prevTrimmed.length === 0 ||
        /[(\[{,=+\-*/^<>]/.test(lastChar) ||
        prevTrimmed.endsWith('\\le') ||
        prevTrimmed.endsWith('\\ge') ||
        prevTrimmed.endsWith('\\cdot') ||
        prevTrimmed.endsWith('abs(');

      if (isPrecededByOp || absDepth === 0) {
        result += 'abs(';
        absDepth++;
      } else {
        result += ')';
        absDepth--;
      }
      i += skipLen;
    } else {
      result += s[i];
      i++;
    }
  }

  while (absDepth > 0) {
    result += ')';
    absDepth--;
  }

  return result;
}

function extractLimit(str: string, pos: number): { limit: string; nextPos: number } | null {
  let i = pos;
  while (i < str.length && /\s/.test(str[i])) i++;
  if (i >= str.length) return null;

  if (str[i] === '{') {
    let depth = 0;
    const start = i + 1;
    while (i < str.length) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) {
          return { limit: str.substring(start, i), nextPos: i + 1 };
        }
      }
      i++;
    }
    return { limit: str.substring(start), nextPos: str.length };
  }

  // Backslashed command or Greek letter with optional subscript: \alpha, \alpha_0, \alpha_{0}, \pi, \infty
  if (str[i] === '\\') {
    const cmdMatch = str.slice(i).match(/^\\([a-zA-Z]+)(?:_\{([^}]*)\}|_([a-zA-Z0-9]))?/);
    if (cmdMatch) {
      return { limit: cmdMatch[0], nextPos: i + cmdMatch[0].length };
    }
  }

  // Identifier or number: x, 0, 1.2, alpha_0
  const idMatch = str.slice(i).match(/^[a-zA-Z0-9_.]+/);
  if (idMatch) {
    return { limit: idMatch[0], nextPos: i + idMatch[0].length };
  }

  return { limit: str[i], nextPos: i + 1 };
}

function stripTrailingDomainRestriction(str: string): string {
  let s = str.trimEnd();
  if (!s.endsWith('}') && !s.endsWith('\\}')) {
    return s;
  }

  let depth = 0;
  let i = s.length - 1;
  while (i >= 0) {
    if (s[i] === '}') {
      depth++;
    } else if (s[i] === '{') {
      depth--;
      if (depth === 0) {
        let braceStart = i;
        if (braceStart > 0 && s[braceStart - 1] === '\\') {
          braceStart--;
        }
        const inner = s.substring(i + 1, s.length - (s.endsWith('\\}') ? 2 : 1)).trim();
        if (/\\le|\\ge|<=|>=|<|>/.test(inner)) {
          return s.substring(0, braceStart).trim();
        }
        break;
      }
    }
    i--;
  }

  return s;
}

function extractDifferential(rest: string): { wrt: string; rawBody: string; diffEnd: number; hasDiff: boolean } {
  // 1. Check if integral starts with a fraction containing the differential in numerator: e.g. \frac{d\phi}{...} or \frac{dx}{...}
  const trimmed = rest.trimStart();
  const leadingSpaces = rest.length - trimmed.length;
  if (trimmed.startsWith('\\frac')) {
    const numGroup = extractGroup(trimmed, 5);
    if (numGroup) {
      const num = numGroup.content.trim();
      const numDiffRegex = /^(?:\\differentialD|\\mathrm\{\s*d\s*\}|\\operatorname\{\s*d\s*\}|d)\s*(?:\\?([a-zA-Z]+))$/;
      const ndm = num.match(numDiffRegex);
      if (ndm) {
        let wrt = ndm[1];
        if (wrt === 'varphi') wrt = 'phi';
        const denGroup = extractGroup(trimmed, numGroup.endIndex);
        if (denGroup) {
          const rawBody = `\\frac{1}{${denGroup.content}}`;
          const diffEnd = leadingSpaces + denGroup.endIndex;
          return { wrt, rawBody, diffEnd, hasDiff: true };
        }
      }
    }
  }

  // 2. Check differential at the end: ... dt, ... dx, ... d\phi, ... d\varphi
  const endDiffRegex = /(?:\\cdot|\*|\\times|\\,|\s)+(?:\\differentialD|\\mathrm\{\s*d\s*([a-zA-Z]+)\s*\}|\\mathrm\{\s*d\s*\}|\\operatorname\{\s*d\s*([a-zA-Z]+)\s*\}|\\operatorname\{\s*d\s*\}|\bd|(?<=[a-zA-Z0-9_)\}\]])\s*d)\s*(?:\\?([a-zA-Z]+))(?:\s*)$/;
  const matchEnd = rest.match(endDiffRegex);
  if (matchEnd) {
    let wrt = matchEnd[1] || matchEnd[2] || matchEnd[3] || 'x';
    if (wrt === 'varphi') wrt = 'phi';
    const diffStart = matchEnd.index!;
    const rawBody = rest.slice(0, diffStart).trim();
    return { wrt, rawBody, diffEnd: rest.length, hasDiff: true };
  }

  // 3. Fallback: matches differential anywhere within rest
  const anywhereRegex = /(?:\\cdot|\*|\\times|\\,|\s)*(?:\\differentialD|\\mathrm\{\s*d\s*([a-zA-Z]+)\s*\}|\\mathrm\{\s*d\s*\}|\\operatorname\{\s*d\s*([a-zA-Z]+)\s*\}|\\operatorname\{\s*d\s*\}|\bd|(?<=[a-zA-Z0-9_)\}\]])\s*d)\s*(?:\\?([a-zA-Z]+))(?![a-zA-Z0-9_])/;
  const match = rest.match(anywhereRegex);
  if (match) {
    let wrt = match[1] || match[2] || match[3] || 'x';
    if (wrt === 'varphi') wrt = 'phi';
    const diffStart = match.index!;
    const diffEnd = diffStart + match[0].length;
    const rawBody = (rest.slice(0, diffStart) + rest.slice(diffEnd)).replace(/(?:\\cdot|\*|\\,|\s)+$/, '').trim();
    return { wrt, rawBody, diffEnd: rest.length, hasDiff: true };
  }

  return { wrt: 'x', rawBody: rest.trim(), diffEnd: rest.length, hasDiff: false };
}

function replaceIntegrals(str: string): string {
  let res = str.replace(/\\placeholder(?:\{[^{}]*\})?/g, '');

  let safety = 0;
  while (safety++ < 50) {
    const intMatch = res.match(/(?<![a-zA-Z\\])\\int(?![a-zA-Z])/);
    if (!intMatch) break;

    const intIdx = intMatch.index!;
    let pos = intIdx + intMatch[0].length;

    while (pos < res.length && /\s/.test(res[pos])) pos++;

    let lower = '0';
    let upper = '1';
    let hasLower = false;
    let hasUpper = false;

    for (let loop = 0; loop < 2; loop++) {
      while (pos < res.length && /\s/.test(res[pos])) pos++;
      if (pos >= res.length) break;

      if (res[pos] === '_') {
        pos++;
        const lim = extractLimit(res, pos);
        if (lim) {
          lower = lim.limit;
          pos = lim.nextPos;
          hasLower = true;
        }
      } else if (res[pos] === '^') {
        pos++;
        const lim = extractLimit(res, pos);
        if (lim) {
          upper = lim.limit;
          pos = lim.nextPos;
          hasUpper = true;
        }
      } else {
        break;
      }
    }

    if (!hasLower && !hasUpper) {
      // Indefinite integral defaults
      lower = '0';
      upper = 'x';
    } else if (hasLower && !hasUpper) {
      upper = '1';
    } else if (!hasLower && hasUpper) {
      lower = '0';
    }

    const rest = res.slice(pos);
    const { wrt, rawBody, diffEnd, hasDiff } = extractDifferential(rest);
    if (!hasDiff) {
      throw new Error('Укажите переменную интегрирования (например, dx)');
    }

    const replacement = `integral(${wrt}, ${latexToMath(lower.trim() || '0')}, ${latexToMath(upper.trim() || '1')}, ${latexToMath(rawBody.trim() || '1')})`;
    const endIndex = pos + diffEnd;
    res = res.slice(0, intIdx) + replacement + res.slice(endIndex);
  }

  // Clean up any leftover bare \int without throwing
  if (/\\int(?![a-zA-Z])/.test(res)) {
    throw new Error('Укажите переменную интегрирования (например, dx)');
  }

  return res;
}
