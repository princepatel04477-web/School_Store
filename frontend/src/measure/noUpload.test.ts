import { describe, expect, it } from 'vitest';

/**
 * The camera frame must never leave the phone (plan A2, principle 1). The
 * measuring code may not send anything, or turn a frame into a file. Only
 * the shoulder width and its confidence go out, through the size check.
 */
const sources = import.meta.glob(['./*.ts', './*.tsx', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /sendBeacon/,
  /WebSocket/,
  /EventSource/,
  /FormData/,
  /\bapi\s*[<(]/,
  /\bupload/i,
  /toBlob\s*\(/,
  /toDataURL\s*\(/,
  /captureStream\s*\(/,
  /MediaRecorder/,
  /localStorage|sessionStorage|indexedDB/,
];

describe('camera measurement stays on the phone', () => {
  const files = Object.keys(sources).map((path) => path.replace('./', ''));

  it('finds the measuring code', () => {
    expect(files).toContain('MeasureCapture.tsx');
    expect(files).toContain('measureBody.ts');
  });

  for (const name of files) {
    it(`${name} has no way to send or save a frame`, () => {
      const source = sources[`./${name}`];
      for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
    });
  }

  it('loads the pose model from this site, not a third party', () => {
    const source = sources['./MeasureCapture.tsx'];
    expect(source).toContain("'/mediapipe/wasm'");
    expect(source).toContain("'/mediapipe/pose_landmarker_lite.task'");
    expect(source).not.toMatch(/https?:\/\//);
  });
});
