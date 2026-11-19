// Noise settings that hit the design targets (milestone 3). Written by calibrate.js: don't edit by hand.
const CALIBRATION = {
 "MULT": {
  "jumper": 1.23238525390625,
  "floater": 1.4984252929687498,
  "layup": 1.74371337890625
 },
 "DIST_IN": 0,
 "CONTEST_IN": 6.185546875,
 "PREMIUM": 0.04,
 "CAP": 1.6,
 "TAIL_IN": 12.5,
 "CONTEST_TAIL_IN": 1.6
};
if (typeof module !== "undefined") module.exports = CALIBRATION;
else Object.assign(window.NoiseLib.NOISE, CALIBRATION);
