import { Camera2D } from '../viewport/camera2d';
import { CompiledFunction } from '../math/compiler-jit';

export interface Point2D {
  x: number;
  y: number;
}

export class CurveSampler {
  private maxDepth: number = 7;
  private tolerancePx: number = 0.5; // Half a pixel error tolerance

  /**
   * Samples a function f(x) adaptively over the camera's visible horizontal span.
   * Produces a list of disconnected continuous line strips (Point2D[][]),
   * automatically splitting strokes across asymptotes and discontinuities.
   */
  public sample(
    fn: CompiledFunction,
    camera: Camera2D
  ): Point2D[][] {
    const width = camera.screenWidth;
    const coarseStepPx = 4; // Dense and responsive 4px step
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
        // Function enters undefined domain: pinpoint exact mathematical boundary via bisection
        const boundary = this.findBoundary(fn, prevWorld.x, currWorld.x, true);
        if (boundary) {
          const sBoundary = camera.worldToScreen(boundary.x, boundary.y);
          this.subdivide(
            fn,
            camera,
            prevWorld.x,
            prevY,
            prevScreen,
            boundary.x,
            boundary.y,
            sBoundary,
            0,
            currentStroke
          );
        }
        if (currentStroke.length > 0) {
          strokes.push(currentStroke);
          currentStroke = [];
        }
      } else if (!prevValid && currValid) {
        // Function exits undefined domain: pinpoint exact mathematical boundary via bisection
        const boundary = this.findBoundary(fn, prevWorld.x, currWorld.x, false);
        if (boundary) {
          const sBoundary = camera.worldToScreen(boundary.x, boundary.y);
          currentStroke.push(sBoundary);
          this.subdivide(
            fn,
            camera,
            boundary.x,
            boundary.y,
            sBoundary,
            currWorld.x,
            currY,
            currScreen,
            0,
            currentStroke
          );
        } else {
          currentStroke.push(currScreen);
        }
      } else {
        // Check for asymptote / singularity crossing (e.g. tan(x), 1/x)
        if (this.isAsymptote(fn, prevWorld.x, prevY, currWorld.x, currY, camera)) {
          if (currentStroke.length > 0) {
            strokes.push(currentStroke);
            currentStroke = [];
          }
          currentStroke.push(currScreen);
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

  /**
   * Refines the exact boundary between defined and undefined function domain
   * using binary search (bisection) with 16 iterations (< 0.0001px error).
   * @param validOnLeft true if x0 is valid and x1 is invalid; false if x0 is invalid and x1 is valid.
   */
  private findBoundary(
    fn: CompiledFunction,
    x0: number,
    x1: number,
    validOnLeft: boolean
  ): { x: number; y: number } | null {
    let low = x0;
    let high = x1;
    let bestX = validOnLeft ? x0 : x1;
    let bestY = this.safeEval(fn, bestX);

    if (!Number.isFinite(bestY)) {
      return null;
    }

    for (let i = 0; i < 16; i++) {
      const mid = (low + high) * 0.5;
      const ym = this.safeEval(fn, mid);
      if (Number.isFinite(ym)) {
        bestX = mid;
        bestY = ym;
        if (validOnLeft) {
          low = mid;
        } else {
          high = mid;
        }
      } else {
        if (validOnLeft) {
          high = mid;
        } else {
          low = mid;
        }
      }
    }

    return Number.isFinite(bestY) ? { x: bestX, y: bestY } : null;
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
   * Detects whether an asymptote or jump discontinuity exists between x0 and x1.
   */
  private isAsymptote(
    fn: CompiledFunction,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    camera: Camera2D
  ): boolean {
    const s0 = camera.worldToScreen(x0, y0);
    const s1 = camera.worldToScreen(x1, y1);

    const dyPx = Math.abs(s1.y - s0.y);

    // If screen vertical jump is small, it's not an asymptote
    if (dyPx < camera.screenHeight * 0.5) {
      return false;
    }

    // Check midpoint
    const xm = (x0 + x1) * 0.5;
    const ym = this.safeEval(fn, xm);
    if (!Number.isFinite(ym)) return true;

    // Check for sign flip with massive gradient (like 1/x or tan(x))
    if ((y0 > 0 && y1 < 0) || (y0 < 0 && y1 > 0)) {
      // Numerical derivative at midpoint
      const eps = (x1 - x0) * 0.01;
      const dMid = (this.safeEval(fn, xm + eps) - this.safeEval(fn, xm - eps)) / (2 * eps);
      const secantSlope = (y1 - y0) / (x1 - x0);

      // If secant slope opposite sign to actual derivative, it's a branch cut / asymptote wrap-around!
      if (Number.isFinite(dMid) && secantSlope * dMid < 0) {
        return true;
      }

      // If midpoint does not lie between y0 and y1 and distance is huge
      if (dyPx > camera.screenHeight * 0.8) {
        return true;
      }
    }

    return false;
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

    // Skip detailed subdivision if points are far off-screen vertically
    const h = camera.screenHeight;
    const offMargin = 120;
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
