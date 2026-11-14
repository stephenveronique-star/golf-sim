// Ball-flight model: drag + Magnus lift + gravity, integrated with RK4.
// Coefficients are fitted to published PGA Tour launch-monitor averages
// (see test/fit-physics.mjs). All units SI unless named otherwise.

export const BALL = { mass: 0.04593, radius: 0.021335, diameter: 0.04267 };
export const MPH = 0.44704;      // m/s per mph
export const YARD = 0.9144;      // m per yard
export const RPM = Math.PI / 30; // rad/s per rpm

// Fitted aerodynamic coefficients (overwritten by the fit script output).
export const AERO = {
  cd0: 0.2453, cd1: 0.153, cdV: -0.2059, // Cd = cd0 + cd1*S + cdV*(v/50-1)  (S = r*w/v)
  clA: 0.5112, clB: 0.4791,   // Cl = clA * S^clB
  spinTau: 25,                // spin decay time constant, s
  rollK: 1.64,              // roll model scale
};

// Air density from altitude (m) and temperature (C), dry air.
export function airDensity(altitudeM = 0, tempC = 15) {
  const P = 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  return P / (287.05 * (tempC + 273.15));
}

// Club table. Tour reference numbers (TrackMan PGA Tour averages):
// club speed mph, ball speed mph, launch deg, spin rpm, carry yd.
// Wedges below PW are typical figures, used only for spin/smash defaults.
export const CLUBS = [
  { id: 'DR', name: 'Driver',  club: 113, ball: 167, launch: 10.9, spin: 2686, carry: 275, apex: 32, land: 38 },
  { id: '3W', name: '3 Wood',  club: 107, ball: 158, launch: 9.2,  spin: 3655, carry: 243, apex: 30, land: 43 },
  { id: '5W', name: '5 Wood',  club: 103, ball: 152, launch: 9.4,  spin: 4350, carry: 230, apex: 31, land: 47 },
  { id: 'HY', name: 'Hybrid',  club: 100, ball: 146, launch: 10.2, spin: 4437, carry: 225, apex: 29, land: 47 },
  { id: '3I', name: '3 Iron',  club: 98,  ball: 142, launch: 10.4, spin: 4630, carry: 212, apex: 27, land: 46 },
  { id: '4I', name: '4 Iron',  club: 96,  ball: 137, launch: 11.0, spin: 4836, carry: 203, apex: 28, land: 48 },
  { id: '5I', name: '5 Iron',  club: 94,  ball: 132, launch: 12.1, spin: 5361, carry: 194, apex: 31, land: 49 },
  { id: '6I', name: '6 Iron',  club: 92,  ball: 127, launch: 14.1, spin: 6231, carry: 183, apex: 30, land: 50 },
  { id: '7I', name: '7 Iron',  club: 90,  ball: 120, launch: 16.3, spin: 7097, carry: 172, apex: 32, land: 50 },
  { id: '8I', name: '8 Iron',  club: 87,  ball: 115, launch: 18.1, spin: 7998, carry: 160, apex: 31, land: 50 },
  { id: '9I', name: '9 Iron',  club: 85,  ball: 109, launch: 20.4, spin: 8647, carry: 148, apex: 30, land: 51 },
  { id: 'PW', name: 'P Wedge', club: 83,  ball: 102, launch: 24.2, spin: 9304, carry: 136, apex: 29, land: 52 },
  { id: 'GW', name: 'G Wedge', club: 80,  ball: 94,  launch: 27,   spin: 9700 },
  { id: 'SW', name: 'S Wedge', club: 76,  ball: 85,  launch: 30,   spin: 10000 },
  { id: 'LW', name: 'L Wedge', club: 72,  ball: 76,  launch: 33,   spin: 10200 },
];
export const clubById = (id) => CLUBS.find((c) => c.id === id) || CLUBS[8];

// Estimated spin for a club at a measured ball speed (spin is not measured
// by a single camera; it scales down for slower swings).
export function estimateSpin(clubId, ballSpeedMs) {
  const c = clubById(clubId);
  const ratio = Math.max(0.3, Math.min(1.3, ballSpeedMs / (c.ball * MPH)));
  return c.spin * Math.pow(ratio, 0.8);
}
export function smashFactor(clubId) {
  const c = clubById(clubId);
  return c.ball / c.club;
}

/**
 * Simulate a shot.
 * @param {object} p
 *   speed (m/s), launch (deg up), direction (deg, + = right of target),
 *   spin (rpm), spinAxis (deg, + = curves right), altitude (m), tempC,
 *   firmness (0.5 soft .. 1.5 firm), aero (optional override)
 * @returns carry, total, roll, apex, offline (m, + right), landAngle (deg),
 *   flightTime (s), points [{t,x,y,z}] with x downrange, y up, z right.
 */
