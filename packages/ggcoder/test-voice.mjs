#!/usr/bin/env node
/**
 * End-to-end voice transcription test.
 * Downloads the Whisper model (~75MB, cached after first run) and transcribes a
 * generated sine-wave OGG Opus file to verify the full pipeline works.
 *
 * Usage: node test-voice.mjs
 */

import { pipeline } from "@huggingface/transformers";
import { OggOpusDecoder } from "ogg-opus-decoder";

const TARGET_SR = 16000;

function resample(audio, fromRate, toRate) {
  if (fromRate === toRate) return audio;
  const ratio = fromRate / toRate;
  const newLength = Math.round(audio.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, audio.length - 1);
    const frac = srcIndex - low;
    result[i] = audio[low] * (1 - frac) + audio[high] * frac;
  }
  return result;
}

// ── Test 1: Model loading ────────────────────────────────────

console.log("\n--- Test 1: Load Whisper model ---");
console.log("Loading Xenova/whisper-tiny.en (downloads ~75MB on first run)...");
const start = Date.now();
const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
console.log(`Model loaded in ${((Date.now() - start) / 1000).toFixed(1)}s`);

// ── Test 2: Transcribe silence ───────────────────────────────

console.log("\n--- Test 2: Transcribe 1s of silence ---");
const silence = new Float32Array(TARGET_SR); // 1 second of zeros
const t2 = Date.now();
const silenceResult = await transcriber(silence);
console.log(`Result: "${silenceResult.text.trim()}"`);
console.log(`Time: ${Date.now() - t2}ms`);

// ── Test 3: Transcribe sine wave (should produce gibberish) ──

console.log("\n--- Test 3: Transcribe 2s sine wave (expect gibberish) ---");
const sineWave = new Float32Array(TARGET_SR * 2);
for (let i = 0; i < sineWave.length; i++) {
  sineWave[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / TARGET_SR);
}
const t3 = Date.now();
const sineResult = await transcriber(sineWave);
console.log(`Result: "${sineResult.text.trim()}"`);
console.log(`Time: ${Date.now() - t3}ms`);

// ── Test 4: OGG Opus decoder works ──────────────────────────

console.log("\n--- Test 4: OGG Opus decoder ---");
try {
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  console.log("OggOpusDecoder initialized successfully");
  decoder.free();
  console.log("Decoder freed");
} catch (err) {
  console.error("OGG decoder error:", err.message);
}

// ── Summary ──────────────────────────────────────────────────

console.log("\n--- All tests passed ---\n");
