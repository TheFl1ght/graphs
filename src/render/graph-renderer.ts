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
  orientation?: 'y-of-x' | 'x-of-y';
  layer?: number;
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
  layer?: number;
}

export interface VectorGraphItem {
  type: 'vector';
  id: string;
  color: string;
  origin?: { x: number; y: number };
  target: { x: number; y: number };
  label?: string;
  visible: boolean;
  layer?: number;
}

export interface TrajectoryGraphItem {
  type: 'trajectory';
  id: string;
  color: string;
  points: { x: number; y: number; z?: number; t: number }[];
  currentPoint?: { x: number; y: number };
  projection?: 'xy' | 'xz' | 'yz';
  visible: boolean;
  layer?: number;
}

export type GraphItem = CurveGraphItem | PointsGraphItem | VectorGraphItem | TrajectoryGraphItem;

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

        const strokes: Point2D[][] = this.sampler.sample(item.fn, camera, item.orientation);
        const maxCoordY = height * 4;
        const minCoordY = -maxCoordY;
        const maxCoordX = width * 4;
        const minCoordX = -maxCoordX;
        for (const stroke of strokes) {
          if (stroke.length < 2) continue;
          ctx.beginPath();
          const startX = Math.max(minCoordX, Math.min(maxCoordX, stroke[0].x));
          const startY = Math.max(minCoordY, Math.min(maxCoordY, stroke[0].y));
          ctx.moveTo(startX, startY);
          for (let i = 1; i < stroke.length; i++) {
            const ptX = Math.max(minCoordX, Math.min(maxCoordX, stroke[i].x));
            const ptY = Math.max(minCoordY, Math.min(maxCoordY, stroke[i].y));
            ctx.lineTo(ptX, ptY);
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
      } else if (item.type === 'vector') {
        const ox = item.origin?.x ?? 0;
        const oy = item.origin?.y ?? 0;
        const tx = item.target.x;
        const ty = item.target.y;

        if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
          continue;
        }

        const p0 = camera.worldToScreen(ox, oy);
        const p1 = camera.worldToScreen(tx, ty);

        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);

        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.lineWidth = 2.75;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        // Origin anchor dot
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, 4, 0, Math.PI * 2);
        ctx.fill();

        if (len > 3) {
          const angle = Math.atan2(dy, dx);
          const headLen = Math.min(15, Math.max(8, len * 0.3));
          const headAngle = Math.PI / 7;

          // Shorten line slightly so arrow head tip looks sharp
          const endShaftX = p1.x - Math.cos(angle) * (headLen * 0.5);
          const endShaftY = p1.y - Math.sin(angle) * (headLen * 0.5);

          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(endShaftX, endShaftY);
          ctx.stroke();

          // Arrowhead
          const leftX = p1.x - headLen * Math.cos(angle - headAngle);
          const leftY = p1.y - headLen * Math.sin(angle - headAngle);
          const rightX = p1.x - headLen * Math.cos(angle + headAngle);
          const rightY = p1.y - headLen * Math.sin(angle + headAngle);

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(leftX, leftY);
          ctx.lineTo(rightX, rightY);
          ctx.closePath();
          ctx.fill();
        }

        // Draw coordinate / name label if present
        if (item.label) {
          ctx.font = '600 12px Inter, system-ui, sans-serif';
          ctx.fillStyle = item.color;
          const labelOffset = 12;
          const textX = p1.x + (dx >= 0 ? labelOffset : -labelOffset - ctx.measureText(item.label).width);
          const textY = p1.y + (dy <= 0 ? -labelOffset : labelOffset + 10);
          ctx.fillText(item.label, textX, textY);
        }
      } else if (item.type === 'trajectory') {
        const pts = item.points;
        if (pts.length < 2) continue;

        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        const proj = item.projection || 'xy';
        const get2D = (p: { x: number; y: number; z?: number }) => {
          if (proj === 'xz') return { x: p.x, y: p.z ?? 0 };
          if (proj === 'yz') return { x: p.y, y: p.z ?? 0 };
          return { x: p.x, y: p.y };
        };

        const total = pts.length;
        ctx.beginPath();
        const p0 = get2D(pts[0]);
        const s0 = camera.worldToScreen(p0.x, p0.y);
        ctx.moveTo(s0.x, s0.y);

        for (let i = 1; i < total; i++) {
          const p = get2D(pts[i]);
          const s = camera.worldToScreen(p.x, p.y);
          ctx.lineTo(s.x, s.y);
        }
        ctx.strokeStyle = item.color;
        ctx.stroke();

        // Draw active head point (glowing position dot)
        const lastPt = pts[pts.length - 1];
        const head2D = item.currentPoint || get2D(lastPt);
        const sHead = camera.worldToScreen(head2D.x, head2D.y);

        ctx.beginPath();
        ctx.arc(sHead.x, sHead.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        ctx.beginPath();
        ctx.arc(sHead.x, sHead.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = item.color;
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
