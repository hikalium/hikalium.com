// Tuner: detects the fundamental frequency from the mic waveform and shows
// the nearest musical note together with how many cents it is off.
//
// The pure detection logic (frequencyToNote, bufferRms, detectPitch, MIN_FREQ,
// MAX_FREQ) lives in pitch.js, which index.html loads before this file.

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

    // Floor-noise removal. Pressing the button waits 1s, then records the
    // frequencies detected over the next 2s (assumed to be floor noise) and
    // suppresses those frequency bins from later detections.
    this.denoiseButton = document.querySelector('#denoiseButton');
    this.denoiseStatus = document.querySelector('#denoiseStatus');
    this.denoiseButton.onclick = this.toggleDenoise.bind(this);
    this.denoise = {
      state : 'off',       // 'off' | 'delay' | 'measuring' | 'active'
      startTime : 0,       // performance.now() when the current phase began
      samples : [],        // detected frequencies collected while measuring
      bins : new Set(),    // blacklisted frequency bins (see freqToBin)
    };

    // Smoothed displayed frequency to reduce jitter.
    this.smoothedFreq = -1;
  }

  // Map a frequency to an integer bin ~25 cents wide, so nearby detections
  // (including the natural jitter of the noise estimate) share a bin.
  freqToBin(freq) {
    return Math.round(1200 * Math.log2(freq / MIN_FREQ) / 25);
  }

  // True when freq falls in a blacklisted noise bin (or an adjacent one).
  isNoiseFreq(freq) {
    const b = this.freqToBin(freq);
    const bins = this.denoise.bins;
    return bins.has(b) || bins.has(b - 1) || bins.has(b + 1);
  }

  toggleDenoise() {
    const d = this.denoise;
    if (d.state === 'off') {
      d.state = 'delay';
      d.startTime = performance.now();
      d.samples = [];
      d.bins = new Set();
      this.denoiseButton.textContent = 'ノイズ除去 (クリア)';
    } else {
      // Cancel an in-progress calibration or clear an active profile.
      d.state = 'off';
      d.samples = [];
      d.bins = new Set();
      this.denoiseButton.textContent = 'ノイズ除去';
      this.denoiseStatus.textContent = '未適用';
    }
  }

  // Advance the noise-removal state machine each frame, given the frequency
  // detected this frame (-1 if none).
  stepDenoise(freq) {
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
        d.samples = [];
      }
      return;
    }
    // measuring
    if (freq > 0) {
      d.samples.push(freq);
    }
    this.denoiseStatus.textContent =
        'ノイズ測定中… ' + Math.ceil((2000 - elapsed) / 1000) + 's';
    if (elapsed >= 2000) {
      this.finishDenoise();
    }
  }

  // Build the blacklist from the collected noise samples: any bin seen at
  // least twice during the measurement window.
  finishDenoise() {
    const d = this.denoise;
    const counts = new Map();
    for (const f of d.samples) {
      const b = this.freqToBin(f);
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    d.bins = new Set();
    for (const [b, c] of counts) {
      if (c >= 2) {
        d.bins.add(b);
      }
    }
    d.state = 'active';
    this.denoiseStatus.textContent = '適用中 (' + d.bins.size + 'ヶ所抑制)';
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
    // source -> gain -> analyser, so the gain slider boosts quiet inputs.
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = parseFloat(this.gainSlider.value);
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);

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

    // Drive the noise-removal calibration with this frame's detection, then
    // suppress detections that fall in a blacklisted noise bin.
    this.stepDenoise(freq);
    const isNoise =
        this.denoise.state === 'active' && freq > 0 && this.isNoiseFreq(freq);

    if (freq <= 0 || isNoise) {
      // Show idle state when nothing is sounding (or it is just floor noise).
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
