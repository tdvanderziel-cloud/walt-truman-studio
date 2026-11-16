// The Walt Truman fact-check video template.
// Layers, back to front: original video · claim bar · "Original" credit ·
// source cards · Walt · verdict stamp · captions.

import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/anton/400.css";
import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS, LAYOUT, SAFE, VERDICT_STYLE } from "./theme";
import type { VideoProps } from "./types";

export const WaltFactcheck: React.FC<VideoProps> = (p) => {
  const { fps } = useVideoConfig();
  const f = (sec: number) => Math.round(sec * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navyDark }}>
      <Background {...p} />
      {p.audio.map((a, i) => (
        <Sequence key={i} from={f(a.start)} layout="none">
          <Audio src={staticFile(a.src)} />
        </Sequence>
      ))}
      <ClaimBar text={p.claimShortEn} account={p.original.account} date={p.original.dateLabel} />
      {p.sources.map((s, i) => (
        <Sequence key={i} from={f(s.start)} durationInFrames={Math.max(1, f(s.end - s.start))} layout="none">
          <SourceCard publisher={s.publisher} year={s.year} />
        </Sequence>
      ))}
      <Walt {...p.walt} />
      <Sequence from={f(p.verdict.at)} layout="none">
        <Stamp verdictKey={p.verdict.key} />
      </Sequence>
      <Captions words={p.captions} />
    </AbsoluteFill>
  );
};

// ---------- background: the original video ----------
const Background: React.FC<VideoProps> = ({ original }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const playing = t >= original.clipStart && t < original.clipEnd;
  const dim = playing ? 0 : LAYOUT.background.dimDuringExplanation;
  const zoom = 1 + 0.04 * Math.min(1, Math.max(0, (t - original.clipEnd) / 20)); // slow push-in on the still
  const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  return (
    <AbsoluteFill>
      {playing ? (
        <Sequence from={Math.round(original.clipStart * fps)} layout="none">
          <AbsoluteFill>
            <OffthreadVideo src={staticFile(original.clipSrc)} style={cover} />
          </AbsoluteFill>
        </Sequence>
      ) : (
        <Img src={staticFile(original.stillSrc)} style={{ ...cover, transform: `scale(${zoom})` }} />
      )}
      <AbsoluteFill style={{ backgroundColor: `rgba(10, 14, 28, ${dim})` }} />
    </AbsoluteFill>
  );
};

// ---------- top: claim bar + credit ----------
const ClaimBar: React.FC<{ text: string; account: string; date: string }> = ({ text, account, date }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18 } });
  const L = LAYOUT.claimBar;
  return (
    <div style={{ position: "absolute", top: L.top, left: L.left, right: L.right, transform: `translateY(${(1 - enter) * -60}px)`, opacity: enter }}>
      <div style={{ display: "flex", alignItems: "stretch", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}>
        <div style={{ background: COLORS.copper, color: COLORS.white, fontFamily: FONTS.heading, fontWeight: 900, fontSize: 30, padding: "0 18px", display: "flex", alignItems: "center", letterSpacing: 2 }}>
          CLAIM
        </div>
        <div style={{ background: COLORS.navy, color: COLORS.white, fontFamily: FONTS.heading, fontWeight: 800, fontSize: L.fontSize, lineHeight: 1.12, padding: "18px 22px", flex: 1 }}>
          {text}
        </div>
      </div>
      <div style={{ marginTop: 10, display: "inline-block", background: "rgba(0,0,0,.55)", color: COLORS.white, fontFamily: FONTS.heading, fontWeight: 700, fontSize: LAYOUT.original.fontSize, padding: "6px 14px", borderRadius: 8 }}>
        Original: {account} · {date}
      </div>
    </div>
  );
};

// ---------- source cards ----------
const SourceCard: React.FC<{ publisher: string; year: string }> = ({ publisher, year }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const L = LAYOUT.sourceCard;
  return (
    <div style={{
      position: "absolute", top: L.top, left: L.left, width: L.width, transform: `translateX(${(1 - enter) * 500}px) rotate(${(1 - enter) * 6}deg)`,
      background: COLORS.white, borderRadius: 16, padding: "18px 22px", boxShadow: "0 10px 30px rgba(0,0,0,.4)", borderLeft: `10px solid ${COLORS.copper}`,
    }}>
      <div style={{ fontFamily: FONTS.heading, fontWeight: 800, fontSize: 24, color: COLORS.copper, letterSpacing: 2 }}>SOURCE</div>
      <div style={{ fontFamily: FONTS.heading, fontWeight: 900, fontSize: 44, color: COLORS.navy, lineHeight: 1.1 }}>{publisher}</div>
      {year && <div style={{ fontFamily: FONTS.heading, fontWeight: 700, fontSize: 30, color: "#555" }}>{year}</div>}
    </div>
  );
};

