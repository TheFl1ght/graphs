import { Camera2D } from '../viewport/camera2d';
import { CompiledFunction } from '../math/compiler-jit';

export interface Point2D {
  x: number;
  y: number;
}

interface SampleY {
  x: number;
  y: number;
  sx: number;
  sy: number;
  valid: boolean;
  type: 'inside' | 'above' | 'below' | 'invalid';
}

interface SampleX {
  y: number;
  x: number;
  sx: number;
  sy: number;
  valid: boolean;
  type: 'inside' | 'left' | 'right' | 'invalid';
}

/**
 * Robust, interval-based adaptive curve sampler.
 *
 * Samples functions y = f(x) and x = f(y) adaptively with:
 * - Geometric screen-margin boundary clipping: curves terminate cleanly at the viewport margin
 *   without artificial spikes, bridging lines across asymptotes, or mid-air terminations.
 * - Exact bisection of domain boundaries (e.g., sqrt(x) at x = 0) and boundary crossings.
 * - Deep hidden-pole discovery and symmetric dual-branch isolation (e.g. Gamma function across integer poles).
 * - Step-jump discontinuity splitting (e.g., floor, ceil, sign) without vertical riser artifacts.
 * - Adaptive curvature subdivision bounded by maximum recursion depth.
 */
export class CurveSampler {
  private margin: number = 40;
  private tolerancePx: number = 0.5;
  private maxDepth: number = 9;
  private coarseStepPx: number = 4;

  private evalFn(fn: CompiledFunction, val: number): number {
    try {
      const res = fn(val);
      return Number.isFinite(res) ? res : NaN;
    } catch {
      return NaN;
    }
  }

  private evalSampleY(fn: CompiledFunction, camera: Camera2D, x: number): SampleY {
    const y = this.evalFn(fn, x);
    const valid = Number.isFinite(y);
    const sx = camera.worldToScreen(x, 0).x;
    if (!valid) {
      return { x, y: NaN, sx, sy: NaN, valid: false, type: 'invalid' };
    }
    const sy = camera.worldToScreen(x, y).y;
    const h = camera.screenHeight;
    let type: 'inside' | 'above' | 'below';
    if (sy < -this.margin) {
      type = 'above';
    } else if (sy > h + this.margin) {
      type = 'below';
    } else {
      type = 'inside';
    }
    return { x, y, sx, sy, valid: true, type };
  }

  private evalSampleX(fn: CompiledFunction, camera: Camera2D, y: number): SampleX {
    const xVal = this.evalFn(fn, y);
    const valid = Number.isFinite(xVal);
    const sy = camera.worldToScreen(0, y).y;
    if (!valid) {
      return { y, x: NaN, sx: NaN, sy, valid: false, type: 'invalid' };
    }
    const sx = camera.worldToScreen(xVal, y).x;
    const w = camera.screenWidth;
    let type: 'inside' | 'left' | 'right';
    if (sx < -this.margin) {
      type = 'left';
    } else if (sx > w + this.margin) {
      type = 'right';
    } else {
      type = 'inside';
    }
    return { y, x: xVal, sx, sy, valid: true, type };
  }

  private findCrossingY(
    fn: CompiledFunction,
    camera: Camera2D,
    xIn: number,
    xOut: number,
    targetSy: number
  ): Point2D {
    let xin = xIn;
    let xout = xOut;
    const minY = -this.margin;
    const maxY = camera.screenHeight + this.margin;

    for (let i = 0; i < 30; i++) {
      const xMid = (xin + xout) * 0.5;
      const sMid = this.evalSampleY(fn, camera, xMid);
      if (!sMid.valid) {
        xout = xMid;
      } else if (sMid.sy >= minY && sMid.sy <= maxY) {
        xin = xMid;
      } else {
        xout = xMid;
      }
    }

    const xFinal = (xin + xout) * 0.5;
    const sxFinal = camera.worldToScreen(xFinal, 0).x;
    return { x: sxFinal, y: targetSy };
  }

