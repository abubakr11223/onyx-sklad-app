import { Composition } from "remotion";
import { Guide } from "./Guide";
import type { VideoData } from "./theme";
import vladelets from "./data/vladelets.json";
import menedzher from "./data/menedzher.json";
import zavsklad from "./data/zavsklad.json";

// Данные каждой роли — `node build-data.mjs <роль>` (render.mjs делает это сам).
const videos: Record<string, VideoData> = {
  vladelets: vladelets as VideoData,
  menedzher: menedzher as VideoData,
  zavsklad: zavsklad as VideoData,
};

export const Root: React.FC = () => (
  <>
    {Object.entries(videos).map(([id, data]) => (
      <Composition
        key={id}
        id={id}
        component={Guide}
        durationInFrames={data.durationInFrames}
        fps={data.fps}
        width={data.width}
        height={data.height}
        defaultProps={{ data }}
      />
    ))}
  </>
);
