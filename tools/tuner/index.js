// Tuner: detects the fundamental frequency from the mic waveform and shows
// the nearest musical note together with how many cents it is off.

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
  // samples. Here we correlate the signal against a linearly-interpolated copy
  // shifted by fractional lags around the coarse peak and take the maximum.
  // Normalized cross-correlation at a fractional lag (Pearson-style), so the
  // value depends only on waveform shape match, not on amplitude or the number
  // of overlapping samples. Without this normalization the peak is biased.
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

class Tuner {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.buf = null;
    this.running = false;

    this.noteRef = document.querySelector('#note');
    this.centsRef = document.querySelector('#cents');
    this.freqRef = document.querySelector('#freq');
    this.meter = document.querySelector('#meter');
    this.meterCtx = this.meter.getContext('2d');
    this.visualiser = document.querySelector('#visualiser');
    this.visCtx = this.visualiser.getContext('2d');

    this.startButton = document.querySelector('#startButton');
    this.startButton.onclick = this.toggle.bind(this);

    // Minimum input amplitude (RMS) required to attempt pitch detection.
    this.thresholdSlider = document.querySelector('#threshold');
    this.thresholdValue = document.querySelector('#thresholdValue');
    this.levelValue = document.querySelector('#levelValue');
    this.minRms = parseFloat(this.thresholdSlider.value);
    this.thresholdSlider.oninput = () => {
      this.minRms = parseFloat(this.thresholdSlider.value);
      this.thresholdValue.textContent = this.minRms.toFixed(3);
    };

    // Smoothed displayed frequency to reduce jitter.
    this.smoothedFreq = -1;
  }

  async toggle() {
    if (this.running) {
      this.stop();
    } else {
      await this.start();
    }
  }

  async start() {
    const constraints = {
      audio : {
        autoGainControl : false,
        channelCount : 1,
        echoCancellation : false,
        noiseSuppression : false,
        sampleRate : {max : 48000, min : 48000},
        sampleSize : {max : 16, min : 16},
        voiceIsolation : false,
      },
      video : false,
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      console.error('getUserMedia failed: ', e);
      this.noteRef.textContent = 'Mic error';
      return;
    }

    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.running = true;
    this.startButton.textContent = 'Stop';
    this.update();
  }

  stop() {
    this.running = false;
    this.startButton.textContent = 'Start';
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.noteRef.textContent = '--';
    this.centsRef.innerHTML = '&nbsp;';
    this.freqRef.innerHTML = '&nbsp;';
    this.smoothedFreq = -1;
    this.drawMeter(null);
  }

  update() {
    if (!this.running) {
      return;
    }
    requestAnimationFrame(this.update.bind(this));

    this.analyser.getFloatTimeDomainData(this.buf);
    this.drawWaveform();

    // Show the live input level so the user can pick a sensible threshold.
    this.levelValue.textContent = bufferRms(this.buf).toFixed(3);

    const freq = detectPitch(this.buf, this.audioCtx.sampleRate, this.minRms);
    if (freq <= 0) {
      // Show idle state when nothing is sounding.
      this.noteRef.textContent = '--';
      this.centsRef.innerHTML = '&nbsp;';
      this.freqRef.innerHTML = '&nbsp;';
      this.drawMeter(null);
      return;
    }

    // Exponential smoothing on the detected frequency.
    if (this.smoothedFreq < 0) {
      this.smoothedFreq = freq;
    } else {
      this.smoothedFreq = this.smoothedFreq * 0.8 + freq * 0.2;
    }

    const note = frequencyToNote(this.smoothedFreq);
    this.noteRef.innerHTML = note.name +
        (note.sharp ? '<span class="sharp">#</span>' : '') +
        '<span style="font-size:1.6rem;color:#888">' + note.octave + '</span>';
    this.freqRef.textContent = this.smoothedFreq.toFixed(1) + ' Hz';

    const cents = note.cents;
    let cls = 'in-tune';
    let label = 'in tune';
    if (cents <= -5) {
      cls = 'flat';
      label = cents + ' cents (low ◀)';
    } else if (cents >= 5) {
      cls = 'sharpish';
      label = '+' + cents + ' cents (high ▶)';
    } else {
      label = (cents >= 0 ? '+' : '') + cents + ' cents ✓';
    }
    this.centsRef.className = cls;
    this.centsRef.textContent = label;

    this.drawMeter(cents);
  }

  // Draw a needle meter spanning -50..+50 cents.
  drawMeter(cents) {
    const ctx = this.meterCtx;
    const W = this.meter.width;
    const H = this.meter.height;
    ctx.clearRect(0, 0, W, H);

    // Scale ticks.
    ctx.lineWidth = 1;
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let c = -50; c <= 50; c += 10) {
      const x = W / 2 + (c / 50) * (W / 2 - 10);
      const tall = (c === 0);
      ctx.strokeStyle = tall ? '#3ad65a' : '#444';
      ctx.beginPath();
      ctx.moveTo(x, H - 20);
      ctx.lineTo(x, H - 20 - (tall ? 18 : 10));
      ctx.stroke();
      if (c % 20 === 0) {
        ctx.fillText(c, x, H - 4);
      }
    }

    if (cents === null) {
      return;
    }

    // Needle.
    const clamped = Math.max(-50, Math.min(50, cents));
    const x = W / 2 + (clamped / 50) * (W / 2 - 10);
    const inTune = Math.abs(cents) < 5;
    ctx.strokeStyle = inTune ? '#3ad65a' : (cents < 0 ? '#4aa3ff' : '#ff7a4a');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, H - 20);
    ctx.lineTo(x, 6);
    ctx.stroke();
  }

  drawWaveform() {
    const ctx = this.visCtx;
    const W = this.visualiser.width;
    const H = this.visualiser.height;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a7';
    ctx.beginPath();
    const buf = this.buf;
    const sliceWidth = W / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = (1 - buf[i]) * H / 2;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    ctx.stroke();
  }
}

window.tuner = new Tuner();