  private findCrossingX(
    fn: CompiledFunction,
    camera: Camera2D,
    yIn: number,
    yOut: number,
    targetSx: number
  ): Point2D {
    let yin = yIn;
    let yout = yOut;
    const minX = -this.margin;
    const maxX = camera.screenWidth + this.margin;

    for (let i = 0; i < 30; i++) {
      const yMid = (yin + yout) * 0.5;
      const sMid = this.evalSampleX(fn, camera, yMid);
      if (!sMid.valid) {
        yout = yMid;
      } else if (sMid.sx >= minX && sMid.sx <= maxX) {
        yin = yMid;
      } else {
        yout = yMid;
      }
    }

    const yFinal = (yin + yout) * 0.5;
    const syFinal = camera.worldToScreen(0, yFinal).y;
    return { x: targetSx, y: syFinal };
  }

  public sample(
    fn: CompiledFunction,
    camera: Camera2D,
    orientation: 'y-of-x' | 'x-of-y' = 'y-of-x'
  ): Point2D[][] {
    if (orientation === 'x-of-y') {
      return this.sampleXOfY(fn, camera);
    }
    return this.sampleYOfX(fn, camera);
  }

  private sampleYOfX(fn: CompiledFunction, camera: Camera2D): Point2D[][] {
    const w = camera.screenWidth;
    const h = camera.screenHeight;
    const strokes: Point2D[][] = [];
    let currentStroke: Point2D[] = [];

    const flush = () => {
      if (currentStroke.length >= 1) {
        strokes.push(currentStroke);
      }
      currentStroke = [];
    };

    const clampPoint = (p: Point2D): Point2D => {
      const minY = -this.margin;
      const maxY = h + this.margin;
      return {
        x: p.x,
        y: Math.max(minY, Math.min(maxY, p.y))
      };
    };

    const addPoint = (p: Point2D) => {
      currentStroke.push(clampPoint(p));
    };

    const startStroke = (p: Point2D) => {
      flush();
      currentStroke.push(clampPoint(p));
    };

    /**
     * Symmetrically handles an asymptote pole between p0 and p1:
     * - Left branch (up to pole) terminates at targetSyL (top/bottom margin)
     * - Right branch (from pole onwards) begins at targetSyR (top/bottom margin)
     * Neither branch is omitted, and no bridging line connects them.
     */
    const handlePoleCrossing = (
      p0: SampleY,
      p1: SampleY,
      l: number,
      r: number,
      yL: number,
      yR: number
    ) => {
      if (p0.type === 'inside') {
        const targetSyL = yL > 0 ? -this.margin : h + this.margin;
        const crossL = this.findCrossingY(fn, camera, p0.x, l, targetSyL);
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint(crossL);
      }
      flush();

      if (p1.type === 'inside') {
        const targetSyR = yR > 0 ? -this.margin : h + this.margin;
        const crossR = this.findCrossingY(fn, camera, p1.x, r, targetSyR);
        startStroke(crossR);
        addPoint({ x: p1.sx, y: p1.sy });
      }
    };

    const processInterval = (p0: SampleY, p1: SampleY, depth: number) => {
      // 1. Both invalid -> nothing on screen
      if (!p0.valid && !p1.valid) {
        flush();
        return;
      }

      // 2. One valid, one invalid -> finite domain boundary OR exact pole hit
      if (p0.valid && !p1.valid) {
        let l = p0.x, r = p1.x;
        let sL = p0;
        for (let i = 0; i < 35; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleY(fn, camera, m);
          if (sm.valid) {
            l = m;
            sL = sm;
          } else {
            r = m;
          }
        }
        if (p0.type === 'inside') {
          if (sL.type !== 'inside') {
            const targetSy = sL.y > 0 ? -this.margin : h + this.margin;
            const cross = this.findCrossingY(fn, camera, p0.x, l, targetSy);
            addPoint(cross);
          } else {
            addPoint({ x: sL.sx, y: sL.sy });
          }
        }
        flush();
        return;
      }

      if (!p0.valid && p1.valid) {
        flush();
        let l = p0.x, r = p1.x;
        let sR = p1;
        for (let i = 0; i < 35; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleY(fn, camera, m);
          if (sm.valid) {
            r = m;
            sR = sm;
          } else {
            l = m;
          }
        }
        if (p1.type === 'inside') {
          if (sR.type !== 'inside') {
            const targetSy = sR.y > 0 ? -this.margin : h + this.margin;
            const cross = this.findCrossingY(fn, camera, p1.x, r, targetSy);
            startStroke(cross);
          } else {
            startStroke({ x: sR.sx, y: sR.sy });
          }
          addPoint({ x: p1.sx, y: p1.sy });
        }
        return;
      }

      // 3. Both offscreen on the same side
      if ((p0.type === 'above' && p1.type === 'above') || (p0.type === 'below' && p1.type === 'below')) {
        const xm = (p0.x + p1.x) * 0.5;
        const pm = this.evalSampleY(fn, camera, xm);
        if (pm.type === p0.type) {
          flush();
          return;
        }
        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        }
        return;
      }

      // 4. One above, one below -> pole or steep continuous crossing
      if ((p0.type === 'above' && p1.type === 'below') || (p0.type === 'below' && p1.type === 'above')) {
        const xm = (p0.x + p1.x) * 0.5;
        const pm = this.evalSampleY(fn, camera, xm);
        const eps = (p1.x - p0.x) * 0.01;
        const dMid = (this.evalFn(fn, xm + eps) - this.evalFn(fn, xm - eps)) / (2 * eps);
        const secantSlope = (p1.y - p0.y) / (p1.x - p0.x);
        const isAsymptote = !pm.valid || (Number.isFinite(dMid) && secantSlope * dMid < 0);

        if (isAsymptote) {
          // Pole between above and below: both sides are already offscreen, no stroke crossing
          flush();
          return;
        }

        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        } else {
          const cross0 = this.findCrossingY(fn, camera, pm.type === 'inside' ? pm.x : p0.x, p0.x, p0.type === 'above' ? -this.margin : h + this.margin);
          const cross1 = this.findCrossingY(fn, camera, pm.type === 'inside' ? pm.x : p1.x, p1.x, p1.type === 'above' ? -this.margin : h + this.margin);
          startStroke(cross0);
          addPoint(cross1);
          flush();
        }
        return;
      }

