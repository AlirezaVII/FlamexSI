"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { navType } from "@/lib/pipeline";

/** A Link that tags its navigation forward / back / lateral along the pipeline, so the
 * page transition moves in the direction the user is going. */
export function PipelineLink(props: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const to =
    typeof props.href === "string" ? props.href : (props.href.pathname ?? "/");
  return <Link {...props} transitionTypes={[navType(pathname, to)]} />;
}