export function simulate(p) {
  const A = p.aero || AERO;
  const rho = p.rho ?? airDensity(p.altitude ?? 0, p.tempC ?? 15);
  const { mass: m, radius: r } = BALL;
  const area = Math.PI * r * r;
  const k = (0.5 * rho * area) / m;
  const la = (p.launch * Math.PI) / 180;
  const dir = ((p.direction || 0) * Math.PI) / 180;
  let vx = p.speed * Math.cos(la) * Math.cos(dir);
  let vy = p.speed * Math.sin(la);
  let vz = p.speed * Math.cos(la) * Math.sin(dir);
  let x = 0, y = 0, z = 0, t = 0;
  const w0 = (p.spin || 0) * RPM;
  // Spin axis: pure backspin axis is horizontal, perpendicular to flight
  // direction; tilt it by spinAxis to create curve.
  const ax = ((p.spinAxis || 0) * Math.PI) / 180;
  const hx = Math.cos(dir), hz = Math.sin(dir);
  // unit spin vector (backspin about axis pointing left of travel, tilted)
  // left of travel in (x,z) plane is (hz, -hx)... use right-hand rule so
  // w x v gives upward lift for backspin.
  const sx0 = -hz * Math.cos(ax), sy0 = -Math.sin(ax), sz0 = hx * Math.cos(ax);
  const pts = [{ t: 0, x: 0, y: 0, z: 0 }];

  const accel = (vx, vy, vz, t) => {
    const v = Math.hypot(vx, vy, vz) || 1e-9;
    const w = w0 * Math.exp(-t / A.spinTau);
    const S = (r * w) / v;
    const cd = A.cd0 + A.cd1 * S + (A.cdV || 0) * (v / 50 - 1);
    const cl = S > 0 ? A.clA * Math.pow(S, A.clB) : 0;
    // lift direction = (spin x v) normalised
    let lx = sy0 * vz - sz0 * vy;
    let ly = sz0 * vx - sx0 * vz;
    let lz = sx0 * vy - sy0 * vx;
    const ln = Math.hypot(lx, ly, lz) || 1;
    lx /= ln; ly /= ln; lz /= ln;
    const kv2 = k * v * v;
    return [
      -k * cd * v * vx + kv2 * cl * lx,
      -k * cd * v * vy + kv2 * cl * ly - 9.80665,
      -k * cd * v * vz + kv2 * cl * lz,
    ];
  };

  const dt = 0.005;
  let apex = 0;
  let last = { x, y, z, vx, vy, vz, t };
  for (let i = 0; i < 4000; i++) {
    last = { x, y, z, vx, vy, vz, t };
    const a1 = accel(vx, vy, vz, t);
    const a2 = accel(vx + a1[0] * dt / 2, vy + a1[1] * dt / 2, vz + a1[2] * dt / 2, t + dt / 2);
    const a3 = accel(vx + a2[0] * dt / 2, vy + a2[1] * dt / 2, vz + a2[2] * dt / 2, t + dt / 2);
    const a4 = accel(vx + a3[0] * dt, vy + a3[1] * dt, vz + a3[2] * dt, t + dt);
    x += dt * (vx + dt / 6 * (a1[0] + a2[0] + a3[0]));
    y += dt * (vy + dt / 6 * (a1[1] + a2[1] + a3[1]));
    z += dt * (vz + dt / 6 * (a1[2] + a2[2] + a3[2]));
    vx += dt / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
    vy += dt / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
    vz += dt / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
    t += dt;
    if (y > apex) apex = y;
    if (i % 4 === 3) pts.push({ t, x, y, z });
    if (y < 0 && t > 0.05) break;
  }
  // interpolate the landing point
  const f = last.y / (last.y - y);
  const land = {
    x: last.x + (x - last.x) * f, z: last.z + (z - last.z) * f,
    vx: last.vx + (vx - last.vx) * f, vy: last.vy + (vy - last.vy) * f, vz: last.vz + (vz - last.vz) * f,
    t: last.t + (t - last.t) * f,
  };
  pts[pts.length - 1] = { t: land.t, x: land.x, y: 0, z: land.z };
  const vh = Math.hypot(land.vx, land.vz);
  const landAngle = (Math.atan2(-land.vy, vh) * 180) / Math.PI;
  const carry = Math.hypot(land.x, land.z);

  // Roll: empirical. More roll for fast, shallow landings; backspin checks it.
  const spinLand = (p.spin || 0) * Math.exp(-land.t / A.spinTau);
  const firm = p.firmness ?? 1;
  const shallow = Math.max(0, Math.cos((landAngle * Math.PI) / 180)) ** 2;
  const spinBrake = 1 / (1 + Math.pow(spinLand / 3500, 2));
  const roll = Math.max(0, A.rollK * vh * shallow * spinBrake * firm * 1.6);
  const ux = land.vx / (vh || 1), uz = land.vz / (vh || 1);
  const end = { x: land.x + ux * roll, z: land.z + uz * roll };

  return {
    carry, roll, total: Math.hypot(end.x, end.z),
    apex, landAngle, flightTime: land.t,
    offline: land.z, offlineTotal: end.z,
    land: { x: land.x, z: land.z }, end,
    points: pts,
    rho,
  };
}
