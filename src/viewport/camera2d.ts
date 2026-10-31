export interface ViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class Camera2D {
  public centerX: number = 0;
  public centerY: number = 0;
  public zoom: number = 50; // pixels per world unit (at zoom=50, 1 unit = 50px)

  public screenWidth: number = 800;
  public screenHeight: number = 600;

  // Inertial momentum variables
  private velX: number = 0;
  private velY: number = 0;
  private friction: number = 0.92;
  public isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private lastPanTime: number = 0;

  constructor(width: number, height: number) {
    this.resize(width, height);
  }

  public resize(width: number, height: number): void {
    this.screenWidth = Math.max(1, width);
    this.screenHeight = Math.max(1, height);
  }

  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const x = this.centerX + (sx - this.screenWidth / 2) / this.zoom;
    const y = this.centerY - (sy - this.screenHeight / 2) / this.zoom; // Invert Y for Cartesian
    return { x, y };
  }

  public worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const sx = this.screenWidth / 2 + (wx - this.centerX) * this.zoom;
    const sy = this.screenHeight / 2 - (wy - this.centerY) * this.zoom; // Invert Y
    return { x: sx, y: sy };
  }

  public getVisibleBounds(): ViewBounds {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.screenWidth, this.screenHeight);

    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      maxX: Math.max(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxY: Math.max(topLeft.y, bottomRight.y)
    };
  }

  /**
   * Continuous zoom centered strictly around the cursor position.
   */
  public zoomAt(sx: number, sy: number, factor: number): void {
    const worldBefore = this.screenToWorld(sx, sy);
    const newZoom = Math.min(Math.max(this.zoom * factor, 1e-6), 1e8);
    this.zoom = newZoom;

    // Adjust centerX and centerY so worldBefore stays exactly at (sx, sy)
    this.centerX = worldBefore.x - (sx - this.screenWidth / 2) / this.zoom;
    this.centerY = worldBefore.y + (sy - this.screenHeight / 2) / this.zoom;
  }

  public startPan(sx: number, sy: number): void {
    this.isDragging = true;
    this.lastMouseX = sx;
    this.lastMouseY = sy;
    this.velX = 0;
    this.velY = 0;
    this.lastPanTime = performance.now();
  }

  public pan(sx: number, sy: number): void {
    if (!this.isDragging) return;
    const dx = sx - this.lastMouseX;
    const dy = sy - this.lastMouseY;
    if (dx === 0 && dy === 0) return;

    // Convert pixel delta to world delta
    this.centerX -= dx / this.zoom;
    this.centerY += dy / this.zoom;

    const now = performance.now();
    const dt = Math.max(1, now - this.lastPanTime);
    this.lastPanTime = now;

    // Smooth velocity scaled to normal frame delta (approx 16ms per frame)
    const frameFactor = Math.min(3, 16 / dt);
    const instVelX = (-dx / this.zoom) * frameFactor;
    const instVelY = (dy / this.zoom) * frameFactor;
    this.velX = this.velX * 0.4 + instVelX * 0.6;
    this.velY = this.velY * 0.4 + instVelY * 0.6;

    this.lastMouseX = sx;
    this.lastMouseY = sy;
  }

  public endPan(): void {
    this.isDragging = false;
    // If the mouse paused before release (> 60ms), cancel inertia fling
    if (performance.now() - this.lastPanTime > 60) {
      this.velX = 0;
      this.velY = 0;
    }
  }

  /**
   * Applies inertial velocity damping per frame.
   * Returns true if camera is still actively moving.
   */
  public updateInertia(): boolean {
    if (this.isDragging) return false;

    if (Math.abs(this.velX) > 1e-5 || Math.abs(this.velY) > 1e-5) {
      this.centerX += this.velX;
      this.centerY += this.velY;
      this.velX *= this.friction;
      this.velY *= this.friction;
      return true;
    }

    this.velX = 0;
    this.velY = 0;
    return false;
  }
}
