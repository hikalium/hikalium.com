const constraints = {
  video : true
};

const cameraOptions = document.querySelector('.video-options>select');
const screenshotImage = document.querySelector('img');
const controls = document.querySelector('.controls');
const canvas = document.querySelector('canvas');
const video = document.querySelector('video');

const [start, stop, screenshot] = [...controls.querySelectorAll('button') ];

cameraOptions.onchange = () => {
    console.log(`Switching to ${cameraOptions.value}`)
  const updatedConstraints = {
    ...constraints,
    video: {
      deviceId : {exact : cameraOptions.value}
    }
  };
  startStream(updatedConstraints);
};

let streamStarted = false;
start.onclick = async () => {
  if (streamStarted) {
    video.play();
    return;
  } else {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  await getCameraSelection();

  }
  if ('mediaDevices' in navigator && navigator.mediaDevices.getUserMedia) {
    if (cameraOptions.value.length > 0) {
      console.log(`Switching to ${cameraOptions.value}`)
      const updatedConstraints = {
        ...constraints,
        video: {
          deviceId : {exact : cameraOptions.value}
        }
      };
      startStream(updatedConstraints);
    } else {
      console.log("first time");
      startStream(constraints);
    }
  }
};
stop.onclick = () => {
  video.pause();
};
const doScreenshot = () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  screenshotImage.src = canvas.toDataURL('image/webp');
};
screenshot.onclick = doScreenshot;
const startStream = async (newConstraints) => {
  const stream = await navigator.mediaDevices.getUserMedia(newConstraints);
  video.srcObject = stream;
};
const getCameraSelection = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  console.log(devices)
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  const options = videoDevices.map(videoDevice => {
    return `<option value="${videoDevice.deviceId}">${
        videoDevice.label}</option>`;
  });
  cameraOptions.innerHTML = options.join('');
};
