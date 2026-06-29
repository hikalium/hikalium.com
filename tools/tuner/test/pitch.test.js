const test = require('node:test');
const assert = require('node:assert');
const {frequencyToNote, bufferRms, detectPitch, MIN_FREQ, MAX_FREQ} =
    require('../pitch.js');

const SR = 48000;
const N = 4096;

// Build a Float32Array of `n` samples of a sine (plus optional harmonics) at
// the given frequency and amplitude.
function makeTone(freq, amp, harmonics) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = amp * Math.sin(2 * Math.PI * freq * i / SR);
    if (harmonics) {
      v += amp * 0.5 * Math.sin(2 * Math.PI * 2 * freq * i / SR);
      v += amp * 0.3 * Math.sin(2 * Math.PI * 3 * freq * i / SR);
    }
    buf[i] = v;
  }
  return buf;
}

// Deterministic pseudo-random noise (no Math.random, so the test is stable).
function makeNoise(amp) {
  const buf = new Float32Array(N);
  let seed = 12345;
  for (let i = 0; i < N; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = (seed / 0x7fffffff - 0.5) * 2 * amp;
  }
  return buf;
}

// How far `freq` is from `expected`, in cents.
function centsOff(freq, expected) {
  return 1200 * Math.log2(freq / expected);
}

test('detects musical pitches within 5 cents across the range', () => {
  // Standard guitar strings plus a high note: E2, A2, D3, G3, B3, E4, E5.
  const targets = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 659.25];
  for (const f of targets) {
    const got = detectPitch(makeTone(f, 0.5, false), SR, 0.01);
    assert.ok(got > 0, `expected a detection for ${f} Hz`);
    const off = Math.abs(centsOff(got, f));
    assert.ok(off < 5, `${f} Hz detected as ${got.toFixed(2)} Hz (${off.toFixed(1)} cents off)`);
  }
});

test('stays accurate with harmonics present', () => {
  for (const f of [82.41, 196.0, 440.0, 659.25]) {
    const got = detectPitch(makeTone(f, 0.4, true), SR, 0.01);
    assert.ok(got > 0, `expected a detection for ${f} Hz`);
    assert.ok(Math.abs(centsOff(got, f)) < 5, `${f} Hz with harmonics -> ${got.toFixed(2)} Hz`);
  }
});

test('rejects signals below the amplitude threshold', () => {
  assert.strictEqual(detectPitch(makeTone(440, 0.005, false), SR, 0.01), -1);
});

test('rejects noise instead of returning the sample rate', () => {
  // Noise loud enough to pass the amplitude gate must NOT yield a ~48 kHz
  // (one-sample-period) reading; it should be rejected or stay in range.
  const got = detectPitch(makeNoise(0.1), SR, 0.01);
  assert.ok(got === -1 || (got >= MIN_FREQ && got <= MAX_FREQ),
            `noise produced out-of-range ${got} Hz`);
});

test('never returns a frequency outside [MIN_FREQ, MAX_FREQ]', () => {
  for (const f of [60, 440, 1000, 2093]) {
    const got = detectPitch(makeTone(f, 0.5, false), SR, 0.01);
    if (got > 0) {
      assert.ok(got >= MIN_FREQ && got <= MAX_FREQ, `${f} Hz -> ${got} Hz out of range`);
    }
  }
});

test('frequencyToNote maps A4 = 440 Hz exactly', () => {
  const note = frequencyToNote(440);
  assert.strictEqual(note.name, 'A');
  assert.strictEqual(note.sharp, false);
  assert.strictEqual(note.octave, 4);
  assert.strictEqual(note.cents, 0);
});

test('frequencyToNote reports cents deviation (445 Hz ~ A4 +20c)', () => {
  const note = frequencyToNote(445);
  assert.strictEqual(note.name, 'A');
  assert.strictEqual(note.octave, 4);
  assert.ok(Math.abs(note.cents - 20) <= 1, `expected ~+20 cents, got ${note.cents}`);
});

test('frequencyToNote handles sharps and octaves (C#5)', () => {
  const note = frequencyToNote(554.37);  // C#5
  assert.strictEqual(note.name, 'C');
  assert.strictEqual(note.sharp, true);
  assert.strictEqual(note.octave, 5);
  assert.ok(Math.abs(note.cents) <= 1);
});

test('bufferRms is zero for silence and ~0.707 for a unit sine', () => {
  assert.strictEqual(bufferRms(new Float32Array(N)), 0);
  const rms = bufferRms(makeTone(440, 1.0, false));
  assert.ok(Math.abs(rms - Math.SQRT1_2) < 0.01, `rms=${rms}`);
});
