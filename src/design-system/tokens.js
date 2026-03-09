"use strict";

const TOKENS = Object.freeze({
  color: Object.freeze({
    bg: Object.freeze({
      base: "#f8fafc",
      surface: "#ffffff"
    }),
    text: Object.freeze({
      primary: "#0f172a",
      muted: "#475569",
      inverse: "#ffffff"
    }),
    border: Object.freeze({
      default: "#d1d5db"
    }),
    brand: Object.freeze({
      primary: "#2563eb",
      secondary: "#312e81"
    }),
    state: Object.freeze({
      success: "#059669",
      danger: "#b91c1c"
    })
  }),
  spacing: Object.freeze({
    0: "0px",
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px"
  }),
  radius: Object.freeze({
    sm: "8px",
    md: "10px",
    lg: "16px",
    xl: "18px",
    pill: "999px"
  }),
  shadow: Object.freeze({
    card: "0 25px 45px rgba(15, 23, 42, 0.08)",
    overlay: "0 25px 50px rgba(15, 23, 42, 0.1)",
    focus: "0 0 0 3px rgba(37, 99, 235, 0.35)"
  }),
  typography: Object.freeze({
    fontFamily: Object.freeze({
      base: "Inter, 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    }),
    fontSize: Object.freeze({
      xs: "12px",
      sm: "14px",
      md: "16px",
      lg: "20px",
      xl: "24px"
    }),
    fontWeight: Object.freeze({
      regular: 400,
      semibold: 600,
      bold: 700
    }),
    lineHeight: Object.freeze({
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.7
    })
  }),
  breakpoint: Object.freeze({
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px"
  })
});

const FIGMA_TO_CODE_TOKEN_MAP = Object.freeze([
  { figma: "color/bg/base", code: "color.bg.base", status: "mapped" },
  { figma: "color/bg/surface", code: "color.bg.surface", status: "mapped" },
  { figma: "color/text/primary", code: "color.text.primary", status: "mapped" },
  { figma: "color/text/muted", code: "color.text.muted", status: "mapped" },
  { figma: "color/text/inverse", code: "color.text.inverse", status: "mapped" },
  { figma: "color/border/default", code: "color.border.default", status: "mapped" },
  { figma: "color/brand/primary", code: "color.brand.primary", status: "mapped" },
  { figma: "color/brand/secondary", code: "color.brand.secondary", status: "mapped" },
  { figma: "color/state/success", code: "color.state.success", status: "mapped" },
  { figma: "color/state/danger", code: "color.state.danger", status: "mapped" },
  { figma: "space/0", code: "spacing.0", status: "mapped" },
  { figma: "space/1", code: "spacing.1", status: "mapped" },
  { figma: "space/2", code: "spacing.2", status: "mapped" },
  { figma: "space/3", code: "spacing.3", status: "mapped" },
  { figma: "space/4", code: "spacing.4", status: "mapped" },
  { figma: "space/5", code: "spacing.5", status: "mapped" },
  { figma: "space/6", code: "spacing.6", status: "mapped" },
  { figma: "space/8", code: "spacing.8", status: "mapped" },
  { figma: "space/10", code: "spacing.10", status: "mapped" },
  { figma: "space/12", code: "spacing.12", status: "mapped" },
  { figma: "radius/sm", code: "radius.sm", status: "mapped" },
  { figma: "radius/md", code: "radius.md", status: "mapped" },
  { figma: "radius/lg", code: "radius.lg", status: "mapped" },
  { figma: "radius/xl", code: "radius.xl", status: "mapped" },
  { figma: "radius/pill", code: "radius.pill", status: "mapped" },
  { figma: "shadow/card", code: "shadow.card", status: "mapped" },
  { figma: "shadow/overlay", code: "shadow.overlay", status: "mapped" },
  { figma: "shadow/focus", code: "shadow.focus", status: "mapped" },
  { figma: "typography/font-family/base", code: "typography.fontFamily.base", status: "mapped" },
  { figma: "typography/font-size/xs", code: "typography.fontSize.xs", status: "mapped" },
  { figma: "typography/font-size/sm", code: "typography.fontSize.sm", status: "mapped" },
  { figma: "typography/font-size/md", code: "typography.fontSize.md", status: "mapped" },
  { figma: "typography/font-size/lg", code: "typography.fontSize.lg", status: "mapped" },
  { figma: "typography/font-size/xl", code: "typography.fontSize.xl", status: "mapped" },
  { figma: "typography/font-weight/regular", code: "typography.fontWeight.regular", status: "mapped" },
  { figma: "typography/font-weight/semibold", code: "typography.fontWeight.semibold", status: "mapped" },
  { figma: "typography/font-weight/bold", code: "typography.fontWeight.bold", status: "mapped" },
  { figma: "typography/line-height/tight", code: "typography.lineHeight.tight", status: "mapped" },
  { figma: "typography/line-height/normal", code: "typography.lineHeight.normal", status: "mapped" },
  { figma: "typography/line-height/relaxed", code: "typography.lineHeight.relaxed", status: "mapped" },
  { figma: "breakpoint/sm", code: "breakpoint.sm", status: "mapped" },
  { figma: "breakpoint/md", code: "breakpoint.md", status: "mapped" },
  { figma: "breakpoint/lg", code: "breakpoint.lg", status: "mapped" },
  { figma: "breakpoint/xl", code: "breakpoint.xl", status: "mapped" },
  { figma: "breakpoint/2xl", code: "breakpoint.2xl", status: "mapped" }
]);

function listUnmappedTokens() {
  return FIGMA_TO_CODE_TOKEN_MAP.filter((item) => item.status !== "mapped");
}

module.exports = {
  TOKENS,
  FIGMA_TO_CODE_TOKEN_MAP,
  listUnmappedTokens
};
