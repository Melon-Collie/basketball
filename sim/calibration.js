// Noise settings that hit the design targets (milestone 3). Written by calibrate.js: don't edit by hand.
const CALIBRATION = {
 "MULT": {
  "jumper": 1.2315551757812497,
  "floater": 1.41915283203125,
  "layup": 1.40020751953125
 },
 "DIST_IN": 0,
 "CONTEST_IN": 6.173828125,
 "PREMIUM": 0.04,
 "CAP": 1.6,
 "TAIL_IN": 12.5,
 "CONTEST_TAIL_IN": 1.6
};
if (typeof module !== "undefined") module.exports = CALIBRATION;
else Object.assign(window.NoiseLib.NOISE, CALIBRATION);
