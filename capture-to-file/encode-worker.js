importScripts('./webm-writer2.js')

let webmWriter = null;
let fileWritableStream = null;
let frameReader = null;
const FRAME_TO_ENCODE = 6000;
let frameCounter = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startRecording(fileHandle, frameStream, trackSettings) {
  let frameCounter = 0;

  fileWritableStream = await fileHandle.createWritable();

  webmWriter = new WebMWriter({
      fileWriter: fileWritableStream,
      codec: 'VP9',
      width: trackSettings.width,
      height: trackSettings.height});

  frameReader = frameStream.getReader();

  const init = {
    output: (chunk) => {
      console.log('out: '+performance.now());
      webmWriter.addFrame(chunk);
    },
    error: (e) => {
      console.log(e.message);
      stopRecording();
    }
  };

  const config = {
    codec: "vp09.00.10.08",
    width: trackSettings.width,
    height: trackSettings.height,
    bitrate: 10e6,
  };

  let encoder = new VideoEncoder(init);
  let support = await VideoEncoder.isConfigSupported(config);
  console.assert(support.supported);
  encoder.configure(config);

  frameReader.read().then(async function processFrame({done, value}) {
    if(frameCounter > FRAME_TO_ENCODE){
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

    freameCounter++;
      const insert_keyframe = (frameCounter % 150) == 0;
    console.log('in: '+performance.now());
      encoder.encode(frame, { keyFrame: insert_keyframe });
      await sleep(5);
    // } else {
    //   console.log('dropping frame, encoder falling behind');
    // }

    frame.close();
    frameReader.read().then(processFrame);
  });
}

async function stopRecording() {
  await frameReader.cancel();
  await webmWriter.complete();
  fileWritableStream.close();
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
