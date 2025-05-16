// playback.js (Direct Draw version)

const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
const statusDiv = document.getElementById('status');

const IVF_FILE_PATH = 'output_30fps.vp9.ivf'; // Ensure this path is correct

let videoDecoder = null;
let framesDecoded = 0;
let framesRendered = 0;
let videoWidth = 0;
let videoHeight = 0;
let totalIvfFrames = 0; // To track when all frames are expected

// Utility to read bytes from a DataView
function readU16(view, offset) {
    return view.getUint16(offset, true); // Little-endian
}
function readU32(view, offset) {
    return view.getUint32(offset, true); // Little-endian
}

/**
 * Parses the IVF header to get video dimensions and frame rate.
 * @param {ArrayBuffer} buffer - The ArrayBuffer containing the IVF file.
 * @returns {object|null} - Video properties or null if parsing fails.
 */
function parseIvfHeader(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 32) {
        console.error("IVF header too short.");
        return null;
    }

    const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
    if (signature !== 'DKIF') {
        console.error("Invalid IVF signature:", signature);
        return null;
    }

    const version = readU16(view, 4); // Should be 0
    const headerLength = readU16(view, 6); // Should be 32
    const codec = new TextDecoder().decode(new Uint8Array(buffer, 8, 4)); // e.g., 'VP90'
    const width = readU16(view, 12);
    const height = readU16(view, 14);
    const frameRateNumerator = readU32(view, 16);
    const frameRateDenominator = readU32(view, 20);
    const totalFrames = readU32(view, 24);

    if (headerLength !== 32) {
        console.warn("Unexpected IVF header length:", headerLength);
    }

    if (codec !== 'VP90') {
        console.error("Unsupported codec. Only VP90 (VP9) is supported by this parser.", codec);
        return null;
    }

    return {
        width,
        height,
        frameRate: frameRateNumerator / frameRateDenominator,
        totalFrames,
        codec,
        headerSize: headerLength
    };
}

/**
 * Parses the IVF stream frame by frame.
 * @param {ArrayBuffer} buffer - The ArrayBuffer of the IVF file (after header).
 * @param {number} startOffset - The offset where frame data begins.
 * @returns {Array<object>} - An array of frame objects.
 */
function parseIvfFrames(buffer, startOffset) {
    const frames = [];
    let offset = startOffset;
    const view = new DataView(buffer);

    while (offset < view.byteLength) {
        if (offset + 12 > view.byteLength) { // 12 bytes for frame header
            console.warn("Incomplete frame header at offset:", offset);
            break;
        }

        const frameSize = readU32(view, offset);
        const timestamp = readU32(view, offset + 4);

        const frameDataStart = offset + 12;
        const frameDataEnd = frameDataStart + frameSize;

        if (frameDataEnd > view.byteLength) {
            console.error("Frame data extends beyond buffer end. Corrupt file?", { offset, frameSize, bufferLength: view.byteLength });
            break;
        }

        const data = new Uint8Array(buffer, frameDataStart, frameSize);
        frames.push({
            data,
            timestamp,
        });

        offset = frameDataEnd;
    }
    return frames;
}

/**
 * Initializes the VideoDecoder and starts the decoding process.
 * @param {Array<object>} ivfEncodedFrames - Array of parsed IVF encoded frame objects.
 */