// ---------- Walt ----------
const Walt: React.FC<VideoProps["walt"]> = ({ mouthSrcs, mouthLevels, duckFrom, duckTo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const level = mouthLevels[frame] ?? 0;
  const L = LAYOUT.walt;

  // Enter from below at the start; duck down while the original clip plays.
  const enter = spring({ frame, fps, config: { damping: 13, mass: 0.8 } });
  const duckIn = spring({ frame: frame - Math.round(duckFrom * fps), fps, config: { damping: 16 } });
  const duckOut = spring({ frame: frame - Math.round(duckTo * fps), fps, config: { damping: 12 } });
  const duck = Math.max(0, duckIn - duckOut);
  const y = (1 - enter) * 700 + duck * 560;

  // Puppet life: slow sway, plus a small head bob while talking.
  const sway = Math.sin(t * 1.7) * 0.8;
  const bob = level * 3;
  const tilt = sway + (level >= 2 ? Math.sin(frame * 0.9) * 0.6 : 0);

  return (
    <div style={{ position: "absolute", left: L.left, bottom: L.bottom, height: L.height + 160, transform: `translateY(${y + bob}px) rotate(${tilt}deg)`, transformOrigin: "50% 100%" }}>
      {mouthSrcs.map((src, i) => (
        <Img key={src} src={staticFile(src)} style={{ position: i === 0 ? "relative" : "absolute", left: 0, top: 0, height: "100%", opacity: i === level ? 1 : i === 0 && level > 0 ? 0 : i === level ? 1 : 0 }} />
      ))}
    </div>
  );
};

// ---------- verdict stamp ----------
const Stamp: React.FC<{ verdictKey: string }> = ({ verdictKey }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = VERDICT_STYLE[verdictKey] ?? VERDICT_STYLE["Nog onbekend"];
  const L = LAYOUT.stamp;
  const hit = spring({ frame, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } });
  const scale = interpolate(hit, [0, 1], [2.4, 1]);
  const shake = frame < 8 ? Math.sin(frame * 3) * (8 - frame) : 0;
  const long = v.label.length > 8;
  return (
    <div style={{
      position: "absolute", top: L.top, left: L.left, width: L.size, transform: `translate(${shake}px, 0) rotate(${L.rotateDeg}deg) scale(${scale})`, opacity: Math.min(1, frame / 3),
      border: `12px solid ${v.color}`, borderRadius: 24, padding: 10, background: "rgba(255,255,255,0.93)", boxShadow: "0 14px 40px rgba(0,0,0,.45)",
    }}>
      <div style={{ border: `4px solid ${v.color}`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
        <div style={{ fontFamily: FONTS.heading, fontWeight: 900, fontSize: 30, letterSpacing: 6, color: v.color === "#F2C230" ? "#8A6D00" : v.color }}>VERDICT</div>
        <div style={{ fontFamily: FONTS.stamp, fontSize: long ? 82 : 132, lineHeight: 1, color: v.color === "#F2C230" ? "#8A6D00" : v.color, letterSpacing: 2 }}>{v.label}</div>
      </div>
    </div>
  );
};

// ---------- captions: a few words at a time, current word highlighted ----------
const Captions: React.FC<{ words: VideoProps["captions"] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const idx = words.findIndex((w) => t >= w.start && t < (words[words.indexOf(w) + 1]?.start ?? w.end + 0.4));
  if (idx < 0) return null;
  const n = LAYOUT.captions.maxWords;
  // Chunks of n words, but start a new chunk after a sentence end.
  const chunkStart = findChunkStart(words, idx, n);
  const chunk = words.slice(chunkStart, chunkStart + n).filter((w, i, arr) => i === 0 || !/[.!?]$/.test(arr[i - 1].text));
  return (
    <div style={{ position: "absolute", top: LAYOUT.captions.top, left: SAFE.left + 20, right: SAFE.right, textAlign: "center" }}>
      <span style={{ fontFamily: FONTS.heading, fontWeight: 900, fontSize: LAYOUT.captions.fontSize, lineHeight: 1.18, textTransform: "uppercase" }}>
        {chunk.map((w, i) => (
          <span key={i} style={{
            color: chunkStart + i === idx ? COLORS.captionHighlight : COLORS.white,
            WebkitTextStroke: "10px #000", paintOrder: "stroke fill", textShadow: "0 6px 18px rgba(0,0,0,.6)", marginRight: 18, display: "inline-block",
          }}>
            {w.text}
          </span>
        ))}
      </span>
    </div>
  );
};

function findChunkStart(words: VideoProps["captions"], idx: number, n: number): number {
  let start = 0;
  let count = 0;
  for (let i = 0; i <= idx; i++) {
    const prevEndsSentence = i > 0 && /[.!?]$/.test(words[i - 1].text);
    const gap = i > 0 && words[i].start - words[i - 1].end > 0.6;
    if (i > 0 && (count >= n || prevEndsSentence || gap)) {
      start = i;
      count = 0;
    }
    count++;
  }
  return start;
}
