const constraints = {
  video : true,
  audio : true,
};

const cameraOptions = document.querySelector('.video-options>select');
const screenshotImage = document.querySelector('img');
const controls = document.querySelector('.controls');
const canvas = document.querySelector('canvas');
const video = document.querySelector('video');
let devicesDetected = [];

const [start, stop, screenshot] = [...controls.querySelectorAll('button') ];

const startVideoStream = async (newConstraints) => {
  const stream = await navigator.mediaDevices.getUserMedia(newConstraints);
  video.srcObject = stream;
  console.log(stream);
};

const startSelectedStream = async () => {
  if (cameraOptions.value.length == 0) {
    console.log(`No media devices are selected. Just play something...`)
    startVideoStream(constraints);
    await getCameraSelection();
    return;
  }
  console.log(`Switching to ${cameraOptions.value}`)
  const device = devicesDetected.find((a)=> a.deviceId == cameraOptions.value);
  console.log(device);
  let caps = device.getCapabilities();
  let h = caps.height.max;
  let w = caps.width.max;
  const updatedConstraints = {
    ...constraints,
    video: {
      deviceId : {exact : cameraOptions.value},
      width: w,
      height: h,
      resizeMode: 'none',
    }
  };
  video.width = w;
  video.height = h;
  video.videoWidth = w;
  video.videoHeight = h;
  startVideoStream(updatedConstraints);
};

cameraOptions.onchange = startSelectedStream;

let streamStarted = false;
start.onclick = async () => {
  if (streamStarted) {
    video.play();
    return;
  }
  if ('mediaDevices' in navigator && navigator.mediaDevices.getUserMedia) {
    await startSelectedStream();
  }
};
stop.onclick = () => {
  video.pause();
};

const doScreenshot = () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  let ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, 0, 0);
  screenshotImage.src = canvas.toDataURL('image/webp');
};
screenshot.onclick = doScreenshot;

const getCameraSelection = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  console.log(devices)
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  const options = videoDevices.map(videoDevice => {
    let caps = videoDevice.getCapabilities();
    let h = caps.height.max;
    let w = caps.width.max;
    let fps = caps.frameRate.max;
    console.log(videoDevice, caps);
    return `<option value="${videoDevice.deviceId}">${
        videoDevice.label} (${w}x${h} ${fps}fps)</option>`;
  });
  cameraOptions.innerHTML = options.join('');
  devicesDetected = devices; 
};
