// Deterministic evidence checks that run BEFORE the AI sees anything.
// They catch the cheap fraud: reused photos, old photos, photos from the wrong place, edited files.
import crypto from "node:crypto";
import exifr from "exifr";

export async function inspectFile(buffer, mimetype) {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  let meta = {};
  if (mimetype.startsWith("image/")) {
    try {
      const exif = await exifr.parse(buffer, { gps: true, tiff: true, exif: true });
      if (exif) {
        const taken = exif.DateTimeOriginal || exif.CreateDate || null;
        meta = {
          takenAt: taken instanceof Date && !isNaN(taken) ? taken.toISOString() : null,
          lat: typeof exif.latitude === "number" ? exif.latitude : null,
          lng: typeof exif.longitude === "number" ? exif.longitude : null,
          camera: [exif.Make, exif.Model].filter(Boolean).join(" ") || null,
          software: exif.Software || null,
        };
      }
    } catch {
      // Unreadable metadata is reported as "no metadata", never as an error.
    }
  }
  return { sha256, meta };
}

function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|facetune|canva|midjourney|dall|stable diffusion|firefly/i;

/**
 * Flags have a severity: "high" blocks automatic release, "medium" is shown to the AI and reviewer,
 * "info" is context only.
 */
export function runTrustChecks({ files, project, hashIndex, milestoneId }) {
  const flags = [];
  const startedAt = new Date(project.fundedAt || project.createdAt);

  for (const f of files) {
    const seen = hashIndex[f.sha256];
    if (seen && !(seen.projectId === project.id && seen.milestoneId === milestoneId)) {
      flags.push({
        severity: "high",
        code: "duplicate_evidence",
        file: f.name,
        message: `"${f.name}" is byte-identical to evidence already used ${
          seen.projectId === project.id ? "for another milestone in this project" : "in a different project"
        }.`,
      });
    }

    if (!f.mime.startsWith("image/")) continue;
    const m = f.meta || {};

    if (!m.takenAt) {
      flags.push({
        severity: "info",
        code: "no_capture_time",
        file: f.name,
        message: `"${f.name}" has no capture timestamp. Screenshots and messaging-app photos often strip it.`,
      });
    } else if (new Date(m.takenAt) < new Date(startedAt.getTime() - 24 * 3600 * 1000)) {
      flags.push({
        severity: "high",
        code: "taken_before_start",
        file: f.name,
        message: `"${f.name}" was captured on ${m.takenAt.slice(0, 10)}, before this agreement started (${startedAt
          .toISOString()
          .slice(0, 10)}).`,
      });
    }

    if (m.software && EDITORS.test(m.software)) {
      flags.push({
        severity: "medium",
        code: "edited_file",
        file: f.name,
        message: `"${f.name}" was last saved by "${m.software}". It may have been edited or generated.`,
      });
    }

    if (m.lat != null && m.lng != null && project.siteLocation) {
      const km = distanceKm(project.siteLocation, { lat: m.lat, lng: m.lng });
      if (km > 2) {
        flags.push({
          severity: "high",
          code: "location_mismatch",
          file: f.name,
          message: `"${f.name}" was taken ${km.toFixed(1)} km from where earlier verified evidence was captured.`,
        });
      }
    }
  }
  return { flags };
}
