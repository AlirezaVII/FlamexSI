import { Composition } from "remotion";
import { FlamexSI, TOTAL } from "./FlamexSI";

export const Root = () => (
  <Composition
    id="FlamexSI"
    component={FlamexSI}
    durationInFrames={TOTAL}
    fps={30}
    width={1920}
    height={1080}
  />
);
