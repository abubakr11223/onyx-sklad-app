// Палитра «Оникс» (src/app/globals.css) — видео выглядит как сам сайт.
import { loadFont } from "@remotion/google-fonts/IBMPlexSans";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin", "cyrillic"],
});

export const C = {
  onyx950: "#16130f",
  onyx800: "#2e2822",
  ink: "#1c1915",
  ink2: "#6b6359",
  travertine: "#f4f1ec",
  marble: "#ffffff",
  stone100: "#ede8e0",
  line: "#e2dcd2",
  honey: "#d4a24c",
  honeySoft: "#f6ebd3",
  honeyInk: "#8a5a14",
  sideText: "#b5ac9f",
};

export type Box = { x: number; y: number; w: number; h: number };

export type Segment =
  | { type: "intro" | "outro"; title: string; subtitle: string; audio: string | null; frames: number }
  | { type: "scene"; n: number; total: number; title: string; frames: number }
  | {
      type: "step";
      key: string;
      scene: number;
      sceneTotal: number;
      sceneTitle: string;
      caption: string;
      audio: string | null;
      frames: number;
      image: string | null;
      highlights: Box[];
      click: { x: number; y: number } | null;
      after: { image: string; highlights: Box[] } | null;
    };

export type VideoData = {
  role: string;
  fps: number;
  width: number;
  height: number;
  device: "browser" | "phone";
  viewport: { w: number; h: number; scale: number };
  stones: string[];
  segments: Segment[];
  durationInFrames: number;
};
