import { Camera2D } from '../viewport/camera2d';
import { GridRenderer } from './grid-renderer';
import { CurveSampler, Point2D } from './curve-sampler';
import { CompiledFunction } from '../math/compiler-jit';

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface CurveGraphItem {
  type: 'curve';
  id: string;
  color: string;
  fn: CompiledFunction;
  visible: boolean;
  lineStyle?: LineStyle;
}

export interface PointsGraphItem {
  type: 'points';
  id: string;
  color: string;
  points: {
    x: number;
    y: number;
    dx?: number;
    dy?: number;
  }[];
  visible: boolean;
}

export type GraphItem = CurveGraphItem | PointsGraphItem;

export class GraphRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gridRenderer: GridRenderer;
  private sampler: CurveSampler;
  private dpr: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;
    this.gridRenderer = new GridRenderer();
    this.sampler = new CurveSampler();
    this.updateDPR();
  }

  public updateDPR(): void {
    this.dpr = window.devicePixelRatio || 1;
  }

  public resize(width: number, height: number): void {
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  public render(camera: Camera2D, items: GraphItem[]): void {
    const ctx = this.ctx;
    const width = camera.screenWidth;
    const height = camera.screenHeight;

    // 1. Clear complete physical pixel buffer to crisp white
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    // Scale for Retina/HiDPI displays
    ctx.scale(this.dpr, this.dpr);

    // 2. Draw Dynamic Grid & Axes
    this.gridRenderer.render(ctx, camera);

    // 3. Render Graphs & Tables
    for (const item of items) {
      if (!item.visible) continue;

      if (item.type === 'curve') {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = item.color;

        // Apply line style
        if (item.lineStyle === 'dashed') {
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.setLineDash([12, 8]);
        } else if (item.lineStyle === 'dotted') {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([0, 10]);
        } else if (item.lineStyle === 'dashdot') {
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.setLineDash([12, 5, 3, 5]);
        } else {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([]);
        }

        const strokes: Point2D[][] = this.sampler.sample(item.fn, camera);
        const maxCoord = height * 4;
        const minCoord = -maxCoord;
        for (const stroke of strokes) {
          if (stroke.length < 2) continue;
          ctx.beginPath();
          const startY = Math.max(minCoord, Math.min(maxCoord, stroke[0].y));
          ctx.moveTo(stroke[0].x, startY);
          for (let i = 1; i < stroke.length; i++) {
            const ptY = Math.max(minCoord, Math.min(maxCoord, stroke[i].y));
            ctx.lineTo(stroke[i].x, ptY);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else if (item.type === 'points') {
        const capSize = 4; // Half-cap size in px (total cap 8px)

        // 1. Draw error bars (horizontal and vertical with end caps)
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';

        for (const pt of item.points) {
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;

          // Horizontal error bar (dx)
          if (typeof pt.dx === 'number' && Number.isFinite(pt.dx) && pt.dx > 0) {
            const sCenter = camera.worldToScreen(pt.x, pt.y);
            const sLeft = camera.worldToScreen(pt.x - pt.dx, pt.y);
            const sRight = camera.worldToScreen(pt.x + pt.dx, pt.y);

            ctx.beginPath();
            // Main horizontal line
            ctx.moveTo(sLeft.x, sCenter.y);
            ctx.lineTo(sRight.x, sCenter.y);
            // Left vertical cap
            ctx.moveTo(sLeft.x, sCenter.y - capSize);
            ctx.lineTo(sLeft.x, sCenter.y + capSize);
            // Right vertical cap
            ctx.moveTo(sRight.x, sCenter.y - capSize);
            ctx.lineTo(sRight.x, sCenter.y + capSize);
            ctx.stroke();
          }

          // Vertical error bar (dy)
          if (typeof pt.dy === 'number' && Number.isFinite(pt.dy) && pt.dy > 0) {
            const sCenter = camera.worldToScreen(pt.x, pt.y);
            const sTop = camera.worldToScreen(pt.x, pt.y + pt.dy);
            const sBot = camera.worldToScreen(pt.x, pt.y - pt.dy);

            ctx.beginPath();
            // Main vertical line
            ctx.moveTo(sCenter.x, sBot.y);
            ctx.lineTo(sCenter.x, sTop.y);
            // Bottom horizontal cap
            ctx.moveTo(sCenter.x - capSize, sBot.y);
            ctx.lineTo(sCenter.x + capSize, sBot.y);
            // Top horizontal cap
            ctx.moveTo(sCenter.x - capSize, sTop.y);
            ctx.lineTo(sCenter.x + capSize, sTop.y);
            ctx.stroke();
          }
        }

        // 2. Draw center point dots
        ctx.fillStyle = item.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;

        for (const pt of item.points) {
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
          const s = camera.worldToScreen(pt.x, pt.y);
          if (s.x < -20 || s.x > width + 20 || s.y < -20 || s.y > height + 20) continue;

          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }
}
