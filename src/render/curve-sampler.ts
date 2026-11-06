import { Camera2D } from '../viewport/camera2d';
import { CompiledFunction } from '../math/compiler-jit';

export interface Point2D {
  x: number;
  y: number;
}

export class CurveSampler {
  private maxDepth: number = 7;
  private tolerancePx: number = 0.5; // Half a pixel error tolerance
  private offMargin: number = 100; // Extra screen margin in pixels before clipping

  private isOffScreen(sy: number, h: number): boolean {
    return sy < -this.offMargin || sy > h + this.offMargin;
  }

  /**
   * Samples a function f(x) adaptively over the camera's visible horizontal span.
   * Produces a list of disconnected continuous line strips (Point2D[][]),
   * automatically splitting strokes across asymptotes and discontinuities,
   * and extending curves all the way off-screen so they never terminate prematurely in mid-air.
   */
  public sample(
    fn: CompiledFunction,
    camera: Camera2D
  ): Point2D[][] {
    const width = camera.screenWidth;
    const coarseStepPx = 4; // Responsive 4px step
    const strokes: Point2D[][] = [];
    let currentStroke: Point2D[] = [];

    // Evaluate initial point slightly off-screen to avoid margin edge artifacts
    let prevSx = -coarseStepPx;
    let prevWorld = camera.screenToWorld(prevSx, 0);
    let prevY = this.safeEval(fn, prevWorld.x);
    let prevValid = Number.isFinite(prevY);
    let prevScreen = prevValid ? camera.worldToScreen(prevWorld.x, prevY) : { x: prevSx, y: NaN };

    if (prevValid) {
      currentStroke.push(prevScreen);
    }

    // Coarse iteration across the screen width (plus a safety margin)
    for (let sx = 0; sx <= width + coarseStepPx; sx += coarseStepPx) {
      const currWorld = camera.screenToWorld(sx, 0);
      const currY = this.safeEval(fn, currWorld.x);
      const currValid = Number.isFinite(currY);
      const currScreen = currValid ? camera.worldToScreen(currWorld.x, currY) : { x: sx, y: NaN };

      if (!prevValid && !currValid) {
        // Both invalid: function is outside domain
      } else if (prevValid && !currValid) {
        // Function enters undefined domain or pole: trace until offscreen or boundary
        this.resolveExit(fn, camera, prevWorld.x, prevY, prevScreen, currWorld.x, currentStroke);
        if (currentStroke.length > 0) {
          strokes.push(currentStroke);
          currentStroke = [];
        }
      } else if (!prevValid && currValid) {
        // Function exits undefined domain or pole: trace from boundary or offscreen
        const entryStroke: Point2D[] = [];
        this.resolveEntry(fn, camera, prevWorld.x, currWorld.x, currY, currScreen, entryStroke);
        currentStroke = entryStroke;
      } else {
        // Both valid. Check for asymptote / singularity / jump discontinuity crossing
        if (this.detectAsymptote(fn, prevWorld.x, prevY, prevScreen, currWorld.x, currY, currScreen, camera)) {
          this.resolveDiscontinuity(
            fn,
            camera,
            prevWorld.x,
            prevY,
            prevScreen,
            currWorld.x,
            currY,
            currScreen,
            currentStroke,
            strokes
          );
          currentStroke = strokes.pop() ?? [];
        } else {
          // Adaptively subdivide the interval to capture high curvature
          this.subdivide(
            fn,
            camera,
            prevWorld.x,
            prevY,
            prevScreen,
            currWorld.x,
            currY,
            currScreen,
            0,
            currentStroke
          );
        }
      }

      prevSx = sx;
      prevWorld = currWorld;
      prevY = currY;
      prevValid = currValid;
      prevScreen = currScreen;
    }

    if (currentStroke.length > 0) {
      strokes.push(currentStroke);
    }

    return strokes;
  }

  private safeEval(fn: CompiledFunction, x: number): number {
    try {
      const y = fn(x);
      return Number.isFinite(y) ? y : NaN;
    } catch {
      return NaN;
    }
  }

