// The data a video is made from. Built by server/render.ts, read by the template.

export interface TimedWord {
  text: string;
  start: number; // seconds from the start of the video
  end: number;
}

export interface VideoProps {
  durationSec: number;
  claimShortEn: string;
  original: {
    account: string;
    dateLabel: string; // e.g. "10 Nov 2026"
    clipSrc: string; // file in the render folder
    stillSrc: string; // frozen frame shown while Walt explains
    clipStart: number; // seconds in the video where the original clip plays
    clipEnd: number;
  };
  walt: {
    mouthSrcs: string[]; // index = mouth level 0..3
    mouthLevels: number[]; // one value per video frame
    duckFrom: number; // Walt ducks away while the original clip plays
    duckTo: number;
  };
  audio: { src: string; start: number }[]; // Walt's voice clips
  captions: TimedWord[];
  sources: { publisher: string; year: string; start: number; end: number }[];
  verdict: { key: string; at: number };
}
