class VoiceRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mediaRecorder = [];
    this.chunks = [];
    this.isRecording = false;
    this.recorderRef = document.querySelector('#recorder');
    this.playerRef = document.querySelector('#player');
    this.buttonRef = document.querySelector('#recordButton');
    this.buttonRef.onclick = this.startStop.bind(this);
  }
  startStop() {
    if (this.isRecording) {
      this.stopRecording()
      console.log("start")
    } else {
      this.startRecording()
      console.log("stop")
    }
  }
  startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.buttonRef.innerHTML = 'Stop';
    this.playerRef.src = '';
    this.stream.oninactive = () => {
      console.log('Stream ended!')
    };
    this.recorderRef.srcObject = this.stream;
    const options = {
      audioBitsPerSecond: 1411 * 1000,
      mimeType: 'audio/wav',
    };
    this.mediaRecorder = new MediaRecorder(this.stream)
    console.log(this.mediaRecorder);
    this.mediaRecorder.ondataavailable = (e) => {
      this.chunks.push(e.data);
    };
    this.mediaRecorder.onstop = (e) => {
      const blob = new Blob(this.chunks, {'type': 'audio/wav'})
      const audioURL = window.URL.createObjectURL(blob);
      this.playerRef.src = audioURL;
      this.playerRef.preload = "auto";
      this.playerRef.load();
      this.playerRef.play();
      this.chunks = [];
    };
    this.recorderRef.play();
    this.mediaRecorder.start();
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.buttonRef.innerHTML = 'Start';
    this.recorderRef.pause();
    this.mediaRecorder.stop()
  }
}

class VoiceVisualiser {
  constructor(stream) {
    this.audioCtx = new AudioContext();
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = document.querySelector('#visualiser');
    const canvasCtx = canvas.getContext("2d");

    this.source.connect(this.analyser);
    let draw = () => {
      const WIDTH = canvas.width
      const HEIGHT = canvas.height;

      requestAnimationFrame(draw);

      this.analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgba(255,255,255,0.2)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = 'rgb(0, 0, 0)';

      canvasCtx.beginPath();

      let sliceWidth = WIDTH * 1.0 / bufferLength;
      let x = 0;


      for (let i = 0; i < bufferLength; i++) {
        let v = dataArray[i] / 128.0;
        let y = v * HEIGHT / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };

    draw();
  }
}


const constraints = {
  audio: true,
  video: false
};
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        window.voiceRecorder = new VoiceRecorder(stream);
        window.VoiceVisualiser = new VoiceVisualiser(stream);
        this.stream = stream;
      })
      .catch((e) => {
        console.error('getUserMedia failed: ', e);
      });
} else {
  console.error('getUserMedia is not supported on your browser!');
}
