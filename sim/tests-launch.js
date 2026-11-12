// Milestone 2: continuity. At the same inputs, a physics shot should land within about 10% of today's model.
const L = (typeof module !== "undefined") ? require("./launch.js") : window.LaunchLib;
const PL = (typeof module !== "undefined") ? require("./physics.js") : window.PhysicsLib;
const R = { x: PL.PHYS.RIM.x, y: PL.PHYS.RIM.y };
const launchTests = [];
function ltest(name, fn) { launchTests.push({ name, fn }); }
function close(got, want, tolFrac, tolAbs = 0.3) { return Math.abs(got - want) <= Math.max(Math.abs(want)*tolFrac, tolAbs); }
function offsets(dist, inp) {
  const player = { x: R.x, y: R.y + dist };
  const base = L.rimPlaneOffset(L.buildLaunch({ kind: "jumper", player }), player);
  const o = L.rimPlaneOffset(L.buildLaunch({ kind: "jumper", player, ...inp }), player);
  return { lat: o.lat - base.lat, dep: o.dep - base.dep };
}
function old(dist, inp) {
  const th = inp.aimTheta || 0, b = inp.body || { vx: 0, vy: 0 };
  return { lat: dist*12*Math.tan(th) + L.LAUNCH.OLD.DRIFT_LAT*b.vx, dep: L.LAUNCH.OLD.KT*(inp.timingMs || 0) + L.LAUNCH.OLD.DRIFT_DEP*(-b.vy) };
}
const cases = [
  ["aim 1° right", { aimTheta: 1*Math.PI/180 }], ["aim 2° left", { aimTheta: -2*Math.PI/180 }],
  ["30 ms late", { timingMs: 30 }], ["50 ms early", { timingMs: -50 }],
  ["drifting right at 4 ft/s", { body: { vx: 4, vy: 0 } }], ["moving toward the rim at 3 ft/s", { body: { vx: 0, vy: -3 } }],
  ["fading away at 3 ft/s", { body: { vx: 0, vy: 3 } }],
  ["combined: 1° right, 20 ms late, drifting left at 3 ft/s", { aimTheta: Math.PI/180, timingMs: 20, body: { vx: -3, vy: 0 } }],
];
ltest("At 24 ft, every input lands within 10% of today's model", () => {
  const lines = [];
  for (const [name, inp] of cases) {
    const p = offsets(24, inp), o = old(24, inp);
    if (!close(p.lat, o.lat, 0.1) || !close(p.dep, o.dep, 0.1)) throw new Error(`${name}: physics ${p.lat.toFixed(1)}/${p.dep.toFixed(1)} in vs today ${o.lat.toFixed(1)}/${o.dep.toFixed(1)} in`);
    lines.push(`${name}: ${p.lat.toFixed(1)} in side, ${p.dep.toFixed(1)} in depth (today ${o.lat.toFixed(1)}, ${o.dep.toFixed(1)})`);
  }
  return lines.join("; ");
});
ltest("Closer in, aim still matches; timing and drift are gentler, as physics would have it", () => {
  const lines = [];
  for (const d of [15, 10]) {
    const a = offsets(d, { aimTheta: Math.PI/180 }), oa = old(d, { aimTheta: Math.PI/180 });
    if (!close(a.lat, oa.lat, 0.1)) throw new Error(`${d} ft aim: ${a.lat.toFixed(1)} vs ${oa.lat.toFixed(1)}`);
    const t = offsets(d, { timingMs: 30 }), dr = offsets(d, { body: { vx: 4, vy: 0 } });
    lines.push(`${d} ft: 1° aim ${a.lat.toFixed(1)} in (today ${oa.lat.toFixed(1)}), 30 ms late ${t.dep.toFixed(1)} in (today 2.7), 4 ft/s drift ${dr.lat.toFixed(1)} in (today 6.4)`);
  }
  return lines.join("; ");
});
ltest("Perfect inputs still swish through the full simulation", () => {
  const out = [10, 15, 24].map(d => { const player = { x: R.x, y: R.y + d }; return PL.simulateShot(L.buildLaunch({ kind: "jumper", player }), { quick: true }); });
  out.forEach((r, i) => { if (!r.made) throw new Error(`${[10, 15, 24][i]} ft: ${r.label}`); });
  return out.map((r, i) => `${[10, 15, 24][i]} ft: ${r.label}`).join(", ");
});
if (typeof module !== "undefined" && require.main === module) {
  console.log("constants", JSON.stringify(L.LAUNCH.K_SPEED), L.LAUNCH.F_LAT.toFixed(3), L.LAUNCH.F_DEP.toFixed(3));
  for (const t of launchTests) { try { console.log("PASS ", t.name, "\n     ", t.fn()); } catch (e) { console.log("FAIL ", t.name, "\n     ", e.message); } }
}
if (typeof module !== "undefined") module.exports = { launchTests };
else window.LaunchTests = { launchTests };
