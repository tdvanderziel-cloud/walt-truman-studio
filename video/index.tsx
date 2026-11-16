// Remotion entry point. Preview the template with: npm run video:preview
import React from "react";
import { Composition, registerRoot } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./theme";
import type { VideoProps } from "./types";
import { WaltFactcheck } from "./WaltFactcheck";
import sample from "./sample-props.json";

const Root: React.FC = () => (
  <Composition
    id="WaltFactcheck"
    component={WaltFactcheck as unknown as React.FC<Record<string, unknown>>}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={Math.round((sample as VideoProps).durationSec * FPS)}
    defaultProps={sample as unknown as Record<string, unknown>}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.round((props as unknown as VideoProps).durationSec * FPS)) })}
  />
);

registerRoot(Root);
