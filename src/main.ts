import 'mathlive';
import 'mathlive/fonts.css';
import 'mathlive/static.css';

import { Camera2D } from './viewport/camera2d';
import { GraphRenderer, LineStyle } from './render/graph-renderer';
import { ExpressionManager, ExpressionEntry, HistorySnapshot, TableRegression, findMatchingBaseColumn } from './state/expression-manager';
import { RegressionType, formatNum } from './math/regression';
import { Lexer } from './math/lexer';

const GREEK_SHORTCUTS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon',
  'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
  'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
  'Upsilon', 'Phi', 'Psi', 'Omega'
];

function setupGreekShortcuts(dict: any) {
  if (!dict || typeof dict !== 'object') return;
  for (const g of GREEK_SHORTCUTS) {
    const target = g === 'phi' ? '\\varphi' : `\\${g}`;
    dict[g] = target;
    for (let d = 0; d <= 9; d++) {
      dict[`${g}${d}`] = `${target}_{${d}}`;
      dict[`${g}_${d}`] = `${target}_{${d}}`;
    }
  }
  dict['matrix'] = '\\begin{bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{bmatrix}';
  dict['vector'] = '\\begin{bmatrix} \\placeholder{} \\\\ \\placeholder{} \\end{bmatrix}';
  dict['round'] = '\\operatorname{round}';
  dict['floor'] = '\\lfloor \\placeholder{} \\rfloor';
  dict['ceil'] = '\\lceil \\placeholder{} \\rceil';
}

function resizeMatrixLatex(latex: string, targetRows: number, targetCols: number): string {
  const match = latex.match(/\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}([\s\S]*?)\\end\{\1\}/);
  if (!match) return latex;

  const env = match[1];
  const body = match[2];
  const prefix = latex.substring(0, match.index);
  const suffix = latex.substring(match.index! + match[0].length);

  // Parse existing cells
  const rawRows = body.split(/\\\\|\\cr/);
  const existing: string[][] = [];
  for (const r of rawRows) {
    if (r.trim() === '' && existing.length > 0) continue;
    existing.push(r.split('&').map(c => c.trim()));
  }

  const safeRows = Math.max(1, Math.min(8, targetRows));
  const safeCols = Math.max(1, Math.min(8, targetCols));

  const newRowsArr: string[] = [];
  for (let r = 0; r < safeRows; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < safeCols; c++) {
      let val = '\\placeholder{}';
      if (existing[r] && existing[r][c] !== undefined) {
        const cellStr = existing[r][c].trim();
        if (cellStr !== '' && cellStr !== '0' && cellStr !== '\\placeholder{}' && cellStr !== '\\placeholder') {
          val = cellStr;
        }
      }
      rowCells.push(val);
    }
    newRowsArr.push(rowCells.join(' & '));
  }

  const newBody = newRowsArr.join(' \\\\ ');
  return `${prefix}\\begin{${env}} ${newBody} \\end{${env}}${suffix}`;
}

function purgeLtGtShortcuts(mf: any) {
  try {
    const rawShortcuts = mf._mathfield?.options?.inlineShortcuts;
    if (rawShortcuts) {
      delete rawShortcuts['lt'];
      delete rawShortcuts['lt='];
      delete rawShortcuts['gt'];
      delete rawShortcuts['gt='];
      setupGreekShortcuts(rawShortcuts);
    }
  } catch (_) {}
  try {
    const sc = mf.inlineShortcuts;
    if (sc && typeof sc === 'object') {
      delete sc['lt'];
      delete sc['lt='];
      delete sc['gt'];
      delete sc['gt='];
      setupGreekShortcuts(sc);
      mf.inlineShortcuts = sc;
    }
  } catch (_) {}
}

function setupMathField(mf: any) {
  mf.mathVirtualKeyboardPolicy = 'manual';
  mf.smartFence = true;
  mf.smartSuperscript = true;
  mf.smartMode = false;
  mf.placeholderSymbol = '0';

  const injectPlaceholderStyle = () => {
    try {
      if (mf.shadowRoot && !mf.shadowRoot.querySelector('#mf-matrix-ph-style')) {
        const style = document.createElement('style');
        style.id = 'mf-matrix-ph-style';
        style.textContent = `
          .ML__placeholder {
            color: #94a3b8 !important;
            opacity: 0.55 !important;
            font-family: KaTeX_Main, 'Times New Roman', serif !important;
            font-style: normal !important;
            font-weight: normal !important;
            padding-left: 2px !important;
            padding-right: 2px !important;
            background: transparent !important;
            background-color: transparent !important;
          }
          .ML__placeholder.ML__placeholder-selected,
          .ML__focused .ML__placeholder.ML__placeholder-selected,
          .ML__focused .ML__selected .ML__placeholder,
          .ML__focused .ML__placeholder.ML__selected,
          .ML__focused .ML__selected:has(.ML__placeholder) {
            background: transparent !important;
            background-color: transparent !important;
            color: #94a3b8 !important;
            opacity: 0.55 !important;
          }
        `;
        mf.shadowRoot.appendChild(style);
      }
    } catch (_) {}
  };

  injectPlaceholderStyle();
  mf.addEventListener('mount', injectPlaceholderStyle);
  requestAnimationFrame(injectPlaceholderStyle);
  setTimeout(injectPlaceholderStyle, 0);

  purgeLtGtShortcuts(mf);
  mf.addEventListener('mount', () => purgeLtGtShortcuts(mf));
  requestAnimationFrame(() => purgeLtGtShortcuts(mf));
  setTimeout(() => purgeLtGtShortcuts(mf), 0);
}

if (typeof window !== 'undefined') {
  const initGlobalMathlive = () => {
    try {
      if ((window as any).MathfieldElement) {
        (window as any).MathfieldElement.fontsDirectory = '/fonts/';
        (window as any).MathfieldElement.placeholderSymbol = '0';

        const originalConnected = (window as any).MathfieldElement.prototype.connectedCallback;
        (window as any).MathfieldElement.prototype.connectedCallback = function() {
          originalConnected?.call(this);
          this.placeholderSymbol = '0';
          purgeLtGtShortcuts(this);
          try {
            if (this.shadowRoot && !this.shadowRoot.querySelector('#mf-matrix-ph-style')) {
              const style = document.createElement('style');
              style.id = 'mf-matrix-ph-style';
              style.textContent = `
                .ML__placeholder {
                  color: #94a3b8 !important;
                  opacity: 0.55 !important;
                  font-family: KaTeX_Main, 'Times New Roman', serif !important;
                  font-style: normal !important;
                  font-weight: normal !important;
                  padding-left: 2px !important;
                  padding-right: 2px !important;
                  background: transparent !important;
                  background-color: transparent !important;
                }
                .ML__placeholder.ML__placeholder-selected,
                .ML__focused .ML__placeholder.ML__placeholder-selected,
                .ML__focused .ML__selected .ML__placeholder,
                .ML__focused .ML__placeholder.ML__selected,
                .ML__focused .ML__selected:has(.ML__placeholder) {
                  background: transparent !important;
                  background-color: transparent !important;
                  color: #94a3b8 !important;
                  opacity: 0.55 !important;
                }
              `;
              this.shadowRoot.appendChild(style);
            }
          } catch (_) {}
        };
      }

      const dummy = document.createElement('math-field') as any;
      dummy.style.position = 'fixed';
      dummy.style.top = '-9999px';
      dummy.style.opacity = '0';
      document.body.appendChild(dummy);
      purgeLtGtShortcuts(dummy);
      requestAnimationFrame(() => {
        purgeLtGtShortcuts(dummy);
        dummy.remove();
      });
    } catch (_) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalMathlive);
  } else {
    initGlobalMathlive();
  }
}

function isBigOp(atom: any): boolean {
  if (!atom) return false;
  const cmd = atom.command;
  return typeof cmd === 'string' && /^\\(int|iint|iiint|oint|sum|prod|coprod|lim|limsup|liminf|min|max|inf|sup)$/.test(cmd);
}

function isInsideBigOpLimit(atom: any): boolean {
  let curr = atom;
  while (curr) {
    if (isBigOp(curr)) return true;
    if (curr.parent && isBigOp(curr.parent)) return true;
    if (curr.parent?.parent && isBigOp(curr.parent?.parent)) return true;
    curr = curr.parent;
  }
  return false;
}

