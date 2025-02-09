class VoiceRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mediaRecorder = [];
    this.chunks = [];
    this.isRecording = false;
    this.recorderRef = document.querySelector('#recorder');
    this.recordButtonRef = document.querySelector('#recordButton');
    this.recordButtonRef.onclick = this.startStop.bind(this);
    this.playButton = document.querySelector('#playButton');
    this.playButton.onclick = this.play.bind(this);
    this.selectTabButton = document.querySelector('#selectTabButton');
    this.selectTabButton.onclick = this.selectTab.bind(this);
  }
  startStop() {
    if (this.isRecording) {
      console.log("stop")
      this.stopRecording()
    } else {
      console.log("start")
      this.startRecording()
    }
  }
  async selectTab() {
    let stream = await startCapture();
    console.log("tab stream:", stream);
      window.VoiceVisualiser.connectMediaStream(stream);
    this.currentTabAudioTrack = stream.getAudioTracks()[0];
    console.log(this.currentTabAudioTrack);
  }
  async startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.recordButtonRef.innerHTML = 'Stop';
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
      const blob = new Blob(this.chunks, {'type': 'audio/wav'});
      console.log(blob);
      this.lastRecordBlob = blob;
    };
    this.recorderRef.play();
    this.mediaRecorder.start();
  }
  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.recordButtonRef.innerHTML = 'Start';
    this.recorderRef.pause();
    this.mediaRecorder.stop()
  }
  play() {
    const fr = new FileReader();
    fr.onloadend = () => {
      const ab = fr.result;
      console.log(ab);
      const audioCtx = new AudioContext();
      audioCtx.decodeAudioData(ab, (sourceAudioBuffer) => {
        const merger = audioCtx.createChannelMerger(2);
        console.log(sourceAudioBuffer);
        const sourceAudio = audioCtx.createBufferSource();
        {
          // mono to stereo
        sourceAudio.buffer = sourceAudioBuffer;
          const splitter = audioCtx.createChannelSplitter(2);
          sourceAudio.connect(splitter);

        splitter.connect(merger, 0, 0);
        splitter.connect(merger, 0, 1);
        }

        if(this.currentTabAudioTrack !== undefined) {
          const tabMediaStream = new MediaStream();
          tabMediaStream.addTrack(this.currentTabAudioTrack);
          const tabAudioElement = new Audio();
          tabAudioElement.srcObject = tabMediaStream;
          tabAudioElement.muted = true;
          tabAudioElement.play();
          const tabAudioNode = audioCtx.createMediaStreamSource(tabAudioElement.captureStream());
          console.log(tabAudioNode);
          tabAudioNode.connect(merger);
        }

        //const gainNodeL = audioCtx.createGain();
        //const gainNodeR = audioCtx.createGain();
        //gainNodeL.connect(merger, 0, 0);
        //gainNodeR.connect(merger, 0, 1);
        //merger.connect(audioCtx.destination);
        merger.connect(audioCtx.destination);
        console.log(sourceAudio);
        sourceAudio.start();
      });
    };
    fr.readAsArrayBuffer(this.lastRecordBlob);
    this.chunks = [];
  }
}

class VoiceVisualiser {
  constructor(stream) {
    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const canvas = document.querySelector('#visualiser');
    const canvasCtx = canvas.getContext("2d");
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
  connectMediaStream(stream) {
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
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
      window.VoiceVisualiser = new VoiceVisualiser();
      window.VoiceVisualiser.connectMediaStream(stream);
      this.stream = stream;
    })
    .catch((e) => {
      console.error('getUserMedia failed: ', e);
    });
} else {
  console.error('getUserMedia is not supported on your browser!');
}

async function startCapture() {
  let captureStream = null;
  const displayMediaOptions = {
    video: true,
    audio: true,
  };
  try {
    captureStream =
      await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
  } catch (err) {
    console.error(`Error: ${err}`);
  }
  return captureStream;
}
