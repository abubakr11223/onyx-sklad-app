// ТЗ №21 Б — обучающее видео по роли. Стиль — как в образце заказчика:
// светлый фон с плавающими фото камня, крупный титр сверху с акцентным словом,
// экран сайта в рамке, камера подъезжает к нужному месту, курсор нажимает.
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, fontFamily, type Box, type Segment, type VideoData } from "./theme";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const Guide: React.FC<{ data: VideoData }> = ({ data }) => {
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: C.travertine, fontFamily }}>
      <FloatingStones stones={data.stones} />
      {data.segments.map((seg, i) => {
        const start = from;
        from += seg.frames;
        return (
          <Sequence key={i} from={start} durationInFrames={seg.frames} name={seg.type === "step" ? seg.key : seg.type}>
            <SegmentView seg={seg} data={data} />
            {"audio" in seg && seg.audio ? (
              <Sequence from={seg.type === "step" ? 6 : 10}>
                <Audio src={staticFile(seg.audio)} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SegmentView: React.FC<{ seg: Segment; data: VideoData }> = ({ seg, data }) => {
  if (seg.type === "scene") return <SceneCard seg={seg} data={data} />;
  if (seg.type === "step") return <StepView seg={seg} data={data} />;
  return <TitleCard seg={seg} data={data} />;
};

// ── Фон: плавающие фото камня ────────────────────────────────────────────
const FloatingStones: React.FC<{ stones: string[] }> = ({ stones }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (stones.length === 0) return null;
  const tiles = Array.from({ length: 14 }, (_, i) => {
    const r = (k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return {
      src: stones[i % stones.length],
      x: r(1) * width - 80,
      y: r(2) * height - 80,
      size: 150 + r(3) * 130,
      rot: (r(4) - 0.5) * 14,
      speed: 0.25 + r(5) * 0.35,
      phase: r(6) * Math.PI * 2,
      opacity: 0.16 + r(7) * 0.16,
    };
  });
  return (
    <AbsoluteFill>
      {tiles.map((t, i) => (
        <Img
          key={i}
          src={staticFile(t.src)}
          style={{
            position: "absolute",
            left: t.x + Math.sin(frame / 90 + t.phase) * 18,
            top: t.y - ((frame * t.speed) % (height + 400)) + Math.cos(frame / 70 + t.phase) * 10,
            width: t.size,
            height: t.size * 0.7,
            objectFit: "cover",
            borderRadius: 18,
            opacity: t.opacity,
            transform: `rotate(${t.rot}deg)`,
            filter: "blur(1.5px) saturate(0.9)",
            boxShadow: "0 12px 30px rgba(28,25,21,0.12)",
          }}
        />
      ))}
      {/* второй ряд — те же плитки ниже, чтобы поток не кончался */}
      {tiles.map((t, i) => (
        <Img
          key={`b${i}`}
          src={staticFile(t.src)}
          style={{
            position: "absolute",
            left: t.x + Math.sin(frame / 90 + t.phase) * 18,
            top: t.y + height + 400 - ((frame * t.speed) % (height + 400)),
            width: t.size,
            height: t.size * 0.7,
            objectFit: "cover",
            borderRadius: 18,
            opacity: t.opacity,
            transform: `rotate(${t.rot}deg)`,
            filter: "blur(1.5px) saturate(0.9)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// ── Титр с акцентом: «...» и часть до « — » окрашиваются мёдом ─────────────
const Highlighted: React.FC<{ text: string }> = ({ text }) => {
  const parts: { t: string; hi: boolean }[] = [];
  if (text.includes("«")) {
    const re = /(«[^»]+»)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > last) parts.push({ t: text.slice(last, m.index), hi: false });
      parts.push({ t: m[0], hi: true });
      last = m.index! + m[0].length;
    }
    if (last < text.length) parts.push({ t: text.slice(last), hi: false });
  } else if (text.includes(" — ")) {
    const [a, ...rest] = text.split(" — ");
    parts.push({ t: a, hi: true }, { t: " — " + rest.join(" — "), hi: false });
  } else {
    parts.push({ t: text, hi: false });
  }
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} style={{ color: p.hi ? C.honeyInk : C.ink }}>
          {p.t}
        </span>
      ))}
    </>
  );
};

const Caption: React.FC<{ text: string; portrait: boolean }> = ({ text, portrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  return (
    <div
      style={{
        position: "absolute",
        top: portrait ? 110 : 44,
        left: "50%",
        transform: `translate(-50%, ${interpolate(s, [0, 1], [-30, 0])}px)`,
        opacity: s,
        maxWidth: portrait ? 960 : 1560,
        width: "max-content",
        padding: portrait ? "30px 44px" : "24px 44px",
        background: C.marble,
        borderRadius: 26,
        border: `1px solid ${C.line}`,
        boxShadow: "0 18px 50px rgba(28,25,21,0.12)",
        fontSize: portrait ? 56 : 44,
        lineHeight: 1.18,
        fontWeight: 700,
        textAlign: "center",
        letterSpacing: "-0.01em",
      }}
    >
      <Highlighted text={text} />
    </div>
  );
};

// ── Шаг: экран сайта, камера, подсветка, курсор ─────────────────────────────
function geometry(data: VideoData) {
  if (data.device === "phone") {
    const W = 660;
    const H = Math.round((W * data.viewport.h) / data.viewport.w);
    return { W, H, left: (data.width - W) / 2, top: 420, bezel: 22, toolbar: 0 };
  }
  const W = 1280;
  const H = Math.round((W * data.viewport.h) / data.viewport.w);
  return { W, H, left: (data.width - W) / 2, top: 192 + 40, bezel: 0, toolbar: 40 };
}

function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const StepView: React.FC<{ seg: Extract<Segment, { type: "step" }>; data: VideoData }> = ({ seg, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const portrait = data.device === "phone";
  const g = geometry(data);
  const k = g.W / data.viewport.w; // css px сайта → px кадра
  const scaleBoxes = (bs: Box[]) => bs.map((b) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }));
  const boxesA = scaleBoxes(seg.highlights);
  const boxesB = seg.after ? scaleBoxes(seg.after.highlights) : [];

  // Камера: подъезд к выделенному месту (фаза A), после нажатия — к результату (фаза B).
  const camFor = (bs: Box[]) => {
    const t = unionBox(bs);
    if (!t) return { z: 1.035, tx: clamp(g.W / 2 - (g.W / 2) * 1.035, g.W - g.W * 1.035, 0), ty: clamp(g.H / 2 - (g.H / 2) * 1.035, g.H - g.H * 1.035, 0) };
    const z = clamp(Math.min((g.W * 0.62) / t.w, (g.H * 0.62) / t.h), 1, portrait ? 1.45 : 1.75);
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    return { z, tx: clamp(g.W / 2 - cx * z, g.W - g.W * z, 0), ty: clamp(g.H / 2 - cy * z, g.H - g.H * z, 0) };
  };
  const A = camFor(boxesA);
  const B = seg.after ? camFor(boxesB) : A;
  const ease = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const, easing: Easing.inOut(Easing.cubic) };
  const pA = interpolate(frame, [8, 34], [0, 1], ease);
  const pB = seg.after ? interpolate(frame, [74, 100], [0, 1], ease) : 0;
  const zA = 1 + (A.z - 1) * pA;
  const s = zA + (B.z - zA) * pB;
  const ox = A.tx * pA + (B.tx - A.tx * pA) * pB;
  const oy = A.ty * pA + (B.ty - A.ty * pA) * pB;
  const toScreen = (x: number, y: number) => ({ x: ox + x * s, y: oy + y * s });
  const afterOpacity = seg.after ? interpolate(frame, [66, 78], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;

  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 120 } });
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  // Курсор: от правого нижнего угла к точке нажатия.
  const click = seg.click ? { x: seg.click.x * k, y: seg.click.y * k } : null;
  const cp = interpolate(frame, [32, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const ringA = spring({ frame: frame - 30, fps, config: { damping: 14, stiffness: 120 } }) * (1 - afterOpacity);
  const ringB = seg.after ? spring({ frame: frame - 96, fps, config: { damping: 14, stiffness: 120 } }) : 0;
  const pulse = 0.5 + 0.5 * Math.sin(frame / 7);
  const layers = [
    { boxes: boxesA, ring: ringA, id: "a" },
    { boxes: boxesB, ring: ringB, id: "b" },
  ].filter((l) => l.boxes.length > 0 && l.ring > 0.001);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Caption text={seg.caption} portrait={portrait} />

      {/* Рамка устройства */}
      <div
        style={{
          position: "absolute",
          left: g.left - g.bezel,
          top: g.top - g.toolbar - g.bezel,
          width: g.W + g.bezel * 2,
          height: g.H + g.toolbar + g.bezel * 2,
          borderRadius: portrait ? 64 : 18,
          background: portrait ? C.onyx950 : C.marble,
          border: portrait ? "none" : `1px solid ${C.line}`,
          boxShadow: "0 40px 90px rgba(28,25,21,0.22)",
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
          overflow: "hidden",
        }}
      >
        {!portrait && (
          <div style={{ height: g.toolbar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: C.stone100 }}>
            {["#e0b4a8", "#e8d29a", "#b9d0b0"].map((c) => (
              <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
            ))}
            <div
              style={{
                marginLeft: 18,
                height: 24,
                flex: 1,
                maxWidth: 520,
                borderRadius: 12,
                background: C.marble,
                color: C.ink2,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
              }}
            >
              onyx · {seg.sceneTitle.replace(/«|»/g, "")}
            </div>
          </div>
        )}
        <div
          style={{
            position: "absolute",
            left: g.bezel,
            top: g.toolbar + g.bezel,
            width: g.W,
            height: g.H,
            overflow: "hidden",
            borderRadius: portrait ? 44 : 0,
            background: C.travertine,
          }}
        >
          <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `translate(${ox}px, ${oy}px) scale(${s})` }}>
            {seg.image ? (
              <>
                <Img src={staticFile(seg.image)} style={{ width: g.W, height: g.H, display: "block" }} />
                {seg.after ? (
                  <Img src={staticFile(seg.after.image)} style={{ position: "absolute", inset: 0, width: g.W, height: g.H, opacity: afterOpacity }} />
                ) : null}
              </>
            ) : (
              <div style={{ width: g.W, height: g.H, display: "grid", placeItems: "center", color: C.ink2, fontSize: 32 }}>
                Ekran tayyorlanmoqda · {seg.key}
              </div>
            )}
          </div>

          {/* Затемнение вокруг выделенного и рамка-подсветка */}
          {layers.map((l) => (
            <React.Fragment key={l.id}>
              <svg width={g.W} height={g.H} style={{ position: "absolute", inset: 0 }}>
                <defs>
                  <mask id={`m-${seg.key}-${l.id}`}>
                    <rect width={g.W} height={g.H} fill="white" />
                    {l.boxes.map((b, i) => {
                      const a = toScreen(b.x, b.y);
                      return <rect key={i} x={a.x - 8} y={a.y - 8} width={b.w * s + 16} height={b.h * s + 16} rx={12} fill="black" />;
                    })}
                  </mask>
                </defs>
                <rect width={g.W} height={g.H} fill={C.onyx950} opacity={0.32 * l.ring} mask={`url(#m-${seg.key}-${l.id})`} />
              </svg>
              {l.boxes.map((b, i) => {
                const a = toScreen(b.x, b.y);
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: a.x - 8,
                      top: a.y - 8,
                      width: b.w * s + 16,
                      height: b.h * s + 16,
                      borderRadius: 12,
                      border: `3px solid ${C.honey}`,
                      boxShadow: `0 0 ${18 + pulse * 18}px rgba(212,162,76,${0.45 + pulse * 0.25})`,
                      opacity: l.ring,
                      transform: `scale(${interpolate(l.ring, [0, 1], [1.08, 1])})`,
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}

          {click && afterOpacity < 1 && <Cursor from={{ x: g.W * 0.82, y: g.H * 0.86 }} to={toScreen(click.x, click.y)} p={cp} frame={frame} portrait={portrait} />}
        </div>
      </div>

      <SceneChip n={seg.scene} total={seg.sceneTotal} title={seg.sceneTitle} portrait={portrait} />
    </AbsoluteFill>
  );
};

const Cursor: React.FC<{ from: { x: number; y: number }; to: { x: number; y: number }; p: number; frame: number; portrait: boolean }> = ({
  from,
  to,
  p,
  frame,
  portrait,
}) => {
  const x = interpolate(p, [0, 1], [from.x, to.x]);
  const y = interpolate(p, [0, 1], [from.y, to.y]);
  const clickAt = 58;
  const press = interpolate(frame, [clickAt, clickAt + 4, clickAt + 9], [1, 0.82, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rip = interpolate(frame, [clickAt, clickAt + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const appear = interpolate(frame, [26, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (portrait) {
    // На телефоне — палец: круглая точка касания.
    return (
      <>
        <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 34, background: "rgba(28,25,21,0.28)", border: "3px solid white", opacity: appear, transform: `scale(${press})` }} />
        {rip > 0 && rip < 1 && (
          <div style={{ position: "absolute", left: x - 70, top: y - 70, width: 140, height: 140, borderRadius: 70, border: `4px solid ${C.honey}`, opacity: 1 - rip, transform: `scale(${0.4 + rip})` }} />
        )}
      </>
    );
  }
  return (
    <>
      {rip > 0 && rip < 1 && (
        <div style={{ position: "absolute", left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: 40, border: `4px solid ${C.honey}`, opacity: 1 - rip, transform: `scale(${0.3 + rip})` }} />
      )}
      <svg
        width={34}
        height={40}
        viewBox="0 0 24 28"
        style={{ position: "absolute", left: x - 4, top: y - 2, opacity: appear, transform: `scale(${press})`, transformOrigin: "4px 2px", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.3))" }}
      >
        <path d="M3 1 L3 22 L8.5 17 L12 26 L15.5 24.5 L12 16 L19.5 16 Z" fill={C.ink} stroke="white" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </>
  );
};

const SceneChip: React.FC<{ n: number; total: number; title: string; portrait: boolean }> = ({ n, total, title, portrait }) => (
  <div
    style={{
      position: "absolute",
      left: portrait ? "50%" : 36,
      bottom: portrait ? 70 : 36,
      transform: portrait ? "translateX(-50%)" : undefined,
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 20px",
      borderRadius: 999,
      background: C.onyx950,
      color: C.sideText,
      fontSize: portrait ? 30 : 20,
      fontWeight: 600,
      boxShadow: "0 10px 30px rgba(28,25,21,0.2)",
      maxWidth: portrait ? 900 : 270,
    }}
  >
    <span style={{ color: C.honey, whiteSpace: "nowrap" }}>
      {n} / {total}
    </span>
    {portrait ? <span style={{ color: "#fff" }}>{title.replace(/«|»/g, "")}</span> : null}
    <div style={{ display: "flex", gap: 5 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ width: portrait ? 18 : 14, height: 6, borderRadius: 3, background: i < n ? C.honey : "#4a4239" }} />
      ))}
    </div>
  </div>
);

// ── Заставка раздела ───────────────────────────────────────────────────────
const SceneCard: React.FC<{ seg: Extract<Segment, { type: "scene" }>; data: VideoData }> = ({ seg, data }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const portrait = data.device === "phone";
  const s = spring({ frame, fps, config: { damping: 16, stiffness: 110 } });
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const bg = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        opacity: bg * out,
        background: `radial-gradient(ellipse at 50% 40%, ${C.onyx800} 0%, ${C.onyx950} 70%)`,
        alignItems: "center",
        justifyContent: "center",
        padding: portrait ? 80 : 160,
        textAlign: "center",
      }}
    >
      <div style={{ transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px)`, opacity: s }}>
        <div style={{ color: C.honey, fontSize: portrait ? 34 : 28, fontWeight: 600, letterSpacing: "0.28em", textTransform: "uppercase" }}>
          {seg.n}-bo'lim · {seg.total} tadan
        </div>
        <div style={{ marginTop: 26, color: "#fff", fontSize: portrait ? 80 : 84, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.015em" }}>
          {seg.title.split(/(«[^»]+»)/g).map((t, i) => (
            <span key={i} style={{ color: t.startsWith("«") ? C.honey : "#fff" }}>
              {t}
            </span>
          ))}
        </div>
        <div style={{ margin: "40px auto 0", width: interpolate(s, [0, 1], [0, 160]), height: 4, borderRadius: 2, background: C.honey }} />
      </div>
    </AbsoluteFill>
  );
};

// ── Начало и конец ─────────────────────────────────────────────────────────
const TitleCard: React.FC<{ seg: Extract<Segment, { type: "intro" | "outro" }>; data: VideoData }> = ({ seg, data }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const portrait = data.device === "phone";
  const logo = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const text = spring({ frame: frame - 10, fps, config: { damping: 18, stiffness: 110 } });
  const sub = spring({ frame: frame - 20, fps, config: { damping: 18, stiffness: 110 } });
  const out = seg.type === "intro" ? interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  const [head, tail] = seg.title.includes(" — ") ? seg.title.split(" — ") : [seg.title, ""];
  return (
    <AbsoluteFill
      style={{
        opacity: out,
        background: `radial-gradient(ellipse at 50% 35%, ${C.onyx800} 0%, ${C.onyx950} 65%)`,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: portrait ? 70 : 140,
      }}
    >
      <Img
        src={staticFile("logo.jpg")}
        style={{
          width: portrait ? 300 : 230,
          height: portrait ? 300 : 230,
          borderRadius: "50%",
          transform: `scale(${logo}) rotate(${interpolate(frame, [0, durationInFrames], [-8, 8])}deg)`,
          boxShadow: `0 0 120px rgba(212,162,76,${0.25 * logo})`,
        }}
      />
      <div style={{ marginTop: 50, opacity: text, transform: `translateY(${interpolate(text, [0, 1], [30, 0])}px)` }}>
        <div style={{ color: "#fff", fontSize: portrait ? 88 : 92, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
          {seg.type === "intro" ? head : seg.title}
        </div>
        {seg.type === "intro" && tail ? (
          <div style={{ color: C.honey, fontSize: portrait ? 64 : 60, fontWeight: 600, marginTop: 14 }}>{tail}</div>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 34,
          maxWidth: 1200,
          color: C.sideText,
          fontSize: portrait ? 40 : 34,
          lineHeight: 1.3,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [20, 0])}px)`,
        }}
      >
        {seg.subtitle}
      </div>
    </AbsoluteFill>
  );
};
