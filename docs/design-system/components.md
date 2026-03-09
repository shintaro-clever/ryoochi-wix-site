# Component Contract SoT (Phase4)

## Purpose
- Fix component interpretation across Figma, code, and production.
- Reduce implementation drift by standardizing contract vocabulary.

## Contract Fields (Required)
- `variant`: visual or structural alternative intended by design.
- `state`: runtime/interaction state.
- `slot`: named composition area of a component.
- `allowed overrides`: overrideable properties without breaking contract.

## Canonical Source
- Code-side contract SoT: `src/components/contracts.js`
- Fidelity validation reference: `docs/ai/core/fidelity-model.md`

## Component Contracts

### AppShell
- `variant`: `default`, `dense`
- `state`: `default`, `loading`, `error`
- `slot`: `header`, `sidebar`, `content`, `footer`
- `allowed overrides`: `contentMaxWidth`, `sidebarWidth`, `stickyHeader`, `gapScale`

### TopNav
- `variant`: `default`, `compact`
- `state`: `default`, `scrolled`, `menu_open`
- `slot`: `brand`, `primaryNav`, `actions`, `profileMenu`
- `allowed overrides`: `height`, `brandAreaWidth`, `elevation`

### SideNav
- `variant`: `expanded`, `collapsed`
- `state`: `default`, `active_item`, `disabled_item`
- `slot`: `sectionHeader`, `item`, `itemIcon`, `itemLabel`, `footerAction`
- `allowed overrides`: `width`, `itemHeight`, `sectionGap`

### Card
- `variant`: `default`, `elevated`, `outlined`
- `state`: `default`, `hover`, `selected`, `disabled`
- `slot`: `media`, `header`, `body`, `footer`
- `allowed overrides`: `paddingScale`, `radiusToken`, `shadowToken`, `borderToken`

### Button
- `variant`: `primary`, `secondary`, `ghost`, `danger`
- `state`: `default`, `hover`, `active`, `focus`, `disabled`, `loading`
- `slot`: `leadingIcon`, `label`, `trailingIcon`, `spinner`
- `allowed overrides`: `size`, `minWidth`, `iconGap`, `fullWidth`

### InputField
- `variant`: `outlined`, `filled`
- `state`: `default`, `focus`, `error`, `disabled`, `readonly`
- `slot`: `label`, `prefix`, `control`, `suffix`, `helperText`, `errorText`
- `allowed overrides`: `height`, `paddingInline`, `radiusToken`, `validationMode`

### StatusBadge
- `variant`: `info`, `success`, `warning`, `danger`
- `state`: `default`, `subtle`
- `slot`: `dot`, `label`
- `allowed overrides`: `size`, `radiusToken`, `uppercase`

### Modal
- `variant`: `default`, `danger_confirm`, `full_screen`
- `state`: `closed`, `open`, `submitting`
- `slot`: `overlay`, `container`, `header`, `body`, `footer`, `closeButton`
- `allowed overrides`: `width`, `maxHeight`, `closeOnBackdrop`, `footerAlignment`

### DataTable
- `variant`: `default`, `compact`
- `state`: `default`, `loading`, `empty`, `error`
- `slot`: `toolbar`, `headerRow`, `bodyRow`, `cell`, `pagination`
- `allowed overrides`: `rowHeight`, `denseMode`, `stickyHeader`, `stripedRows`

## Figma Component ↔ Code Component Mapping
Status:
- `mapped`: both sides are defined and aligned.
- `unmapped_figma`: code exists but Figma component is not defined.
- `unmapped_code`: Figma exists but code component is not defined.

| Figma component | Code component | Status | Notes |
| --- | --- | --- | --- |
| `Layout/AppShell` | `AppShell` | mapped | Page scaffold/root layout |
| `Navigation/TopNav` | `TopNav` | mapped | Global top navigation |
| `Navigation/SideNav` | `SideNav` | mapped | Project/workspace side navigation |
| `Surface/Card` | `Card` | mapped | Generic panel container |
| `Actions/Button` | `Button` | mapped | Primary/secondary actions |
| `Form/InputField` | `InputField` | mapped | Text-like form control |
| `Feedback/StatusBadge` | `StatusBadge` | mapped | Inline status chip |
| `Overlay/Modal` | `Modal` | mapped | Dialog/overlay container |
| `Data/DataTable` | `DataTable` | mapped | Tabular list view |

## Unmapped Components (Visible List)
Current baseline:
- `unmapped_figma`: none
- `unmapped_code`: none

If either side adds a component without mapping:
1. Add it to `src/components/contracts.js`
2. Add/update this mapping table
3. Record it in this section until mapped
