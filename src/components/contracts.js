"use strict";

const COMPONENT_CONTRACTS = Object.freeze({
  AppShell: Object.freeze({
    variants: ["default", "dense"],
    states: ["default", "loading", "error"],
    slots: ["header", "sidebar", "content", "footer"],
    allowedOverrides: ["contentMaxWidth", "sidebarWidth", "stickyHeader", "gapScale"]
  }),
  TopNav: Object.freeze({
    variants: ["default", "compact"],
    states: ["default", "scrolled", "menu_open"],
    slots: ["brand", "primaryNav", "actions", "profileMenu"],
    allowedOverrides: ["height", "brandAreaWidth", "elevation"]
  }),
  SideNav: Object.freeze({
    variants: ["expanded", "collapsed"],
    states: ["default", "active_item", "disabled_item"],
    slots: ["sectionHeader", "item", "itemIcon", "itemLabel", "footerAction"],
    allowedOverrides: ["width", "itemHeight", "sectionGap"]
  }),
  Card: Object.freeze({
    variants: ["default", "elevated", "outlined"],
    states: ["default", "hover", "selected", "disabled"],
    slots: ["media", "header", "body", "footer"],
    allowedOverrides: ["paddingScale", "radiusToken", "shadowToken", "borderToken"]
  }),
  Button: Object.freeze({
    variants: ["primary", "secondary", "ghost", "danger"],
    states: ["default", "hover", "active", "focus", "disabled", "loading"],
    slots: ["leadingIcon", "label", "trailingIcon", "spinner"],
    allowedOverrides: ["size", "minWidth", "iconGap", "fullWidth"]
  }),
  InputField: Object.freeze({
    variants: ["outlined", "filled"],
    states: ["default", "focus", "error", "disabled", "readonly"],
    slots: ["label", "prefix", "control", "suffix", "helperText", "errorText"],
    allowedOverrides: ["height", "paddingInline", "radiusToken", "validationMode"]
  }),
  StatusBadge: Object.freeze({
    variants: ["info", "success", "warning", "danger"],
    states: ["default", "subtle"],
    slots: ["dot", "label"],
    allowedOverrides: ["size", "radiusToken", "uppercase"]
  }),
  Modal: Object.freeze({
    variants: ["default", "danger_confirm", "full_screen"],
    states: ["closed", "open", "submitting"],
    slots: ["overlay", "container", "header", "body", "footer", "closeButton"],
    allowedOverrides: ["width", "maxHeight", "closeOnBackdrop", "footerAlignment"]
  }),
  DataTable: Object.freeze({
    variants: ["default", "compact"],
    states: ["default", "loading", "empty", "error"],
    slots: ["toolbar", "headerRow", "bodyRow", "cell", "pagination"],
    allowedOverrides: ["rowHeight", "denseMode", "stickyHeader", "stripedRows"]
  })
});

const FIGMA_TO_CODE_COMPONENT_MAP = Object.freeze([
  { figma: "Layout/AppShell", code: "AppShell", status: "mapped" },
  { figma: "Navigation/TopNav", code: "TopNav", status: "mapped" },
  { figma: "Navigation/SideNav", code: "SideNav", status: "mapped" },
  { figma: "Surface/Card", code: "Card", status: "mapped" },
  { figma: "Actions/Button", code: "Button", status: "mapped" },
  { figma: "Form/InputField", code: "InputField", status: "mapped" },
  { figma: "Feedback/StatusBadge", code: "StatusBadge", status: "mapped" },
  { figma: "Overlay/Modal", code: "Modal", status: "mapped" },
  { figma: "Data/DataTable", code: "DataTable", status: "mapped" }
]);

function listUnmappedComponents() {
  return FIGMA_TO_CODE_COMPONENT_MAP.filter((item) => item.status !== "mapped");
}

module.exports = {
  COMPONENT_CONTRACTS,
  FIGMA_TO_CODE_COMPONENT_MAP,
  listUnmappedComponents
};
