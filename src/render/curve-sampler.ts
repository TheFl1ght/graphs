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
  private minAsymptoteWidthPx: number = 0.05; // Minimum visible width in screen pixels for an asymptote

  private isOffScreen(sy: number, h: number): boolean {
    return sy < -this.offMargin || sy > h + this.offMargin;
  }

  private clampScreenY(sy: number, h: number): number {
    const min = -this.offMargin - 20;
    const max = h + this.offMargin + 20;
    if (sy < min) return min;
    if (sy > max) return max;
    return sy;
  }

  private clampScreenX(sx: number, w: number): number {
    const min = -this.offMargin - 20;
    const max = w + this.offMargin + 20;
    if (sx < min) return min;
    if (sx > max) return max;
    return sx;
  }

  /**
   * Samples a function f(x) adaptively over the camera's visible horizontal span.
   * Produces a list of disconnected continuous line strips (Point2D[][]),
   * automatically splitting strokes across asymptotes and discontinuities,
   * and extending curves all the way off-screen so they never terminate prematurely in mid-air.
   */
  public sample(
    fn: CompiledFunction,
    camera: Camera2D,
    orientation: 'y-of-x' | 'x-of-y' = 'y-of-x'
  ): Point2D[][] {
    if (orientation === 'x-of-y') {
      return this.sampleXOfY(fn, camera);
    }
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

      // Branch cut / asymptote wrap-around: pole derivative has opposite sign to secant slope
      if (Number.isFinite(dMid) && secantSlope * dMid < 0) {
        return true;
      }

      // Vertical jump across a significant portion of the screen
      if (dyPx > h * 0.25) {
        return true;
      }
    }

    // Step discontinuity check (e.g. floor, ceil, sign)
    if (dyPx > 2) {
      let l = x0;
      let r = x1;
      let yL = y0;
      let yR = y1;
      for (let i = 0; i < 20; i++) {
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
   * Resolves a discontinuity or asymptote by locating the exact singularity xa via bisection,
   * extending the left branch to offscreen along xa and starting the right branch from offscreen along xa.
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
    let isAsymptote = false;

    // 1. Locate the exact discontinuity / asymptote location xa in [x0, x1]
    let l = x0;
    let r = x1;
    let yL = y0;
    let yR = y1;
    let xa = (x0 + x1) * 0.5;

    for (let i = 0; i < 40; i++) {
      const m = (l + r) * 0.5;
      const ym = this.safeEval(fn, m);
      if (!Number.isFinite(ym)) {
        xa = m;
        isAsymptote = true;
        break;
      }
      const sm = camera.worldToScreen(m, ym);
      if (this.isOffScreen(sm.y, h)) {
        isAsymptote = true;
      }

      if ((y0 > 0 && y1 < 0) || (y0 < 0 && y1 > 0)) {
        if (Math.sign(ym) === Math.sign(y0)) {
          l = m;
          yL = ym;
        } else {
          r = m;
          yR = ym;
        }
      } else {
        if (Math.abs(ym - yL) <= Math.abs(ym - yR)) {
          l = m;
          yL = ym;
        } else {
          r = m;
          yR = ym;
        }
      }
      xa = (l + r) * 0.5;
    }

    // Step jump discontinuity (floor, ceil, sign)
    if (!isAsymptote && r - l < 1e-4 && Math.abs(yR - yL) > 0.05) {
      const sLeft = camera.worldToScreen(l, yL);
      currentStroke.push(sLeft);
      strokes.push(currentStroke);

      const rightStroke: Point2D[] = [];
      const sRight = camera.worldToScreen(r, yR);
      rightStroke.push(sRight);
      this.subdivide(fn, camera, r, yR, sRight, x1, y1, s1, 0, rightStroke);
      strokes.push(rightStroke);
      return;
    }

    // Asymptote:
    // 2. Trace left branch from x0 towards xa until it exits the screen
    let lowL = x0;
    let highL = xa;
    let bestXL = x0;
    let bestYL = y0;
    let bestSmL = _s0;
    let leftReachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const m = (lowL + highL) * 0.5;
      const ym = this.safeEval(fn, m);
      if (Number.isFinite(ym) && (Math.sign(y0) === 0 || Math.sign(ym) === Math.sign(y0))) {
        lowL = m;
        bestXL = m;
        bestYL = ym;
        bestSmL = camera.worldToScreen(m, ym);
        if (this.isOffScreen(bestSmL.y, h)) {
          bestSmL.y = this.clampScreenY(bestSmL.y, h);
          leftReachedOffscreen = true;
          break;
        }
      } else {
        highL = m;
      }
    }

    const leftWidthPx = Math.abs(bestXL - xa) * camera.zoom;
    if (leftReachedOffscreen) {
      if (leftWidthPx >= this.minAsymptoteWidthPx) {
        if (bestSmL !== _s0) {
          this.subdivide(fn, camera, x0, y0, _s0, bestXL, bestYL, bestSmL, 0, currentStroke);
        }
      }
    } else {
      const isBlowingUp = Math.abs(bestYL) > Math.abs(y0) * 5 + 1;
      if (!isBlowingUp) {
        if (bestSmL !== _s0) {
          this.subdivide(fn, camera, x0, y0, _s0, bestXL, bestYL, bestSmL, 0, currentStroke);
        }
      }
    }

    if (currentStroke.length > 0) {
      strokes.push(currentStroke);
    }

    // 3. Trace right branch from xa towards x1 from offscreen
    let bestStart: Point2D | null = null;
    let bestX = x1;
    let bestY = y1;
    let lowR = xa;
    let highR = x1;
    let rightReachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const m = (lowR + highR) * 0.5;
      const ym = this.safeEval(fn, m);
      if (Number.isFinite(ym) && (Math.sign(y1) === 0 || Math.sign(ym) === Math.sign(y1))) {
        bestStart = camera.worldToScreen(m, ym);
        bestX = m;
        bestY = ym;
        highR = m;
        if (this.isOffScreen(bestStart.y, h)) {
          bestStart.y = this.clampScreenY(bestStart.y, h);
          rightReachedOffscreen = true;
          break;
        }
      } else {
        lowR = m;
      }
    }

    const rightWidthPx = Math.abs(bestX - xa) * camera.zoom;
    const rightStroke: Point2D[] = [];
    if (rightReachedOffscreen) {
      if (rightWidthPx >= this.minAsymptoteWidthPx && bestStart) {
        rightStroke.push(bestStart);
        if (bestStart !== s1) {
          this.subdivide(fn, camera, bestX, bestY, bestStart, x1, y1, s1, 0, rightStroke);
        }
      } else {
        rightStroke.push(s1);
      }
    } else {
      const isBlowingUp = Math.abs(bestY) > Math.abs(y1) * 5 + 1;
      if (bestStart && !isBlowingUp) {
        rightStroke.push(bestStart);
        if (bestStart !== s1) {
          this.subdivide(fn, camera, bestX, bestY, bestStart, x1, y1, s1, 0, rightStroke);
        }
      } else {
        rightStroke.push(s1);
      }
    }
    strokes.push(rightStroke);
  }

  private resolveExit(
    fn: CompiledFunction,
    camera: Camera2D,
    x0: number,
    y0: number,
    s0: Point2D,
    x1: number,
    stroke: Point2D[]
  ): void {
    const h = camera.screenHeight;
    let low = x0;
    let high = x1;
    let bestX = x0;
    let bestY = y0;
    let bestSm = s0;
    let reachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym)) {
        low = mid;
        bestX = mid;
        bestY = ym;
        bestSm = camera.worldToScreen(mid, ym);
        if (this.isOffScreen(bestSm.y, h)) {
          bestSm.y = this.clampScreenY(bestSm.y, h);
          reachedOffscreen = true;
          break;
        }
      } else {
        high = mid;
      }
    }

    const widthPx = Math.abs(bestX - x1) * camera.zoom;
    if (reachedOffscreen) {
      if (widthPx >= this.minAsymptoteWidthPx) {
        if (bestSm !== s0) {
          this.subdivide(fn, camera, x0, y0, s0, bestX, bestY, bestSm, 0, stroke);
        }
      }
    } else {
      const isBlowingUp = Math.abs(bestY) > Math.abs(y0) * 5 + 1;
      if (!isBlowingUp) {
        if (bestSm !== s0) {
          this.subdivide(fn, camera, x0, y0, s0, bestX, bestY, bestSm, 0, stroke);
        }
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
    let reachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym)) {
        high = mid;
        bestX = mid;
        bestY = ym;
        bestS = camera.worldToScreen(mid, ym);
        if (this.isOffScreen(bestS.y, h)) {
          bestS.y = this.clampScreenY(bestS.y, h);
          reachedOffscreen = true;
          break;
        }
      } else {
        low = mid;
      }
    }

    const widthPx = Math.abs(bestX - x0) * camera.zoom;
    if (reachedOffscreen) {
      if (widthPx >= this.minAsymptoteWidthPx) {
        stroke.push(bestS);
        if (bestS !== s1) {
          this.subdivide(fn, camera, bestX, bestY, bestS, x1, y1, s1, 0, stroke);
        }
      } else {
        stroke.push(s1);
      }
    } else {
      const isBlowingUp = Math.abs(bestY) > Math.abs(y1) * 5 + 1;
      if (!isBlowingUp) {
        stroke.push(bestS);
        if (bestS !== s1) {
          this.subdivide(fn, camera, bestX, bestY, bestS, x1, y1, s1, 0, stroke);
        }
      } else {
        stroke.push(s1);
      }
    }
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

    const vertDev = Math.abs(sm.y - (s0.y + s1.y) * 0.5);

    // If curvature deviation or vertical chord deviation exceeds tolerance in pixels, subdivide recursively
    if (distSq > this.tolerancePx * this.tolerancePx || vertDev > this.tolerancePx * 2) {
      this.subdivide(fn, camera, x0, y0, s0, xm, ym, sm, depth + 1, stroke);
      this.subdivide(fn, camera, xm, ym, sm, x1, y1, s1, depth + 1, stroke);
    } else {
      stroke.push(s1);
    }
  }

  public sampleXOfY(
    fn: CompiledFunction,
    camera: Camera2D
  ): Point2D[][] {
    const height = camera.screenHeight;
    const coarseStepPx = 4;
    const strokes: Point2D[][] = [];
    let currentStroke: Point2D[] = [];

    let prevSy = -coarseStepPx;
    let prevWorld = camera.screenToWorld(0, prevSy);
    let prevX = this.safeEval(fn, prevWorld.y);
    let prevValid = Number.isFinite(prevX);
    let prevScreen = prevValid ? camera.worldToScreen(prevX, prevWorld.y) : { x: NaN, y: prevSy };

    if (prevValid) {
      currentStroke.push(prevScreen);
    }

    for (let sy = 0; sy <= height + coarseStepPx; sy += coarseStepPx) {
      const currWorld = camera.screenToWorld(0, sy);
      const currX = this.safeEval(fn, currWorld.y);
      const currValid = Number.isFinite(currX);
      const currScreen = currValid ? camera.worldToScreen(currX, currWorld.y) : { x: NaN, y: sy };

      if (!prevValid && !currValid) {
        // Outside domain
      } else if (prevValid && !currValid) {
        this.resolveExitY(fn, camera, prevWorld.y, prevX, prevScreen, currWorld.y, currentStroke);
        if (currentStroke.length > 0) {
          strokes.push(currentStroke);
          currentStroke = [];
        }
      } else if (!prevValid && currValid) {
        const entryStroke: Point2D[] = [];
        this.resolveEntryY(fn, camera, prevWorld.y, currWorld.y, currX, currScreen, entryStroke);
        currentStroke = entryStroke;
      } else {
        if (this.detectAsymptoteY(fn, prevWorld.y, prevX, prevScreen, currWorld.y, currX, currScreen, camera)) {
          this.resolveDiscontinuityY(
            fn,
            camera,
            prevWorld.y,
            prevX,
            prevScreen,
            currWorld.y,
            currX,
            currScreen,
            currentStroke,
            strokes
          );
          currentStroke = strokes.pop() ?? [];
        } else {
          this.subdivideY(
            fn,
            camera,
            prevWorld.y,
            prevX,
            prevScreen,
            currWorld.y,
            currX,
            currScreen,
            0,
            currentStroke
          );
        }
      }

      prevSy = sy;
      prevWorld = currWorld;
      prevX = currX;
      prevValid = currValid;
      prevScreen = currScreen;
    }

    if (currentStroke.length > 0) {
      strokes.push(currentStroke);
    }

    return strokes;
  }

  private isOffScreenX(sx: number, w: number): boolean {
    return sx < -this.offMargin || sx > w + this.offMargin;
  }

  private detectAsymptoteY(
    fn: CompiledFunction,
    y0: number,
    x0: number,
    s0: Point2D,
    y1: number,
    x1: number,
    s1: Point2D,
    camera: Camera2D
  ): boolean {
    const w = camera.screenWidth;
    const dxPx = Math.abs(s1.x - s0.x);

    const ym = (y0 + y1) * 0.5;
    const xm = this.safeEval(fn, ym);

    if (!Number.isFinite(xm)) return true;

    const sm = camera.worldToScreen(xm, ym);

    if ((s0.x < -this.offMargin && s1.x > w + this.offMargin) || (s0.x > w + this.offMargin && s1.x < -this.offMargin)) {
      return true;
    }

    if (!this.isOffScreenX(s0.x, w) && !this.isOffScreenX(s1.x, w) && this.isOffScreenX(sm.x, w)) {
      return true;
    }

    if ((x0 > 0 && x1 < 0) || (x0 < 0 && x1 > 0)) {
      const eps = (y1 - y0) * 0.01;
      const dMid = (this.safeEval(fn, ym + eps) - this.safeEval(fn, ym - eps)) / (2 * eps);
      const secantSlope = (x1 - x0) / (y1 - y0);

      if (Number.isFinite(dMid) && secantSlope * dMid < 0) {
        return true;
      }

      if (dxPx > w * 0.25) {
        return true;
      }
    }

    if (dxPx > 2) {
      let l = y0;
      let r = y1;
      let xL = x0;
      let xR = x1;
      for (let i = 0; i < 20; i++) {
        const m = (l + r) * 0.5;
        const val = this.safeEval(fn, m);
        if (!Number.isFinite(val)) return true;
        if (Math.abs(val - xL) < Math.abs(val - xR)) {
          l = m;
          xL = val;
        } else {
          r = m;
          xR = val;
        }
      }
      if (r - l < 1e-5 && Math.abs(xR - xL) > 0.05) {
        return true;
      }
    }

    return false;
  }

  private resolveDiscontinuityY(
    fn: CompiledFunction,
    camera: Camera2D,
    y0: number,
    x0: number,
    _s0: Point2D,
    y1: number,
    x1: number,
    s1: Point2D,
    currentStroke: Point2D[],
    strokes: Point2D[][]
  ): void {
    const w = camera.screenWidth;
    let isAsymptote = false;

    let l = y0;
    let r = y1;
    let xL = x0;
    let xR = x1;
    let ya = (y0 + y1) * 0.5;

    for (let i = 0; i < 40; i++) {
      const m = (l + r) * 0.5;
      const xm = this.safeEval(fn, m);
      if (!Number.isFinite(xm)) {
        ya = m;
        isAsymptote = true;
        break;
      }
      const sm = camera.worldToScreen(xm, m);
      if (this.isOffScreenX(sm.x, w)) {
        isAsymptote = true;
      }

      if ((x0 > 0 && x1 < 0) || (x0 < 0 && x1 > 0)) {
        if (Math.sign(xm) === Math.sign(x0)) {
          l = m;
          xL = xm;
        } else {
          r = m;
          xR = xm;
        }
      } else {
        if (Math.abs(xm - xL) <= Math.abs(xm - xR)) {
          l = m;
          xL = xm;
        } else {
          r = m;
          xR = xm;
        }
      }
      ya = (l + r) * 0.5;
    }

    if (!isAsymptote && r - l < 1e-4 && Math.abs(xR - xL) > 0.05) {
      const sLeft = camera.worldToScreen(xL, l);
      currentStroke.push(sLeft);
      strokes.push(currentStroke);

      const rightStroke: Point2D[] = [];
      const sRight = camera.worldToScreen(xR, r);
      rightStroke.push(sRight);
      this.subdivideY(fn, camera, r, xR, sRight, y1, x1, s1, 0, rightStroke);
      strokes.push(rightStroke);
      return;
    }

    let lowL = y0;
    let highL = ya;
    let bestYL = y0;
    let bestXL = x0;
    let bestSmL = _s0;
    let leftReachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const m = (lowL + highL) * 0.5;
      const xm = this.safeEval(fn, m);
      if (Number.isFinite(xm) && (Math.sign(x0) === 0 || Math.sign(xm) === Math.sign(x0))) {
        lowL = m;
        bestYL = m;
        bestXL = xm;
        bestSmL = camera.worldToScreen(xm, m);
        if (this.isOffScreenX(bestSmL.x, w)) {
          bestSmL.x = this.clampScreenX(bestSmL.x, w);
          leftReachedOffscreen = true;
          break;
        }
      } else {
        highL = m;
      }
    }

    const leftWidthPx = Math.abs(bestYL - ya) * camera.zoom;
    if (leftReachedOffscreen) {
      if (leftWidthPx >= this.minAsymptoteWidthPx) {
        if (bestSmL !== _s0) {
          this.subdivideY(fn, camera, y0, x0, _s0, bestYL, bestXL, bestSmL, 0, currentStroke);
        }
      }
    } else {
      const isBlowingUp = Math.abs(bestXL) > Math.abs(x0) * 5 + 1;
      if (!isBlowingUp) {
        if (bestSmL !== _s0) {
          this.subdivideY(fn, camera, y0, x0, _s0, bestYL, bestXL, bestSmL, 0, currentStroke);
        }
      }
    }

    if (currentStroke.length > 0) {
      strokes.push(currentStroke);
    }

    let bestStart: Point2D | null = null;
    let bestY = y1;
    let bestX = x1;
    let lowR = ya;
    let highR = y1;
    let rightReachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const m = (lowR + highR) * 0.5;
      const xm = this.safeEval(fn, m);
      if (Number.isFinite(xm) && (Math.sign(x1) === 0 || Math.sign(xm) === Math.sign(x1))) {
        bestStart = camera.worldToScreen(xm, m);
        bestY = m;
        bestX = xm;
        highR = m;
        if (this.isOffScreenX(bestStart.x, w)) {
          bestStart.x = this.clampScreenX(bestStart.x, w);
          rightReachedOffscreen = true;
          break;
        }
      } else {
        lowR = m;
      }
    }

    const rightWidthPx = Math.abs(bestY - ya) * camera.zoom;
    const rightStroke: Point2D[] = [];
    if (rightReachedOffscreen) {
      if (rightWidthPx >= this.minAsymptoteWidthPx && bestStart) {
        rightStroke.push(bestStart);
        if (bestStart !== s1) {
          this.subdivideY(fn, camera, bestY, bestX, bestStart, y1, x1, s1, 0, rightStroke);
        }
      } else {
        rightStroke.push(s1);
      }
    } else {
      const isBlowingUp = Math.abs(bestX) > Math.abs(x1) * 5 + 1;
      if (bestStart && !isBlowingUp) {
        rightStroke.push(bestStart);
        if (bestStart !== s1) {
          this.subdivideY(fn, camera, bestY, bestX, bestStart, y1, x1, s1, 0, rightStroke);
        }
      } else {
        rightStroke.push(s1);
      }
    }
    strokes.push(rightStroke);
  }

  private resolveExitY(
    fn: CompiledFunction,
    camera: Camera2D,
    y0: number,
    x0: number,
    s0: Point2D,
    y1: number,
    stroke: Point2D[]
  ): void {
    const w = camera.screenWidth;
    let low = y0;
    let high = y1;
    let bestY = y0;
    let bestX = x0;
    let bestSm = s0;
    let reachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const mid = (low + high) * 0.5;
      const xm = this.safeEval(fn, mid);
      if (Number.isFinite(xm)) {
        low = mid;
        bestY = mid;
        bestX = xm;
        bestSm = camera.worldToScreen(xm, mid);
        if (this.isOffScreenX(bestSm.x, w)) {
          bestSm.x = this.clampScreenX(bestSm.x, w);
          reachedOffscreen = true;
          break;
        }
      } else {
        high = mid;
      }
    }

    const widthPx = Math.abs(bestY - y1) * camera.zoom;
    if (reachedOffscreen) {
      if (widthPx >= this.minAsymptoteWidthPx) {
        if (bestSm !== s0) {
          this.subdivideY(fn, camera, y0, x0, s0, bestY, bestX, bestSm, 0, stroke);
        }
      }
    } else {
      const isBlowingUp = Math.abs(bestX) > Math.abs(x0) * 5 + 1;
      if (!isBlowingUp) {
        if (bestSm !== s0) {
          this.subdivideY(fn, camera, y0, x0, s0, bestY, bestX, bestSm, 0, stroke);
        }
      }
    }
  }

  private resolveEntryY(
    fn: CompiledFunction,
    camera: Camera2D,
    y0: number,
    y1: number,
    x1: number,
    s1: Point2D,
    stroke: Point2D[]
  ): void {
    const w = camera.screenWidth;
    let low = y0;
    let high = y1;
    let bestY = y1;
    let bestX = x1;
    let bestS = s1;
    let reachedOffscreen = false;

    for (let i = 0; i < 40; i++) {
      const mid = (low + high) * 0.5;
      const xm = this.safeEval(fn, mid);
      if (Number.isFinite(xm)) {
        high = mid;
        bestY = mid;
        bestX = xm;
        bestS = camera.worldToScreen(xm, mid);
        if (this.isOffScreenX(bestS.x, w)) {
          bestS.x = this.clampScreenX(bestS.x, w);
          reachedOffscreen = true;
          break;
        }
      } else {
        low = mid;
      }
    }

    const widthPx = Math.abs(bestY - y0) * camera.zoom;
    if (reachedOffscreen) {
      if (widthPx >= this.minAsymptoteWidthPx) {
        stroke.push(bestS);
        if (bestS !== s1) {
          this.subdivideY(fn, camera, bestY, bestX, bestS, y1, x1, s1, 0, stroke);
        }
      } else {
        stroke.push(s1);
      }
    } else {
      const isBlowingUp = Math.abs(bestX) > Math.abs(x1) * 5 + 1;
      if (!isBlowingUp) {
        stroke.push(bestS);
        if (bestS !== s1) {
          this.subdivideY(fn, camera, bestY, bestX, bestS, y1, x1, s1, 0, stroke);
        }
      } else {
        stroke.push(s1);
      }
    }
  }

  private subdivideY(
    fn: CompiledFunction,
    camera: Camera2D,
    y0: number,
    x0: number,
    s0: Point2D,
    y1: number,
    x1: number,
    s1: Point2D,
    depth: number,
    stroke: Point2D[]
  ): void {
    if (depth >= this.maxDepth) {
      stroke.push(s1);
      return;
    }

    const w = camera.screenWidth;
    const offMargin = this.offMargin;
    if ((s0.x < -offMargin && s1.x < -offMargin) || (s0.x > w + offMargin && s1.x > w + offMargin)) {
      const ym = (y0 + y1) * 0.5;
      const xm = this.safeEval(fn, ym);
      if (!Number.isFinite(xm)) return;
      const sm = camera.worldToScreen(xm, ym);
      if ((sm.x < -offMargin && s0.x < -offMargin) || (sm.x > w + offMargin && s0.x > w + offMargin)) {
        stroke.push(s1);
        return;
      }
    }

    const ym = (y0 + y1) * 0.5;
    const xm = this.safeEval(fn, ym);

    if (!Number.isFinite(xm)) {
      return;
    }

    const sm = camera.worldToScreen(xm, ym);

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

    const horizDev = Math.abs(sm.x - (s0.x + s1.x) * 0.5);

    if (distSq > this.tolerancePx * this.tolerancePx || horizDev > this.tolerancePx * 2) {
      this.subdivideY(fn, camera, y0, x0, s0, ym, xm, sm, depth + 1, stroke);
      this.subdivideY(fn, camera, ym, xm, sm, y1, x1, s1, depth + 1, stroke);
    } else {
      stroke.push(s1);
    }
  }
}