      // 5. One inside, one above/below
      if (p0.type === 'inside' && (p1.type === 'above' || p1.type === 'below')) {
        const targetSy = p1.type === 'above' ? -this.margin : h + this.margin;
        const crossing = this.findCrossingY(fn, camera, p0.x, p1.x, targetSy);
        if (depth < this.maxDepth && Math.abs(p1.sx - p0.sx) > 1) {
          const xm = (p0.x + p1.x) * 0.5;
          const pm = this.evalSampleY(fn, camera, xm);
          if (pm.type === 'inside') {
            processInterval(p0, pm, depth + 1);
            processInterval(pm, p1, depth + 1);
            return;
          }
        }
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint(crossing);
        flush();
        return;
      }

      if ((p0.type === 'above' || p0.type === 'below') && p1.type === 'inside') {
        const targetSy = p0.type === 'above' ? -this.margin : h + this.margin;
        const crossing = this.findCrossingY(fn, camera, p1.x, p0.x, targetSy);
        if (depth < this.maxDepth && Math.abs(p1.sx - p0.sx) > 1) {
          const xm = (p0.x + p1.x) * 0.5;
          const pm = this.evalSampleY(fn, camera, xm);
          if (pm.type === 'inside') {
            processInterval(p0, pm, depth + 1);
            processInterval(pm, p1, depth + 1);
            return;
          }
        }
        startStroke(crossing);
        addPoint({ x: p1.sx, y: p1.sy });
        return;
      }

      // 6. Both inside: check for hidden pole across sign change
      if (p0.y * p1.y < 0) {
        let l = p0.x, r = p1.x;
        let yL = p0.y, yR = p1.y;
        let isPole = false;

        for (let i = 0; i < 45; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleY(fn, camera, m);
          if (!sm.valid || sm.type !== 'inside') {
            isPole = true;
          }
          if (!sm.valid) {
            break;
          }
          if (sm.y * yL > 0) {
            l = m;
            yL = sm.y;
          } else {
            r = m;
            yR = sm.y;
          }
        }

        if (isPole) {
          handlePoleCrossing(p0, p1, l, r, yL, yR);
          return;
        }
      }

      let xm = (p0.x + p1.x) * 0.5;
      let pm = this.evalSampleY(fn, camera, xm);