  /**
   * Detects whether an asymptote, singularity, or jump discontinuity exists between x0 and x1.
   */
  private detectAsymptote(
    fn: CompiledFunction,
    x0: number,
    y0: number,
    s0: Point2D,
    x1: number,
    y1: number,
    s1: Point2D,
    camera: Camera2D
  ): boolean {
    const h = camera.screenHeight;
    const dyPx = Math.abs(s1.y - s0.y);

    const xm = (x0 + x1) * 0.5;
    const ym = this.safeEval(fn, xm);

    // Singularity exists at midpoint
    if (!Number.isFinite(ym)) return true;

    const sm = camera.worldToScreen(xm, ym);

    // One point is off the top and one is off the bottom
    if ((s0.y < -this.offMargin && s1.y > h + this.offMargin) || (s0.y > h + this.offMargin && s1.y < -this.offMargin)) {
      return true;
    }

    // Both endpoints are on-screen, but midpoint shoots far off-screen (e.g. 1/x^2)
    if (!this.isOffScreen(s0.y, h) && !this.isOffScreen(s1.y, h) && this.isOffScreen(sm.y, h)) {
      return true;
    }

    // Sign flip check (odd-degree poles like 1/x, tan(x), Gamma(x))
    if ((y0 > 0 && y1 < 0) || (y0 < 0 && y1 > 0)) {
      const eps = (x1 - x0) * 0.01;
      const dMid = (this.safeEval(fn, xm + eps) - this.safeEval(fn, xm - eps)) / (2 * eps);
      const secantSlope = (y1 - y0) / (x1 - x0);

      // Branch cut / asymptote wrap-around
      if (Number.isFinite(dMid) && secantSlope * dMid < 0) {
        return true;
      }

      // Vertical jump across a significant portion of the screen
      if (dyPx > h * 0.3) {
        return true;
      }
    }

    // Step discontinuity check (e.g. floor, ceil, sign)
    if (dyPx > 2) {
      let l = x0;
      let r = x1;
      let yL = y0;
      let yR = y1;
      for (let i = 0; i < 16; i++) {
        const m = (l + r) * 0.5;
        const val = this.safeEval(fn, m);
        if (!Number.isFinite(val)) return true;
        if (Math.abs(val - yL) < Math.abs(val - yR)) {
          l = m;
          yL = val;
        } else {
          r = m;
          yR = val;
        }
      }
      if (r - l < 1e-5 && Math.abs(yR - yL) > 0.05) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolves a discontinuity or asymptote by extending the left branch to offscreen/boundary
   * and starting the right branch from offscreen/boundary, preventing mid-air cutoffs and false lines.
   */
  private resolveDiscontinuity(
    fn: CompiledFunction,
    camera: Camera2D,
    x0: number,
    y0: number,
    _s0: Point2D,
    x1: number,
    y1: number,
    s1: Point2D,
    currentStroke: Point2D[],
    strokes: Point2D[][]
  ): void {
    const h = camera.screenHeight;
    let low = x0;
    let high = x1;
    let isAsymptote = false;

    let leftBestX = x0;
    let leftBestY = y0;
    let rightBestX = x1;
    let rightBestY = y1;

    for (let i = 0; i < 20; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (!Number.isFinite(ym)) {
        isAsymptote = true;
        break;
      }
      const sm = camera.worldToScreen(mid, ym);
      if (this.isOffScreen(sm.y, h)) {
        isAsymptote = true;
        break;
      }

      if (Math.sign(ym - y0) === 0 || Math.abs(ym - y0) < Math.abs(ym - y1)) {
        leftBestX = mid;
        leftBestY = ym;
        low = mid;
      } else {
        rightBestX = mid;
        rightBestY = ym;
        high = mid;
      }
    }

    if (isAsymptote) {
      // 1. Trace left branch towards asymptote until it exits the screen
      this.traceToAsymptote(fn, camera, x0, y0, (x0 + x1) * 0.5, currentStroke);
      if (currentStroke.length > 0) {
        strokes.push(currentStroke);
      }

      // 2. Trace right branch from asymptote starting offscreen towards s1
      const rightStroke: Point2D[] = [];
      this.traceFromAsymptote(fn, camera, (x0 + x1) * 0.5, x1, y1, s1, rightStroke);
      strokes.push(rightStroke);
    } else {
      // Finite jump discontinuity (floor, ceil, sign):
      // Left stroke ends right at left cliff point
      const sLeft = camera.worldToScreen(leftBestX, leftBestY);
      currentStroke.push(sLeft);
      strokes.push(currentStroke);

      // Right stroke begins right at right cliff point and subdivides to s1
      const rightStroke: Point2D[] = [];
      const sRight = camera.worldToScreen(rightBestX, rightBestY);
      rightStroke.push(sRight);
      this.subdivide(fn, camera, rightBestX, rightBestY, sRight, x1, y1, s1, 0, rightStroke);
      strokes.push(rightStroke);
    }
  }

  private traceToAsymptote(
    fn: CompiledFunction,
    camera: Camera2D,
    xFrom: number,
    yFrom: number,
    xTo: number,
    stroke: Point2D[]
  ): void {
    const h = camera.screenHeight;
    let low = xFrom;
    let high = xTo;
    const sign = Math.sign(yFrom);

    for (let i = 0; i < 20; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym) && (sign === 0 || Math.sign(ym) === sign)) {
        const sm = camera.worldToScreen(mid, ym);
        stroke.push(sm);
        low = mid;
        if (this.isOffScreen(sm.y, h)) {
          break;
        }
      } else {
        high = mid;
      }
    }
  }

