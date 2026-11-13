export interface RK4Result {
  x: number;
  y: number;
  z: number;
  t: number;
  exploded?: boolean;
}

export type ODEFunction = (x: number, y: number, z: number, t: number) => number;

/**
 * 4th-order Runge-Kutta (RK4) numerical integration step for 3D and 2D dynamical systems.
 * Provides high precision and stability for chaotic attractors (Lorenz, Rössler, etc.).
 */
export function rk4Step(
  fx: ODEFunction,
  fy: ODEFunction,
  fz: ODEFunction | undefined,
  x: number,
  y: number,
  z: number,
  t: number,
  h: number
): RK4Result {
  const evalZ = fz || (() => 0);

  const k1x = fx(x, y, z, t);
  const k1y = fy(x, y, z, t);
  const k1z = evalZ(x, y, z, t);

  const x2 = x + 0.5 * h * k1x;
  const y2 = y + 0.5 * h * k1y;
  const z2 = z + 0.5 * h * k1z;
  const t2 = t + 0.5 * h;

  const k2x = fx(x2, y2, z2, t2);
  const k2y = fy(x2, y2, z2, t2);
  const k2z = evalZ(x2, y2, z2, t2);

  const x3 = x + 0.5 * h * k2x;
  const y3 = y + 0.5 * h * k2y;
  const z3 = z + 0.5 * h * k2z;
  const t3 = t + 0.5 * h;

  const k3x = fx(x3, y3, z3, t3);
  const k3y = fy(x3, y3, z3, t3);
  const k3z = evalZ(x3, y3, z3, t3);

  const x4 = x + h * k3x;
  const y4 = y + h * k3y;
  const z4 = z + h * k3z;
  const t4 = t + h;

  const k4x = fx(x4, y4, z4, t4);
  const k4y = fy(x4, y4, z4, t4);
  const k4z = evalZ(x4, y4, z4, t4);

  const nextX = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
  const nextY = y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
  const nextZ = z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
  const nextT = t + h;

  if (!Number.isFinite(nextX) || !Number.isFinite(nextY) || !Number.isFinite(nextZ)) {
    return { x, y, z, t, exploded: true };
  }

  return { x: nextX, y: nextY, z: nextZ, t: nextT };
}
