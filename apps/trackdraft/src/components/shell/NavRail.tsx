import { useState } from "react";
import { NavLink } from "react-router-dom";
import Icon, { type IconName } from "../common/Icon";

/** Every song view, in order. The Library is a VIEW like the others now
 *  (user decision 2026-09-21: "make the library a view and we can have a
 *  narrower tool bar") — the browser lives in the center canvas, so this
 *  rail carries navigation and nothing else. Icons are the shared SVG set
 *  (components/common/Icon), matching the inspector's element icons where
 *  they mean the same thing. */
const VIEWS: { to: string; label: string; icon: IconName; divider?: boolean }[] = [
  { to: "workbench", label: "Workbench β", icon: "workbench" },
  { to: "studio", label: "Studio", icon: "studio" },
  { to: "structure", label: "Structure", icon: "structure" },
  { to: "harmony", label: "Harmony", icon: "harmony" },
  { to: "drums", label: "Drums", icon: "drums" },
  { to: "lyrics", label: "Lyrics", icon: "lyrics" },
  { to: "melody", label: "Melody", icon: "melody" },
  { to: "library", label: "Library", icon: "library" },
  { to: "settings", label: "Settings", icon: "settings", divider: true },
];

/**
 * The NavRail — the shell's LEFT zone: navigation only, and narrow by
 * design (w-32 with labels — the Library view holds what needs width).
 * Views are explicitly coupled to the canvas: clicking one switches the
 * center, and the current view is highlighted wherever you are. The top
 * tab row and the identity header dissolved 2026-09-21 — the spine's chip
 * carries the song identity, and the inspector's facets are purely the
 * focused object's tools.
 *
 * Collapsed (w-9), navigation stays visible as a glyph strip with the
 * current view lit — you never lose where you are.
 */
export default function NavRail() {
  // Minimized by default (user decision 2026-10-24): the canvas gets the
  // width, and the glyph strip still says exactly where you are.
  const [open, setOpen] = useState(false);

  return (
    <aside className={`shrink-0 border-r border-edge bg-panel flex flex-col min-h-0 ${open ? "w-32" : "w-9"}`} aria-label="Views">
      <button
        type="button"
        className="h-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Collapse — views stay visible as icons" : "Expand — views with labels"}
      >
        <Icon name={open ? "chevron-left" : "chevron-right"} size={13} />
      </button>

      {open ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
          <div className="space-y-0.5">
            {VIEWS.map((v) => (
              <div key={v.to}>
                {v.divider && <div className="my-1 border-t border-edge/60" />}
                <NavLink
                  to={v.to}
                  title={`Go to ${v.label}`}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-1.5 py-1 rounded text-xs ${
                      isActive
                        ? "nav-on bg-panelAlt text-ink"
                        : "text-inkMuted hover:text-ink hover:bg-panelAlt/60"
                    }`
                  }
                >
                  <Icon name={v.icon} />
                  <span className="truncate">{v.label}</span>
                </NavLink>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {VIEWS.map((v) => (
            <div key={v.to}>
              {v.divider && <div className="w-6 my-1 border-t border-edge/60" />}
              <NavLink
                to={v.to}
                title={v.label}
                className={({ isActive }) =>
                  `w-9 h-8 flex items-center justify-center ${
                    isActive ? "text-accent bg-panelAlt" : "text-inkMuted hover:text-ink"
                  }`
                }
              >
                <Icon name={v.icon} size={16} />
              </NavLink>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
