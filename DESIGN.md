# Seedexchange design system

The visual direction remains **Botanical Archive**: calm, editorial, botanical and evidence-led. The interface should feel like a living accession record rather than a generic marketplace.

## Core tokens

- Forest ink: `#18352a`; dark surfaces: `#173d2d`; deepest surface: `#0d2c20`.
- Canvas: `#f3f0e6`; paper: `#fbf8ef`; surface: `#fffdf7`.
- Primary leaf: `#316b4d`; hover leaf: `#21543b`; editorial ochre: `#a8742a`.
- Muted text: `#647168`; line: `#d7d9cc`; danger: `#9f352e`.
- Display type: Fraunces with Georgia fallback. UI/body: Manrope with Avenir Next or Segoe UI fallback. Metadata: IBM Plex Mono.

The implemented CSS variables in `public/assets/app.css` are the code-level source. Update this document whenever a reusable visual rule changes.

## Required separation

1. Content and data are supplied by content modules and PostgreSQL read models.
2. Routes select view models; EJS templates provide semantic structure.
3. Shared presentation belongs in `public/assets/app.css`; behavior belongs in `public/assets/app.js`.

Content changes must not require CSS edits. Design changes must not alter transactional state. Do not place product data, shipping rules, payment calculations or database queries in templates.

## Interface rules

- Use one clear primary action per major section.
- Minimum interactive target is 44px; keyboard focus must always be visible.
- Labels are explicit; placeholder text is not a label. Status is never communicated by color alone.
- Public product imagery must come from the seller or use a neutral placeholder. Generated product images must not misrepresent species or packets.
- Avoid invented metrics, placeholder organizations, stock trust signals, emojis, neon effects and generic gradients.
- Use cards only for independently actionable objects; use divided lists for dense records.
- Administration can be denser, but it retains the same tokens, accessibility and responsive behavior.

## Responsive and accessibility checks

Verify 375px, 768px and 1440px widths, no horizontal scrolling, useful alt text, semantic controls, visible focus, reduced-motion support and WCAG AA contrast. Use `100dvh` rather than `100vh` for viewport-height layouts.
