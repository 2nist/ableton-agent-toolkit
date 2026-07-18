import type { SectionRole } from "@music-theory/song-structure";

/** A single slot in a narrative structure template: which section role
 *  goes here, and what its dramatic purpose is (the "narrative prompter"
 *  idea from TrackDraft's original docs — a guided prompt per section,
 *  not just a bare role label). This is a fresh design (the original's
 *  actual PEC/Journey template definitions are lost along with its
 *  source), informed only by the "How To Write Songs" Seven-Step
 *  Formula's general shape, not a verified port. */
export interface MapSlot {
  role: SectionRole;
  label: string;
  purpose: string;
}

export interface SongMap {
  id: string;
  name: string;
  description: string;
  slots: MapSlot[];
}

export const SONG_MAPS: SongMap[] = [
  {
    id: "classic-pop",
    name: "Classic Pop",
    description: "Straightforward verse/chorus/bridge form.",
    slots: [
      { role: "intro", label: "Intro", purpose: "Establish the sonic world before any words land." },
      { role: "verse", label: "Verse 1", purpose: "Set the scene — who, where, what's at stake." },
      { role: "chorus", label: "Chorus", purpose: "State the song's central idea, memorably." },
      { role: "verse", label: "Verse 2", purpose: "Deepen or complicate the scene from Verse 1." },
      { role: "chorus", label: "Chorus", purpose: "Restate the central idea, now with more context." },
      { role: "bridge", label: "Bridge", purpose: "Shift perspective or raise the stakes once." },
      { role: "chorus", label: "Chorus", purpose: "Final, most-earned statement of the idea." },
      { role: "outro", label: "Outro", purpose: "Let the idea settle; close the sonic world." },
    ],
  },
  {
    id: "pec",
    name: "PEC (Problem / Explore / Change)",
    description: "A three-act emotional arc mapped onto song form.",
    slots: [
      { role: "verse", label: "Verse 1 — Problem", purpose: "Name the problem or tension driving the song." },
      { role: "chorus", label: "Chorus", purpose: "The problem, stated as a hook." },
      { role: "verse", label: "Verse 2 — Explore", purpose: "Sit inside the problem; explore its texture." },
      { role: "chorus", label: "Chorus", purpose: "Same hook, now with more weight behind it." },
      { role: "bridge", label: "Bridge — Change", purpose: "The turn: a new realization or decision." },
      { role: "chorus", label: "Chorus", purpose: "The hook, recontextualized by the change." },
      { role: "outro", label: "Outro — Resolution", purpose: "Where things land after the change." },
    ],
  },
  {
    id: "journey",
    name: "Journey",
    description: "A departure-and-return narrative arc.",
    slots: [
      { role: "intro", label: "Intro — Departure", purpose: "The world before the journey begins." },
      { role: "verse", label: "Verse 1 — The Call", purpose: "What sets the journey in motion." },
      { role: "chorus", label: "Chorus — Commitment", purpose: "The decision to go." },
      { role: "verse", label: "Verse 2 — Trials", purpose: "Obstacles encountered along the way." },
      { role: "bridge", label: "Bridge — Crisis", purpose: "The lowest or most revealing point." },
      { role: "chorus", label: "Chorus — Return", purpose: "Coming back, changed." },
      { role: "outro", label: "Outro — Transformation", purpose: "Who they are now, having gone." },
    ],
  },
  {
    id: "minimal-loop",
    name: "Minimal / Ambient",
    description: "Long, evolving sections with little formal contrast — for mood pieces.",
    slots: [
      { role: "intro", label: "Section A", purpose: "Establish a texture and let it breathe." },
      { role: "verse", label: "Section B", purpose: "A related but distinct texture." },
      { role: "outro", label: "Section A'", purpose: "Return to A, altered by what came between." },
    ],
  },
];

export function getSongMap(id: string): SongMap | undefined {
  return SONG_MAPS.find((m) => m.id === id);
}
