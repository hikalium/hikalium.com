class VoiceRecorder {
  constructor() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('getUserMedia is not supported on your browser!');
      return;
    }
    this.mediaRecorder = [];
    this.stream = null;
    this.chunks = [];
    this.isRecording = false;
    this.recorderRef = document.querySelector('#recorder');
    this.playerRef = document.querySelector('#player');
    this.startRef = document.querySelector('#start');
    this.stopRef = document.querySelector('#stop');
    this.startRef.onclick = this.startRecording.bind(this);
    this.stopRef.onclick = this.stopRecording.bind(this);
    const constraints = {audio: true, video: false};
    navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
          this.stream = stream;
        })
        .catch((e) => {
          console.error('getUserMedia failed: ', e);
        });
  }
  startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.startRef.innerHTML = 'Recording...';
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
      this.chunks = [];
    };
    this.recorderRef.play();
    this.mediaRecorder.start();
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.startRef.innerHTML = 'Start';
    this.recorderRef.pause();
    this.mediaRecorder.stop()
  }
}
window.voiceRecorder = new VoiceRecorder();
