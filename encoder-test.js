async function checkCodecs(){
    const codecs = [
        'avc1.420034',
        'hvc1.1.6.L123.00',
        'vp8',
        'vp09.00.10.08',
        'av01.0.04M.08',
      ];
      
      for (const codec of codecs) {
        const videoEncoderConfig = {
          codec,
          hardwareAcceleration: 'prefer-hardware',
          width: 1920,
          height: 1080,
          bitrate: 1_024_000,
          bitrateMode: 'constant',
          framerate: 30,
        };
        const support = await VideoEncoder.isConfigSupported(videoEncoderConfig);
        console.log(
          `VideoEncoder's config ${JSON.stringify(
            videoEncoderConfig,
          )} support: ${support.supported}`,
        );        
        const videoDecoderConfig = {
          codec,
          hardwareAcceleration: 'prefer-hardware',
          codedWidth: 1920,
          codedHeight: 1080,
        };
        const supportDec = await VideoDecoder.isConfigSupported(videoDecoderConfig);
        console.log(
          `VideoDecoder's config ${JSON.stringify(
            videoDecoderConfig,
          )} support: ${supportDec.supported}`,
        );
      }
}

checkCodecs();
