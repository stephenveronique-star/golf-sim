# Golf Sim

A home golf simulator that runs in Safari on an iPhone. Put the phone on a tripod side-on to the ball, hit into a net, and the app measures ball speed and launch angle from the camera, then works out carry, total, apex and left/right with a ball-flight model fitted to tour launch-monitor data (adjusted for altitude and temperature).

- `index.html` – the app
- `js/tracker.js` – shot detection and ball tracking (runs in `js/worker.js`)
- `js/physics.js` – ball-flight model
- `js/range.js` – driving-range view
- `test/` – synthetic-footage tests (`node test/track-test.mjs`) and the flight-model fit (`node test/fit-physics.mjs`)

Open it from an https address (GitHub Pages) — iPhone only allows the camera on secure pages.
