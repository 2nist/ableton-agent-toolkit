import type { BlueprintSection } from "../../../types/blueprint";
import BassSettings from "../BassSettings";
import ColorSettings from "../ColorSettings";

export interface VoicesLaneProps {
  section: BlueprintSection;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
}

/**
 * The foot band's second tab: the section's two derived voices.
 *
 * These are NOT per chord — `bassProfile` and the colour settings shape the
 * generated bass and colour layers for the whole section — so they belong in
 * their own tab rather than in the effects lane's time axis, where a chip
 * under one chord would imply it only applied to that chord.
 *
 * Same components the inspector rail uses, so there is one definition of what
 * a bass register or a colour flavour means.
 */
export default function VoicesLane({ section, onChange }: VoicesLaneProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto px-3 pb-2 sm:grid-cols-2">
      <div className="min-w-0">
        <BassSettings section={section} onChange={onChange} />
      </div>
      <div className="min-w-0">
        <ColorSettings section={section} onChange={onChange} />
      </div>
    </div>
  );
}
