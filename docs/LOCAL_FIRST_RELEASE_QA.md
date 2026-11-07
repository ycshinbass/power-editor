# Local-first release verification — 2026-11-01

## Implemented
- Four top groups: observations/air, weather warnings, disaster, outage reporting; nationwide daily flow second; news third.
- Mandatory explicit initial region confirmation. Existing selected regions retained as draft; multiple regions and explicit nationwide choice supported. Removing all selected cities does not implicitly select nationwide.
- Clickable official-list details; successful scoped zero distinct from failed/stale/unknown; flood-history, road-weather, boundary detail entry points appear only for successfully matched current relevant warnings. Missing connectors remain labelled 미연동.
- Fixed 00–24 KST chart with validated fuel composition only, prior total dashed, unfilled gaps/future, independently timestamped supply reserve %. No synthetic production series.
- Local-data endpoint gives per-domain dependency states. Credential-ready gated supply/generation connectors require verified units/contracts and shared D1 quota before any official-key request.

## Checked
- Node unit suite, generated Worker syntax, production build and artifact validation.
- Cloud managed preview desktop: retained former six-city preferences, explicit two-city selection, nationwide switch, detail modals, nationwide warning vs selected-region zero, fire/landslide public-list zero.
- Initial live preview fetched existing public sources; repeated preview was stopped by auto-review to prevent duplicate weather-provider requests. No bypass or additional live weather call. Remaining UI testing used the existing review-fixture mode which intercepts all /api calls locally (fixtures excluded from Worker artifact).
- Fixture-only browser: relevant rain warning reveals three conditional detail links; historical flood detail explicitly not live risk; missing earthquake/outage/current observation connections do not show zero.
- Fixture-only responsive checks: desktop, 390px and 320px; DOM body width/scrollWidth both 320 at smallest width, no horizontal overflow.
- Explicit nationwide deselection disables Apply; choosing Yeosu and Suncheon enables Apply and preserves two-region selection.
- Preview stopped and package dev command restored before packaging. No push subscription, test notification, dispatch, credentials or visibility changes.

## Not claimed complete
Authenticated live provider tests are blocked by missing secure credential transfer. Current observations, air, earthquake, CCTV road weather, flood imagery and administrative map adapters are status scaffolding, not live collectors. Supply/generation require live contract verification before enabling. Historical date archive is unavailable and never relabels today's series. Regional outage licensed collection is absent. Existing regional-news shortage remains visible; no invented articles. Fire/landslide nonempty geographic detail remains unverified. Emergency real-time collection is not implemented.