      if (!pm.valid || pm.type !== 'inside') {
        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        } else {
          flush();
        }
        return;
      }

      // Check jump discontinuity (e.g. floor, ceil, sign)
      const dyPx = Math.abs(p1.sy - p0.sy);
      if (dyPx > 3) {
        let l = p0.x, r = p1.x, yL = p0.y, yR = p1.y;
        for (let i = 0; i < 20; i++) {
          const m = (l + r) * 0.5;
          const ym = this.evalFn(fn, m);
          if (!Number.isFinite(ym)) break;
          if (Math.abs(ym - yL) <= Math.abs(ym - yR)) {
            l = m; yL = ym;
          } else {
            r = m; yR = ym;
          }
        }
        if (r - l < 1e-4 && Math.abs(yR - yL) > 0.05) {
          const sLeft = camera.worldToScreen(l, yL);
          addPoint(sLeft);
          flush();
          const sRight = camera.worldToScreen(r, yR);
          startStroke(sRight);
          return;
        }
      }

      // Adaptive curvature check (chord distance and vertical deviation)
      const chordDx = p1.sx - p0.sx;
      const chordDy = p1.sy - p0.sy;
      const chordLenSq = chordDx * chordDx + chordDy * chordDy;

      let distSq = 0;
      if (chordLenSq > 1e-6) {
        const cross = Math.abs(chordDy * pm.sx - chordDx * pm.sy + p1.sx * p0.sy - p1.sy * p0.sx);
        distSq = (cross * cross) / chordLenSq;
      } else {
        const dx = pm.sx - p0.sx;
        const dy = pm.sy - p0.sy;
        distSq = dx * dx + dy * dy;
      }

      const vertDev = Math.abs(pm.sy - (p0.sy + p1.sy) * 0.5);

      if (depth < this.maxDepth && (distSq > this.tolerancePx * this.tolerancePx || vertDev > this.tolerancePx * 2)) {
        processInterval(p0, pm, depth + 1);
        processInterval(pm, p1, depth + 1);
      } else {
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint({ x: p1.sx, y: p1.sy });
      }
    };

    let prev = this.evalSampleY(fn, camera, camera.screenToWorld(-this.margin, 0).x);
    if (prev.type === 'inside') {
      startStroke({ x: prev.sx, y: prev.sy });
    }

    for (let sx = -this.margin + this.coarseStepPx; sx <= w + this.margin; sx += this.coarseStepPx) {
      const x = camera.screenToWorld(sx, 0).x;
      const curr = this.evalSampleY(fn, camera, x);
      processInterval(prev, curr, 0);
      prev = curr;
    }

    flush();
    return strokes;
  }

  private sampleXOfY(fn: CompiledFunction, camera: Camera2D): Point2D[][] {
    const w = camera.screenWidth;
    const h = camera.screenHeight;
    const strokes: Point2D[][] = [];
    let currentStroke: Point2D[] = [];

    const flush = () => {
      if (currentStroke.length >= 1) {
        strokes.push(currentStroke);
      }
      currentStroke = [];
    };

    const clampPoint = (p: Point2D): Point2D => {
      const minX = -this.margin;
      const maxX = w + this.margin;
      return {
        x: Math.max(minX, Math.min(maxX, p.x)),
        y: p.y
      };
    };

    const addPoint = (p: Point2D) => {
      currentStroke.push(clampPoint(p));
    };

    const startStroke = (p: Point2D) => {
      flush();
      currentStroke.push(clampPoint(p));
    };

    const handlePoleCrossingX = (
      p0: SampleX,
      p1: SampleX,
      l: number,
      r: number,
      xL: number,
      xR: number
    ) => {
      if (p0.type === 'inside') {
        const targetSxL = xL > 0 ? w + this.margin : -this.margin;
        const crossL = this.findCrossingX(fn, camera, p0.y, l, targetSxL);
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint(crossL);
      }
      flush();

      if (p1.type === 'inside') {
        const targetSxR = xR > 0 ? w + this.margin : -this.margin;
        const crossR = this.findCrossingX(fn, camera, p1.y, r, targetSxR);
        startStroke(crossR);
        addPoint({ x: p1.sx, y: p1.sy });
      }
    };

    const processInterval = (p0: SampleX, p1: SampleX, depth: number) => {
      // 1. Both invalid
      if (!p0.valid && !p1.valid) {
        flush();
        return;
      }

      // 2. One valid, one invalid -> finite domain boundary OR exact pole hit
      if (p0.valid && !p1.valid) {
        let l = p0.y, r = p1.y;
        let sL = p0;
        for (let i = 0; i < 35; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleX(fn, camera, m);
          if (sm.valid) {
            l = m;
            sL = sm;
          } else {
            r = m;
          }
        }
        if (p0.type === 'inside') {
          if (sL.type !== 'inside') {
            const targetSx = sL.x > 0 ? w + this.margin : -this.margin;
            const cross = this.findCrossingX(fn, camera, p0.y, l, targetSx);
            addPoint(cross);
          } else {
            addPoint({ x: sL.sx, y: sL.sy });
          }
        }
        flush();
        return;
      }

      if (!p0.valid && p1.valid) {
        flush();
        let l = p0.y, r = p1.y;
        let sR = p1;
        for (let i = 0; i < 35; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleX(fn, camera, m);
          if (sm.valid) {
            r = m;
            sR = sm;
          } else {
            l = m;
          }
        }
        if (p1.type === 'inside') {
          if (sR.type !== 'inside') {
            const targetSx = sR.x > 0 ? w + this.margin : -this.margin;
            const cross = this.findCrossingX(fn, camera, p1.y, r, targetSx);
            startStroke(cross);
          } else {
            startStroke({ x: sR.sx, y: sR.sy });
          }
          addPoint({ x: p1.sx, y: p1.sy });
        }
        return;
      }

      // 3. Both offscreen on same side
      if ((p0.type === 'left' && p1.type === 'left') || (p0.type === 'right' && p1.type === 'right')) {
        const ym = (p0.y + p1.y) * 0.5;
        const pm = this.evalSampleX(fn, camera, ym);
        if (pm.type === p0.type) {
          flush();
          return;
        }
        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        }
        return;
      }

      // 4. One left, one right -> asymptote pole or steep continuous crossing
      if ((p0.type === 'left' && p1.type === 'right') || (p0.type === 'right' && p1.type === 'left')) {
        const ym = (p0.y + p1.y) * 0.5;
        const pm = this.evalSampleX(fn, camera, ym);
        const eps = (p1.y - p0.y) * 0.01;
        const dMid = (this.evalFn(fn, ym + eps) - this.evalFn(fn, ym - eps)) / (2 * eps);
        const secantSlope = (p1.x - p0.x) / (p1.y - p0.y);
        const isAsymptote = !pm.valid || (Number.isFinite(dMid) && secantSlope * dMid < 0);

        if (isAsymptote) {
          flush();
          return;
        }

        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        } else {
          const cross0 = this.findCrossingX(fn, camera, pm.type === 'inside' ? pm.y : p0.y, p0.y, p0.type === 'left' ? -this.margin : w + this.margin);
          const cross1 = this.findCrossingX(fn, camera, pm.type === 'inside' ? pm.y : p1.y, p1.y, p1.type === 'left' ? -this.margin : w + this.margin);
          startStroke(cross0);
          addPoint(cross1);
          flush();
        }
        return;
      }

      // 5. One inside, one left/right
      if (p0.type === 'inside' && (p1.type === 'left' || p1.type === 'right')) {
        const targetSx = p1.type === 'left' ? -this.margin : w + this.margin;
        const crossing = this.findCrossingX(fn, camera, p0.y, p1.y, targetSx);
        if (depth < this.maxDepth && Math.abs(p1.sy - p0.sy) > 1) {
          const ym = (p0.y + p1.y) * 0.5;
          const pm = this.evalSampleX(fn, camera, ym);
          if (pm.type === 'inside') {
            processInterval(p0, pm, depth + 1);
            processInterval(pm, p1, depth + 1);
            return;
          }
        }
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint(crossing);
        flush();
        return;
      }

      if ((p0.type === 'left' || p0.type === 'right') && p1.type === 'inside') {
        const targetSx = p0.type === 'left' ? -this.margin : w + this.margin;
        const crossing = this.findCrossingX(fn, camera, p1.y, p0.y, targetSx);
        if (depth < this.maxDepth && Math.abs(p1.sy - p0.sy) > 1) {
          const ym = (p0.y + p1.y) * 0.5;
          const pm = this.evalSampleX(fn, camera, ym);
          if (pm.type === 'inside') {
            processInterval(p0, pm, depth + 1);
            processInterval(pm, p1, depth + 1);
            return;
          }
        }
        startStroke(crossing);
        addPoint({ x: p1.sx, y: p1.sy });
        return;
      }

      // 6. Both inside: check for hidden pole across sign change
      if (p0.x * p1.x < 0) {
        let l = p0.y, r = p1.y;
        let xL = p0.x, xR = p1.x;
        let isPole = false;

        for (let i = 0; i < 45; i++) {
          const m = (l + r) * 0.5;
          const sm = this.evalSampleX(fn, camera, m);
          if (!sm.valid || sm.type !== 'inside') {
            isPole = true;
          }
          if (!sm.valid) {
            break;
          }
          if (sm.x * xL > 0) {
            l = m;
            xL = sm.x;
          } else {
            r = m;
            xR = sm.x;
          }
        }

        if (isPole) {
          handlePoleCrossingX(p0, p1, l, r, xL, xR);
          return;
        }
      }

      let ym = (p0.y + p1.y) * 0.5;
      let pm = this.evalSampleX(fn, camera, ym);

      if (!pm.valid || pm.type !== 'inside') {
        if (depth < this.maxDepth) {
          processInterval(p0, pm, depth + 1);
          processInterval(pm, p1, depth + 1);
        } else {
          flush();
        }
        return;
      }

      // Check jump discontinuity
      const dxPx = Math.abs(p1.sx - p0.sx);
      if (dxPx > 3) {
        let l = p0.y, r = p1.y, xL = p0.x, xR = p1.x;
        for (let i = 0; i < 20; i++) {
          const m = (l + r) * 0.5;
          const xm = this.evalFn(fn, m);
          if (!Number.isFinite(xm)) break;
          if (Math.abs(xm - xL) <= Math.abs(xm - xR)) {
            l = m; xL = xm;
          } else {
            r = m; xR = xm;
          }
        }
        if (r - l < 1e-4 && Math.abs(xR - xL) > 0.05) {
          const sLeft = camera.worldToScreen(xL, l);
          addPoint(sLeft);
          flush();
          const sRight = camera.worldToScreen(xR, r);
          startStroke(sRight);
          return;
        }
      }

      // Adaptive curvature check (chord distance and horizontal deviation)
      const chordDx = p1.sx - p0.sx;
      const chordDy = p1.sy - p0.sy;
      const chordLenSq = chordDx * chordDx + chordDy * chordDy;

      let distSq = 0;
      if (chordLenSq > 1e-6) {
        const cross = Math.abs(chordDy * pm.sx - chordDx * pm.sy + p1.sx * p0.sy - p1.sy * p0.sx);
        distSq = (cross * cross) / chordLenSq;
      } else {
        const dx = pm.sx - p0.sx;
        const dy = pm.sy - p0.sy;
        distSq = dx * dx + dy * dy;
      }

      const horizDev = Math.abs(pm.sx - (p0.sx + p1.sx) * 0.5);

      if (depth < this.maxDepth && (distSq > this.tolerancePx * this.tolerancePx || horizDev > this.tolerancePx * 2)) {
        processInterval(p0, pm, depth + 1);
        processInterval(pm, p1, depth + 1);
      } else {
        if (currentStroke.length === 0) {
          startStroke({ x: p0.sx, y: p0.sy });
        }
        addPoint({ x: p1.sx, y: p1.sy });
      }
    };

    let prev = this.evalSampleX(fn, camera, camera.screenToWorld(0, -this.margin).y);
    if (prev.type === 'inside') {
      startStroke({ x: prev.sx, y: prev.sy });
    }

    for (let sy = -this.margin + this.coarseStepPx; sy <= h + this.margin; sy += this.coarseStepPx) {
      const y = camera.screenToWorld(0, sy).y;
      const curr = this.evalSampleX(fn, camera, y);
      processInterval(prev, curr, 0);
      prev = curr;
    }

    flush();
    return strokes;
  }
}
