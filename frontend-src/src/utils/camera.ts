// Shared camera diagnostics.
//
// Both camera components used to decide what went wrong by substring-matching
// err.message ("NotAllowed", "Permission"). The name is in err.name, and
// Safari's message text ("The request is not allowed by the user agent or the
// platform in the current context.") matches neither, so on iOS every failure
// fell through to a generic "could not access camera" that told the user
// nothing about the actual cause.

import { t } from "../i18n";

// Why the live camera cannot even be attempted, or "" when it can be.
//
// Over plain http:// the page is not a secure context and the browser does not
// expose navigator.mediaDevices at all — calling getUserMedia throws a
// TypeError that reads like a mysterious failure. There is no code-side fix
// for that, so the honest move is to say it up front and point at the device's
// own camera, which needs no secure context.
export function cameraBlockedReason(language?: string): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return t("ui.camera.blockedInsecure", language);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return t("ui.camera.notOffered", language);
  }
  return "";
}

// A getUserMedia failure, in words that suggest what to do about it.
export function describeCameraError(err: any, language?: string): string {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return t("ui.camera.accessDenied", language);
    case "NotFoundError":
    case "OverconstrainedError":
      return t("ui.camera.notFound", language);
    case "NotReadableError":
    case "AbortError":
      return t("ui.camera.busy", language);
    default:
      return t("ui.camera.genericError", language, {
        detail: err?.name ? ` (${err.name})` : "",
      });
  }
}
