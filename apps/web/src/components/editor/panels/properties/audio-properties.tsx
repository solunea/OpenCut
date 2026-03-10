import type { AudioElement } from "@/types/timeline";
import { ClipSpeedSection } from "./sections";

export function AudioProperties({
  element,
  trackId,
}: {
  element: AudioElement;
  trackId: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <ClipSpeedSection element={element} trackId={trackId} />
    </div>
  );
}
