// This file is decode_h265_ivf.js
// It's loaded as a JavaScript module by index.html

// Immediately Invoked Function Expression (IIFE) is still good practice,
// but for a true module, top-level async is also implicitly allowed.
(async () => {
    /**
     * Decodes an H.265 IVF video file using WebCodecs API,
     * with the H.265 description (VPS, SPS, PPS) provided in a separate file.
     *
     * @param ivfFile The IVF file containing the H.265 video frames.
     * @param descriptionFile The binary file containing the concatenated H.265 VPS, SPS, PPS NAL units.
     */
    async function decodeH265IvfWithExternalDescription(ivfFile, descriptionFile) {
        console.log("Starting H.265 IVF decoding process...");

        // --- 1. Load the Description File ---
        const descriptionBuffer = await descriptionFile.arrayBuffer();
        if (descriptionBuffer.byteLength === 0) {
            console.error("Description file is empty. This is critical for H.265 decoding.");
            alert("Description file is empty. Cannot decode H265 without VPS/SPS/PPS.");
            return;
        }
        console.log(`Loaded description file: ${descriptionFile.name}, size: ${descriptionBuffer.byteLength} bytes.`);

        // --- 2. Load the IVF File ---
        const ivfArrayBuffer = await ivfFile.arrayBuffer();
        const bytes = new Uint8Array(ivfArrayBuffer);
        let offset = 0;

        // --- Parse IVF File Header (32 bytes) ---
        if (offset + 32 > bytes.length) {
            console.error("IVF file is too small to contain a full header.");
            return;
        }
        const ivfHeader = new DataView(ivfArrayBuffer, offset, 32);
        offset += 32;

        const magic = String.fromCharCode(ivfHeader.getUint8(0), ivfHeader.getUint8(1), ivfHeader.getUint8(2), ivfHeader.getUint8(3));
        if (magic !== 'DKIF') {
            console.error("Not a valid IVF file: Magic signature 'DKIF' not found.");
            return;
        }
        const version = ivfHeader.getUint16(4, true); // Little-endian
        const headerLen = ivfHeader.getUint16(6, true); // Little-endian
        const codecFourCC = String.fromCharCode(ivfHeader.getUint8(8), ivfHeader.getUint8(9), ivfHeader.getUint8(10), ivfHeader.getUint8(11));
        const width = ivfHeader.getUint16(12, true); // Little-endian
        const height = ivfHeader.getUint16(14, true); // Little-endian
        const timebaseDen = ivfHeader.getUint32(16, true); // Little-endian (Denominator)
        const timebaseNum = ivfHeader.getUint32(20, true); // Little-endian (Numerator)
        const numFrames = ivfHeader.getUint32(24, true); // Little-endian (Number of frames, can be 0)

        console.log(`IVF Header Details:
            Magic: ${magic}
            Version: ${version}
            Header Length: ${headerLen}
            Codec FourCC: ${codecFourCC}
            Dimensions: ${width}x${height}
            Timebase: ${timebaseNum}/${timebaseDen} (approx. ${timebaseDen / timebaseNum} fps)
            Number of Frames (from header): ${numFrames}
        `);

        if (headerLen !== 32) {
            console.warn("IVF header length is not 32 bytes as expected. This parser might be misaligned.");
        }
        if (version !== 0) {
            console.warn("IVF version is not 0. This parser might be misaligned.");
        }
        if (codecFourCC !== 'H265') {
            console.warn(`IVF Codec FourCC is '${codecFourCC}', expected 'H265'.`);
        }

        // --- Canvas Setup (for rendering decoded frames) ---
        const canvas = document.getElementById('outputCanvas');
        if (!canvas) {
            console.error("Canvas element not found!");
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("Could not get 2D rendering context for canvas.");
            return;
        }
        // Set canvas size to match video dimensions for correct rendering
        // We'll scale it down using CSS for display purposes
        canvas.width = width;
        canvas.height = height;


        // --- 3. Configure VideoDecoder ---
        const videoDecoderConfig = {
            // EXACT codec string as requested: hvc1.1.6.L123.00
            codec: `hvc1.1.6.L123.00`,
            codedWidth: width,
            codedHeight: height,
            description: descriptionBuffer, // Directly use the loaded ArrayBuffer for description
        };

        const decoder = new VideoDecoder({
            output: (frame) => {
                // This callback is called every time a frame is decoded.
                // Draw the decoded frame onto the canvas.
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                console.log(`Decoded frame: Timestamp ${frame.timestamp / 1_000_000} s, ${frame.codedWidth}x${frame.codedHeight}`);
                frame.close(); // IMPORTANT: Close the frame to release resources
            },
            error: (e) => {
                console.error("VideoDecoder error:", e);
                alert(`VideoDecoder error: ${e.message}. Check console for details.`);
            },
        });

        try {
            const isSupported = await VideoDecoder.isConfigSupported(videoDecoderConfig);
            if (!isSupported.supported) {
                console.error("H.265 decoder configuration is NOT supported by this browser:", isSupported.message, isSupported.config);
                alert(`H.265 decoder configuration not supported: ${isSupported.message}\nCheck console for details.`);
                return;
            }
            decoder.configure(videoDecoderConfig);
            console.log("VideoDecoder configured successfully for H.265.");
        } catch (e) {
            console.error("Error during VideoDecoder configuration or support check:", e);
            alert("Failed to configure VideoDecoder. Check console for errors.");
            return;
        }

        // --- 4. Parse and Feed IVF Frames ---
        let frameCount = 0;
        while (offset < bytes.length) {
            // Read Frame Header (12 bytes)
            if (offset + 12 > bytes.length) {
                console.warn(`Reached end of IVF file prematurely, incomplete frame header at offset ${offset}.`);
                break;
            }
            const frameHeader = new DataView(ivfArrayBuffer, offset, 12);
            offset += 12;

            const frameSize = frameHeader.getUint32(0, true); // Little-endian, size of frame data
            const ivfFrameNumberBigInt = frameHeader.getBigUint64(4, true); // Little-endian, 64-bit frame number
            const ivfFrameNumber = Number(ivfFrameNumberBigInt); // Convert BigInt to number for calculation

            // Calculate presentation timestamp in microseconds
            // (frame_number / (timebase_den / timebase_num)) * 1_000_000 = microseconds
            const presentationTimestampUs = Math.round(
                (ivfFrameNumber * timebaseDen / timebaseNum) * 1_000_000
            );

            // Check if there's enough data for the frame
            if (offset + frameSize > bytes.length) {
                console.error(`Incomplete frame data for frame ${frameCount} (size ${frameSize} bytes) at offset ${offset}. Remaining bytes: ${bytes.length - offset}.`);
                break;
            }

            const frameData = bytes.subarray(offset, offset + frameSize);
            offset += frameSize;

            // Keyframe detection: Every 1 second, which is every 30 frames at 30fps.
            // The first frame (index 0) is always a keyframe by definition in a new stream.
            // Subsequent keyframes will be at indices 30, 60, 90, etc., due to FFmpeg's -g 30.
            const isKeyframe = (frameCount % 30 === 0);

            const encodedChunk = new EncodedVideoChunk({
                type: isKeyframe ? "key" : "delta", // "key" for IDR/I-frame, "delta" for P/B-frame
                timestamp: presentationTimestampUs,
                data: frameData.buffer, // Pass the ArrayBuffer portion of the NAL unit(s)
            });

            decoder.decode(encodedChunk);
            frameCount++;
        }

        console.log("All IVF frames submitted to decoder. Flushing...");
        await decoder.flush(); // Ensure all pending decode operations are complete
        console.log(`Decoding of ${frameCount} frames complete. Decoder closed.`);
        decoder.close(); // Release decoder resources
    }

    // --- HTML Setup and Event Handlers (Executed when DOM is ready) ---
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error("HTML element with id 'app-container' not found.");
        return;
    }

    // Add the input elements dynamically
    appContainer.innerHTML = `
        <p>
            <label for="ivfFileInput">Select IVF Video File (.ivf):</label><br>
            <input type="file" id="ivfFileInput" accept=".ivf">
        </p>
        <p>
            <label for="descFileInput">Select H.265 Description File (.bin):</label><br>
            <input type="file" id="descFileInput" accept=".bin">
        </p>
        <button id="decodeButton" disabled>Decode Video</button>
        <p><em>(Ensure you generated 'video.ivf' and 'h265_description.bin' with the latest Python script)</em></p>
    `;

    const ivfFileInput = document.getElementById('ivfFileInput');
    const descFileInput = document.getElementById('descFileInput');
    const decodeButton = document.getElementById('decodeButton');

    let loadedIvfFile = null;
    let loadedDescFile = null;

    // Function to enable/disable button based on file selection
    const updateDecodeButtonState = () => {
        decodeButton.disabled = !(loadedIvfFile && loadedDescFile);
    };

    // Event listeners for file input changes
    ivfFileInput.onchange = (event) => {
        loadedIvfFile = event.target.files?.[0] || null;
        updateDecodeButtonState();
    };

    descFileInput.onchange = (event) => {
        loadedDescFile = event.target.files?.[0] || null;
        updateDecodeButtonState();
    };

    // Event listener for the decode button click
    decodeButton.onclick = async () => {
        if (loadedIvfFile && loadedDescFile) {
            decodeButton.disabled = true; // Disable button during decoding
            try {
                await decodeH265IvfWithExternalDescription(loadedIvfFile, loadedDescFile);
            } finally {
                decodeButton.disabled = false; // Re-enable button after decoding (or error)
            }
        } else {
            alert("Please select both the IVF video file and the description file.");
        }
    };

    console.log("Web page loaded. Please select your IVF and description files to begin decoding.");

})(); // End of IIFE