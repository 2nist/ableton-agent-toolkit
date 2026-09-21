/**
 * Bend — the app-side surface for the shared style layer in `@drum/library`.
 *
 * A thin domain barrel: the actual resolution (`resolveStyleProfile`),
 * deterministic seed, and note transforms live in `@drum/library` so the
 * web app and the Ableton bridge resolve a bend IDENTICALLY (parity is a
 * test). App code imports from here — not from `@drum/library` directly —
 * so the style domain has one import path and the Phase D Studio panel
 * stays tidy.
 */
export {
  DEFAULT_STYLE_PROFILE,
  STYLE_RECIPES,
  applyStyleToVariant,
  bassProfileFromBend,
  hasBend,
  resolveBassProfile,
  resolveStyleProfile,
  styleArticulation,
  styleBackbeat,
  styleFeel,
  styleMelodyLine,
  styleProfileToEngineTargets,
  styleQualityFor,
  styleSeed,
  styleTension,
  velocityScaleFor,
  type BendArticulationEffect,
  type StyleProfile,
  type StyleTargets,
} from "@drum/library";
