import type {
ImageElement,
StickerElement,
VideoElement,
} from "@/types/timeline";
import {
BlendingSection,
ClipSpeedSection,
MediaAnimationSection,
TransformSection,
VideoStyleSection,
} from "./sections";

export function VideoProperties({
element,
trackId,
}: {
element: VideoElement | ImageElement | StickerElement;
trackId: string;
}) {
return (
<div className="flex h-full flex-col">
<TransformSection
element={element}
trackId={trackId}
showTopBorder={false}
/>
{element.type === "video" && (
<ClipSpeedSection element={element} trackId={trackId} />
)}
{element.type === "video" && (
<VideoStyleSection element={element} trackId={trackId} />
)}
{element.type !== "sticker" && (
<MediaAnimationSection element={element} trackId={trackId} />
)}
<BlendingSection element={element} trackId={trackId} />
</div>
);
}