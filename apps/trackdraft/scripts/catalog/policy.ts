/**
 * What goes into a pack, and on whose authority.
 *
 * Two profiles, one policy function:
 *
 * - `release` — only songs the manifest calls `cleared`, or which the
 *   allowlist names with an explicit attestation. This is the default and the
 *   only profile that may be distributed.
 * - `internal` — everything, for early test builds. It is deliberately
 *   awkward to invoke (it requires an acknowledgement flag) and stamps every
 *   artifact it produces as not-for-distribution, because the material in a
 *   research library is not ours to hand out.
 *
 * Pure: no fs, no console. The CLI decides what to do with the result; the
 * tests pin the policy itself.
 */

import type { CatalogManifest, ManifestSong } from "./manifest";

export type PackProfile = "release" | "internal";

export interface AllowlistEntry {
  songId: string;
  /** Explicit claim, by the packager, that they hold the rights. */
  attested?: boolean;
  note?: string;
}

export interface PackRequest {
  profile: PackProfile;
  /** `release` ignores this; `internal` refuses without it. */
  acknowledgedRestricted: boolean;
}

export interface PackSelection {
  profile: PackProfile;
  /** True only for a release with no violations. Always false for `internal`. */
  distributable: boolean;
  selected: ManifestSong[];
  excluded: ManifestSong[];
  /** Song ids shipping on an attestation rather than a cleared licence class. */
  attested: string[];
  /** Anything that must stop the pack from being written. */
  violations: string[];
  /** True when an `internal` pack contains restricted material. */
  containsRestricted: boolean;
}

/** Song ids in the allowlist that the manifest does not know about. */
function unknownAllowlistIds(allowlist: AllowlistEntry[], manifest: CatalogManifest): string[] {
  const known = new Set(manifest.songs.map((song) => song.songId));
  return allowlist.filter((entry) => !known.has(entry.songId)).map((entry) => entry.songId);
}

export function selectForPack(
  manifest: CatalogManifest,
  allowlist: AllowlistEntry[],
  request: PackRequest,
): PackSelection {
  const violations: string[] = [];
  for (const id of unknownAllowlistIds(allowlist, manifest)) {
    violations.push(`allowlist names "${id}", which is not in the manifest`);
  }

  const byId = new Map(manifest.songs.map((song) => [song.songId, song]));

  if (request.profile === "internal") {
    if (!request.acknowledgedRestricted) {
      violations.push(
        'the "internal" profile includes restricted material and requires --acknowledge-restricted',
      );
    }
    const selected = [...manifest.songs];
    return {
      profile: "internal",
      distributable: false,
      selected,
      excluded: [],
      attested: [],
      violations,
      containsRestricted: selected.some((song) => !song.redistributable),
    };
  }

  const attested: string[] = [];
  for (const entry of allowlist) {
    const song = byId.get(entry.songId);
    if (!song) continue; // already reported as an unknown id
    if (song.redistributable) continue; // cleared by class — no attestation needed
    if (entry.attested !== true) {
      violations.push(
        `allowlist names "${entry.songId}" (licence: ${song.licence}) without "attested": true — ` +
          "either drop it or state, explicitly, that you hold the rights",
      );
      continue;
    }
    attested.push(entry.songId);
  }

  const attestedSet = new Set(attested);
  const selected = manifest.songs.filter(
    (song) => song.redistributable || attestedSet.has(song.songId),
  );
  const selectedIds = new Set(selected.map((song) => song.songId));

  /* Defence in depth: re-assert the invariant on the final set rather than
   * trusting the filter above. */
  for (const song of selected) {
    const clearedByClass = song.redistributable && song.licence === "cleared";
    if (!clearedByClass && !attestedSet.has(song.songId)) {
      violations.push(`internal: "${song.songId}" (${song.licence}) was selected without clearance`);
    }
  }

  return {
    profile: "release",
    distributable: violations.length === 0,
    selected,
    excluded: manifest.songs.filter((song) => !selectedIds.has(song.songId)),
    attested: [...attested].sort(),
    violations,
    containsRestricted: selected.some((song) => !song.redistributable),
  };
}

/** Counts by licence class, for the pack's own manifest. */
export function tallyByLicence(songs: ManifestSong[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const song of songs) counts[song.licence] = (counts[song.licence] ?? 0) + 1;
  return counts;
}
