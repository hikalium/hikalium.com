// Pure pitch-detection logic, shared by the browser app (index.js loads this
// first as a classic script, so these become globals) and the Node test suite
// (which requires this file). No DOM or Web Audio dependencies here.

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];
const A4 = 440.0;       // reference pitch (Hz)
const A4_MIDI = 69;     // MIDI note number of A4

// Convert a frequency to {name, octave, sharp, cents} relative to equal
// temperament. cents is in [-50, +50): how far the input is from the note.
function frequencyToNote(freq) {
  const midiFloat = A4_MIDI + 12 * Math.log2(freq / A4);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return {name : name.replace('#', ''), sharp : name.includes('#'), octave, cents};
}

// Root-mean-square (overall loudness) of the buffer.
function bufferRms(buf) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) {
    rms += buf[i] * buf[i];
  }
  return Math.sqrt(rms / buf.length);
}

// Musical pitch range we accept. Frequencies outside this are almost always
// spurious (e.g. a one-sample period yields the sample rate itself, ~48 kHz).
const MIN_FREQ = 40;    // a touch below the lowest bass string (E1 ~41 Hz)
const MAX_FREQ = 2200;  // a touch above the highest common note (C7 ~2093 Hz)

// Autocorrelation-based pitch detection. Returns the fundamental frequency in
// Hz, or -1 when the signal is quieter than minRms / not periodic enough.
function detectPitch(buf, sampleRate, minRms) {
  const SIZE = buf.length;

  // Bail out on signals below the configured minimum amplitude.
  if (bufferRms(buf) < minRms) {
    return -1;
  }

  // Trim leading/trailing samples below 20% of full scale so the correlation
  // window focuses on the sustained part of the note.
  const threshold = 0.2;
  let start = 0;
  let end = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) {
      start = i;
    } else {
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) {
      end = SIZE - i;
    } else {
      break;
    }
  }

  const trimmed = buf.slice(start, end);
  const n = trimmed.length;
  if (n < 2) {
    return -1;
  }

  // Compute the autocorrelation for each lag.
  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += trimmed[i] * trimmed[i + lag];
    }
    c[lag] = sum;
  }

  // Only consider lags within the accepted musical pitch range. A period
  // shorter than minLag would correspond to a frequency above MAX_FREQ (in the
  // limit, a one-sample period gives the sample rate itself), which is what
  // produced the spurious ~48 kHz readings on noise.
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxLagAllowed = Math.min(n - 1, Math.ceil(sampleRate / MIN_FREQ));

  // Skip the descending slope from lag 0, then find the highest peak within the
  // allowed range: that lag is the period of the fundamental.
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) {
    d++;
  }
  let maxVal = -1;
  let maxLag = -1;
  for (let lag = Math.max(d, minLag); lag <= maxLagAllowed; lag++) {
    if (c[lag] > maxVal) {
      maxVal = c[lag];
      maxLag = lag;
    }
  }
  if (maxLag <= 0) {
    return -1;
  }

  // Refine the integer-lag estimate with a fractional-lag search. The raw
  // autocorrelation peak is biased (asymmetric and only sampled at integers),
  // which costs many cents at high frequencies where the period is few
  // samples. We use a normalized cross-correlation (Pearson-style) at
  // fractional lags around the coarse peak so the value depends only on
  // waveform-shape match, not on amplitude or the number of overlapping
  // samples; without that normalization the peak is biased.
  const corrAt = (lag) => {
    const last = n - Math.ceil(lag) - 1;
    if (last < 2) {
      return -1;
    }
    let sum = 0, e0 = 0, e1 = 0;
    for (let i = 0; i < last; i++) {
      const j = i + lag;
      const j0 = Math.floor(j);
      const frac = j - j0;
      const s = trimmed[j0] * (1 - frac) + trimmed[j0 + 1] * frac;
      sum += trimmed[i] * s;
      e0 += trimmed[i] * trimmed[i];
      e1 += s * s;
    }
    const denom = Math.sqrt(e0 * e1);
    return denom > 0 ? sum / denom : -1;
  };

  let period = maxLag;
  let best = corrAt(maxLag);
  for (let lag = maxLag - 2; lag <= maxLag + 2; lag += 0.02) {
    if (lag < 1) {
      continue;
    }
    const v = corrAt(lag);
    if (v > best) {
      best = v;
      period = lag;
    }
  }

  const freq = sampleRate / period;
  if (freq < MIN_FREQ || freq > MAX_FREQ) {
    return -1;
  }
  return freq;
}

// --- FFT-spectrum helpers (used for the spectrum graph and noise removal) ---
//
// The spectrum itself comes from the Web Audio AnalyserNode in the browser
// (its built-in FFT), so these helpers operate on a magnitude array and stay
// free of any audio API, which keeps them unit-testable.

// Frequency (Hz) at a given FFT bin index.
function binToFreq(bin, sampleRate, fftSize) {
  return bin * sampleRate / fftSize;
}

// FFT bin index nearest to a given frequency.
function freqToFftBin(freq, sampleRate, fftSize) {
  return Math.round(freq * fftSize / sampleRate);
}

// Spectral subtraction: cleaned[i] = max(0, mag[i] - alpha * noise[i]).
// `alpha` > 1 over-subtracts, trading a little signal for stronger noise
// suppression. Returns a new Float32Array.
function subtractNoiseSpectrum(mag, noise, alpha) {
  const out = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i] - alpha * (noise ? noise[i] : 0);
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

// Largest magnitude (and its bin) within [minBin, maxBin], inclusive.
function spectrumPeak(mag, minBin, maxBin) {
  let bin = -1, value = -1;
  const hi = Math.min(maxBin, mag.length - 1);
  for (let i = Math.max(0, minBin); i <= hi; i++) {
    if (mag[i] > value) {
      value = mag[i];
      bin = i;
    }
  }
  return {bin, value};
}

// Noise gate at the spectrum level: a tonal component is considered present
// when the cleaned spectrum still has a peak at least `ratio` times the
// measured noise floor's peak in the band. With no noise profile (peak 0) this
// always passes, matching the un-calibrated behaviour.
function gatePasses(cleaned, noise, minBin, maxBin, ratio) {
  const sigPeak = spectrumPeak(cleaned, minBin, maxBin).value;
  if (sigPeak <= 0) {
    return false;
  }
  const noisePeak = noise ? spectrumPeak(noise, minBin, maxBin).value : 0;
  return sigPeak >= ratio * noisePeak;
}

// Export for the Node test suite. In the browser `module` is undefined, so the
// functions above simply remain as globals for index.js to use.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    frequencyToNote,
    bufferRms,
    detectPitch,
    MIN_FREQ,
    MAX_FREQ,
    binToFreq,
    freqToFftBin,
    subtractNoiseSpectrum,
    spectrumPeak,
    gatePasses,
  };
}
