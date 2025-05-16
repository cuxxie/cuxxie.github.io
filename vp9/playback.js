// playback.js

const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
const statusDiv = document.getElementById('status');

const IVF_FILE_PATH = 'output_30fps.vp9.ivf'; // Make sure this path is correct

let videoDecoder = null;
let currentFrameQueue = [];
let framesDecoded = 0;
let framesRendered = 0;
let frameRate = 30; // Will be updated from IVF header
let videoWidth = 0;  // Will be updated from IVF header
let videoHeight = 0; // Will be updated from IVF header
let lastRenderTime = 0;
let animationFrameId = null;
let isPlaying = false;

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
    const totalFrames = readU32(view, 24); // Not strictly needed for playback, but good for info

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
        const timestamp = readU32(view, offset + 4); // Lower 32 bits of 64-bit timestamp

        const frameDataStart = offset + 12;
        const frameDataEnd = frameDataStart + frameSize;

        if (frameDataEnd > view.byteLength) {
            console.error("Frame data extends beyond buffer end. Corrupt file?", { offset, frameSize, bufferLength: view.byteLength });
            break;
        }

        const data = new Uint8Array(buffer, frameDataStart, frameSize);
        frames.push({
            data,
            timestamp, // This timestamp might need more precise handling for 64-bit timestamps if available in future IVF versions
            duration: 0 // Placeholder, duration will be calculated based on frame rate
        });

        offset = frameDataEnd;
    }
    return frames;
}

/**
 * Initializes the VideoDecoder and starts the decoding process.
 * @param {Array<object>} ivfFrames - Array of parsed IVF frame objects.
 */
async function initializeDecoder(ivfFrames) {
    statusDiv.textContent = "Initializing decoder...";

    if (!window.VideoDecoder) {
        statusDiv.textContent = "Error: WebCodecs API (VideoDecoder) not supported by your browser.";
        console.error("WebCodecs API not supported.");
        return;
    }

    videoDecoder = new VideoDecoder({
        output: (videoFrame) => {
            currentFrameQueue.push(videoFrame);
            framesDecoded++;
            statusDiv.textContent = `Decoded: ${framesDecoded} | Rendered: ${framesRendered}`;
        },
        error: (e) => {
            console.error("VideoDecoder error:", e);
            statusDiv.textContent = `Decoder Error: ${e.message}`;
            isPlaying = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        },
    });

    const config = {
        codec: 'vp09.00.10.08', // This matches the VP9 profile 0, 8-bit depth
        // You can also provide the codec string as extracted from the IVF header if it were more detailed:
        // codec: 'vp9', // Simpler, often sufficient
        codedWidth: videoWidth,
        codedHeight: videoHeight,
        // You might need a more precise description of the profile if it's not default
        // e.g., 'vp09.00.10.08' is for Profile 0, Level 1.0, 8-bit
        // For your file, 'vp09.00.10.08' or just 'vp9' should work for the codec.
    };

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
        statusDiv.textContent = "Error: VideoDecoder config not supported by your browser.";
        console.error("VideoDecoder config not supported:", config, support);
        return;
    }

    videoDecoder.configure(config);
    statusDiv.textContent = "Decoder configured. Starting decode loop...";

    // Calculate frame duration for smooth playback
    const frameDurationMs = 1000 / frameRate;

    // Start feeding frames to the decoder
    for (let i = 0; i < ivfFrames.length; i++) {
        const frame = ivfFrames[i];
        const chunk = new EncodedVideoChunk({
            type: (i === 0) ? 'key' : 'delta', // First frame is always a keyframe in IVF (assuming typical generation)
            timestamp: i * frameDurationMs * 1000, // Timestamps in microseconds
            data: frame.data,
        });

        videoDecoder.decode(chunk);
    }

    // Start the rendering loop
    isPlaying = true;
    requestAnimationFrame(renderLoop);
}

/**
 * The main rendering loop that draws decoded frames to the canvas.
 * @param {DOMHighResTimeStamp} now - The current time provided by requestAnimationFrame.
 */
function renderLoop(now) {
    console.log("isPlaying:", isPlaying);
    if (!isPlaying) return;

    if (lastRenderTime === 0) {
        lastRenderTime = now;
    }

    // Calculate expected time for the next frame
    const timeSinceLastFrame = now - lastRenderTime;
    const targetFrameTime = 1000 / frameRate; // ms per frame

    // Only render if enough time has passed or if we have a backlog of frames
    if (timeSinceLastFrame >= targetFrameTime && currentFrameQueue.length > 0) {
        const frame = currentFrameQueue.shift();

        if (frame) {
            // Resize canvas to video dimensions
            if (canvas.width !== frame.codedWidth || canvas.height !== frame.codedHeight) {
                canvas.width = frame.codedWidth;
                canvas.height = frame.codedHeight;
                videoWidth = frame.codedWidth;
                videoHeight = frame.codedHeight;
            }

            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
            frame.close(); // Release the VideoFrame memory
            framesRendered++;
            statusDiv.textContent = `Decoded: ${framesDecoded} | Rendered: ${framesRendered}`;
            lastRenderTime = now; // Update last render time
        }
    }

    if (framesRendered < framesDecoded || currentFrameQueue.length > 0) {
        animationFrameId = requestAnimationFrame(renderLoop);
    } else if (videoDecoder && videoDecoder.state === 'configured' && framesRendered >= framesDecoded && currentFrameQueue.length === 0) {
        // If all frames decoded and rendered, and no frames left in queue,
        // we can consider looping or stopping.
        statusDiv.textContent = `Playback finished. Decoded: ${framesDecoded} | Rendered: ${framesRendered}`;
        console.log("All frames processed and rendered.");
        isPlaying = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        // Optionally, loop the video here by re-initializing or seeking
        // For simplicity, this example just stops.
    }
}

/**
 * Fetches the IVF file, parses it, and starts playback.
 */
async function loadAndPlayVideo() {
    statusDiv.textContent = "Fetching IVF file...";
    playButton.disabled = true;

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
        frameRate = ivfHeader.frameRate;

        statusDiv.textContent = `Video properties: ${videoWidth}x${videoHeight}, ${frameRate.toFixed(2)} fps`;
        console.log("IVF Header:", ivfHeader);

        // Pre-allocate canvas size
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        const ivfFrames = parseIvfFrames(arrayBuffer, ivfHeader.headerSize);
        console.log(`Parsed ${ivfFrames.length} video frames.`);

        await initializeDecoder(ivfFrames);

    } catch (error) {
        console.error("Error loading or playing video:", error);
        statusDiv.textContent = `Error: ${error.message}`;
        playButton.disabled = false;
    }
}

playButton.addEventListener('click', loadAndPlayVideo);
statusDiv.textContent = "Ready to play. Click 'Load and Play Video'.";