  private traceFromAsymptote(
    fn: CompiledFunction,
    camera: Camera2D,
    xFrom: number,
    xTo: number,
    yTo: number,
    sTo: Point2D,
    stroke: Point2D[]
  ): void {
    const h = camera.screenHeight;
    let low = xFrom;
    let high = xTo;
    const sign = Math.sign(yTo);
    let bestStart: Point2D | null = null;
    let bestX = xTo;
    let bestY = yTo;

    for (let i = 0; i < 20; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym) && (sign === 0 || Math.sign(ym) === sign)) {
        const sm = camera.worldToScreen(mid, ym);
        bestStart = sm;
        bestX = mid;
        bestY = ym;
        high = mid;
        if (this.isOffScreen(sm.y, h)) {
          break;
        }
      } else {
        low = mid;
      }
    }

    if (bestStart) {
      stroke.push(bestStart);
      this.subdivide(fn, camera, bestX, bestY, bestStart, xTo, yTo, sTo, 0, stroke);
    } else {
      stroke.push(sTo);
    }
  }

  private resolveExit(
    fn: CompiledFunction,
    camera: Camera2D,
    x0: number,
    _y0: number,
    _s0: Point2D,
    x1: number,
    stroke: Point2D[]
  ): void {
    const h = camera.screenHeight;
    let low = x0;
    let high = x1;

    for (let i = 0; i < 20; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym)) {
        low = mid;
        const sm = camera.worldToScreen(mid, ym);
        stroke.push(sm);
        if (this.isOffScreen(sm.y, h)) {
          break;
        }
      } else {
        high = mid;
      }
    }
  }

  private resolveEntry(
    fn: CompiledFunction,
    camera: Camera2D,
    x0: number,
    x1: number,
    y1: number,
    s1: Point2D,
    stroke: Point2D[]
  ): void {
    const h = camera.screenHeight;
    let low = x0;
    let high = x1;
    let bestX = x1;
    let bestY = y1;
    let bestS = s1;

    for (let i = 0; i < 20; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym)) {
        bestX = mid;
        bestY = ym;
        bestS = camera.worldToScreen(mid, ym);
        high = mid;
        if (this.isOffScreen(bestS.y, h)) {
          break;
        }
      } else {
        low = mid;
      }
    }

    stroke.push(bestS);
    this.subdivide(fn, camera, bestX, bestY, bestS, x1, y1, s1, 0, stroke);
  }

  /**
   * Recursive adaptive subdivision based on curvature and screen-space distance.
   */
  private subdivide(
    fn: CompiledFunction,
    camera: Camera2D,
    x0: number,
    y0: number,
    s0: Point2D,
    x1: number,
    y1: number,
    s1: Point2D,
    depth: number,
    stroke: Point2D[]
  ): void {
    if (depth >= this.maxDepth) {
      stroke.push(s1);
      return;
    }

    // Skip detailed subdivision if points are far off-screen vertically on the same side
    const h = camera.screenHeight;
    const offMargin = this.offMargin;
    if ((s0.y < -offMargin && s1.y < -offMargin) || (s0.y > h + offMargin && s1.y > h + offMargin)) {
      const xm = (x0 + x1) * 0.5;
      const ym = this.safeEval(fn, xm);
      if (!Number.isFinite(ym)) return;
      const sm = camera.worldToScreen(xm, ym);
      if ((sm.y < -offMargin && s0.y < -offMargin) || (sm.y > h + offMargin && s0.y > h + offMargin)) {
        stroke.push(s1);
        return;
      }
    }

    const xm = (x0 + x1) * 0.5;
    const ym = this.safeEval(fn, xm);

    if (!Number.isFinite(ym)) {
      return;
    }

    const sm = camera.worldToScreen(xm, ym);

    // Calculate perpendicular distance from screen midpoint sm to chord (s0 -> s1)
    const chordDx = s1.x - s0.x;
    const chordDy = s1.y - s0.y;
    const chordLenSq = chordDx * chordDx + chordDy * chordDy;

    let distSq = 0;
    if (chordLenSq > 1e-6) {
      const cross = Math.abs(chordDy * sm.x - chordDx * sm.y + s1.x * s0.y - s1.y * s0.x);
      distSq = (cross * cross) / chordLenSq;
    } else {
      const dx = sm.x - s0.x;
      const dy = sm.y - s0.y;
      distSq = dx * dx + dy * dy;
    }

    // If curvature deviation exceeds tolerance in pixels, subdivide recursively
    if (distSq > this.tolerancePx * this.tolerancePx) {
      this.subdivide(fn, camera, x0, y0, s0, xm, ym, sm, depth + 1, stroke);
      this.subdivide(fn, camera, xm, ym, sm, x1, y1, s1, depth + 1, stroke);
    } else {
      stroke.push(s1);
    }
  }
}
