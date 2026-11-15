import { Composition } from "remotion";
import { FlamexSI, TOTAL } from "./FlamexSI";
import { Formal, FORMAL_TOTAL } from "./Formal";

export const Root = () => (
  <>
    <Composition id="FlamexSI" component={FlamexSI} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
    <Composition id="Formal" component={Formal} durationInFrames={FORMAL_TOTAL} fps={30} width={1920} height={1080} />
  </>
);