async function initializeDecoder(ivfEncodedFrames) {
    statusDiv.textContent = "Initializing decoder...";

    if (!window.VideoDecoder) {
        statusDiv.textContent = "Error: WebCodecs API (VideoDecoder) not supported by your browser.";
        console.error("WebCodecs API not supported.");
        return;
    }

    videoDecoder = new VideoDecoder({
        output: (videoFrame) => {
            // DIRECT DRAW: Draw the frame immediately as it's decoded
            if (canvas.width !== videoFrame.codedWidth || canvas.height !== videoFrame.codedHeight) {
                canvas.width = videoFrame.codedWidth;
                canvas.height = videoFrame.codedHeight;
                videoWidth = videoFrame.codedWidth;
                videoHeight = videoFrame.codedHeight;
                console.log("Canvas resized to:", canvas.width, "x", canvas.height);
            }

            ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
            videoFrame.close(); // Release the VideoFrame memory immediately
            framesRendered++;
            statusDiv.textContent = `Decoded: ${framesDecoded} | Rendered: ${framesRendered}`;

            // Check if all frames have been rendered and decoded
            if (framesRendered === totalIvfFrames && framesDecoded === totalIvfFrames) {
                statusDiv.textContent = `Playback finished. Decoded: ${framesDecoded} | Rendered: ${framesRendered}`;
                console.log("All frames decoded and rendered.");
                playButton.disabled = false; // Re-enable button
            }
        },
        error: (e) => {
            console.error("VideoDecoder error:", e);
            statusDiv.textContent = `Decoder Error: ${e.message}`;
            playButton.disabled = false;
        },
    });

    const config = {
        codec: 'vp9', // Or 'vp09.00.10.08' if you want to be more specific
        codedWidth: videoWidth,
        codedHeight: videoHeight,
    };

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
        statusDiv.textContent = "Error: VideoDecoder config not supported by your browser.";
        console.error("VideoDecoder config not supported:", config, support);
        playButton.disabled = false;
        return;
    }

    videoDecoder.configure(config);
    statusDiv.textContent = "Decoder configured. Starting decode...";

    // Calculate frame duration for timestamp, though not strictly needed for direct draw
    const frameDurationMicroseconds = (1000 / 30) * 1000; // 30 FPS = 33.33ms per frame = 33333 microseconds

    // Feed all frames to the decoder
    for (let i = 0; i < ivfEncodedFrames.length; i++) {
        const frame = ivfEncodedFrames[i];
        const chunk = new EncodedVideoChunk({
            type: (i === 0) ? 'key' : 'delta', // First frame is a keyframe
            timestamp: i * frameDurationMicroseconds, // Timestamps in microseconds
            data: frame.data,
        });

        videoDecoder.decode(chunk);
        framesDecoded++; // Increment immediately when fed to decoder
    }

    // Flush the decoder to ensure all buffered frames are pushed to output
    videoDecoder.flush().then(() => {
        console.log("VideoDecoder flushed. All input chunks processed.");
        // The output callback will handle rendering and final status update
    }).catch(e => {
        console.error("Decoder flush failed:", e);
        statusDiv.textContent = `Decoder flush error: ${e.message}`;
        playButton.disabled = false;
    });
}


/**
 * Fetches the IVF file, parses it, and starts playback.
 */
async function loadAndPlayVideo() {
    statusDiv.textContent = "Fetching IVF file...";
    playButton.disabled = true;

    // Reset state for potential re-play
    framesDecoded = 0;
    framesRendered = 0;
    totalIvfFrames = 0;
    if (videoDecoder) {
        await videoDecoder.reset(); // Reset decoder if it was already used
        videoDecoder = null;
    }

    try {
        const response = await fetch(IVF_FILE_PATH);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        const ivfHeader = parseIvfHeader(arrayBuffer);
        if (!ivfHeader) {
            statusDiv.textContent = "Error: Failed to parse IVF header.";
            playButton.disabled = false;
            return;
        }

        videoWidth = ivfHeader.width;
        videoHeight = ivfHeader.height;
        // frameRate = ivfHeader.frameRate; // Not strictly used for timing in this direct draw version
        totalIvfFrames = ivfHeader.totalFrames; // Use the total frames from the header

        statusDiv.textContent = `Video properties: ${videoWidth}x${videoHeight}, ${ivfHeader.frameRate.toFixed(2)} fps (Expected: 30fps)`;
        console.log("IVF Header:", ivfHeader);

        // Pre-allocate canvas size
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        const ivfEncodedFrames = parseIvfFrames(arrayBuffer, ivfHeader.headerSize);
        console.log(`Parsed ${ivfEncodedFrames.length} video frames.`);
        // Ensure totalIvfFrames is accurate from parsing if header's totalFrames is 0 or unreliable
        if (totalIvfFrames === 0 && ivfEncodedFrames.length > 0) {
             totalIvfFrames = ivfEncodedFrames.length;
             console.log("Using parsed frame count as total frames:", totalIvfFrames);
        }

        await initializeDecoder(ivfEncodedFrames);

    } catch (error) {
        console.error("Error loading or playing video:", error);
        statusDiv.textContent = `Error: ${error.message}`;
        playButton.disabled = false;
    }
}

playButton.addEventListener('click', loadAndPlayVideo);
statusDiv.textContent = "Ready to play. Click 'Load and Play Video'.";