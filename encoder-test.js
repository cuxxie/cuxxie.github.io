async function checkCodecs(){
    const codecs = [
        "avc1.420034",
        "hvc1.1.6.L123.00",
        "vp8",
        "vp09.00.10.08",
        "av01.0.04M.08",
      ];
      const accelerations = ["prefer-hardware", "prefer-software"];
      
      const configs = [];
      for (const codec of codecs) {
        for (const acceleration of accelerations) {
          configs.push({
            codec,
            hardwareAcceleration: acceleration,
            width: 1280,
            height: 720,
            bitrate: 2_000_000,
            bitrateMode: "constant",
            framerate: 30,
            not_supported_field: 123,
          });
        }
      }
      
      for (const config of configs) {
        const support = await VideoEncoder.isConfigSupported(config);
        console.log(
          `VideoEncoder's config ${JSON.stringify(support.config)} support: ${
            support.supported
          }`,
        );
      }
}

checkCodecs();
