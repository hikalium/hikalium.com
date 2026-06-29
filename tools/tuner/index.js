// Tuner: detects the fundamental frequency from the mic waveform and shows
// the nearest musical note together with how many cents it is off.
//
// The pure detection logic (frequencyToNote, bufferRms, detectPitch, the FFT
// spectrum helpers, MIN_FREQ, MAX_FREQ) lives in pitch.js, which index.html
// loads before this file.

const DENOISE_ALPHA = 1.5;          // spectral-subtraction over-subtraction
const GATE_RATIO = 1.2;             // cleaned peak must exceed ratio * noise peak
const SPECTRUM_MAX_FREQ = 2500;     // highest frequency drawn on the graph (Hz)
const SPECTRUM_MIN_DB = -100;       // dB range mapped onto the graph height
const SPECTRUM_MAX_DB = 0;

// Convert a magnitude in dBFS (as returned by AnalyserNode) to linear scale.
function dbToLinear(db) {
  return Math.pow(10, db / 20);
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
    this.spectrum = document.querySelector('#spectrum');
    this.spectrumCtx = this.spectrum.getContext('2d');
    this.visualiser = document.querySelector('#visualiser');
    this.visCtx = this.visualiser.getContext('2d');

    this.startButton = document.querySelector('#startButton');
    this.startButton.onclick = this.toggle.bind(this);

    // Input gain, applied before analysis so quiet sources can be boosted.
    this.gainSlider = document.querySelector('#gain');
    this.gainValue = document.querySelector('#gainValue');
    this.gainSlider.oninput = () => {
      const g = parseFloat(this.gainSlider.value);
      this.gainValue.textContent = g.toFixed(1);
      if (this.gainNode) {
        this.gainNode.gain.value = g;
      }
    };

    // Minimum input amplitude (RMS) required to attempt pitch detection.
    this.thresholdSlider = document.querySelector('#threshold');
    this.thresholdValue = document.querySelector('#thresholdValue');
    this.levelValue = document.querySelector('#levelValue');
    this.minRms = parseFloat(this.thresholdSlider.value);
    this.thresholdSlider.oninput = () => {
      this.minRms = parseFloat(this.thresholdSlider.value);
      this.thresholdValue.textContent = this.minRms.toFixed(3);
    };

    // Floor-noise removal, applied at the FFT level. Pressing the button waits
    // 1s, then averages the magnitude spectrum over the next 2s (assumed to be
    // floor noise). That noise spectrum is then subtracted from the live
    // spectrum (spectral subtraction) and used as a noise gate for detection.
    this.denoiseButton = document.querySelector('#denoiseButton');
    this.denoiseStatus = document.querySelector('#denoiseStatus');
    this.denoiseButton.onclick = this.toggleDenoise.bind(this);
    this.denoise = {
      state : 'off',     // 'off' | 'delay' | 'measuring' | 'active'
      startTime : 0,     // performance.now() when the current phase began
      accum : null,      // running sum of linear magnitude spectra
      frames : 0,        // number of frames summed into accum
      noise : null,      // averaged noise magnitude spectrum (linear), or null
    };

    // Smoothed displayed frequency to reduce jitter.
    this.smoothedFreq = -1;
  }

  toggleDenoise() {
    const d = this.denoise;
    if (d.state === 'off') {
      d.state = 'delay';
      d.startTime = performance.now();
      d.accum = null;
      d.frames = 0;
      d.noise = null;
      this.denoiseButton.textContent = 'ノイズ除去 (クリア)';
    } else {
      // Cancel an in-progress calibration or clear an active profile.
      d.state = 'off';
      d.accum = null;
      d.frames = 0;
      d.noise = null;
      this.denoiseButton.textContent = 'ノイズ除去';
      this.denoiseStatus.textContent = '未適用';
    }
  }

  // Advance the noise-removal state machine each frame, accumulating the live
  // linear magnitude spectrum while measuring.
  stepDenoise(liveMag) {
    const d = this.denoise;
    if (d.state === 'off' || d.state === 'active') {
      return;
    }
    const elapsed = performance.now() - d.startTime;
    if (d.state === 'delay') {
      this.denoiseStatus.textContent =
          '測定準備中… ' + Math.ceil((1000 - elapsed) / 1000) + 's';
      if (elapsed >= 1000) {
        d.state = 'measuring';
        d.startTime = performance.now();
        d.accum = new Float32Array(liveMag.length);
        d.frames = 0;
      }
      return;
    }
    // measuring: sum the spectrum
    for (let i = 0; i < liveMag.length; i++) {
      d.accum[i] += liveMag[i];
    }
    d.frames++;
    this.denoiseStatus.textContent =
        'ノイズ測定中… ' + Math.ceil((2000 - elapsed) / 1000) + 's';
    if (elapsed >= 2000) {
      this.finishDenoise();
    }
  }

  // Average the accumulated spectra into the noise profile.
  finishDenoise() {
    const d = this.denoise;
    d.noise = new Float32Array(d.accum.length);
    if (d.frames > 0) {
      for (let i = 0; i < d.accum.length; i++) {
        d.noise[i] = d.accum[i] / d.frames;
      }
    }
    d.state = 'active';
    const peak = spectrumPeak(d.noise, this.minBin, this.maxBin);
    const peakHz = binToFreq(peak.bin, this.sampleRate, this.fftSize);
    this.denoiseStatus.textContent =
        '適用中 (ノイズ床ピーク ' + peakHz.toFixed(0) + 'Hz)';
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
    this.analyser.smoothingTimeConstant = 0.5;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.source = this.audioCtx.createMediaStreamSource(stream);
    // source -> gain -> analyser, so the gain slider boosts quiet inputs.
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = parseFloat(this.gainSlider.value);
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);

    // FFT spectrum buffers and the musical band we care about.
    this.sampleRate = this.audioCtx.sampleRate;
    this.fftSize = this.analyser.fftSize;
    this.freqDataDb = new Float32Array(this.analyser.frequencyBinCount);
    this.liveMag = new Float32Array(this.analyser.frequencyBinCount);
    this.minBin = freqToFftBin(MIN_FREQ, this.sampleRate, this.fftSize);
    this.maxBin = freqToFftBin(MAX_FREQ, this.sampleRate, this.fftSize);

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
    this.gainNode = null;
    this.noteRef.textContent = '--';
    this.centsRef.innerHTML = '&nbsp;';
    this.freqRef.innerHTML = '&nbsp;';
    this.smoothedFreq = -1;
    this.drawMeter(null);
    this.clearSpectrum();
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

    // FFT magnitude spectrum (linear) from the analyser's built-in FFT.
    this.analyser.getFloatFrequencyData(this.freqDataDb);
    for (let i = 0; i < this.freqDataDb.length; i++) {
      this.liveMag[i] = dbToLinear(this.freqDataDb[i]);
    }

    // Drive the noise calibration, then subtract the noise spectrum and gate.
    this.stepDenoise(this.liveMag);
    const noise = this.denoise.noise;
    const cleaned = subtractNoiseSpectrum(this.liveMag, noise, DENOISE_ALPHA);
    this.drawSpectrum(cleaned, noise);

    const freq = detectPitch(this.buf, this.audioCtx.sampleRate, this.minRms);
    const passesGate =
        gatePasses(cleaned, noise, this.minBin, this.maxBin, GATE_RATIO);

    if (freq <= 0 || !passesGate) {
      // Idle when nothing is sounding or the gate rejected it as floor noise.
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

  // Draw the FFT spectrum: the cleaned (noise-subtracted) magnitude in white
  // and, when calibrated, the measured noise floor in red. Frequency axis is
  // linear from 0 to SPECTRUM_MAX_FREQ; vertical axis is dB.
  drawSpectrum(cleaned, noise) {
    const ctx = this.spectrumCtx;
    const W = this.spectrum.width;
    const H = this.spectrum.height;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    const displayMaxBin = Math.min(
        cleaned.length - 1,
        freqToFftBin(SPECTRUM_MAX_FREQ, this.sampleRate, this.fftSize));
    if (displayMaxBin <= 0) {
      return;
    }
    const toX = (bin) => bin / displayMaxBin * W;
    const toY = (v) => {
      const db = v > 0 ? 20 * Math.log10(v) : SPECTRUM_MIN_DB;
      const t = (db - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB);
      return H - Math.max(0, Math.min(1, t)) * H;
    };

    // Frequency gridlines and labels.
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    for (const f of [100, 250, 500, 1000, 2000]) {
      const x = toX(freqToFftBin(f, this.sampleRate, this.fftSize));
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? f / 1000 + 'k' : f, x, H - 2);
    }

    // Noise floor (red line).
    if (noise) {
      ctx.strokeStyle = '#c44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let bin = 0; bin <= displayMaxBin; bin++) {
        const x = toX(bin), y = toY(noise[bin] * DENOISE_ALPHA);
        bin === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Cleaned spectrum (white filled area).
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let bin = 0; bin <= displayMaxBin; bin++) {
      ctx.lineTo(toX(bin), toY(cleaned[bin]));
    }
    ctx.lineTo(toX(displayMaxBin), H);
    ctx.closePath();
    ctx.fill();
  }

  clearSpectrum() {
    const ctx = this.spectrumCtx;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, this.spectrum.width, this.spectrum.height);
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
