#!/usr/bin/env node
/**
 * 生成占位音频（WAV）
 *
 * AudioPlayer 用 HTML Audio 元素播放，播放的前提是 public/ 下存在真实文件。
 * 正式素材到位前先用本脚本生成一批可听的占位音，让「环境音选了会响」这条链路通起来：
 *
 *   public/audio/ambient/rain.wav     30s 滤波白噪声（雨声质感），循环播放
 *   public/audio/ambient/snow.wav     30s 轻高频噪声（雪天底噪），循环播放
 *   public/audio/ambient/sunny.wav    30s 轻暖底噪（晴日安静），循环播放
 *   public/audio/ambient/cafe.wav     30s 棕色噪声（咖啡馆底噪），循环播放
 *   public/audio/cue/start.wav        升调两音，专注开始
 *   public/audio/cue/complete.wav     双音钟声，专注完成
 *   public/audio/companion/greet.wav  单音软招呼，宠物互动
 *
 * 目录结构与 audio-library.ts 的 category 对齐：ambient / cue / companion。
 * 之后换成正式素材（CC 授权音乐 / 音效）时，删掉本脚本生成的 .wav 即可，不需要改代码。
 *
 * 用法：npm run audio:placeholder
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;

function writeWav(filePath, samples) {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk 大小
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 单声道
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = sampleRate * channels * bytesPerSample
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // 16-bit
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);
}

/** 首尾淡入淡出，避免循环播放时在接缝处"啪"一声 */
function fade(samples, seconds = 0.05) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = Float64Array.from(samples);
  for (let i = 0; i < n; i++) {
    const gain = i / n;
    out[i] *= gain;
    out[out.length - 1 - i] *= gain;
  }
  return out;
}

/** 低通滤波白噪声 + 缓慢振幅调制，接近雨声底噪 */
function rainNoise(seconds) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float64Array(n);
  let filtered = 0;
  const alpha = 0.3;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    filtered = alpha * white + (1 - alpha) * filtered;
    // 0.6Hz 的振幅起伏让"雨势"有微妙变化，不至于听成一个平面噪声
    out[i] = filtered * (0.55 + 0.3 * Math.sin((2 * Math.PI * i * 0.6) / SAMPLE_RATE));
  }
  return fade(out);
}

/** 比雨更轻更亮的高频噪声，缓慢起伏，接近雪天安静底噪 */
function snowNoise(seconds) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float64Array(n);
  let filtered = 0;
  const alpha = 0.55;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    filtered = alpha * white + (1 - alpha) * filtered;
    // 0.25Hz 缓慢起伏，整体音量更低
    out[i] = filtered * (0.3 + 0.18 * Math.sin((2 * Math.PI * i * 0.25) / SAMPLE_RATE));
  }
  return fade(out);
}

/** 晴日：很轻的暖底噪，几乎贴着安静，只有极缓慢的呼吸起伏 */
function sunnyNoise(seconds) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float64Array(n);
  let filtered = 0;
  const alpha = 0.4;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    filtered = alpha * white + (1 - alpha) * filtered;
    out[i] = filtered * (0.16 + 0.1 * Math.sin((2 * Math.PI * i * 0.12) / SAMPLE_RATE));
  }
  return fade(out);
}

/** 棕色噪声（积分白噪声）归一化，接近咖啡馆人声底噪 */
function cafeNoise(seconds) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float64Array(n);
  let last = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last;
    maxAbs = Math.max(maxAbs, Math.abs(last));
  }
  if (maxAbs > 0) {
    for (let i = 0; i < n; i++) out[i] = (out[i] / maxAbs) * 0.24;
  }
  return fade(out);
}

/** 正弦音 + 起音/释音包络 */
function tone(freq, seconds, amplitude = 0.4) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float64Array(n);
  const attack = Math.min(0.02, seconds * 0.25);
  const release = Math.min(0.06, seconds * 0.3);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / (attack * SAMPLE_RATE), (n - i) / (release * SAMPLE_RATE));
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * Math.max(0, env);
  }
  return out;
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function silent(seconds) {
  return new Float64Array(Math.floor(SAMPLE_RATE * seconds));
}

/** 升调两音：开始专注的短促确认音 */
function startCue() {
  return concat(tone(523.25, 0.16, 0.3), silent(0.03), tone(659.25, 0.24, 0.32));
}

/** 指数衰减的双音钟声：完成专注 */
function completeCue() {
  const decay = (freq, seconds) => {
    const n = Math.floor(SAMPLE_RATE * seconds);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const env = Math.exp((-3.2 * i) / n);
      out[i] = 0.35 * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * env;
    }
    return out;
  };
  return concat(decay(659.25, 0.42), decay(880, 0.55));
}

/** 单音软招呼：宠物出现时 */
function greetCue() {
  return tone(440, 0.5, 0.28);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const audioDir = join(root, 'public', 'audio');

const files = [
  ['ambient/rain.wav', rainNoise(30)],
  ['ambient/snow.wav', snowNoise(30)],
  ['ambient/sunny.wav', sunnyNoise(30)],
  ['ambient/cafe.wav', cafeNoise(30)],
  ['cue/start.wav', startCue()],
  ['cue/complete.wav', completeCue()],
  ['companion/greet.wav', greetCue()],
];

for (const [relative, samples] of files) {
  const target = join(audioDir, relative);
  writeWav(target, samples);
  console.log(
    `生成 ${relative} (${samples.length} 采样, ${(samples.length / SAMPLE_RATE).toFixed(1)}s)`
  );
}

console.log('占位音频生成完毕。正式素材到位后可直接覆盖这些 .wav。');
