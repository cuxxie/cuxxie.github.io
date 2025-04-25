importScripts('./webm-writer2.js')

let webmWriter = null;
let fileWritableStream = null;
let frameReader = null;
const FRAME_TO_ENCODE = 600;
let frameCounter = 0;
let map = new Map();
let duration = [];
let printed = false;
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printOnce(){
  if(!printed) {
    printed = true;
    console.log(duration);
  }
}

async function startRecording(fileHandle, frameStream, trackSettings) {
  // fileWritableStream = await fileHandle.createWritable();

  // webmWriter = new WebMWriter({
  //     fileWriter: fileWritableStream,
  //     codec: 'VP9',
  //     width: trackSettings.width,
  //     height: trackSettings.height});

  frameReader = frameStream.getReader();

  const init = {
    output: (chunk) => {
      // console.log('out: '+performance.now());
      const lNow = performance.now();
      const ts = chunk.timestamp;
      duration.push({
        timestamp: ts,
        start: map.get(ts),
        end: lNow,
        duration: lNow - map.get(ts)
      });
      // webmWriter.addFrame(chunk);
    },
    error: (e) => {
      console.log(e.message);
      stopRecording();
    }
  };

  const config = {
    codec: "hvc1.1.6.L123.00",
    width: trackSettings.width,
    height: trackSettings.height,
    hardwareAcceleration: 'prefer-hardware',
    bitrate: 10e6,
    framerate: 30,
    // scalabilityMode: 'L1T1',
    // alpha: 'discard',
    // bitrateMode: 'constant',
    // latencyMode: 'realtime',
  };

  let encoder = new VideoEncoder(init);
  let support = await VideoEncoder.isConfigSupported(config);
  console.assert(support.supported);
  encoder.configure(config);

  frameReader.read().then(async function processFrame({done, value}) {
    // console.log(frameCounter);
    if(frameCounter > FRAME_TO_ENCODE){
      printOnce();
      stopRecording()
      return;
    }
    let frame = value;

    if(done) {
      await encoder.flush();
      encoder.close();
      return;
    }

    // if (encoder.encodeQueueSize <= 30) {
    //   if (++frameCounter % 20 == 0) {
    //     console.log(frameCounter + ' frames processed');
    //   }

      frameCounter++;
      // const insert_keyframe = (frameCounter % 150) == 0;
      map.set(frame.timestamp, performance.now());
      encoder.encode(frame, { keyFrame: false });
      frame.close();
      await sleep(5);
    // } else {
    //   console.log('dropping frame, encoder falling behind');
    // }
    frameReader.read().then(processFrame);
  });
}

async function stopRecording() {
  console.log('stop recording called');
  await frameReader.cancel();
  // await webmWriter.complete();
  // fileWritableStream.close();
  frameReader = null;
  webmWriter = null;
  fileWritableStream = null;
}

self.addEventListener('message', function(e) {
  switch (e.data.type) {
    case "start":
      startRecording(e.data.fileHandle, e.data.frameStream,
                          e.data.trackSettings);
      break;
    case "stop":
      stopRecording();
      break;
  }
});
