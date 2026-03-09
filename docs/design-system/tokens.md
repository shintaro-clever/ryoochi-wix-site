# Design Token SoT (Phase4)

## Purpose
- Fix the canonical token set to reduce drift across Figma, code, and production.
- Use this document as the SoT for token naming and mapping.

## Minimum Token Scope (Required)
- `color`
- `spacing`
- `radius`
- `shadow`
- `typography`
- `breakpoint`

## Canonical Code Tokens
Code-side canonical names are defined in `src/design-system/tokens.js`.

## Figma Variable ↔ Code Token Mapping
Status:
- `mapped`: Figma variable name and code token are both defined.
- `unmapped_figma`: expected Figma variable is not defined yet.
- `unmapped_code`: code token is planned but not available yet.

| Category | Figma variable name | Code token name | Status | Notes |
| --- | --- | --- | --- | --- |
| color | `color/bg/base` | `color.bg.base` | mapped | Base page background |
| color | `color/bg/surface` | `color.bg.surface` | mapped | Card/surface background |
| color | `color/text/primary` | `color.text.primary` | mapped | Primary text |
| color | `color/text/muted` | `color.text.muted` | mapped | Secondary text |
| color | `color/text/inverse` | `color.text.inverse` | mapped | Text on dark/brand bg |
| color | `color/border/default` | `color.border.default` | mapped | Default border |
| color | `color/brand/primary` | `color.brand.primary` | mapped | Primary action |
| color | `color/brand/secondary` | `color.brand.secondary` | mapped | Secondary accent |
| color | `color/state/success` | `color.state.success` | mapped | Success badge/button |
| color | `color/state/danger` | `color.state.danger` | mapped | Error/danger |
| spacing | `space/0` | `spacing.0` | mapped | `0px` |
| spacing | `space/1` | `spacing.1` | mapped | `4px` |
| spacing | `space/2` | `spacing.2` | mapped | `8px` |
| spacing | `space/3` | `spacing.3` | mapped | `12px` |
| spacing | `space/4` | `spacing.4` | mapped | `16px` |
| spacing | `space/5` | `spacing.5` | mapped | `20px` |
| spacing | `space/6` | `spacing.6` | mapped | `24px` |
| spacing | `space/8` | `spacing.8` | mapped | `32px` |
| spacing | `space/10` | `spacing.10` | mapped | `40px` |
| spacing | `space/12` | `spacing.12` | mapped | `48px` |
| radius | `radius/sm` | `radius.sm` | mapped | Small controls |
| radius | `radius/md` | `radius.md` | mapped | Input/button |
| radius | `radius/lg` | `radius.lg` | mapped | Card/container |
| radius | `radius/xl` | `radius.xl` | mapped | Emphasized container |
| radius | `radius/pill` | `radius.pill` | mapped | Pill badge/button |
| shadow | `shadow/card` | `shadow.card` | mapped | Card depth |
| shadow | `shadow/overlay` | `shadow.overlay` | mapped | Modal/popover |
| shadow | `shadow/focus` | `shadow.focus` | mapped | Focus ring-like shadow |
| typography | `typography/font-family/base` | `typography.fontFamily.base` | mapped | App base font family |
| typography | `typography/font-size/xs` | `typography.fontSize.xs` | mapped | `12px` |
| typography | `typography/font-size/sm` | `typography.fontSize.sm` | mapped | `14px` |
| typography | `typography/font-size/md` | `typography.fontSize.md` | mapped | `16px` |
| typography | `typography/font-size/lg` | `typography.fontSize.lg` | mapped | `20px` |
| typography | `typography/font-size/xl` | `typography.fontSize.xl` | mapped | `24px` |
| typography | `typography/font-weight/regular` | `typography.fontWeight.regular` | mapped | 400 |
| typography | `typography/font-weight/semibold` | `typography.fontWeight.semibold` | mapped | 600 |
| typography | `typography/font-weight/bold` | `typography.fontWeight.bold` | mapped | 700 |
| typography | `typography/line-height/tight` | `typography.lineHeight.tight` | mapped | 1.25 |
| typography | `typography/line-height/normal` | `typography.lineHeight.normal` | mapped | 1.5 |
| typography | `typography/line-height/relaxed` | `typography.lineHeight.relaxed` | mapped | 1.7 |
| breakpoint | `breakpoint/sm` | `breakpoint.sm` | mapped | `640px` |
| breakpoint | `breakpoint/md` | `breakpoint.md` | mapped | `768px` |
| breakpoint | `breakpoint/lg` | `breakpoint.lg` | mapped | `1024px` |
| breakpoint | `breakpoint/xl` | `breakpoint.xl` | mapped | `1280px` |
| breakpoint | `breakpoint/2xl` | `breakpoint.2xl` | mapped | `1536px` |

## Unmapped Tokens (Visible List)
Current baseline:
- `unmapped_figma`: none
- `unmapped_code`: none

When adding tokens, update both:
1. `src/design-system/tokens.js`
2. This mapping table

Any token present only on one side must be added to this section before Phase4 review can pass.
