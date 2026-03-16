import { DEFAULT_MEDIA_KEYFRAME_EASING } from "@/constants/timeline-constants";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/hooks/use-editor";
import type {
AudioElement,
ImageElement,
MediaKeyframeEasing,
VideoElement,
} from "@/types/timeline";
import {
Section,
SectionContent,
SectionField,
SectionHeader,
SectionTitle,
} from "../section";

const EASING_OPTIONS: Array<{
label: string;
value: MediaKeyframeEasing;
}> = [
{ label: "Linear", value: "linear" },
{ label: "Ease in", value: "ease-in" },
{ label: "Ease out", value: "ease-out" },
{ label: "Ease in-out", value: "ease-in-out" },
];

export function MediaAnimationSection({
element,
trackId,
}: {
element: AudioElement | VideoElement | ImageElement;
trackId: string;
}) {
const editor = useEditor();
const keyframeEasing =
element.keyframeEasing ?? DEFAULT_MEDIA_KEYFRAME_EASING;

return (
<Section collapsible sectionKey={`${element.type}:${element.id}:animation`}>
<SectionHeader>
<SectionTitle>Animation</SectionTitle>
</SectionHeader>
<SectionContent>
<SectionField label="Easing">
<Select
value={keyframeEasing}
onValueChange={(value) => {
editor.timeline.updateElements({
updates: [
{
trackId,
elementId: element.id,
updates: {
keyframeEasing: value as MediaKeyframeEasing,
},
},
],
});
}}
>
<SelectTrigger className="w-full">
<SelectValue />
</SelectTrigger>
<SelectContent>
{EASING_OPTIONS.map((option) => (
<SelectItem key={option.value} value={option.value}>
{option.label}
</SelectItem>
))}
</SelectContent>
</Select>
</SectionField>
</SectionContent>
</Section>
);
}