export function upgradeMathFunctions(latex: string): string {
  let res = latex;

  // Protect anything inside \mathrm{...} or \operatorname{...} so decomposed functions are never mangled
  const protectedBlocks: string[] = [];
  res = res.replace(/\\(?:mathrm|operatorname)\{[^}]*\}/g, (match) => {
    protectedBlocks.push(match);
    return `__PROTECTED_BLOCK_${protectedBlocks.length - 1}__`;
  });

  // Protect integrals, sums, products and big operators and their limits
  res = res.replace(/(\\(?:int|iint|iiint|oint|sum|prod|coprod|lim|limsup|liminf)\b(?:(?:_(?:\{[^{}]*\}|\\?[a-zA-Z0-9]+))|(?:\^(?:\{[^{}]*\}|\\?[a-zA-Z0-9]+)))*)/g, (match) => {
    protectedBlocks.push(match);
    return `__PROTECTED_BLOCK_${protectedBlocks.length - 1}__`;
  });

  // 1. Arc functions with optional spaces or backslashes
  // e.g. 'arcsin', 'a r c s i n', 'arc\sin', 'a r c \sin', 'arc sin'
  res = res.replace(/(?<!\\)\b(?:arc|a\s*r\s*c)\s*\\?(sin|cos|tan|cot|ctg|tg)\b/g, (_m, fn) => {
    const stdFn = fn === 'ctg' ? 'cot' : (fn === 'tg' ? 'tan' : fn);
    return `\\arc${stdFn}`;
  });

  // Handle spaced letters: 'a r c s i n', 'a r c c o s', 'a r c t a n', 'a r c c o t'
  res = res.replace(/\b(?:a\s+r\s+c\s+s\s+i\s+n)\b/g, '\\arcsin');
  res = res.replace(/\b(?:a\s+r\s+c\s+c\s+o\s+s)\b/g, '\\arccos');
  res = res.replace(/\b(?:a\s+r\s+c\s+t\s+a\s+n)\b/g, '\\arctan');
  res = res.replace(/\b(?:a\s+r\s+c\s+c\s+o\s+t)\b/g, '\\arccot');

  // 2. Plain function names without backslash: arcsin, arccos, arctan, arccot, etc.
  const plainFnRegex = /(?<!\\)\b(arcsin|arccos|arctan|arccot|sinh|cosh|tanh|sqrt|cbrt|sin|cos|tan|cot|sec|csc|ln|log|exp|abs)\b/g;
  res = res.replace(plainFnRegex, '\\$1');
  res = res.replace(/(?<![a-zA-Z\\])\b(round)\b/g, '\\operatorname{round}');

  // 3. Spaced letters for common functions: 's i n', 'c o s', 't a n', 'c o t', 'l n'
  res = res.replace(/\b(?:s\s+i\s+n)\b/g, '\\sin');
  res = res.replace(/\b(?:c\s+o\s+s)\b/g, '\\cos');
  res = res.replace(/\b(?:t\s+a\s+n)\b/g, '\\tan');
  res = res.replace(/\b(?:c\s+o\s+t)\b/g, '\\cot');
  res = res.replace(/\b(?:l\s+n)\b/g, '\\ln');

  // Convert Greek letters followed by underscore and digits/identifier: omega_0 -> \omega_{0}, alpha_0 -> \alpha_{0}
  const greekNames = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|varkappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega';
  const greekSubRegex = new RegExp(`(?<![a-zA-Z])\\\\?(${greekNames})_\\{?([a-zA-Z0-9]+)\\}?`, 'g');
  res = res.replace(greekSubRegex, (_m, g, sub) => {
    const latexG = g === 'phi' ? 'varphi' : g;
    return `\\${latexG}_{${sub}}`;
  });

  // Convert Greek letters typed directly followed by digits to subscripts: alpha0 -> \alpha_{0}, omega0 -> \omega_{0}
  const greekDigitsRegex = new RegExp(`(?<![a-zA-Z])\\\\?(${greekNames})\\s*([0-9]+)(?![a-zA-Z])`, 'g');
  res = res.replace(greekDigitsRegex, (_m, g, num) => {
    const latexG = g === 'phi' ? 'varphi' : g;
    return `\\${latexG}_{${num}}`;
  });

  // Convert standalone unslashed Greek letters to proper LaTeX commands: omega -> \omega, alpha -> \alpha, phi -> \varphi
  const greekStandaloneRegex = new RegExp(`(?<![a-zA-Z\\\\_])(${greekNames})(?![a-zA-Z])`, 'g');
  res = res.replace(greekStandaloneRegex, (_m, g) => {
    const latexG = g === 'phi' ? 'varphi' : g;
    return `\\${latexG}`;
  });

  // Convert plain \phi to \varphi in display if user typed \phi
  res = res.replace(/\\phi\b(?![a-zA-Z])/g, '\\varphi');

  // 4. Auto-convert single letters followed directly by digits to subscripts: y1 -> y_{1}, x2 -> x_{2}, a1 -> a_{1}
  // Matches y1, x2, 2x1, e^{y2}, \ln y1 without matching multi-letter functions like ln, log, sin
  res = res.replace(/(?<![a-zA-Z\\_])([a-zA-Z])(?:\s*|\\cdot\s*)([0-9]+)(?![a-zA-Z])/g, '$1_{$2}');

  // Auto-upgrade Delta to \Delta: Deltax1 -> \Delta x_{1}, Delta x1 -> \Delta x_{1}, Deltap^2 -> \Delta p^{2}
  res = res.replace(/(?<!\\)\bDelta\s*([a-zA-Z])(?:\s*|\\cdot\s*)([0-9]+)\b/g, '\\Delta $1_{$2}');
  res = res.replace(/(?<!\\)\bDelta\s*([a-zA-Z])\^([0-9]+)\b/g, '\\Delta $1^{$2}');
  res = res.replace(/(?<!\\)\bDelta\s*([a-zA-Z])_\{?([0-9]+)\}?\^([0-9]+)\b/g, '\\Delta $1_{$2}^{$3}');
  res = res.replace(/(?<!\\)\bDelta\s*([a-zA-Z])\b/g, '\\Delta $1');
  res = res.replace(/(?<!\\)\bDelta\b/g, '\\Delta ');
  res = res.replace(/(?<!\\)\bdelta\s*([a-zA-Z])(?:\s*|\\cdot\s*)([0-9]+)\b/g, '\\delta $1_{$2}');
  res = res.replace(/(?<!\\)\bdelta\s*([a-zA-Z])\^([0-9]+)\b/g, '\\delta $1^{$2}');

  // 5. If operators (+, -, *, /, =) are typed at the end of a subscript, extract them to baseline
  res = res.replace(/([a-zA-Z])_\{([0-9]+)\s*([\+\-\*\/=])\}/g, '$1_{$2}$3');
  res = res.replace(/([a-zA-Z])_\{([0-9]+)\s*\\cdot\s*\}/g, '$1_{$2}\\cdot ');

  // 6. Matrix and Vector auto-upgrade from plain keyword
  res = res.replace(/(?<![a-zA-Z\\])\b(?:m\s*a\s*t\s*r\s*i\s*x|matrix)\b/gi, '\\begin{bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{bmatrix}');
  res = res.replace(/(?<![a-zA-Z\\])\b(?:v\s*e\s*c\s*t\s*o\s*r|vector)\b/gi, '\\begin{bmatrix} \\placeholder{} \\\\ \\placeholder{} \\end{bmatrix}');

  // Replace bare zeros in matrix definitions with placeholders
  res = res.replace(/\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}([\s\S]*?)\\end\{\1\}/g, (_match, env, body) => {
    const rows = body.split(/\\\\|\\cr/).map((row: string) => {
      const cols = row.split('&').map((col: string) => {
        const trimmed = col.trim();
        if (trimmed === '0') return ' \\placeholder{} ';
        return col;
      });
      return cols.join('&');
    });
    return `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
  });

  // Restore protected blocks
  res = res.replace(/__PROTECTED_BLOCK_(\d+)__/g, (_m, idx) => protectedBlocks[parseInt(idx, 10)]);

  return res;
}

class App {
  private canvas: HTMLCanvasElement;
  private camera: Camera2D;
  private renderer: GraphRenderer;
  private exprManager: ExpressionManager;
  private exprListEl: HTMLElement;
  private addMenuEl: HTMLElement;
  private customColors: string[] = [];
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private historyDebounceTimer: any = null;
  private lastSavedSnapshotJson: string = '';

  constructor() {
    this.canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
    this.exprListEl = document.getElementById('expression-list') as HTMLElement;
    this.addMenuEl = document.getElementById('add-dropdown-menu') as HTMLElement;

    this.loadCustomColors();

    const rect = this.canvas.getBoundingClientRect();
    this.camera = new Camera2D(rect.width || 800, rect.height || 600);
    this.renderer = new GraphRenderer(this.canvas);
    this.exprManager = new ExpressionManager();

    this.setupResizeObserver();
    this.setupInteractions();
    this.setupUI();
    this.loadInitialExpressions();
    this.lastSavedSnapshotJson = JSON.stringify(this.exprManager.createSnapshot());
    this.startRenderLoop();
  }

  private pushHistory(immediate: boolean = false): void {
    const doPush = () => {
      const snap = this.exprManager.createSnapshot();
      const json = JSON.stringify(snap);
      if (json === this.lastSavedSnapshotJson) return;
      this.lastSavedSnapshotJson = json;
      this.undoStack.push(snap);
      if (this.undoStack.length > 80) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    };

    if (immediate) {
      if (this.historyDebounceTimer) {
        clearTimeout(this.historyDebounceTimer);
        this.historyDebounceTimer = null;
      }
      doPush();
    } else {
      if (this.historyDebounceTimer) {
        clearTimeout(this.historyDebounceTimer);
      }
      this.historyDebounceTimer = setTimeout(() => {
        doPush();
      }, 350);
    }
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;
    const current = this.exprManager.createSnapshot();
    const prev = this.undoStack.pop()!;
    this.redoStack.push(current);
    this.lastSavedSnapshotJson = JSON.stringify(prev);
    this.exprManager.restoreSnapshot(prev);
    this.renderExpressionList();
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    const current = this.exprManager.createSnapshot();
    const next = this.redoStack.pop()!;
    this.undoStack.push(current);
    this.lastSavedSnapshotJson = JSON.stringify(next);
    this.exprManager.restoreSnapshot(next);
    this.renderExpressionList();
  }

  private loadCustomColors(): void {
    try {
      const saved = localStorage.getItem('desmos_custom_colors');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          this.customColors = arr.filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c));
        }
      }
    } catch (_) {}
  }

  private saveCustomColors(): void {
    try {
      localStorage.setItem('desmos_custom_colors', JSON.stringify(this.customColors));
    } catch (_) {}
  }

  private addCustomColor(color: string): void {
    const norm = color.toLowerCase();
    const defaultPalette = ['#2d70b3', '#c74440', '#388c46', '#6042a6', '#fa7e19', '#000000'];
    if (defaultPalette.includes(norm)) return;
    if (!this.customColors.map(c => c.toLowerCase()).includes(norm)) {
      this.customColors.push(color);
      if (this.customColors.length > 12) {
        this.customColors.shift();
      }
      this.saveCustomColors();
    }
  }

  private setupResizeObserver(): void {
    const container = document.getElementById('canvas-container')!;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.camera.resize(width, height);
          this.renderer.resize(width, height);
        }
      }
    });
    ro.observe(container);
  }

  private setupInteractions(): void {
    const container = document.getElementById('canvas-container')!;

    // Pan with mouse drag
    let canvasRect: DOMRect | null = null;

    container.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      canvasRect = this.canvas.getBoundingClientRect();
      this.camera.startPan(e.clientX - canvasRect.left, e.clientY - canvasRect.top);
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.camera.isDragging) return;
      if (!canvasRect) canvasRect = this.canvas.getBoundingClientRect();
      this.camera.pan(e.clientX - canvasRect.left, e.clientY - canvasRect.top);
    });

    window.addEventListener('mouseup', () => {
      if (this.camera.isDragging) {
        this.camera.endPan();
      }
      canvasRect = null;
    });

    // Touch support for dragging/panning
    container.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        canvasRect = this.canvas.getBoundingClientRect();
        const t = e.touches[0];
        this.camera.startPan(t.clientX - canvasRect.left, t.clientY - canvasRect.top);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e: TouchEvent) => {
      if (!this.camera.isDragging || e.touches.length !== 1) return;
      if (!canvasRect) canvasRect = this.canvas.getBoundingClientRect();
      const t = e.touches[0];
      this.camera.pan(t.clientX - canvasRect.left, t.clientY - canvasRect.top);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (this.camera.isDragging) {
        this.camera.endPan();
      }
      canvasRect = null;
    });

    // Zoom centered around cursor
    container.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.camera.zoomAt(sx, sy, zoomFactor);
    }, { passive: false });

    // Overlay control buttons
    document.getElementById('zoom-in')?.addEventListener('click', () => {
      this.camera.zoomAt(this.camera.screenWidth / 2, this.camera.screenHeight / 2, 1.25);
    });

    document.getElementById('zoom-out')?.addEventListener('click', () => {
      this.camera.zoomAt(this.camera.screenWidth / 2, this.camera.screenHeight / 2, 1 / 1.25);
    });

    document.getElementById('reset-view')?.addEventListener('click', () => {
      this.camera.centerX = 0;
      this.camera.centerY = 0;
      this.camera.zoom = 50;
    });
  }

  private setupUI(): void {
    const addBtn = document.getElementById('add-expr-btn')!;
    
    // Toggle dropdown menu
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addMenuEl.classList.toggle('show');
    });

    // Close menu when clicking outside
    window.addEventListener('click', () => {
      this.addMenuEl.classList.remove('show');
    });

    // Menu options
    this.addMenuEl.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (item as HTMLElement).dataset.action;
        this.addMenuEl.classList.remove('show');
        this.handleAddMenuAction(action);
      });
    });

    // Clicking in empty area below expressions creates or focuses empty line
    const handleEmptyClick = () => {
      const last = this.exprManager.entries[this.exprManager.entries.length - 1];
      if (last && last.rawText.trim() === '') {
        this.focusEntry(last.id);
      } else {
        const entry = this.exprManager.addExpression('');
        this.renderExpressionList();
        this.focusEntry(entry.id);
      }
    };

    const emptyArea = document.getElementById('empty-click-area');
    if (emptyArea) {
      emptyArea.addEventListener('click', handleEmptyClick);
    }

    const scrollContainer = document.querySelector('.sidebar-scroll-container');
    if (scrollContainer) {
      scrollContainer.addEventListener('click', (e) => {
        if (e.target === scrollContainer) {
          handleEmptyClick();
        }
      });
      scrollContainer.addEventListener('scroll', () => {
        this.repositionAllMatrixHandles();
      });
    }

    window.addEventListener('resize', () => {
      this.repositionAllMatrixHandles();
    });

    this.exprListEl.addEventListener('click', (e) => {
      if (e.target === this.exprListEl) {
        handleEmptyClick();
      }
    });

    // Global Undo/Redo shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я';
        const isY = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н';
        if (isZ && !e.shiftKey) {
          const active = document.activeElement as any;
          if (active && active.tagName === 'MATH-FIELD' && typeof active.canUndo === 'function' && active.canUndo()) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          this.undo();
        } else if (isY || (isZ && e.shiftKey)) {
          const active = document.activeElement as any;
          if (active && active.tagName === 'MATH-FIELD' && typeof active.canRedo === 'function' && active.canRedo()) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          this.redo();
        }
      }
    });

    this.setupSidebarControls();
  }

  private setupSidebarControls(): void {
    const sidebar = document.getElementById('sidebar') as HTMLElement;
    const resizer = document.getElementById('sidebar-resizer') as HTMLElement;
    const toggleBtn = document.getElementById('btn-toggle-sidebar') as HTMLElement;
    const showBtn = document.getElementById('btn-show-sidebar') as HTMLElement;

    if (!sidebar) return;

    // 1. Restore saved width and collapsed state
    const savedWidth = localStorage.getItem('desmos_sidebar_width');
    if (savedWidth) {
      const w = parseInt(savedWidth, 10);
      if (!isNaN(w) && w >= 260 && w <= window.innerWidth - 100) {
        sidebar.style.width = `${w}px`;
      }
    }

    const isCollapsed = localStorage.getItem('desmos_sidebar_collapsed') === 'true';
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      if (showBtn) showBtn.style.display = 'flex';
    }

    // 2. Hide / Expand sidebar toggles
    const collapseSidebar = () => {
      sidebar.classList.add('collapsed');
      if (showBtn) showBtn.style.display = 'flex';
      localStorage.setItem('desmos_sidebar_collapsed', 'true');
      setTimeout(() => {
        const container = document.getElementById('canvas-container');
        if (container) {
          this.camera.resize(container.clientWidth, container.clientHeight);
          this.renderer.resize(container.clientWidth, container.clientHeight);
        }
      }, 260);
    };

    const expandSidebar = () => {
      sidebar.classList.remove('collapsed');
      if (showBtn) showBtn.style.display = 'none';
      localStorage.setItem('desmos_sidebar_collapsed', 'false');
      setTimeout(() => {
        const container = document.getElementById('canvas-container');
        if (container) {
          this.camera.resize(container.clientWidth, container.clientHeight);
          this.renderer.resize(container.clientWidth, container.clientHeight);
        }
      }, 260);
    };

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSidebar();
      });
    }

    if (showBtn) {
      showBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expandSidebar();
      });
    }

    // 3. Horizontal Resizing of Sidebar
    if (resizer) {
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
        const newWidth = Math.max(260, Math.min(window.innerWidth - 120, startWidth + deltaX));
        sidebar.style.width = `${newWidth}px`;
        localStorage.setItem('desmos_sidebar_width', newWidth.toString());

        const container = document.getElementById('canvas-container');
        if (container) {
          this.camera.resize(container.clientWidth, container.clientHeight);
          this.renderer.resize(container.clientWidth, container.clientHeight);
        }
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove('is-dragging');
        sidebar.classList.remove('is-resizing');
        document.body.classList.remove('resizing-sidebar');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      resizer.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        resizer.classList.add('is-dragging');
        sidebar.classList.add('is-resizing');
        document.body.classList.add('resizing-sidebar');
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }
  }

  private handleAddMenuAction(action?: string): void {
    this.pushHistory(true);
    let entry: ExpressionEntry;
    if (action === 'slider') {
      const usedVars = new Set(this.exprManager.entries.map(e => e.varName).filter(Boolean));
      const candidates = ['a', 'b', 'c', 'k', 'm', 'n', 'p'];
      const v = candidates.find(c => !usedVars.has(c)) || 'k';
      entry = this.exprManager.addExpression(`${v} = 2`);
    } else if (action === 'table') {
      entry = this.exprManager.addExpression('', 'table');
    } else if (action === 'matrix') {
      const usedVars = new Set(this.exprManager.entries.map(e => e.varName).filter(Boolean));
      const candidates = ['A', 'B', 'M', 'T', 'v', 'u', 'w'];
      const v = candidates.find(c => !usedVars.has(c)) || 'A';
      entry = this.exprManager.addExpression(`${v} = \\begin{bmatrix} \\placeholder{} & \\placeholder{} \\\\ \\placeholder{} & \\placeholder{} \\end{bmatrix}`);
    } else {
      entry = this.exprManager.addExpression('');
    }

    this.renderExpressionList();
    this.focusEntry(entry.id);
  }

  private loadInitialExpressions(): void {
    this.exprManager.addExpression('');
    this.renderExpressionList();
  }

  private renderExpressionList(): void {
    this.exprListEl.innerHTML = '';

    this.exprManager.entries.forEach((entry, idx) => {
      try {
        const itemEl = document.createElement('div');
        itemEl.className = 'expression-item';
        itemEl.dataset.id = entry.id;

        // 1. Gutter: index number and color circle
        const gutterEl = document.createElement('div');
        gutterEl.className = 'item-gutter';

        const indexEl = document.createElement('span');
        indexEl.className = 'item-index';
        indexEl.textContent = (idx + 1).toString();

        const circleEl = document.createElement('div');
        circleEl.className = 'color-circle';
        const circleInner = document.createElement('div');
        circleInner.className = 'color-circle-inner';
        circleEl.appendChild(circleInner);
        this.setupCircleEvents(circleEl, circleInner, entry);

        gutterEl.appendChild(indexEl);
        gutterEl.appendChild(circleEl);
        itemEl.appendChild(gutterEl);

        // 2. Content Area
        const contentEl = document.createElement('div');
        contentEl.className = 'item-content';

        if (entry.kind === 'table') {
          this.renderTableItem(contentEl, itemEl, entry, circleInner);
        } else {
          this.renderMathItem(contentEl, itemEl, entry, circleInner);
        }

        itemEl.appendChild(contentEl);
        this.exprListEl.appendChild(itemEl);
      } catch (err) {
        console.error('Error rendering expression row:', entry, err);
      }
    });
  }

  private renderMathItem(
    contentEl: HTMLElement,
    itemEl: HTMLElement,
    entry: ExpressionEntry,
    circleInner: HTMLElement
  ): void {
    const mathRow = document.createElement('div');
    mathRow.className = 'math-row';

    const mfContainer = document.createElement('div');
    mfContainer.className = 'math-field-container';

    // Create MathLive element
    const mf = document.createElement('math-field') as any;
    mf.setValue(entry.rawText);
    setupMathField(mf);

    if (entry.type === 'variable') {
      itemEl.classList.add('is-variable');
    }

    mf.addEventListener('focus', () => {
      document.querySelectorAll('.expression-item').forEach(el => el.classList.remove('focused'));
      itemEl.classList.add('focused');
    });

    mf.addEventListener('input', () => {
      let latex = mf.getValue();

      // Check if user typed 'table' or 'таблица' to convert expression to table
      const cleanVal = latex
        .replace(/\\(?:text|mathrm|operatorname)\{([^}]*)\}/g, '$1')
        .replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '')
        .toLowerCase();
      if (cleanVal === 'table' || cleanVal === 'таблица') {
        const tableCount = this.exprManager.entries.filter(e => e.kind === 'table').length;
        const num = tableCount + 1;
        entry.kind = 'table';
        entry.type = 'graph';
        entry.rawText = '';
        entry.tableColumns = [
          { id: `c_${Date.now()}_0`, name: `x_{${num}}` },
          { id: `c_${Date.now()}_1`, name: `y_{${num}}`, color: entry.color }
        ];
        entry.tableRows = [['', '']];
        this.renderExpressionList();
        setTimeout(() => {
          const firstInp = this.exprListEl.querySelector(`[data-id="${entry.id}"] .desmos-cell-input`) as HTMLInputElement;
          if (firstInp) firstInp.focus();
        }, 30);
        return;
      }

      if ((mf as any)._isNavigating) {
        (mf as any)._isNavigating = false;
        this.exprManager.updateExpression(entry.id, latex);
        circleInner.style.backgroundColor = (entry.type === 'invalid' || entry.type === 'evaluation') ? '#cbd5e1' : entry.color;
        this.updateItemExtras(contentEl, entry, mf);
        return;
      }

      // Upgrade plain or typed functions into proper LaTeX atoms (\arcsin, \sin, etc.)
      const upgraded = upgradeMathFunctions(latex);
      if (upgraded !== latex) {
        const wasAtEnd = mf.position >= mf.lastOffset;
        const prevPos = mf.position;
        mf.setValue(upgraded);
        if (wasAtEnd) {
          try { mf.position = mf.lastOffset; } catch (_) {}
        } else {
          try { mf.position = Math.min(prevPos, mf.lastOffset); } catch (_) {}
        }
        const model = (mf as any)._mathfield?.model || (mf as any).model;
        if (model) {
          const atom = model.at?.(mf.position);
          if (atom && !isInsideBigOpLimit(atom) && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
            mf.executeCommand('moveAfterParent');
          }
        }
        latex = upgraded;
      }

      this.exprManager.updateExpression(entry.id, latex);
      this.updateCircleAppearance(circleInner, entry);
      this.pushHistory(false);

      if (entry.type === 'variable') {
        itemEl.classList.add('is-variable');
      } else {
        itemEl.classList.remove('is-variable');
      }

      // Desmos behavior: if this was the last line and the user started typing,
      // append a new empty entry to expression-list without re-rendering current input!
      const entries = this.exprManager.entries;
      const isLast = entries[entries.length - 1].id === entry.id;
      if (isLast && latex.trim().length > 0) {
        const newEntry = this.exprManager.addExpression('');
        const newItemEl = document.createElement('div');
        newItemEl.className = 'expression-item';
        newItemEl.dataset.id = newEntry.id;

        const newGutterEl = document.createElement('div');
        newGutterEl.className = 'item-gutter';
        const newIndexEl = document.createElement('span');
        newIndexEl.className = 'item-index';
        newIndexEl.textContent = this.exprManager.entries.length.toString();

        const newCircleEl = document.createElement('div');
        newCircleEl.className = 'color-circle';
        const newCircleInner = document.createElement('div');
        newCircleInner.className = 'color-circle-inner';
        newCircleEl.appendChild(newCircleInner);
        this.setupCircleEvents(newCircleEl, newCircleInner, newEntry);
        newGutterEl.appendChild(newIndexEl);
        newGutterEl.appendChild(newCircleEl);
        newItemEl.appendChild(newGutterEl);

        const newContentEl = document.createElement('div');
        newContentEl.className = 'item-content';
        this.renderMathItem(newContentEl, newItemEl, newEntry, newCircleInner);
        newItemEl.appendChild(newContentEl);

        this.exprListEl.appendChild(newItemEl);
      }

      this.updateItemExtras(contentEl, entry, mf);
      this.updateMatrixResizeHandle(mfContainer, mf, entry);
    });

    mf.addEventListener('blur', () => {
      itemEl.classList.remove('focused');
      // If user typed plain parentheses around fraction, auto-upgrade to stretchy \left( \right)
      const current = mf.getValue();
      if (current.includes('\\frac') && current.includes('(') && !current.includes('\\left(')) {
        const upgraded = current.replace(/\(([^()]*\\frac\{[^}]*\}\{[^}]*\}[^()]*)\)/g, '\\left($1\\right)');
        if (upgraded !== current) {
          mf.setValue(upgraded);
          this.exprManager.updateExpression(entry.id, upgraded);
        }
      }
    });

    mf.addEventListener('keydown', (e: KeyboardEvent) => {
      // Exit subscript if operator key is typed: y_1| -> typing '+' results in y_1 + |
      const opKeys = ['+', '-', '*', '/', '=', '(', ')', '<', '>', ','];
      if (opKeys.includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const model = (mf as any)._mathfield?.model || (mf as any).model;
        if (model) {
          const atom = model.at?.(model.position);
          if (atom && !isInsideBigOpLimit(atom) && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
            mf.executeCommand('moveAfterParent');
          }
        }
      }

      const fnRegex = /^(arcsin|arccos|arctan|arccot|sinh|cosh|tanh|asin|acos|atan|acot|sin|cos|tan|cot|sec|csc|log|ln|exp|abs)$/;
      const isBigOp = (atom: any): boolean => {
        if (!atom) return false;
        const cmd = atom.command;
        return typeof cmd === 'string' && /^\\(int|iint|iiint|oint|sum|prod|coprod)$/.test(cmd);
      };

      const isBranchEmpty = (branch: any[] | undefined): boolean => {
        if (!branch || branch.length === 0) return true;
        if (branch.length === 1 && branch[0].type === 'first') return true;
        return false;
      };

      const hasEmptyLimits = (atom: any): boolean => {
        if (!isBigOp(atom)) return false;
        return isBranchEmpty(atom.subscript) && isBranchEmpty(atom.superscript);
      };

      const check = (atom: any): string => {
        if (!atom) return '';
        // Never intercept atoms with superscripts, subscripts, limits, or complex structures (integrals, sums, fractions, roots, etc.)
        if (atom.superscript || atom.subscript || atom.hasLimits || isBigOp(atom)) return '';
        if (atom.type === 'leftright' || atom.type === 'genfrac' || atom.type === 'surd' || atom.type === 'root') return '';
        if (atom.command && typeof atom.command === 'string' && atom.command.startsWith('\\')) {
          const raw = atom.command.slice(1);
          if (fnRegex.test(raw)) return raw;
        }
        if (atom.value && typeof atom.value === 'string') {
          if (fnRegex.test(atom.value)) return atom.value;
        }
        return '';
      };

      // 1. Backspace:
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const val = typeof mf.getValue === 'function' ? mf.getValue() : (mf.value || '');
        const isEmpty = !val || val.trim() === '';
        if (isEmpty) {
          const currIdx = this.exprManager.entries.findIndex(entryItem => entryItem.id === entry.id);
          if (currIdx >= 0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const isLast = currIdx === this.exprManager.entries.length - 1;
            if (!isLast) {
              // Если строка не последняя (например, пустая строка в середине) — удаляем её
              this.pushHistory(true);
              this.exprManager.removeExpression(entry.id);
              this.renderExpressionList();
              if (currIdx > 0) {
                const prevEntry = this.exprManager.entries[currIdx - 1];
                this.focusEntry(prevEntry.id, { atEnd: true });
              }
            } else {
              // Если строка последняя — не удаляем, а переносим фокус на прошлую строку
              if (currIdx > 0) {
                const prevEntry = this.exprManager.entries[currIdx - 1];
                this.focusEntry(prevEntry.id, { atEnd: true });
              }
            }
            return;
          }
        }
        if (mf.selectionIsCollapsed !== false) {
          const model = (mf as any)._mathfield?.model || (mf as any).model;
          if (model) {
            const target = model.at?.(model.position);

            // A) Check if inside empty limits of \int, \sum, \prod (e.g. \int_{|}^{})
            const parentAtom = target?.parent;
            if (parentAtom && hasEmptyLimits(parentAtom)) {
              const opParent = parentAtom.parent;
              if (opParent) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                model.position = model.offsetOf(parentAtom.leftSibling);
                opParent.removeChild(parentAtom);
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                mf.dispatchEvent(new Event('input', { bubbles: true }));
                return;
              }
            }

            // B) Check if cursor is right after an empty \int, \sum, \prod
            if (target && hasEmptyLimits(target)) {
              const opParent = target.parent;
              if (opParent) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                model.position = model.offsetOf(target.leftSibling);
                opParent.removeChild(target);
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                mf.dispatchEvent(new Event('input', { bubbles: true }));
                return;
              }
            }

            // C) Check if cursor is right before an empty \int, \sum, \prod (e.g. |\int)
            const rightSib = target?.rightSibling;
            if (rightSib && hasEmptyLimits(rightSib)) {
              const opParent = rightSib.parent;
              if (opParent) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                model.position = model.offsetOf(target);
                opParent.removeChild(rightSib);
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                mf.dispatchEvent(new Event('input', { bubbles: true }));
                return;
              }
            }

            let fnName = check(target);
            let atomToShorten = target;

            if (fnName && atomToShorten) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              const shortened = fnName.slice(0, -1);
              const targetParent = atomToShorten.parent;
              if (targetParent) {
                model.position = model.offsetOf(atomToShorten.leftSibling);
                targetParent.removeChild(atomToShorten);
                if (shortened.length > 0) {
                  mf.insert(shortened);
                }
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                mf.dispatchEvent(new Event('input', { bubbles: true }));
                return;
              }
            }
          }
        }
      }

      // 2. ArrowLeft: Navigate character-by-character into function names (e.g. \arcsin -> arcsi|n)
      if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (mf.selectionIsCollapsed !== false) {
          const model = (mf as any)._mathfield?.model || (mf as any).model;
          if (model) {
            const target = model.at?.(model.position);
            let fnName = check(target);
            let atomToDecompose = target;

            if (fnName && atomToDecompose) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              const targetParent = atomToDecompose.parent;
              if (targetParent) {
                const targetOffset = model.offsetOf(atomToDecompose.leftSibling);
                model.position = targetOffset;
                targetParent.removeChild(atomToDecompose);
                (mf as any)._isNavigating = true;
                mf.insert('\\mathrm{' + fnName + '}');
                try {
                  mf.position = mf.position - 1;
                } catch (_) {}
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                return;
              }
            }
          }
        }
      }

      // 3. ArrowRight: Navigate character-by-character from left of function names (e.g. |\arcsin -> a|rcsin)
      if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (mf.selectionIsCollapsed !== false) {
          const model = (mf as any)._mathfield?.model || (mf as any).model;
          if (model) {
            const target = model.at?.(model.position);
            const rightSib = target?.rightSibling;
            const fnName = check(rightSib);
            if (fnName && rightSib) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              const targetParent = rightSib.parent;
              if (targetParent) {
                const targetOffset = model.offsetOf(target);
                targetParent.removeChild(rightSib);
                mf.position = targetOffset;
                (mf as any)._isNavigating = true;
                mf.insert('\\mathrm{' + fnName + '}');
                try {
                  mf.position = targetOffset + 1;
                } catch (_) {}
                mf.dirty = true;
                (mf as any)._mathfield?.requestUpdate?.();
                return;
              }
            }
          }
        }
      }

      // 4. Enter: transition to next empty row if available, or create new row below
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const currIdx = this.exprManager.entries.findIndex(eItem => eItem.id === entry.id);
        const nextEntry = currIdx !== -1 ? this.exprManager.entries[currIdx + 1] : undefined;

        // Если следующая строка уже существует и она пустая — просто переходим на неё!
        if (nextEntry && nextEntry.kind !== 'table' && (!nextEntry.rawText || nextEntry.rawText.trim() === '')) {
          this.focusEntry(nextEntry.id);
          return;
        }

        this.pushHistory(true);
        const newEntry = this.exprManager.addExpression('');
        if (currIdx >= 0 && currIdx < this.exprManager.entries.length - 1) {
          const added = this.exprManager.entries.pop()!;
          this.exprManager.entries.splice(currIdx + 1, 0, added);
        }
        this.renderExpressionList();
        this.focusEntry(newEntry.id);
        return;
      }

      // 5. ArrowDown: switch to next row (expression or table)
      if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const currIdx = this.exprManager.entries.findIndex(entryItem => entryItem.id === entry.id);
        if (currIdx !== -1 && currIdx < this.exprManager.entries.length - 1) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const nextEntry = this.exprManager.entries[currIdx + 1];
          this.focusEntry(nextEntry.id, { atEnd: false });
          return;
        }
      }

      // 6. ArrowUp: switch to previous row (expression or table)
      if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const currIdx = this.exprManager.entries.findIndex(entryItem => entryItem.id === entry.id);
        if (currIdx > 0) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const prevEntry = this.exprManager.entries[currIdx - 1];
          this.focusEntry(prevEntry.id, { atEnd: true, bottom: true });
          return;
        }
      }
    }, { capture: true });

    mfContainer.appendChild(mf);

    // Cross delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.innerHTML = '×';
    delBtn.title = 'Удалить';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushHistory(true);
      this.exprManager.removeExpression(entry.id);
      if (this.exprManager.entries.length === 0) {
        this.exprManager.addExpression('');
      }
      this.renderExpressionList();
    });

    mathRow.appendChild(mfContainer);
    mathRow.appendChild(delBtn);
    contentEl.appendChild(mathRow);

    this.updateItemExtras(contentEl, entry, mf);
    this.updateMatrixResizeHandle(mfContainer, mf, entry);
  }

  private updateMatrixResizeHandle(
    mfContainer: HTMLElement,
    mf: any,
    entry: ExpressionEntry
  ): void {
    const latex = mf.getValue();
    const hasMatrix = /\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}/.test(latex);
    let handle = mfContainer.querySelector('.matrix-resize-container') as HTMLElement | null;

    if (!hasMatrix) {
      if (handle) handle.remove();
      return;
    }

    const match = latex.match(/\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}([\s\S]*?)\\end\{\1\}/);
    let currentRows = 2;
    let currentCols = 2;
    if (match) {
      const body = match[2];
      const rawRows = body.split(/\\\\|\\cr/);
      const rows: string[][] = [];
      for (const r of rawRows) {
        if (r.trim() === '' && rows.length > 0) continue;
        rows.push(r.split('&').map((c: string) => c.trim()));
      }
      currentRows = rows.length || 1;
      currentCols = 1;
      for (const r of rows) {
        if (r.length > currentCols) currentCols = r.length;
      }
    }

    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'matrix-resize-container';
      handle.innerHTML = `
        <div class="matrix-resize-dot" title="Потяните для изменения размера матрицы"></div>
        <div class="matrix-resize-badge">${currentRows} × ${currentCols}</div>
      `;
      mfContainer.appendChild(handle);
      this.setupMatrixDrag(handle, mfContainer, mf, entry);
    }

    const badge = handle.querySelector('.matrix-resize-badge');
    if (badge) badge.textContent = `${currentRows} × ${currentCols}`;

    requestAnimationFrame(() => {
      this.positionMatrixHandle(handle!, mfContainer, mf);
    });
  }

  private positionMatrixHandle(handle: HTMLElement, mfContainer: HTMLElement, mf: any): void {
    const containerRect = mfContainer.getBoundingClientRect();
    if (containerRect.width === 0 && containerRect.height === 0) return;

    const mtable = mf.shadowRoot?.querySelector('.ML__mtable') as HTMLElement | null;
    if (mtable) {
      const matrixBox = mtable.parentElement as HTMLElement | null;
      const rightBracket = (mtable.nextElementSibling as HTMLElement | null) ||
                           (matrixBox?.lastElementChild as HTMLElement | null);

      const dRect = rightBracket ? rightBracket.getBoundingClientRect() : null;
      const mBoxRect = matrixBox ? matrixBox.getBoundingClientRect() : null;
      const tRect = mtable.getBoundingClientRect();

      // Right edge: rightmost coordinate of the closing bracket or matrix container
      const targetRight = Math.max(
        dRect && dRect.width > 0 ? dRect.right : 0,
        mBoxRect && mBoxRect.width > 0 ? mBoxRect.right : 0,
        tRect.right + 14
      );

      // Bottom edge: bottommost coordinate of the bracket
      const targetBottom = Math.max(
        dRect && dRect.height > 0 ? dRect.bottom : 0,
        mBoxRect && mBoxRect.height > 0 ? mBoxRect.bottom : 0,
        tRect.bottom + 6
      );

      const left = targetRight - containerRect.left;
      const top = targetBottom - containerRect.top;
      handle.style.left = `${left}px`;
      handle.style.top = `${top}px`;
      handle.style.display = 'flex';
    } else {
      const mfRect = mf.getBoundingClientRect();
      handle.style.left = `${mfRect.right - containerRect.left - 6}px`;
      handle.style.top = `${mfRect.bottom - containerRect.top - 2}px`;
      handle.style.display = 'flex';
    }
  }

  private repositionAllMatrixHandles(): void {
    const handles = document.querySelectorAll('.matrix-resize-container');
    handles.forEach(handleEl => {
      const handle = handleEl as HTMLElement;
      const mfContainer = handle.closest('.math-field-container') as HTMLElement;
      const mf = mfContainer?.querySelector('math-field') as any;
      if (handle && mfContainer && mf) {
        this.positionMatrixHandle(handle, mfContainer, mf);
      }
    });
  }

  private setupMatrixDrag(
    handle: HTMLElement,
    mfContainer: HTMLElement,
    mf: any,
    entry: ExpressionEntry
  ): void {
    const dot = handle.querySelector('.matrix-resize-dot') as HTMLElement;
    const badge = handle.querySelector('.matrix-resize-badge') as HTMLElement;
    if (!dot) return;

    dot.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try { dot.setPointerCapture(e.pointerId); } catch (_) {}
      handle.classList.add('is-dragging');

      const startX = e.clientX;
      const startY = e.clientY;

      const latex = mf.getValue();
      const match = latex.match(/\\begin\{(bmatrix|pmatrix|matrix|vmatrix)\}([\s\S]*?)\\end\{\1\}/);
      if (!match) return;

      const body = match[2];
      const rawRows = body.split(/\\\\|\\cr/);
      const existingRows: string[][] = [];
      for (const r of rawRows) {
        if (r.trim() === '' && existingRows.length > 0) continue;
        existingRows.push(r.split('&').map((c: string) => c.trim()));
      }
      const initialRows = existingRows.length || 1;
      let initialCols = 1;
      for (const r of existingRows) {
        if (r.length > initialCols) initialCols = r.length;
      }

      let activeRows = initialRows;
      let activeCols = initialCols;

      const onPointerMove = (moveEv: PointerEvent) => {
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;

        const stepX = 28;
        const stepY = 26;

        const newCols = Math.max(1, Math.min(8, initialCols + Math.round(dx / stepX)));
        const newRows = Math.max(1, Math.min(8, initialRows + Math.round(dy / stepY)));

        if (badge) badge.textContent = `${newRows} × ${newCols}`;

        if (newRows !== activeRows || newCols !== activeCols) {
          activeRows = newRows;
          activeCols = newCols;

          const updatedLatex = resizeMatrixLatex(mf.getValue(), newRows, newCols);
          mf.setValue(updatedLatex);
          entry.rawText = updatedLatex;
          this.exprManager.updateExpression(entry.id, updatedLatex);
          requestAnimationFrame(() => {
            this.positionMatrixHandle(handle, mfContainer, mf);
          });
        }
      };

      const onPointerUp = (upEv: PointerEvent) => {
        try { dot.releasePointerCapture(upEv.pointerId); } catch (_) {}
        handle.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        const finalLatex = resizeMatrixLatex(mf.getValue(), activeRows, activeCols);
        mf.setValue(finalLatex);
        entry.rawText = finalLatex;
        this.exprManager.updateExpression(entry.id, finalLatex);
        this.pushHistory(false);
        requestAnimationFrame(() => {
          this.positionMatrixHandle(handle, mfContainer, mf);
        });
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  }

  private renderTableItem(
    contentEl: HTMLElement,
    itemEl: HTMLElement,
    entry: ExpressionEntry,
    _circleInner: HTMLElement
  ): void {
    const tableCount = this.exprManager.entries.filter(e => e.kind === 'table').length;
    const tableNum = tableCount || 1;
    if (!entry.tableColumns || entry.tableColumns.length === 0) {
      entry.tableColumns = [
        { id: `c_${Date.now()}_0`, name: `x_{${tableNum}}` },
        { id: `c_${Date.now()}_1`, name: `y_{${tableNum}}`, color: entry.color }
      ];
    }
    itemEl.classList.add('is-table');

    if (!entry.tableRows || entry.tableRows.length === 0) {
      entry.tableRows = [['', '']];
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'table-item-content-wrapper';
    rowEl.style.position = 'relative';
    rowEl.style.display = 'flex';
    rowEl.style.flexDirection = 'column';
    rowEl.style.width = '100%';

    // Delete button (top-right X)
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.innerHTML = '×';
    delBtn.title = 'Удалить';
    delBtn.style.position = 'absolute';
    delBtn.style.top = '4px';
    delBtn.style.right = '4px';
    delBtn.style.zIndex = '5';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pushHistory(true);
      this.exprManager.removeExpression(entry.id);
      if (this.exprManager.entries.length === 0) {
        this.exprManager.addExpression('');
      }
      this.renderExpressionList();
    });
    rowEl.appendChild(delBtn);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'desmos-table-wrapper';

    const table = document.createElement('table');
    table.className = 'desmos-table';

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);

    const regressionsContainer = document.createElement('div');
    regressionsContainer.className = 'table-regressions-container';

    let renderRegressions = () => {};

    const renderTable = () => {
      const cols = entry.tableColumns!;
      const rows = entry.tableRows!;

      // Function to quickly update displayed values in computed cells without full re-render
      const updateComputedCells = () => {
        document.querySelectorAll('.expression-item').forEach(itemEl => {
          const itemEntryId = (itemEl as HTMLElement).dataset.id;
          const e = this.exprManager.entries.find(entry => entry.id === itemEntryId);
          if (e && e.kind === 'table' && e.tableColumns && e.tableRows) {
            e.tableColumns.forEach((c, colIndex) => {
              if (c.isFormula) {
                e.tableRows!.forEach((r, rowIndex) => {
                  const inp = itemEl.querySelector(`input[data-row="${rowIndex}"][data-col="${colIndex}"]`) as HTMLInputElement;
                  if (inp) {
                    inp.value = r[colIndex] || '';
                  }
                });
              }
            });
          }
        });
        renderRegressions();
      };

      // 1. Render Header Row
      thead.innerHTML = '';
      const trHead = document.createElement('tr');

      cols.forEach((col, cIdx) => {
        const th = document.createElement('th');
        th.className = `desmos-table-th ${cIdx === 0 ? 'x-header' : 'y-header'}`;
        th.style.fontWeight = 'normal';

        const inner = document.createElement('div');
        inner.className = 'desmos-header-inner';
        inner.style.fontWeight = 'normal';

        const matchingBaseCol = findMatchingBaseColumn(col.name, cols);

        if (cIdx > 0) {
          // Point circle icon for Y columns (solid circle, clean Desmos style without white dots)
          const color = col.color || entry.color;
          const icon = document.createElement('div');
          icon.className = 'desmos-point-icon';
          icon.title = 'Нажмите для изменения цвета точек';
          icon.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 22 22">
              <circle cx="11" cy="11" r="9" fill="${color}" />
            </svg>
          `;
          icon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openTableColumnColorPicker(icon, entry, cIdx, () => {
              renderTable();
            });
          });
          icon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openTableColumnColorPicker(icon, entry, cIdx, () => {
              renderTable();
            });
          });
          inner.appendChild(icon);
        }

        if (matchingBaseCol) {
          // Error bar toggle button (cross with caps icon from user's image)
          const errBtn = document.createElement('button');
          errBtn.type = 'button';
          errBtn.className = `error-col-toggle-btn ${col.isErrorActive ? 'is-active' : ''}`;
          errBtn.title = col.isErrorActive
            ? `Погрешность включена для ${matchingBaseCol.name} (нажмите для выключения)`
            : `Использовать как погрешность для ${matchingBaseCol.name}`;
          errBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="8" x2="4" y2="16" />
              <line x1="20" y1="8" x2="20" y2="16" />
              <line x1="12" y1="4" x2="12" y2="20" />
              <line x1="8" y1="4" x2="16" y1="4" />
              <line x1="8" y1="20" x2="16" y2="20" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
            </svg>
          `;
          errBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pushHistory(true);
            col.isErrorActive = !col.isErrorActive;
            col.errorTargetColId = matchingBaseCol.id;
            this.exprManager.updateTable(entry.id, rows, cols);
            renderTable();
            renderRegressions();
          });
          inner.appendChild(errBtn);
        }

        // Editable Column Header MathField
        const mfHeader = document.createElement('math-field') as any;
        mfHeader.className = 'desmos-header-mathfield';
        mfHeader.style.fontWeight = 'normal';
        mfHeader.setValue(col.name);
        setupMathField(mfHeader);

        // Clicking anywhere in the header cell focuses the header mathfield
        th.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.desmos-point-icon') || target.closest('.error-col-toggle-btn')) return;
          if (target !== mfHeader && !mfHeader.contains(target)) {
            mfHeader.focus();
          }
        });

        mfHeader.addEventListener('focus', () => {
          document.querySelectorAll('.expression-item').forEach(el => el.classList.remove('focused'));
          itemEl.classList.add('focused');
        });

        mfHeader.addEventListener('input', () => {
          const raw = mfHeader.getValue();
          const upgraded = upgradeMathFunctions(raw);
          if (upgraded !== raw) {
            const wasAtEnd = mfHeader.position >= mfHeader.lastOffset;
            const prevPos = mfHeader.position;
            mfHeader.setValue(upgraded);
            if (wasAtEnd) {
              try { mfHeader.position = mfHeader.lastOffset; } catch (_) {}
            } else {
              try { mfHeader.position = Math.min(prevPos, mfHeader.lastOffset); } catch (_) {}
            }
            const model = (mfHeader as any)._mathfield?.model || (mfHeader as any).model;
            if (model) {
              const atom = model.at?.(mfHeader.position);
              if (atom && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
                mfHeader.executeCommand('moveAfterParent');
              }
            }
          }
          col.name = mfHeader.getValue();
          this.exprManager.updateTable(entry.id, rows, cols);
          this.pushHistory(false);
          updateComputedCells();

          // Live update error button without destroying focus or mathfield
          const matchCol = findMatchingBaseColumn(col.name, cols);
          let currentErrBtn = inner.querySelector('.error-col-toggle-btn') as HTMLButtonElement | null;
          if (matchCol) {
            if (!currentErrBtn) {
              currentErrBtn = document.createElement('button');
              currentErrBtn.type = 'button';
              currentErrBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="8" x2="4" y2="16" />
                  <line x1="20" y1="8" x2="20" y2="16" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                  <line x1="8" y1="4" x2="16" y1="4" />
                  <line x1="8" y1="20" x2="16" y2="20" />
                  <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                </svg>
              `;
              currentErrBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.pushHistory(true);
                col.isErrorActive = !col.isErrorActive;
                col.errorTargetColId = matchCol.id;
                this.exprManager.updateTable(entry.id, rows, cols);
                renderTable();
                renderRegressions();
              });
              inner.insertBefore(currentErrBtn, mfHeader);
            }
            currentErrBtn.title = col.isErrorActive
              ? `Погрешность включена для ${matchCol.name} (нажмите для выключения)`
              : `Использовать как погрешность для ${matchCol.name}`;
            currentErrBtn.className = `error-col-toggle-btn ${col.isErrorActive ? 'is-active' : ''}`;
          } else if (currentErrBtn) {
            currentErrBtn.remove();
          }
        });

        mfHeader.addEventListener('blur', () => {
          if (!col.name || col.name.trim() === '') {
            const fallback = cIdx === 0 ? `x_{${tableNum}}` : `y_{${tableNum},${cIdx}}`;
            col.name = fallback;
            mfHeader.setValue(fallback);
            this.exprManager.updateTable(entry.id, rows, cols);
          }
        });

        mfHeader.addEventListener('keydown', (e: KeyboardEvent) => {
          const opKeys = ['+', '-', '*', '/', '=', '(', ')', '<', '>', ','];
          if (opKeys.includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const model = (mfHeader as any)._mathfield?.model || (mfHeader as any).model;
            if (model) {
              const atom = model.at?.(model.position);
              if (atom && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
                mfHeader.executeCommand('moveAfterParent');
              }
            }
          }

          // ArrowRight: "если после набора текста нет символов, то кнопка вправо будет переносить на столбец вправо"
          if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const isAtEnd = (mfHeader.position >= mfHeader.lastOffset && mfHeader.lastOffset >= 0) || mfHeader.getValue().trim() === '';
            if (isAtEnd && mfHeader.selectionIsCollapsed !== false) {
              e.preventDefault();
              e.stopPropagation();
              if (cIdx < cols.length - 1) {
                const nextMf = thead.querySelectorAll('math-field')[cIdx + 1] as any;
                if (nextMf) {
                  nextMf.focus();
                  try { nextMf.position = 0; } catch (_) {}
                }
              } else {
                mfPhantom.focus();
                try { mfPhantom.position = 0; } catch (_) {}
              }
              return;
            }
          }

          // ArrowLeft: "также если перед набором текста нет символов, то кнопка влево будет переносить на столбец влево"
          if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const isAtStart = mfHeader.position === 0 || mfHeader.getValue().trim() === '';
            if (isAtStart && cIdx > 0 && mfHeader.selectionIsCollapsed !== false) {
              e.preventDefault();
              e.stopPropagation();
              const prevMf = thead.querySelectorAll('math-field')[cIdx - 1] as any;
              if (prevMf) {
                prevMf.focus();
                try { prevMf.position = prevMf.lastOffset; } catch (_) {}
              }
              return;
            }
          }

          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            const firstCell = tbody.querySelector(`input[data-row="0"][data-col="${cIdx}"]`) as HTMLInputElement;
            if (firstCell) firstCell.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.focusPreviousEntry(entry.id);
          } else if (e.key === 'Tab') {
            if (!e.shiftKey) {
              e.preventDefault();
              const nextMf = thead.querySelectorAll('math-field')[cIdx + 1] as any;
              if (nextMf) nextMf.focus();
            } else if (cIdx > 0) {
              e.preventDefault();
              const prevMf = thead.querySelectorAll('math-field')[cIdx - 1] as any;
              if (prevMf) prevMf.focus();
            }
          } else if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const headerEmpty = mfHeader.getValue().trim() === '';
            const allCellsEmpty = rows.every(r => !r[cIdx] || r[cIdx].trim() === '');
            if (headerEmpty && allCellsEmpty) {
              if (cIdx > 1) {
                e.preventDefault();
                e.stopPropagation();
                this.pushHistory(true);
                cols.splice(cIdx, 1);
                rows.forEach(r => r.splice(cIdx, 1));
                this.exprManager.updateTable(entry.id, rows, cols);
                renderTable();
                setTimeout(() => {
                  const prevMf = thead.querySelectorAll('math-field')[cIdx - 1] as any;
                  if (prevMf) {
                    prevMf.focus();
                    try { prevMf.position = prevMf.lastOffset; } catch (_) {}
                  }
                }, 20);
              }
            }
          }
        }, { capture: true });

        inner.appendChild(mfHeader);
        th.appendChild(inner);
        trHead.appendChild(th);
      });

      // --- PHANTOM COLUMN HEADER ---
      const thPhantom = document.createElement('th');
      thPhantom.className = 'desmos-table-th phantom-header';
      thPhantom.style.fontWeight = 'normal';
      const innerPhantom = document.createElement('div');
      innerPhantom.className = 'desmos-header-inner';
      innerPhantom.style.fontWeight = 'normal';

      const mfPhantom = document.createElement('math-field') as any;
      mfPhantom.className = 'desmos-header-mathfield phantom-header-mathfield';
      mfPhantom.style.fontWeight = 'normal';
      mfPhantom.setValue('');
      setupMathField(mfPhantom);

      // Clicking anywhere in phantom header focuses phantom mathfield
      thPhantom.addEventListener('click', () => {
        if (document.activeElement !== mfPhantom) {
          mfPhantom.focus();
        }
      });

      mfPhantom.addEventListener('focus', () => {
        document.querySelectorAll('.expression-item').forEach(el => el.classList.remove('focused'));
        itemEl.classList.add('focused');
      });

      mfPhantom.addEventListener('input', () => {
        let val = mfPhantom.getValue().trim();
        if (!val) return;
        val = upgradeMathFunctions(val);
        const nextIdx = cols.length;
        const nextColor = this.exprManager.colorPalette[(cols.length - 1) % this.exprManager.colorPalette.length];
        cols.push({
          id: `c_${Date.now()}_${nextIdx}`,
          name: val,
          color: nextColor
        });
        rows.forEach(r => r.push(''));
        this.exprManager.updateTable(entry.id, rows, cols);
        renderTable();
        setTimeout(() => {
          const newMf = thead.querySelectorAll('math-field')[nextIdx] as any;
          if (newMf) {
            newMf.focus();
            try { newMf.position = newMf.lastOffset; } catch (_) {}
            const model = (newMf as any)._mathfield?.model || (newMf as any).model;
            if (model) {
              const atom = model.at?.(newMf.position);
              if (atom && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
                newMf.executeCommand('moveAfterParent');
              }
            }
          }
        }, 20);
      });

      mfPhantom.addEventListener('keydown', (e: KeyboardEvent) => {
        const opKeys = ['+', '-', '*', '/', '=', '(', ')', '<', '>', ','];
        if (opKeys.includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const model = (mfPhantom as any)._mathfield?.model || (mfPhantom as any).model;
          if (model) {
            const atom = model.at?.(model.position);
            if (atom && (atom.parentBranch === 'subscript' || atom.parent?.parentBranch === 'subscript')) {
              mfPhantom.executeCommand('moveAfterParent');
            }
          }
        }

        // ArrowLeft: move to the last committed column header
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const isAtStart = mfPhantom.position === 0 || mfPhantom.getValue().trim() === '';
          if (isAtStart) {
            e.preventDefault();
            e.stopPropagation();
            const prevMf = thead.querySelectorAll('math-field')[cols.length - 1] as any;
            if (prevMf) {
              prevMf.focus();
              try { prevMf.position = prevMf.lastOffset; } catch (_) {}
            }
            return;
          }
        }

        // Backspace in rightmost (phantom) column:
        // "если это самый правый столбец, то не удаляй, а переноси набор текста на столбец влево"
        if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && mfPhantom.getValue().trim() === '') {
          e.preventDefault();
          e.stopPropagation();
          const prevMf = thead.querySelectorAll('math-field')[cols.length - 1] as any;
          if (prevMf) {
            prevMf.focus();
            try { prevMf.position = prevMf.lastOffset; } catch (_) {}
          }
          return;
        }

        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          const firstPhantomCell = tbody.querySelector(`input.phantom-cell-input[data-row="0"]`) as HTMLInputElement;
          if (firstPhantomCell) firstPhantomCell.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.focusPreviousEntry(entry.id);
        } else if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
          const prevMf = thead.querySelectorAll('math-field')[cols.length - 1] as any;
          if (prevMf) prevMf.focus();
        }
      }, { capture: true });

      innerPhantom.appendChild(mfPhantom);
      thPhantom.appendChild(innerPhantom);
      trHead.appendChild(thPhantom);
      thead.appendChild(trHead);

      // 2. Render Data Rows
      tbody.innerHTML = '';
      rows.forEach((row, rIdx) => {
        const tr = document.createElement('tr');
        cols.forEach((col, cIdx) => {
          const td = document.createElement('td');
          td.className = `desmos-table-td ${cIdx === 0 ? 'x-cell' : 'y-cell'}`;

          const input = document.createElement('input');
          input.type = 'text';
          input.className = `desmos-cell-input ${col.isFormula ? 'is-computed' : ''}`;
          input.value = row[cIdx] || '';
          input.dataset.row = rIdx.toString();
          input.dataset.col = cIdx.toString();

          if (col.isFormula) {
            input.readOnly = true;
            input.title = `Вычисляется по формуле ${col.name}`;
          }

          input.addEventListener('focus', () => {
            document.querySelectorAll('.expression-item').forEach(el => el.classList.remove('focused'));
            itemEl.classList.add('focused');
          });

          // Clicking anywhere in td focuses the cell input
          td.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target === input) return;
            if (!col.isFormula) {
              input.focus();
            }
          });

          input.addEventListener('input', () => {
            if (col.isFormula) return;
            row[cIdx] = input.value;
            // If user types into the last row and it's non-empty, auto-append a new empty row
            if (rIdx === rows.length - 1 && input.value.trim() !== '') {
              const newRow = cols.map(() => '');
              rows.push(newRow);
              this.exprManager.updateTable(entry.id, rows);
              renderTable();
              const cur = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx}"]`) as HTMLInputElement;
              if (cur) {
                cur.focus();
                cur.setSelectionRange(input.value.length, input.value.length);
              }
              return;
            }
            this.exprManager.updateTable(entry.id, rows);
            this.pushHistory(false);
            updateComputedCells();
          });

          input.addEventListener('keydown', (e: KeyboardEvent) => {
            // ArrowRight: "если после набора текста нет символов, то кнопка вправо будет переносить на столбец вправо"
            if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
              if (atEnd) {
                e.preventDefault();
                e.stopPropagation();
                if (cIdx < cols.length - 1) {
                  const nextInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx + 1}"]`) as HTMLInputElement;
                  if (nextInp) {
                    nextInp.focus();
                    nextInp.setSelectionRange(0, 0);
                  }
                } else {
                  const phantomCell = tbody.querySelector(`tr:nth-child(${rIdx + 1}) .phantom-cell-input`) as HTMLInputElement;
                  if (phantomCell) {
                    phantomCell.focus();
                    phantomCell.setSelectionRange(0, 0);
                  }
                }
                return;
              }
            }

            // ArrowLeft: "если перед набором текста нет символов, то кнопка влево будет переносить на столбец влево"
            if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
              if (atStart && cIdx > 0) {
                e.preventDefault();
                e.stopPropagation();
                const prevInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx - 1}"]`) as HTMLInputElement;
                if (prevInp) {
                  prevInp.focus();
                  prevInp.setSelectionRange(prevInp.value.length, prevInp.value.length);
                }
                return;
              }
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              if (rIdx === rows.length - 1) {
                this.pushHistory(true);
                const newRow = cols.map(() => '');
                rows.push(newRow);
                this.exprManager.updateTable(entry.id, rows);
                renderTable();
              }
              setTimeout(() => {
                const nextInp = tbody.querySelector(`input[data-row="${rIdx + 1}"][data-col="${cIdx}"]`) as HTMLInputElement;
                if (nextInp) nextInp.focus();
              }, 10);
            } else if (e.key === 'ArrowDown') {
              if (rIdx < rows.length - 1) {
                e.preventDefault();
                const nextInp = tbody.querySelector(`input[data-row="${rIdx + 1}"][data-col="${cIdx}"]`) as HTMLInputElement;
                if (nextInp) nextInp.focus();
              } else if (input.value.trim() !== '') {
                e.preventDefault();
                this.pushHistory(true);
                const newRow = cols.map(() => '');
                rows.push(newRow);
                this.exprManager.updateTable(entry.id, rows);
                renderTable();
                setTimeout(() => {
                  const nextInp = tbody.querySelector(`input[data-row="${rIdx + 1}"][data-col="${cIdx}"]`) as HTMLInputElement;
                  if (nextInp) nextInp.focus();
                }, 10);
              } else {
                e.preventDefault();
                this.focusNextEntry(entry.id);
              }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (rIdx > 0) {
                const prevInp = tbody.querySelector(`input[data-row="${rIdx - 1}"][data-col="${cIdx}"]`) as HTMLInputElement;
                if (prevInp) prevInp.focus();
              } else {
                const headMf = thead.querySelectorAll('math-field')[cIdx] as any;
                if (headMf) {
                  headMf.focus();
                  try { headMf.position = headMf.lastOffset; } catch (_) {}
                } else {
                  this.focusPreviousEntry(entry.id);
                }
              }
            } else if (e.key === 'Tab') {
              if (!e.shiftKey) {
                if (cIdx < cols.length - 1) {
                  e.preventDefault();
                  const nextColInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx + 1}"]`) as HTMLInputElement;
                  if (nextColInp) nextColInp.focus();
                } else {
                  e.preventDefault();
                  const phantomCell = tbody.querySelector(`tr:nth-child(${rIdx + 1}) .phantom-cell-input`) as HTMLInputElement;
                  if (phantomCell) phantomCell.focus();
                }
              } else {
                if (cIdx > 0) {
                  e.preventDefault();
                  const prevColInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx - 1}"]`) as HTMLInputElement;
                  if (prevColInp) prevColInp.focus();
                } else if (rIdx > 0) {
                  e.preventDefault();
                  const prevRowInp = tbody.querySelector(`input[data-row="${rIdx - 1}"][data-col="${cols.length - 1}"]`) as HTMLInputElement;
                  if (prevRowInp) prevRowInp.focus();
                }
              }
            } else if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
              const headerEmpty = (!cols[cIdx].name || cols[cIdx].name.trim() === '');
              const colEmpty = rows.every(r => !r[cIdx] || r[cIdx].trim() === '');
              if (headerEmpty && colEmpty && cIdx > 1) {
                e.preventDefault();
                this.pushHistory(true);
                cols.splice(cIdx, 1);
                rows.forEach(r => r.splice(cIdx, 1));
                this.exprManager.updateTable(entry.id, rows, cols);
                renderTable();
                setTimeout(() => {
                  const prevInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cIdx - 1}"]`) as HTMLInputElement;
                  if (prevInp) {
                    prevInp.focus();
                    prevInp.setSelectionRange(prevInp.value.length, prevInp.value.length);
                  }
                }, 10);
                return;
              }

              if (input.value === '') {
                const rowIsEmpty = row.every(val => !val || val.trim() === '');
                if (rowIsEmpty && rows.length > 1) {
                  const isLastRow = rIdx === rows.length - 1;
                  if (!isLastRow) {
                    e.preventDefault();
                    this.pushHistory(true);
                    rows.splice(rIdx, 1);
                    this.exprManager.updateTable(entry.id, rows);
                    renderTable();
                    const targetR = Math.max(0, rIdx - 1);
                    setTimeout(() => {
                      const targetInp = tbody.querySelector(`input[data-row="${targetR}"][data-col="${cIdx}"]`) as HTMLInputElement;
                      if (targetInp) targetInp.focus();
                    }, 10);
                  } else {
                    e.preventDefault();
                    const prevRowInp = tbody.querySelector(`input[data-row="${rIdx - 1}"][data-col="${cIdx}"]`) as HTMLInputElement;
                    if (prevRowInp) prevRowInp.focus();
                  }
                }
              }
            }
          });

          td.appendChild(input);
          tr.appendChild(td);
        });

        // --- PHANTOM CELL FOR THIS ROW ---
        const tdPhantom = document.createElement('td');
        tdPhantom.className = 'desmos-table-td phantom-cell';

        const phantomInput = document.createElement('input');
        phantomInput.type = 'text';
        phantomInput.className = 'desmos-cell-input phantom-cell-input';
        phantomInput.value = '';
        phantomInput.dataset.row = rIdx.toString();

        phantomInput.addEventListener('focus', () => {
          document.querySelectorAll('.expression-item').forEach(el => el.classList.remove('focused'));
          itemEl.classList.add('focused');
        });

        // Clicking anywhere in phantom td focuses the phantom input
        tdPhantom.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target === phantomInput) return;
          phantomInput.focus();
        });

        phantomInput.addEventListener('input', () => {
          const val = phantomInput.value.trim();
          if (!val) return;
          const nextIdx = cols.length;
          const nextColor = this.exprManager.colorPalette[(cols.length - 1) % this.exprManager.colorPalette.length];
          cols.push({
            id: `c_${Date.now()}_${nextIdx}`,
            name: `y_{${tableNum > 1 ? `${tableNum},${nextIdx}` : nextIdx}}`,
            color: nextColor
          });
          rows.forEach(r => r.push(''));
          rows[rIdx][nextIdx] = val;
          this.exprManager.updateTable(entry.id, rows, cols);
          renderTable();
          setTimeout(() => {
            const newCell = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${nextIdx}"]`) as HTMLInputElement;
            if (newCell) {
              newCell.focus();
              newCell.setSelectionRange(val.length, val.length);
            }
          }, 20);
        });

        phantomInput.addEventListener('keydown', (e: KeyboardEvent) => {
          // ArrowLeft: move to last committed cell in this row
          if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (phantomInput.selectionStart === 0 && phantomInput.selectionEnd === 0) {
              e.preventDefault();
              e.stopPropagation();
              const lastColInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cols.length - 1}"]`) as HTMLInputElement;
              if (lastColInp) {
                lastColInp.focus();
                lastColInp.setSelectionRange(lastColInp.value.length, lastColInp.value.length);
              }
              return;
            }
          }

          // Backspace in rightmost phantom cell:
          // "если это самый правый столбец, то не удаляй, а переноси набор текста на столбец влево"
          if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && phantomInput.value === '') {
            e.preventDefault();
            e.stopPropagation();
            const lastColInp = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cols.length - 1}"]`) as HTMLInputElement;
            if (lastColInp) {
              lastColInp.focus();
              lastColInp.setSelectionRange(lastColInp.value.length, lastColInp.value.length);
            }
            return;
          }

          if (e.key === 'Tab') {
            if (!e.shiftKey) {
              if (rIdx < rows.length - 1) {
                e.preventDefault();
                const nextRowFirstCell = tbody.querySelector(`input[data-row="${rIdx + 1}"][data-col="0"]`) as HTMLInputElement;
                if (nextRowFirstCell) nextRowFirstCell.focus();
              }
            } else {
              e.preventDefault();
              const lastCommittedCell = tbody.querySelector(`input[data-row="${rIdx}"][data-col="${cols.length - 1}"]`) as HTMLInputElement;
              if (lastCommittedCell) lastCommittedCell.focus();
            }
          } else if (e.key === 'ArrowUp') {
            if (rIdx === 0) {
              e.preventDefault();
              mfPhantom.focus();
            } else {
              e.preventDefault();
              const prevPhantomCell = tbody.querySelector(`tr:nth-child(${rIdx}) .phantom-cell-input`) as HTMLInputElement;
              if (prevPhantomCell) prevPhantomCell.focus();
            }
          } else if (e.key === 'ArrowDown') {
            if (rIdx < rows.length - 1) {
              e.preventDefault();
              const nextPhantomCell = tbody.querySelector(`tr:nth-child(${rIdx + 2}) .phantom-cell-input`) as HTMLInputElement;
              if (nextPhantomCell) nextPhantomCell.focus();
            } else {
              e.preventDefault();
              this.focusNextEntry(entry.id);
            }
          }
        });

        tdPhantom.appendChild(phantomInput);
        tr.appendChild(tdPhantom);

        tbody.appendChild(tr);
      });
    };

    renderRegressions = () => {
      regressionsContainer.innerHTML = '';
      if (!entry.regressions) entry.regressions = [];
      const regs = entry.regressions;
      const isCollapsed = entry.regressionsCollapsed ?? false;

      // Header row
      const headerEl = document.createElement('div');
      headerEl.className = 'table-regressions-header';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'table-regressions-toggle-btn';
      toggleBtn.title = isCollapsed ? 'Развернуть меню кривых' : 'Свернуть меню кривых';

      const chevron = document.createElement('span');
      chevron.className = `table-regressions-chevron ${!isCollapsed ? 'is-expanded' : ''}`;
      chevron.textContent = '▶';
      toggleBtn.appendChild(chevron);

      const titleSpan = document.createElement('span');
      titleSpan.textContent = 'Аппроксимация ';
      toggleBtn.appendChild(titleSpan);

      const countMf = document.createElement('math-field') as any;
      countMf.readOnly = true;
      countMf.className = 'inline-latex-mf header-count-mf';
      countMf.setValue(`(${regs.length})`);
      toggleBtn.appendChild(countMf);

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.exprManager.toggleTableRegressionsCollapsed(entry.id);
        renderRegressions();
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'table-add-regression-btn';
      addBtn.title = 'Добавить аппроксимационную прямую или кривую';
      addBtn.innerHTML = `<span>+</span> <span>Добавить кривую</span>`;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pushHistory(true);
        const cols = entry.tableColumns || [];
        const yCol = cols.length > 1 ? 1 : 0;
        this.exprManager.addTableRegression(entry.id, 'linear', 0, yCol);
        renderRegressions();
      });

      headerEl.appendChild(toggleBtn);
      headerEl.appendChild(addBtn);
      regressionsContainer.appendChild(headerEl);

      // Body (only if not collapsed)
      if (!isCollapsed) {
        const bodyEl = document.createElement('div');
        bodyEl.className = 'table-regressions-body';

        regs.forEach((reg) => {
            const card = document.createElement('div');
            card.className = 'regression-card';

            // ROW 1: цвет, столбец y-ов, "от", столбец x-ов, тип графика, степень (если применимо), удалить
            const row1 = document.createElement('div');
            row1.className = 'regression-card-row1';

            // 1. Цвет (Color indicator button)
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'regression-color-indicator';
            colorIndicator.title = 'Нажмите для изменения цвета и стиля линии';
            const isVis = reg.visible !== false;
            colorIndicator.style.backgroundColor = isVis ? reg.color : 'transparent';
            colorIndicator.style.border = isVis ? `2px solid ${reg.color}` : '2px dashed #94a3b8';
            if (reg.lineStyle === 'dashed') {
              colorIndicator.style.borderStyle = 'dashed';
            } else if (reg.lineStyle === 'dotted') {
              colorIndicator.style.borderStyle = 'dotted';
            }

            colorIndicator.addEventListener('click', (e) => {
              e.stopPropagation();
              this.openRegressionStylePopover(colorIndicator, entry, reg, () => {
                renderRegressions();
              });
            });

            const cols = entry.tableColumns || [];
            const getColLabel = (colIdx: number) => {
              const col = cols[colIdx];
              if (!col || !col.name) return `C${colIdx + 1}`;
              return col.name
                .replace(/[{}]/g, '')
                .replace(/\\mathrm/g, '')
                .replace(/\\text/g, '')
                .replace(/_0/g, '₀')
                .replace(/_1/g, '₁')
                .replace(/_2/g, '₂')
                .replace(/_3/g, '₃')
                .replace(/_4/g, '₄')
                .replace(/_5/g, '₅')
                .replace(/_6/g, '₆')
                .replace(/_7/g, '₇')
                .replace(/_8/g, '₈')
                .replace(/_9/g, '₉');
            };

            // 2. Столбец y-ов (Y Column select)
            const ySelect = document.createElement('select');
            ySelect.className = 'regression-select regression-col-select';
            cols.forEach((_, i) => {
              const opt = document.createElement('option');
              opt.value = i.toString();
              opt.textContent = getColLabel(i);
              if (i === reg.yColIdx) opt.selected = true;
              ySelect.appendChild(opt);
            });
            ySelect.addEventListener('change', () => {
              this.pushHistory(true);
              const val = parseInt(ySelect.value, 10);
              this.exprManager.updateTableRegression(entry.id, reg.id, { yColIdx: val });
              renderRegressions();
            });

            // 3. "от" label
            const otLabel = document.createElement('span');
            otLabel.className = 'regression-ot-label';
            otLabel.textContent = 'от';

            // 4. Столбец x-ов (X Column select)
            const xSelect = document.createElement('select');
            xSelect.className = 'regression-select regression-col-select';
            cols.forEach((_, i) => {
              const opt = document.createElement('option');
              opt.value = i.toString();
              opt.textContent = getColLabel(i);
              if (i === reg.xColIdx) opt.selected = true;
              xSelect.appendChild(opt);
            });
            xSelect.addEventListener('change', () => {
              this.pushHistory(true);
              const val = parseInt(xSelect.value, 10);
              this.exprManager.updateTableRegression(entry.id, reg.id, { xColIdx: val });
              renderRegressions();
            });

            // 5. Тип графика (Model select)
            const modelSelect = document.createElement('select');
            modelSelect.className = 'regression-select regression-model-select';
            const models: { type: RegressionType; label: string }[] = [
              { type: 'linear', label: 'Прямая: y = mx + b' },
              { type: 'polynomial', label: 'Многочлен степени n' },
              { type: 'quadratic', label: 'Парабола: y = ax² + bx + c' },
              { type: 'cubic', label: 'Кубическая: y = ax³ + ...' },
              { type: 'exponential', label: 'Экспонента: y = ae^{bx}' },
              { type: 'logarithmic', label: 'Логарифм: y = a ln x + b' },
              { type: 'power', label: 'Степенная: y = ax^b' },
              { type: 'custom', label: 'Пользовательская: f(x)' }
            ];
            models.forEach(m => {
              const opt = document.createElement('option');
              opt.value = m.type;
              opt.textContent = m.label;
              if (m.type === reg.type) opt.selected = true;
              modelSelect.appendChild(opt);
            });
            modelSelect.addEventListener('change', () => {
              this.pushHistory(true);
              const val = modelSelect.value as RegressionType;
              this.exprManager.updateTableRegression(entry.id, reg.id, { type: val });
              renderRegressions();
            });

            // 6. Выбор степени многочлена (для polynomial)
            let degreeWrapper: HTMLElement | null = null;
            if (reg.type === 'polynomial') {
              degreeWrapper = document.createElement('div');
              degreeWrapper.className = 'regression-degree-wrapper';

              const degLbl = document.createElement('math-field') as any;
              degLbl.readOnly = true;
              degLbl.className = 'inline-latex-mf';
              degLbl.setValue('n =');
              degreeWrapper.appendChild(degLbl);

              const degreeSelect = document.createElement('select');
              degreeSelect.className = 'regression-select regression-degree-select';
              [1, 2, 3, 4, 5, 6].forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.toString();
                opt.textContent = d.toString();
                if (d === (reg.polyDegree ?? 2)) opt.selected = true;
                degreeSelect.appendChild(opt);
              });
              degreeSelect.addEventListener('change', () => {
                this.pushHistory(true);
                const d = parseInt(degreeSelect.value, 10);
                this.exprManager.updateTableRegression(entry.id, reg.id, { polyDegree: d });
                renderRegressions();
              });
              degreeWrapper.appendChild(degreeSelect);
            }

            // 6.5. Кнопка k_min, k_max для прямой аппроксимации, если есть погрешности
            let kMinMaxBtn: HTMLButtonElement | null = null;
            if (reg.type === 'linear') {
              const xCol = cols[reg.xColIdx];
              const yCol = cols[reg.yColIdx];
              const hasXErr = cols.some(c => c.isErrorActive && (c.errorTargetColId === xCol?.id || findMatchingBaseColumn(c.name, cols)?.id === xCol?.id));
              const hasYErr = cols.some(c => c.isErrorActive && (c.errorTargetColId === yCol?.id || findMatchingBaseColumn(c.name, cols)?.id === yCol?.id));

              if (hasXErr || hasYErr) {
                kMinMaxBtn = document.createElement('button');
                kMinMaxBtn.type = 'button';
                kMinMaxBtn.className = `btn-kminmax ${reg.showKMinMax ? 'is-active' : ''}`;
                kMinMaxBtn.title = 'Построить предельные прямые k_min и k_max пунктиром';
                kMinMaxBtn.innerHTML = `
                  <span class="kminmax-dashed-icon">╌╌</span>
                  <span class="kminmax-label-math"><span class="math-var">k</span><span class="math-sub">min</span>, <span class="math-var">k</span><span class="math-sub">max</span></span>
                `;
                kMinMaxBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.pushHistory(true);
                  reg.showKMinMax = !reg.showKMinMax;
                  this.exprManager.updateTableRegression(entry.id, reg.id, { showKMinMax: reg.showKMinMax });
                  renderRegressions();
                });
              }
            }

            // 7. Delete button
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'regression-del-btn';
            delBtn.innerHTML = '×';
            delBtn.title = 'Удалить эту линию';
            delBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.pushHistory(true);
              this.exprManager.removeTableRegression(entry.id, reg.id);
              renderRegressions();
            });

            row1.appendChild(colorIndicator);
            row1.appendChild(ySelect);
            row1.appendChild(otLabel);
            row1.appendChild(xSelect);
            row1.appendChild(modelSelect);
            if (degreeWrapper) {
              row1.appendChild(degreeWrapper);
            }
            row1.appendChild(delBtn);
            card.appendChild(row1);

            // ROW 1.5: Custom formula input (если выбрана пользовательская зависимость)
            if (reg.type === 'custom') {
              const customRow = document.createElement('div');
              customRow.className = 'regression-custom-row';

              const customLbl = document.createElement('math-field') as any;
              customLbl.readOnly = true;
              customLbl.className = 'inline-latex-mf';
              customLbl.setValue('f(x) =');
              customRow.appendChild(customLbl);

              const customMf = document.createElement('math-field') as any;
              customMf.className = 'regression-custom-mf';
              customMf.setValue(reg.customFormula || 'a \\sin(x) + b');
              setupMathField(customMf);

              customMf.addEventListener('input', () => {
                reg.customFormula = customMf.getValue();
                this.exprManager.updateTableRegression(entry.id, reg.id, { customFormula: reg.customFormula });
                this.pushHistory(false);
                updateRowViews();
              });
              customRow.appendChild(customMf);
              card.appendChild(customRow);
            }

            // ROW 2: Coefficients (коэффициенты)
            const rowCoeffs = document.createElement('div');
            rowCoeffs.className = 'regression-card-coeffs-row';

            // ROW 3: Error / Equation & R^2 (ошибка / уравнение и R^2)
            const rowEqError = document.createElement('div');
            rowEqError.className = 'regression-card-eq-row';

            // ROW 4: kmin, kmax button (kmin, kmax)
            const rowKMinMaxBtn = document.createElement('div');
            rowKMinMaxBtn.className = 'regression-card-kminmax-btn-row';

            // ROW 5: Calculated extreme slopes (предельные прямые)
            const rowKMinMaxValues = document.createElement('div');
            rowKMinMaxValues.className = 'regression-card-kminmax-values-row';

            const updateRowViews = () => {
              rowCoeffs.innerHTML = '';
              rowEqError.innerHTML = '';
              rowKMinMaxBtn.innerHTML = '';
              rowKMinMaxValues.innerHTML = '';

              if (reg.error) {
                rowCoeffs.style.display = 'none';
                rowEqError.style.display = 'flex';
                const errEl = document.createElement('div');
                errEl.className = 'regression-error-msg';
                errEl.innerHTML = `<span>⚠️</span> <math-field read-only class="inline-latex-mf">\\text{${reg.error}}</math-field>`;
                rowEqError.appendChild(errEl);
                rowKMinMaxBtn.style.display = 'none';
                rowKMinMaxValues.style.display = 'none';
              } else {
                // 1. Коэффициенты (Row 2)
                if (reg.params && Object.keys(reg.params).length > 0) {
                  rowCoeffs.style.display = 'flex';
                  const paramTitle = document.createElement('span');
                  paramTitle.className = 'regression-params-title';
                  paramTitle.textContent = 'Коэффициенты:';
                  rowCoeffs.appendChild(paramTitle);

                  const paramsList = document.createElement('div');
                  paramsList.className = 'regression-params-list';

                  for (const [pName, pVal] of Object.entries(reg.params)) {
                    const pill = document.createElement('div');
                    pill.className = 'regression-param-pill';
                    const mfParam = document.createElement('math-field') as any;
                    mfParam.readOnly = true;
                    mfParam.className = 'inline-latex-mf';
                    mfParam.setValue(`${pName} = ${formatNum(pVal, 4)}`);
                    pill.appendChild(mfParam);
                    paramsList.appendChild(pill);
                  }
                  rowCoeffs.appendChild(paramsList);
                } else {
                  rowCoeffs.style.display = 'none';
                }

                // 2. Ошибка / Уравнение и R^2 (Row 3)
                rowEqError.style.display = 'flex';
                const eqContainer = document.createElement('div');
                eqContainer.className = 'regression-eq-container';
                const mfEq = document.createElement('math-field') as any;
                mfEq.readOnly = true;
                mfEq.className = 'regression-eq-mf';
                mfEq.setValue(reg.equationLatex || '');
                eqContainer.appendChild(mfEq);
                rowEqError.appendChild(eqContainer);

                const r2Val = typeof reg.rSquared === 'number' ? reg.rSquared : 0;
                const r2Mf = document.createElement('math-field') as any;
                r2Mf.readOnly = true;
                r2Mf.className = 'regression-r2-mf';
                r2Mf.setValue(`R^2 = ${formatNum(r2Val, 4)}`);
                rowEqError.appendChild(r2Mf);

                // 3. kmin, kmax (Row 4)
                if (kMinMaxBtn) {
                  rowKMinMaxBtn.style.display = 'flex';
                  rowKMinMaxBtn.appendChild(kMinMaxBtn);
                } else {
                  rowKMinMaxBtn.style.display = 'none';
                }

                // 4. Предельные прямые (Row 5)
                if (reg.type === 'linear' && reg.showKMinMax && typeof reg.kMin === 'number' && typeof reg.kMax === 'number') {
                  rowKMinMaxValues.style.display = 'flex';
                  rowKMinMaxValues.innerHTML = `
                    <span class="regression-params-title">Предельные прямые:</span>
                    <div class="regression-params-list">
                      <div class="regression-param-pill"><math-field read-only class="inline-latex-mf">k_{\\min} = ${formatNum(reg.kMin, 4)}</math-field></div>
                      <div class="regression-param-pill"><math-field read-only class="inline-latex-mf">k_{\\max} = ${formatNum(reg.kMax, 4)}</math-field></div>
                      <div class="regression-param-pill"><math-field read-only class="inline-latex-mf">\\Delta k = ${formatNum(reg.deltaK ?? 0, 4)}</math-field></div>
                    </div>
                  `;
                } else {
                  rowKMinMaxValues.style.display = 'none';
                }
              }
            };

            updateRowViews();
            card.appendChild(rowCoeffs);
            card.appendChild(rowEqError);
            card.appendChild(rowKMinMaxBtn);
            card.appendChild(rowKMinMaxValues);
            bodyEl.appendChild(card);
          });
        regressionsContainer.appendChild(bodyEl);
      }
    };

    renderTable();
    renderRegressions();

    tableWrapper.appendChild(table);
    rowEl.appendChild(tableWrapper);
    rowEl.appendChild(regressionsContainer);
    contentEl.appendChild(rowEl);
  }

  private openTableColumnColorPicker(
    targetEl: HTMLElement,
    entry: ExpressionEntry,
    colIdx: number,
    onChanged: () => void
  ): void {
    document.querySelectorAll('.desmos-style-popover').forEach(el => el.remove());

    const popover = document.createElement('div');
    popover.className = 'desmos-style-popover';

    const rect = targetEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${Math.min(window.innerWidth - 270, Math.max(10, rect.left - 20))}px`;
    popover.style.top = `${Math.min(window.innerHeight - 300, rect.bottom + 8)}px`;
    popover.style.zIndex = '9999';

    // Color Section
    const colorSec = document.createElement('div');
    colorSec.className = 'popover-section';
    const colorTitle = document.createElement('div');
    colorTitle.className = 'popover-title';
    colorTitle.textContent = 'ЦВЕТ ТОЧЕК';
    colorSec.appendChild(colorTitle);

    const colorsGrid = document.createElement('div');
    colorsGrid.className = 'colors-grid';

    const defaultPalette = [
      '#2d70b3', // Desmos Blue
      '#c74440', // Desmos Red
      '#388c46', // Desmos Green
      '#6042a6', // Desmos Purple
      '#fa7e19', // Desmos Orange
      '#000000'  // Black
    ];

    const getColColor = () => entry.tableColumns?.[colIdx]?.color || entry.color;
    let currentCol = getColColor();

    if (currentCol && !defaultPalette.includes(currentCol.toLowerCase())) {
      this.addCustomColor(currentCol);
    }

    const setColColor = (color: string) => {
      currentCol = color;
      if (entry.tableColumns && entry.tableColumns[colIdx]) {
        entry.tableColumns[colIdx].color = color;
        this.exprManager.updateTable(entry.id, entry.tableRows || [], entry.tableColumns);
      }
      const svgCircle = targetEl.querySelector('circle');
      if (svgCircle) svgCircle.setAttribute('fill', color);
    };

    const hexRow = document.createElement('div');
    hexRow.className = 'custom-hex-row';

    const hexPreview = document.createElement('div');
    hexPreview.className = 'custom-hex-preview';
    hexPreview.title = 'Палитра цветов';

    const hexPreviewInput = document.createElement('input');
    hexPreviewInput.type = 'color';
    hexPreviewInput.className = 'custom-color-input-hidden';
    hexPreview.appendChild(hexPreviewInput);

    const hexWrapper = document.createElement('div');
    hexWrapper.className = 'custom-hex-input-wrapper';
    hexWrapper.innerHTML = '<span class="custom-hex-prefix">#</span>';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'custom-hex-input';
    hexInput.placeholder = 'RRGGBB';
    hexInput.maxLength = 8;
    hexWrapper.appendChild(hexInput);

    hexRow.appendChild(hexPreview);
    hexRow.appendChild(hexWrapper);

    const updateHexRow = () => {
      const col = getColColor();
      const hex = col.startsWith('#') ? col.slice(1) : col;
      hexInput.value = hex.toUpperCase();
      hexPreview.style.backgroundColor = col;
      if (col.startsWith('#') && col.length === 7) {
        hexPreviewInput.value = col;
      }
    };

    const renderColorSwatches = () => {
      colorsGrid.innerHTML = '';
      const activeColor = getColColor().toLowerCase();

      // Standard palette
      defaultPalette.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn ${activeColor === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = color;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setColColor(color);
          renderColorSwatches();
          updateHexRow();
          onChanged();
        });
        colorsGrid.appendChild(btn);
      });

      // Custom colors swatches
      this.customColors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn custom-swatch ${activeColor === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = `${color} (ПКМ для удаления)`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setColColor(color);
          renderColorSwatches();
          updateHexRow();
          onChanged();
        });
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.customColors = this.customColors.filter(c => c.toLowerCase() !== color.toLowerCase());
          this.saveCustomColors();
          renderColorSwatches();
        });
        colorsGrid.appendChild(btn);
      });

      // "+" Add Custom Color Button with hidden color input
      const addBtn = document.createElement('button');
      addBtn.className = 'color-btn add-color-btn';
      addBtn.title = 'Добавить свой цвет';
      addBtn.innerHTML = `<span>+</span>`;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'custom-color-input-hidden';
      const c = getColColor();
      colorInput.value = c.startsWith('#') && c.length === 7 ? c : '#ff007f';

      colorInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const chosen = colorInput.value;
        setColColor(chosen);
        updateHexRow();
        onChanged();
      });

      colorInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const chosen = colorInput.value;
        setColColor(chosen);
        this.addCustomColor(chosen);
        renderColorSwatches();
        updateHexRow();
        onChanged();
      });

      addBtn.appendChild(colorInput);
      colorsGrid.appendChild(addBtn);
    };

    hexInput.addEventListener('input', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + raw;
        setColColor(fullHex);
        hexPreview.style.backgroundColor = fullHex;
        if (raw.length === 6) {
          hexPreviewInput.value = fullHex;
        }
        onChanged();
      }
    });

    hexInput.addEventListener('change', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + (raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw);
        setColColor(fullHex);
        this.addCustomColor(fullHex);
        renderColorSwatches();
        updateHexRow();
        onChanged();
      }
    });

    hexPreviewInput.addEventListener('input', () => {
      const chosen = hexPreviewInput.value;
      setColColor(chosen);
      hexInput.value = chosen.slice(1).toUpperCase();
      hexPreview.style.backgroundColor = chosen;
      onChanged();
    });

    hexPreviewInput.addEventListener('change', () => {
      const chosen = hexPreviewInput.value;
      setColColor(chosen);
      this.addCustomColor(chosen);
      renderColorSwatches();
      updateHexRow();
      onChanged();
    });

    renderColorSwatches();
    updateHexRow();

    colorSec.appendChild(colorsGrid);
    colorSec.appendChild(hexRow);
    popover.appendChild(colorSec);

    const closeHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && !targetEl.contains(e.target as Node)) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
    document.body.appendChild(popover);
  }

  private openRegressionStylePopover(
    targetEl: HTMLElement,
    entry: ExpressionEntry,
    reg: TableRegression,
    onChanged: () => void
  ): void {
    document.querySelectorAll('.desmos-style-popover').forEach(el => el.remove());

    const popover = document.createElement('div');
    popover.className = 'desmos-style-popover';

    const rect = targetEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${Math.min(window.innerWidth - 270, Math.max(10, rect.left - 20))}px`;
    popover.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 8)}px`;
    popover.style.zIndex = '9999';

    // 1. Color Section
    const colorSec = document.createElement('div');
    colorSec.className = 'popover-section';
    const colorTitle = document.createElement('div');
    colorTitle.className = 'popover-title';
    colorTitle.textContent = 'ЦВЕТ КРИВОЙ';
    colorSec.appendChild(colorTitle);

    const colorsGrid = document.createElement('div');
    colorsGrid.className = 'colors-grid';

    const defaultPalette = [
      '#2d70b3', // Desmos Blue
      '#c74440', // Desmos Red
      '#388c46', // Desmos Green
      '#6042a6', // Desmos Purple
      '#fa7e19', // Desmos Orange
      '#000000'  // Black
    ];

    if (reg.color && !defaultPalette.includes(reg.color.toLowerCase())) {
      this.addCustomColor(reg.color);
    }

    const setRegColor = (color: string) => {
      reg.color = color;
      this.exprManager.updateTableRegression(entry.id, reg.id, { color });
      onChanged();
    };

    const hexRow = document.createElement('div');
    hexRow.className = 'custom-hex-row';

    const hexPreview = document.createElement('div');
    hexPreview.className = 'custom-hex-preview';
    hexPreview.title = 'Палитра цветов';

    const hexPreviewInput = document.createElement('input');
    hexPreviewInput.type = 'color';
    hexPreviewInput.className = 'custom-color-input-hidden';
    hexPreview.appendChild(hexPreviewInput);

    const hexWrapper = document.createElement('div');
    hexWrapper.className = 'custom-hex-input-wrapper';
    hexWrapper.innerHTML = '<span class="custom-hex-prefix">#</span>';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'custom-hex-input';
    hexInput.placeholder = 'RRGGBB';
    hexInput.maxLength = 8;
    hexWrapper.appendChild(hexInput);

    hexRow.appendChild(hexPreview);
    hexRow.appendChild(hexWrapper);

    const updateHexRow = () => {
      const hex = reg.color.startsWith('#') ? reg.color.slice(1) : reg.color;
      hexInput.value = hex.toUpperCase();
      hexPreview.style.backgroundColor = reg.color;
      if (reg.color.startsWith('#') && reg.color.length === 7) {
        hexPreviewInput.value = reg.color;
      }
    };

    const renderColorSwatches = () => {
      colorsGrid.innerHTML = '';

      defaultPalette.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn ${reg.color.toLowerCase() === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = color;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setRegColor(color);
          renderColorSwatches();
          updateHexRow();
        });
        colorsGrid.appendChild(btn);
      });

      this.customColors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn custom-swatch ${reg.color.toLowerCase() === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = `${color} (ПКМ для удаления)`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setRegColor(color);
          renderColorSwatches();
          updateHexRow();
        });
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.customColors = this.customColors.filter(c => c.toLowerCase() !== color.toLowerCase());
          this.saveCustomColors();
          renderColorSwatches();
        });
        colorsGrid.appendChild(btn);
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'color-btn add-color-btn';
      addBtn.title = 'Добавить свой цвет';
      addBtn.innerHTML = `<span>+</span>`;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'custom-color-input-hidden';
      colorInput.value = reg.color.startsWith('#') && reg.color.length === 7 ? reg.color : '#ff007f';

      colorInput.addEventListener('input', (e) => {
        e.stopPropagation();
        setRegColor(colorInput.value);
        updateHexRow();
      });

      colorInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const chosen = colorInput.value;
        setRegColor(chosen);
        this.addCustomColor(chosen);
        renderColorSwatches();
        updateHexRow();
      });

      addBtn.appendChild(colorInput);
      colorsGrid.appendChild(addBtn);
    };

    hexInput.addEventListener('input', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + raw;
        setRegColor(fullHex);
        hexPreview.style.backgroundColor = fullHex;
        if (raw.length === 6) hexPreviewInput.value = fullHex;
      }
    });

    hexInput.addEventListener('change', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + (raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw);
        setRegColor(fullHex);
        this.addCustomColor(fullHex);
        renderColorSwatches();
        updateHexRow();
      }
    });

    hexPreviewInput.addEventListener('input', () => {
      setRegColor(hexPreviewInput.value);
      hexInput.value = hexPreviewInput.value.slice(1).toUpperCase();
      hexPreview.style.backgroundColor = hexPreviewInput.value;
    });

    hexPreviewInput.addEventListener('change', () => {
      const chosen = hexPreviewInput.value;
      setRegColor(chosen);
      this.addCustomColor(chosen);
      renderColorSwatches();
      updateHexRow();
    });

    renderColorSwatches();
    updateHexRow();

    colorSec.appendChild(colorsGrid);
    colorSec.appendChild(hexRow);
    popover.appendChild(colorSec);

    // 2. Line Style Section
    const styleSec = document.createElement('div');
    styleSec.className = 'popover-section';
    const styleTitle = document.createElement('div');
    styleTitle.className = 'popover-title';
    styleTitle.textContent = 'ВИД ЛИНИИ';
    styleSec.appendChild(styleTitle);

    const stylesRow = document.createElement('div');
    stylesRow.className = 'styles-row';

    const currentStyle = reg.lineStyle || 'solid';
    const styleOptions: { id: LineStyle; label: string; svg: string }[] = [
      {
        id: 'solid',
        label: 'Сплошная',
        svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
      },
      {
        id: 'dashed',
        label: 'Пунктир',
        svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8,5" stroke-linecap="butt"/></svg>'
      },
      {
        id: 'dotted',
        label: 'Точки',
        svg: '<svg width="28" height="6"><line x1="2" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="0,7" stroke-linecap="round"/></svg>'
      },
      {
        id: 'dashdot',
        label: 'Штрих-точка',
        svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8,3,2,3" stroke-linecap="butt"/></svg>'
      }
    ];

    styleOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = `style-btn ${currentStyle === opt.id ? 'active' : ''}`;
      btn.title = opt.label;
      btn.innerHTML = `${opt.svg}<span>${opt.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        reg.lineStyle = opt.id;
        this.exprManager.updateTableRegression(entry.id, reg.id, { lineStyle: opt.id });
        stylesRow.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChanged();
      });
      stylesRow.appendChild(btn);
    });
    styleSec.appendChild(stylesRow);
    popover.appendChild(styleSec);

    // 3. Visibility Section
    const visSec = document.createElement('div');
    visSec.className = 'popover-section popover-visibility-section';
    const visBtn = document.createElement('button');
    visBtn.className = `visibility-toggle-btn ${reg.visible !== false ? 'is-visible' : 'is-hidden'}`;
    const updateVisBtnText = () => {
      visBtn.innerHTML = reg.visible !== false
        ? '👁 <span>Линия включена</span>'
        : '🚫 <span>Линия скрыта</span>';
    };
    updateVisBtnText();

    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reg.visible = reg.visible === false ? true : false;
      this.exprManager.updateTableRegression(entry.id, reg.id, { visible: reg.visible });
      visBtn.className = `visibility-toggle-btn ${reg.visible !== false ? 'is-visible' : 'is-hidden'}`;
      updateVisBtnText();
      onChanged();
    });
    visSec.appendChild(visBtn);
    popover.appendChild(visSec);

    const closeHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && !targetEl.contains(e.target as Node)) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
    document.body.appendChild(popover);
  }

  private updateItemExtras(
    contentEl: HTMLElement,
    entry: ExpressionEntry,
    mf: any
  ): void {
    const oldSlider = contentEl.querySelector('.slider-container');
    if (oldSlider) oldSlider.remove();
    const oldEval = contentEl.querySelector('.evaluation-pill');
    if (oldEval) oldEval.remove();
    const oldPrompt = contentEl.querySelector('.add-slider-prompt');
    if (oldPrompt) oldPrompt.remove();
    const oldError = contentEl.querySelector('.error-msg');
    if (oldError) oldError.remove();

    // 1. Prompt button to add slider for undefined variables: e.g. [ a ]
    if (entry.missingParams && entry.missingParams.length > 0) {
      const promptEl = document.createElement('div');
      promptEl.className = 'add-slider-prompt';

      entry.missingParams.forEach(varName => {
        const btn = document.createElement('button');
        btn.className = 'btn-add-slider-var';

        // Render Greek letters or subscripts with pretty uniform styling: \alpha -> α, \omega_0 -> ω₀, x_1 -> x₁
        const GREEK_UNICODE: Record<string, string> = {
          alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
          zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
          varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
          varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
          upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
          Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
          Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
        };

        const isGreek = Lexer.GREEK_LETTERS.includes(varName) || Lexer.GREEK_LETTERS.some(g => varName.startsWith(g + '_'));
        const hasSubscript = varName.includes('_');

        let labelHtml = varName;
        if (isGreek) {
          for (const g of Lexer.GREEK_LETTERS) {
            if (varName === g) {
              labelHtml = GREEK_UNICODE[g] || g;
              break;
            } else if (varName.startsWith(g + '_')) {
              const sym = GREEK_UNICODE[g] || g;
              const sub = varName.slice(g.length + 1);
              labelHtml = `${sym}<sub>${sub}</sub>`;
              break;
            }
          }
        } else if (hasSubscript) {
          const parts = varName.split('_');
          labelHtml = `${parts[0]}<sub>${parts.slice(1).join('_')}</sub>`;
        }

        btn.innerHTML = labelHtml;

        btn.title = `Создать параметр ${varName}`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Insert variable slider right below this expression
          const currIdx = this.exprManager.entries.findIndex(entryItem => entryItem.id === entry.id);
          const isGreekVar = Lexer.GREEK_LETTERS.includes(varName) || Lexer.GREEK_LETTERS.some(g => varName.startsWith(g + '_'));
          let rawDecl = `${varName} = 1`;
          if (isGreekVar) {
            for (const g of Lexer.GREEK_LETTERS) {
              const latexG = g === 'phi' ? 'varphi' : g;
              if (varName === g) {
                rawDecl = `\\${latexG} = 1`;
                break;
              } else if (varName.startsWith(g + '_')) {
                const sub = varName.slice(g.length + 1);
                rawDecl = `\\${latexG}_{${sub}} = 1`;
                break;
              }
            }
          } else if (varName.includes('_')) {
            const parts = varName.split('_');
            rawDecl = `${parts[0]}_{${parts.slice(1).join('_')}} = 1`;
          }

          this.exprManager.addExpression(rawDecl);
          // Move newly added entry to just after the current entry
          const added = this.exprManager.entries.pop()!;
          this.exprManager.entries.splice(currIdx + 1, 0, added);
          this.exprManager.recompileAll();
          this.renderExpressionList();
        });
        promptEl.appendChild(btn);
      });

      contentEl.appendChild(promptEl);
    }

    // 2. Slider for variable declarations (e.g. a = 2) with editable min, max, and step
    if (entry.type === 'variable' && entry.varName && typeof entry.value === 'number') {
      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'slider-container';

      const minVal = entry.sliderMin ?? -10;
      const maxVal = entry.sliderMax ?? 10;
      const stepVal = entry.sliderStep ?? 0.05;

      // Min bound input
      const minInput = document.createElement('input');
      minInput.type = 'text';
      minInput.className = 'slider-bound slider-min';
      minInput.value = minVal.toString();
      minInput.title = 'Минимум диапазона';

      // Range track
      const rangeInput = document.createElement('input');
      rangeInput.type = 'range';
      rangeInput.className = 'slider-track';
      rangeInput.min = minVal.toString();
      rangeInput.max = maxVal.toString();
      rangeInput.step = stepVal.toString();
      rangeInput.value = entry.value.toString();

      // Max bound input
      const maxInput = document.createElement('input');
      maxInput.type = 'text';
      maxInput.className = 'slider-bound slider-max';
      maxInput.value = maxVal.toString();
      maxInput.title = 'Максимум диапазона';

      // Step input
      const stepBox = document.createElement('div');
      stepBox.className = 'slider-step-box';
      const stepLabel = document.createElement('span');
      stepLabel.className = 'slider-step-label';
      stepLabel.textContent = 'шаг:';
      const stepInput = document.createElement('input');
      stepInput.type = 'text';
      stepInput.className = 'slider-bound slider-step';
      stepInput.value = stepVal.toString();
      stepInput.title = 'Шаг ползунка';
      stepBox.appendChild(stepLabel);
      stepBox.appendChild(stepInput);

      // Event handlers for bound inputs
      const updateMin = () => {
        const val = parseFloat(minInput.value);
        if (!isNaN(val) && val < (entry.sliderMax ?? 10)) {
          entry.sliderMin = val;
          rangeInput.min = val.toString();
        } else {
          minInput.value = (entry.sliderMin ?? -10).toString();
        }
      };
      minInput.addEventListener('change', updateMin);
      minInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          updateMin();
          minInput.blur();
        }
      });
      minInput.addEventListener('click', (e) => e.stopPropagation());

      const updateMax = () => {
        const val = parseFloat(maxInput.value);
        if (!isNaN(val) && val > (entry.sliderMin ?? -10)) {
          entry.sliderMax = val;
          rangeInput.max = val.toString();
        } else {
          maxInput.value = (entry.sliderMax ?? 10).toString();
        }
      };
      maxInput.addEventListener('change', updateMax);
      maxInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          updateMax();
          maxInput.blur();
        }
      });
      maxInput.addEventListener('click', (e) => e.stopPropagation());

      const updateStep = () => {
        const val = parseFloat(stepInput.value);
        if (!isNaN(val) && val > 0) {
          entry.sliderStep = val;
          rangeInput.step = val.toString();
        } else {
          stepInput.value = (entry.sliderStep ?? 0.05).toString();
        }
      };
      stepInput.addEventListener('change', updateStep);
      stepInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          updateStep();
          stepInput.blur();
        }
      });
      stepInput.addEventListener('click', (e) => e.stopPropagation());

      rangeInput.addEventListener('input', () => {
        const val = parseFloat(rangeInput.value);
        this.exprManager.setVariableValue(entry.varName!, val);

        if (mf) {
          const formatted = Number.isInteger(val) ? val.toString() : val.toFixed(2);
          const varName = entry.varName!;
          const isGreek = Lexer.GREEK_LETTERS.includes(varName) || Lexer.GREEK_LETTERS.some(g => varName.startsWith(g + '_'));
          let latexName = varName;
          if (isGreek) {
            for (const g of Lexer.GREEK_LETTERS) {
              if (varName === g) {
                latexName = `\\${g}`;
                break;
              } else if (varName.startsWith(g + '_')) {
                const sub = varName.slice(g.length + 1);
                latexName = `\\${g}_{${sub}}`;
                break;
              }
            }
          } else if (varName.includes('_')) {
            const parts = varName.split('_');
            latexName = `${parts[0]}_{${parts.slice(1).join('_')}}`;
          }
          mf.setValue(`${latexName} = ${formatted}`);
        }
      });

      sliderContainer.appendChild(minInput);
      sliderContainer.appendChild(rangeInput);
      sliderContainer.appendChild(maxInput);
      sliderContainer.appendChild(stepBox);
      contentEl.appendChild(sliderContainer);
    }

    // 3. Desmos Evaluated Pill for standalone numerical expressions (only when type is 'evaluation')
    if (entry.type === 'evaluation' && typeof entry.value === 'number' && Number.isFinite(entry.value)) {
      const evalPill = document.createElement('div');
      evalPill.className = 'evaluation-pill';
      let formatted: string;
      if (Number.isInteger(entry.value)) {
        formatted = entry.value.toString();
      } else {
        formatted = parseFloat(entry.value.toPrecision(10)).toString();
      }
      evalPill.innerHTML = `
        <span class="eval-equal">=</span>
        <span class="eval-box">${formatted}</span>
      `;
      contentEl.appendChild(evalPill);
    }

    // 3.1. Desmos Evaluated Pill for standalone matrix/vector evaluations (e.g. A v, A * B, det A)
    if ((entry.type === 'matrix' || entry.type === 'vector') && entry.matrixData && !entry.varName) {
      const evalPill = document.createElement('div');
      evalPill.className = 'evaluation-pill evaluation-matrix-pill';
      const rows = entry.matrixData.map(r => r.map(v => formatNum(v)).join(' & ')).join(' \\\\ ');
      evalPill.innerHTML = `
        <span class="eval-equal">=</span>
        <span class="eval-box eval-matrix-box"><math-field read-only>\\begin{bmatrix} ${rows} \\end{bmatrix}</math-field></span>
      `;
      contentEl.appendChild(evalPill);
    }

    // 4. Error message if invalid (and no missing parameters)
    if (entry.error && (!entry.missingParams || entry.missingParams.length === 0)) {
      const errEl = document.createElement('div');
      errEl.className = 'error-msg';
      errEl.textContent = entry.error;
      contentEl.appendChild(errEl);
    }
  }

  private setupCircleEvents(circleEl: HTMLElement, circleInner: HTMLElement, entry: ExpressionEntry): void {
    this.updateCircleAppearance(circleInner, entry);

    let pressTimer: any = null;
    let isLongPress = false;

    circleEl.title = 'Нажмите, чтобы скрыть/показать график. Зажмите или правой кнопкой для настройки цвета и стиля линии';

    circleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        this.openStylePopover(circleEl, entry, circleInner);
      }, 300);
    });

    circleEl.addEventListener('pointerup', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });

    circleEl.addEventListener('pointercancel', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });

    circleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isLongPress) {
        isLongPress = false;
        return;
      }
      if (entry.type === 'invalid' || entry.type === 'evaluation') return;
      this.exprManager.toggleVisibility(entry.id);
      this.updateCircleAppearance(circleInner, entry);
    });

    circleEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openStylePopover(circleEl, entry, circleInner);
    });
  }

  private updateCircleAppearance(circleInner: HTMLElement, entry: ExpressionEntry): void {
    if (entry.type === 'invalid' || entry.type === 'evaluation' || entry.type === 'matrix') {
      circleInner.style.backgroundColor = '#cbd5e1';
      circleInner.style.border = '1.5px solid rgba(0, 0, 0, 0.1)';
      circleInner.style.opacity = '1';
      circleInner.classList.remove('is-hidden');
      return;
    }

    const isHidden = entry.visible === false;
    circleInner.style.opacity = isHidden ? '0.35' : '1';

    if (isHidden) {
      circleInner.classList.add('is-hidden');
      circleInner.style.backgroundColor = 'transparent';
      circleInner.style.border = `2.5px solid ${entry.color}`;
      return;
    }

    circleInner.classList.remove('is-hidden');

    if (entry.lineStyle === 'dashed') {
      circleInner.style.backgroundColor = 'transparent';
      circleInner.style.border = `2.5px dashed ${entry.color}`;
    } else if (entry.lineStyle === 'dotted') {
      circleInner.style.backgroundColor = 'transparent';
      circleInner.style.border = `2.5px dotted ${entry.color}`;
    } else if (entry.lineStyle === 'dashdot') {
      circleInner.style.backgroundColor = 'transparent';
      circleInner.style.border = `2.5px double ${entry.color}`;
    } else {
      circleInner.style.backgroundColor = entry.color;
      circleInner.style.border = '1.5px solid rgba(0, 0, 0, 0.1)';
    }
  }

  private openStylePopover(anchorEl: HTMLElement, entry: ExpressionEntry, circleInner: HTMLElement): void {
    document.querySelectorAll('.desmos-style-popover').forEach(el => el.remove());

    const popover = document.createElement('div');
    popover.className = 'desmos-style-popover';

    const rect = anchorEl.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${Math.min(window.innerWidth - 270, rect.right + 10)}px`;
    popover.style.top = `${Math.max(10, Math.min(window.innerHeight - 340, rect.top - 20))}px`;
    popover.style.zIndex = '9999';

    // 1. Color Palette Section
    const colorSec = document.createElement('div');
    colorSec.className = 'popover-section';
    const colorTitle = document.createElement('div');
    colorTitle.className = 'popover-title';
    colorTitle.textContent = 'ЦВЕТ';
    colorSec.appendChild(colorTitle);

    const colorsGrid = document.createElement('div');
    colorsGrid.className = 'colors-grid';

    const defaultPalette = [
      '#2d70b3', // Desmos Blue
      '#c74440', // Desmos Red
      '#388c46', // Desmos Green
      '#6042a6', // Desmos Purple
      '#fa7e19', // Desmos Orange
      '#000000'  // Black
    ];

    if (entry.color && !defaultPalette.includes(entry.color.toLowerCase())) {
      this.addCustomColor(entry.color);
    }

    const hexRow = document.createElement('div');
    hexRow.className = 'custom-hex-row';

    const hexPreview = document.createElement('div');
    hexPreview.className = 'custom-hex-preview';
    hexPreview.title = 'Палитра цветов';

    const hexPreviewInput = document.createElement('input');
    hexPreviewInput.type = 'color';
    hexPreviewInput.className = 'custom-color-input-hidden';
    hexPreview.appendChild(hexPreviewInput);

    const hexWrapper = document.createElement('div');
    hexWrapper.className = 'custom-hex-input-wrapper';
    hexWrapper.innerHTML = '<span class="custom-hex-prefix">#</span>';

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'custom-hex-input';
    hexInput.placeholder = 'RRGGBB';
    hexInput.maxLength = 8;
    hexWrapper.appendChild(hexInput);

    hexRow.appendChild(hexPreview);
    hexRow.appendChild(hexWrapper);

    const updateHexRow = () => {
      const hex = entry.color.startsWith('#') ? entry.color.slice(1) : entry.color;
      hexInput.value = hex.toUpperCase();
      hexPreview.style.backgroundColor = entry.color;
      if (entry.color.startsWith('#') && entry.color.length === 7) {
        hexPreviewInput.value = entry.color;
      }
    };

    const renderColorSwatches = () => {
      colorsGrid.innerHTML = '';

      // Standard palette
      defaultPalette.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn ${entry.color.toLowerCase() === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = color;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          entry.color = color;
          this.exprManager.setEntryColor(entry.id, color);
          this.updateCircleAppearance(circleInner, entry);
          renderColorSwatches();
          updateHexRow();
        });
        colorsGrid.appendChild(btn);
      });

      // Custom colors swatches
      this.customColors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-btn custom-swatch ${entry.color.toLowerCase() === color.toLowerCase() ? 'active' : ''}`;
        btn.style.backgroundColor = color;
        btn.title = `${color} (ПКМ для удаления)`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          entry.color = color;
          this.exprManager.setEntryColor(entry.id, color);
          this.updateCircleAppearance(circleInner, entry);
          renderColorSwatches();
          updateHexRow();
        });
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.customColors = this.customColors.filter(c => c.toLowerCase() !== color.toLowerCase());
          this.saveCustomColors();
          renderColorSwatches();
        });
        colorsGrid.appendChild(btn);
      });

      // "+" Add Custom Color Button with hidden color input
      const addBtn = document.createElement('button');
      addBtn.className = 'color-btn add-color-btn';
      addBtn.title = 'Добавить свой цвет';
      addBtn.innerHTML = `<span>+</span>`;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'custom-color-input-hidden';
      colorInput.value = entry.color.startsWith('#') && entry.color.length === 7 ? entry.color : '#ff007f';

      colorInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const chosen = colorInput.value;
        entry.color = chosen;
        this.exprManager.setEntryColor(entry.id, chosen);
        this.updateCircleAppearance(circleInner, entry);
        updateHexRow();
      });

      colorInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const chosen = colorInput.value;
        entry.color = chosen;
        this.exprManager.setEntryColor(entry.id, chosen);
        this.addCustomColor(chosen);
        this.updateCircleAppearance(circleInner, entry);
        renderColorSwatches();
        updateHexRow();
      });

      addBtn.appendChild(colorInput);
      colorsGrid.appendChild(addBtn);
    };

    hexInput.addEventListener('input', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + raw;
        entry.color = fullHex;
        this.exprManager.setEntryColor(entry.id, fullHex);
        this.updateCircleAppearance(circleInner, entry);
        hexPreview.style.backgroundColor = fullHex;
        if (raw.length === 6) {
          hexPreviewInput.value = fullHex;
        }
      }
    });

    hexInput.addEventListener('change', () => {
      let raw = hexInput.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(raw)) {
        const fullHex = '#' + (raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw);
        entry.color = fullHex;
        this.exprManager.setEntryColor(entry.id, fullHex);
        this.addCustomColor(fullHex);
        this.updateCircleAppearance(circleInner, entry);
        renderColorSwatches();
        updateHexRow();
      }
    });

    hexPreviewInput.addEventListener('input', () => {
      const chosen = hexPreviewInput.value;
      entry.color = chosen;
      this.exprManager.setEntryColor(entry.id, chosen);
      this.updateCircleAppearance(circleInner, entry);
      hexInput.value = chosen.slice(1).toUpperCase();
      hexPreview.style.backgroundColor = chosen;
    });

    hexPreviewInput.addEventListener('change', () => {
      const chosen = hexPreviewInput.value;
      entry.color = chosen;
      this.exprManager.setEntryColor(entry.id, chosen);
      this.addCustomColor(chosen);
      this.updateCircleAppearance(circleInner, entry);
      renderColorSwatches();
      updateHexRow();
    });

    renderColorSwatches();
    updateHexRow();

    colorSec.appendChild(colorsGrid);
    colorSec.appendChild(hexRow);
    popover.appendChild(colorSec);

    // 2. Line Style Section (only for non-table graph items)
    if (entry.kind !== 'table') {
      const styleSec = document.createElement('div');
      styleSec.className = 'popover-section';
      const styleTitle = document.createElement('div');
      styleTitle.className = 'popover-title';
      styleTitle.textContent = 'ВИД ЛИНИИ';
      styleSec.appendChild(styleTitle);

      const stylesRow = document.createElement('div');
      stylesRow.className = 'styles-row';

      const currentStyle = entry.lineStyle || 'solid';
      const styleOptions: { id: LineStyle; label: string; svg: string }[] = [
        {
          id: 'solid',
          label: 'Сплошная',
          svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
        },
        {
          id: 'dashed',
          label: 'Пунктир',
          svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8,5" stroke-linecap="butt"/></svg>'
        },
        {
          id: 'dotted',
          label: 'Точки',
          svg: '<svg width="28" height="6"><line x1="2" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="0,7" stroke-linecap="round"/></svg>'
        },
        {
          id: 'dashdot',
          label: 'Штрих-точка',
          svg: '<svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8,3,2,3" stroke-linecap="butt"/></svg>'
        }
      ];

      styleOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = `style-btn ${currentStyle === opt.id ? 'active' : ''}`;
        btn.title = opt.label;
        btn.innerHTML = `${opt.svg}<span>${opt.label}</span>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          entry.lineStyle = opt.id;
          this.exprManager.setEntryLineStyle(entry.id, opt.id);
          stylesRow.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.updateCircleAppearance(circleInner, entry);
        });
        stylesRow.appendChild(btn);
      });
      styleSec.appendChild(stylesRow);
      popover.appendChild(styleSec);
    }

    // 3. Visibility Section
    const visSec = document.createElement('div');
    visSec.className = 'popover-section popover-visibility-section';
    const visBtn = document.createElement('button');
    visBtn.className = `visibility-toggle-btn ${entry.visible !== false ? 'is-visible' : 'is-hidden'}`;
    const updateVisBtnText = () => {
      visBtn.innerHTML = entry.visible !== false
        ? '👁 <span>График включен</span>'
        : '🚫 <span>График скрыт</span>';
    };
    updateVisBtnText();
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exprManager.toggleVisibility(entry.id);
      visBtn.className = `visibility-toggle-btn ${entry.visible !== false ? 'is-visible' : 'is-hidden'}`;
      updateVisBtnText();
      this.updateCircleAppearance(circleInner, entry);
    });
    visSec.appendChild(visBtn);
    popover.appendChild(visSec);

    document.body.appendChild(popover);

    // Close on click outside
    const outsideClickHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
        popover.remove();
        document.removeEventListener('pointerdown', outsideClickHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', outsideClickHandler);
    }, 10);
  }

  private focusNextEntry(currentId: string): void {
    const idx = this.exprManager.entries.findIndex(e => e.id === currentId);
    if (idx !== -1 && idx < this.exprManager.entries.length - 1) {
      const nextEntry = this.exprManager.entries[idx + 1];
      this.focusEntry(nextEntry.id, { atEnd: false });
    }
  }

  private focusPreviousEntry(currentId: string): void {
    const idx = this.exprManager.entries.findIndex(e => e.id === currentId);
    if (idx > 0) {
      const prevEntry = this.exprManager.entries[idx - 1];
      this.focusEntry(prevEntry.id, { atEnd: true, bottom: true });
    }
  }

  private focusEntry(id: string, opts?: { atEnd?: boolean; bottom?: boolean }): void {
    setTimeout(() => {
      const itemEl = this.exprListEl.querySelector(`[data-id="${id}"]`);
      if (itemEl) {
        const entry = this.exprManager.entries.find(e => e.id === id);
        if (entry?.kind === 'table') {
          if (opts?.bottom) {
            const lastRowIdx = (entry.tableRows?.length ?? 1) - 1;
            const lastRowFirstInput = itemEl.querySelector(`input[data-row="${lastRowIdx}"][data-col="0"]`) as HTMLInputElement;
            if (lastRowFirstInput) {
              lastRowFirstInput.focus();
              return;
            }
          }
          const input = itemEl.querySelector('.desmos-cell-input') as HTMLInputElement;
          if (input) input.focus();
          return;
        }
        const mf = itemEl.querySelector('math-field') as any;
        if (mf) {
          mf.focus();
          if (opts?.atEnd) {
            try {
              mf.position = mf.lastOffset;
            } catch (_) {}
          }
        } else {
          const input = itemEl.querySelector('.desmos-cell-input') as HTMLInputElement;
          if (input) input.focus();
        }
      }
    }, 20);
  }

  private startRenderLoop(): void {
    const loop = () => {
      this.camera.updateInertia();
      const items = this.exprManager.getPlottableItems();
      this.renderer.render(this.camera, items);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function startApp(): void {
  try {
    new App();
  } catch (err) {
    console.error('Failed to initialize App:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
