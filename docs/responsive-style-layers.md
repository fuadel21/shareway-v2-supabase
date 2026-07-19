# Responsive style layers

ShareWay keeps small, isolated CSS layers for UI polish that should not touch React logic or Supabase behavior.

## Load order

The current style order in `src/main.jsx` is intentional:

1. `index.css`
   - Global Tailwind and base app styles.
2. `i18n/rtl.css`
   - Directional overrides for right-to-left languages.
3. `styles/mobile-navigation-polish.css`
   - Bottom navigation and mobile header/safe-area refinements.
4. `styles/mobile-accessibility-touch-polish.css`
   - Focus, touch, reduced-motion and scroll refinements for mobile.
5. `styles/responsive-tablet-desktop-polish.css`
   - Tablet and desktop layout spacing refinements.
6. `styles/visual-performance-motion-polish.css`
   - Rendering, motion and visual performance refinements.
7. `i18n/config`
   - Runtime i18n setup.

## Maintenance rules

- Keep CSS polish isolated in `src/styles/` when the change is cross-cutting.
- Prefer component-native classes for feature logic and permanent layouts.
- Do not use CSS layers to hide broken business logic.
- Avoid broad selectors unless the goal is a safe responsive polish layer.
- Add comments when selectors intentionally target Tailwind class patterns.
- When a CSS layer becomes too large, split it by purpose instead of editing `App.css` further.

## Safe change checklist

Before opening a PR:

- Confirm the new CSS file is imported in `src/main.jsx`.
- Confirm the import order keeps global styles before polish layers.
- Keep the PR body clear about whether SQL is required.
- Avoid touching Supabase, routes or service files for visual-only PRs.
