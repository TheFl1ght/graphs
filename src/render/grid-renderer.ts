import { Camera2D, ViewBounds } from '../viewport/camera2d';

export interface GridStepInfo {
  majorStep: number;
  minorStep: number;
  minorOpacity: number;
}

export class GridRenderer {
  private targetPixelSpacing: number = 80;

  /**
   * Calculates dynamic step (1, 2, 5 * 10^k) and smooth opacity for sub-divisions.
   */
  public calculateGridStep(zoom: number): GridStepInfo {
    const rawStep = this.targetPixelSpacing / zoom;
    const exponent = Math.floor(Math.log10(rawStep));
    const base = Math.pow(10, exponent);
    const fraction = rawStep / base;

    let majorMultiplier: number;
    let subDivisions: number;

    if (fraction < 1.5) {
      majorMultiplier = 1;
      subDivisions = 5;
    } else if (fraction < 3.5) {
      majorMultiplier = 2;
      subDivisions = 4;
    } else if (fraction < 7.5) {
      majorMultiplier = 5;
      subDivisions = 5;
    } else {
      majorMultiplier = 10;
      subDivisions = 5;
    }

    const majorStep = majorMultiplier * base;
    const minorStep = majorStep / subDivisions;

    // Smooth fading of minor grid lines to prevent visual popping
    const minorPixelSpacing = minorStep * zoom;
    const minorOpacity = Math.min(Math.max((minorPixelSpacing - 12) / 20, 0), 1);

    return { majorStep, minorStep, minorOpacity };
  }

  public render(ctx: CanvasRenderingContext2D, camera: Camera2D): void {
    const bounds = camera.getVisibleBounds();
    const { majorStep, minorStep, minorOpacity } = this.calculateGridStep(camera.zoom);

    ctx.save();

    // 1. Render Minor Grid Lines
    if (minorOpacity > 0.01) {
      ctx.strokeStyle = `rgba(200, 205, 215, ${0.4 * minorOpacity})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.drawLines(ctx, camera, bounds, minorStep);
      ctx.stroke();
    }

    // 2. Render Major Grid Lines
    ctx.strokeStyle = 'rgba(180, 185, 195, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this.drawLines(ctx, camera, bounds, majorStep);
    ctx.stroke();

    // 3. Render Coordinate Axes (X = 0, Y = 0)
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    // Vertical Y-axis (X = 0)
    const yAxisScreen = camera.worldToScreen(0, 0).x;
    if (yAxisScreen >= 0 && yAxisScreen <= camera.screenWidth) {
      ctx.moveTo(yAxisScreen, 0);
      ctx.lineTo(yAxisScreen, camera.screenHeight);
    }

    // Horizontal X-axis (Y = 0)
    const xAxisScreen = camera.worldToScreen(0, 0).y;
    if (xAxisScreen >= 0 && xAxisScreen <= camera.screenHeight) {
      ctx.moveTo(0, xAxisScreen);
      ctx.lineTo(camera.screenWidth, xAxisScreen);
    }
    ctx.stroke();

    // 4. Render Numeric Labels along axes
    this.renderLabels(ctx, camera, bounds, majorStep);

    ctx.restore();
  }

  private drawLines(
    ctx: CanvasRenderingContext2D,
    camera: Camera2D,
    bounds: ViewBounds,
    step: number
  ): void {
    // Vertical lines
    const startX = Math.floor(bounds.minX / step) * step;
    for (let x = startX; x <= bounds.maxX; x += step) {
      const sx = Math.round(camera.worldToScreen(x, 0).x) + 0.5; // pixel-snapping
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, camera.screenHeight);
    }

    // Horizontal lines
    const startY = Math.floor(bounds.minY / step) * step;
    for (let y = startY; y <= bounds.maxY; y += step) {
      const sy = Math.round(camera.worldToScreen(0, y).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(camera.screenWidth, sy);
    }
  }

  private renderLabels(
    ctx: CanvasRenderingContext2D,
    camera: Camera2D,
    bounds: ViewBounds,
    step: number
  ): void {
    ctx.font = '13px "KaTeX_Main", "Times New Roman", Times, serif';
    ctx.fillStyle = '#64748b';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    const originScreen = camera.worldToScreen(0, 0);

    // Clamp axis positions so labels stick to screen edges if axis goes offscreen
    const labelYPos = Math.min(Math.max(originScreen.y + 6, 6), camera.screenHeight - 20);
    const labelXPos = Math.min(Math.max(originScreen.x - 8, 40), camera.screenWidth - 10);

    // X-axis labels
    const startX = Math.floor(bounds.minX / step) * step;
    for (let x = startX; x <= bounds.maxX; x += step) {
      if (Math.abs(x) < step * 0.1) continue; // Skip origin (0, 0)

      const sx = camera.worldToScreen(x, 0).x;
      const text = this.formatNumber(x, step);
      ctx.fillText(text, sx, labelYPos);
    }

    // Y-axis labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const startY = Math.floor(bounds.minY / step) * step;
    for (let y = startY; y <= bounds.maxY; y += step) {
      if (Math.abs(y) < step * 0.1) continue;

      const sy = camera.worldToScreen(0, y).y;
      const text = this.formatNumber(y, step);
      ctx.fillText(text, labelXPos, sy);
    }

    // Origin label "0"
    if (
      originScreen.x >= 15 &&
      originScreen.x <= camera.screenWidth - 15 &&
      originScreen.y >= 15 &&
      originScreen.y <= camera.screenHeight - 15
    ) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('0', originScreen.x - 6, originScreen.y + 6);
    }
  }

  private formatNumber(value: number, step: number): string {
    if (Math.abs(value) < 1e-12) return '0';

    const absVal = Math.abs(value);
    if (absVal >= 1e7 || (absVal < 1e-4 && absVal > 0)) {
      return value.toExponential(2);
    }

    // Calculate required decimal places based on step size
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-5));
    return parseFloat(value.toFixed(decimals)).toString();
  }
}
