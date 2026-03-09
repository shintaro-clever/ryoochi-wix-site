"use strict";

const OBSERVABILITY_ALERT_THRESHOLDS = Object.freeze({
  failed_ratio_surge: Object.freeze({
    window_runs: 5,
    min_recent_runs: 3,
    min_baseline_runs: 3,
    warning_failed_rate_pct: 30,
    alert_failed_rate_pct: 50,
    warning_delta_pct: 20,
    alert_delta_pct: 30,
  }),
  fidelity_below_threshold_streak: Object.freeze({
    threshold_score: 95,
    warning_streak: 2,
    alert_streak: 3,
  }),
  confirm_post_failure_rate_spike: Object.freeze({
    window_runs: 4,
    min_recent_runs: 2,
    min_baseline_runs: 2,
    warning_failed_rate_pct: 25,
    alert_failed_rate_pct: 40,
    warning_delta_pct: 15,
    alert_delta_pct: 25,
  }),
});

module.exports = {
  OBSERVABILITY_ALERT_THRESHOLDS,
};
