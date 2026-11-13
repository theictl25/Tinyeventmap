/**
 * Map layout data module.
 *
 * This module is deliberately independent from the Manager UI. It owns the
 * default map, validates saved data, and provides one in-memory active layout.
 * The element field names are kept compatible with Google Sheets / Apps Script.
 */

export const MAP_SETTINGS_KEY = "eventmap_map_layout_v2";
export const DEFAULT_MAP_WIDTH = 800;
export const DEFAULT_MAP_HEIGHT = 900;
export const ELEMENT_SHAPES = ["rectangle", "circle", "triangle", "hexagon"];
export const DEFAULT_ZONE_COLORS = {
  A: "#ffebee",
  B: "#fff5cc",
  C: "#eaf7ed",
  D: "#e1f2ff",
};
export const DEFAULT_NEW_ZONE_COLOR = "#e9d5ff";
const MAX_EMBEDDED_BACKGROUND_LENGTH = 16000;

export const ELEMENT_TYPES = {
  booth: { color: "#ffebee", width: 70, height: 48 },
  walkway: { color: "#f1f5f9", width: 220, height: 45 },
  // New walkways are drawn with the Path Editor. The older rectangular
  // `walkway` type remains supported so saved event maps stay compatible.
  path: { color: "#f1f5f9", width: 200, height: 40 },
  entrance: { color: "#dcfce7", width: 90, height: 42 },
  exit: { color: "#ffe4e6", width: 90, height: 42 },
  tree: { color: "#2A7E19", width: 44, height: 44 },
  stage: { color: "#dbeafe", width: 220, height: 75 },
  label: { color: "#fef3c7", width: 140, height: 36 },
  icon: { color: "#ffffff", width: 64, height: 64 },
  other: { color: "#e9d5ff", width: 90, height: 55 },
};

/**
 * Creates the original demonstration booths. It is used only when there is
 * no saved map layout yet; it never overwrites an existing map.
 */
export function defaultBoothLayouts() {
  const booths = [];

  ["A", "B", "C"].forEach((zone, zoneIndex) => {
    for (let number = 1; number <= 12; number += 1) {
      const boothIndex = number - 1;
      const id = zone + String(number).padStart(2, "0");

      booths.push({
        id,
        type: "booth",
        boothId: id,
        zone,
        x: 145 + zoneIndex * 210 + (boothIndex % 2) * 70,
        y:
          300 +
          Math.floor(boothIndex / 4) * 145 +
          Math.floor((boothIndex % 4) / 2) * 50,
        width: 64,
        height: 44,
        color: "#ffebee",
      });
    }
  });

  for (let number = 1; number <= 6; number += 1) {
    const id = "D" + String(number).padStart(2, "0");
    booths.push({
      id,
      type: "booth",
      boothId: id,
      zone: "D",
      x: 155 + (number - 1) * 78,
      y: 175,
      width: 64,
      height: 44,
      color: "#ffebee",
    });
  }

  return booths;
}

/**
 * Returns a complete new layout object. Callers can safely edit it because
 * each call creates fresh objects and arrays.
 */
export function defaultMapLayout() {
  return {
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    gridSize: 5,
    zoneColors: { ...DEFAULT_ZONE_COLORS },
    elements: [
      {
        id: "stage-1",
        type: "stage",
        label_lo: "ເວທີຫຼັກ",
        label_en: "MAIN STAGE",
        x: 290,
        y: 35,
        width: 220,
        height: 70,
        color: "#dbeafe",
      },
      {
        id: "walkway-1",
        type: "walkway",
        x: 80,
        y: 760,
        width: 640,
        height: 30,
        color: "#f1f5f9",
      },
      {
        id: "entrance-1",
        type: "entrance",
        label_lo: "ທາງເຂົ້າ",
        label_en: "Entrance",
        x: 210,
        y: 830,
        width: 90,
        height: 42,
        color: "#dcfce7",
      },
      {
        id: "exit-1",
        type: "exit",
        label_lo: "ທາງອອກ",
        label_en: "Exit",
        x: 500,
        y: 830,
        width: 90,
        height: 42,
        color: "#ffe4e6",
      },
      ...defaultBoothLayouts(),
    ],
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function normalizeBackgroundImage(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(source)) {
    return source.length <= MAX_EMBEDDED_BACKGROUND_LENGTH ? source : "";
  }
  if (source.length > 2048) return "";
  try {
    const url = new URL(source);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeZoneColors(sourceColors, elements) {
  const colors = { ...DEFAULT_ZONE_COLORS };
  Object.entries(sourceColors || {}).forEach(([zone, color]) => {
    const key = String(zone).trim().toUpperCase();
    if (
      /^[A-Z0-9_-]{1,24}$/.test(key) &&
      /^#[0-9a-f]{6}$/i.test(String(color))
    ) {
      colors[key] = String(color);
    }
  });
  elements.forEach((element) => {
    if (element.type !== "booth") return;
    const zone = element.zone.trim().toUpperCase();
    if (/^[A-Z0-9_-]{1,24}$/.test(zone) && !colors[zone]) {
      colors[zone] = DEFAULT_NEW_ZONE_COLOR;
    }
  });
  return colors;
}

function normalizePathPoints(points, fallback, width, height) {
  const source = Array.isArray(points) ? points : [];
  const normalized = source
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (normalized.length >= 2) return normalized;
  return [
    { x: fallback.x, y: fallback.y + height / 2 },
    { x: fallback.x + width, y: fallback.y + height / 2 },
  ];
}

function pathBounds(points, fallback) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
    ...fallback,
  };
}

export function cleanIconId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

// รหัสไอคอน -> URL รูปจาก Drive (ไม่ได้เก็บในชีต MapLayout)
let iconImages = {};
export function setIconImages(map) {
  iconImages = {};
  if (!map || typeof map !== "object") return;
  Object.entries(map).forEach(([key, value]) => {
    const url = String(value || "");
    if (/^https:\/\//i.test(url)) iconImages[cleanIconId(key)] = url;
  });
}
export function getIconImages() {
  return iconImages;
}

/**
 * Makes an individual element safe for rendering without changing its
 * external schema. Unknown element types become "other".
 */
function normalizeElement(element, index) {
  const type = ELEMENT_TYPES[element?.type] ? element.type : "other";
  const defaults = ELEMENT_TYPES[type];

  const fallback = {
    x: Math.max(0, Number(element?.x) || 0),
    y: Math.max(0, Number(element?.y) || 0),
  };
  const width = positiveNumber(element?.width, defaults.width);
  const height = positiveNumber(element?.height, defaults.height);
  const points =
    type === "path"
      ? normalizePathPoints(element?.points, fallback, width, height)
      : undefined;
  const bounds = type === "path" ? pathBounds(points, {}) : {};

  return {
    id: String(element?.id || type + "-" + (index + 1)),
    type,
    boothId: String(element?.boothId || ""),
    zone: String(element?.zone || ""),
    label_lo: String(element?.label_lo || ""),
    label_en: String(element?.label_en || ""),
    x: type === "path" ? bounds.x : fallback.x,
    y: type === "path" ? bounds.y : fallback.y,
    width: type === "path" ? bounds.width : width,
    height: type === "path" ? bounds.height : height,
    color: String(element?.color || defaults.color),
    fontSize: Math.min(72, Math.max(6, positiveNumber(element?.fontSize, 12))),
    textColor: /^#[0-9a-f]{6}$/i.test(String(element?.textColor || ""))
      ? String(element.textColor)
      : type === "booth"
        ? "#425066"
        : "#334155",
    shape: ELEMENT_SHAPES.includes(element?.shape)
      ? element.shape
      : "rectangle",
    rotation: normalizeRotation(element?.rotation),
    ...(type === "icon" ? { iconId: cleanIconId(element?.iconId) } : {}),
    ...(type === "path"
      ? {
          points,
          pathWidth: Math.min(
            120,
            Math.max(4, positiveNumber(element?.pathWidth, 28)),
          ),
        }
      : {}),
  };
}

/**
 * Accepts data from localStorage, Apps Script, or the Manager and always
 * returns a renderable layout with the current element schema.
 */
export function normalizeMapLayout(value) {
  const fallback = defaultMapLayout();
  const source = value && typeof value === "object" ? value : fallback;
  const elements = Array.isArray(source.elements)
    ? source.elements
    : fallback.elements;
  const normalizedElements = elements.map(normalizeElement);

  return {
    width: positiveNumber(source.width, fallback.width),
    height: positiveNumber(source.height, fallback.height),
    gridSize: positiveNumber(source.gridSize, fallback.gridSize),
    backgroundImage: normalizeBackgroundImage(source.backgroundImage),
    backgroundOpacity: Math.min(
      1,
      Math.max(
        0,
        Number.isFinite(Number(source.backgroundOpacity))
          ? Number(source.backgroundOpacity)
          : 0.35,
      ),
    ),
    backgroundLocked: source.backgroundLocked !== false,
    zoneColors: normalizeZoneColors(source?.zoneColors, normalizedElements),
    elements: normalizedElements,
  };
}

function readLocalLayout() {
  try {
    return normalizeMapLayout(
      JSON.parse(localStorage.getItem(MAP_SETTINGS_KEY) || "null"),
    );
  } catch {
    return defaultMapLayout();
  }
}

let activeLayout = readLocalLayout();

export function getMapLayout() {
  return activeLayout;
}

export function compactMapLayout(layout) {
  const normalized = normalizeMapLayout(layout);
  return {
    width: normalized.width,
    height: normalized.height,
    gridSize: normalized.gridSize,
    backgroundImage: normalized.backgroundImage,
    backgroundOpacity: normalized.backgroundOpacity,
    backgroundLocked: normalized.backgroundLocked,
    zoneColors: normalized.zoneColors,
    elements: normalized.elements.map((el) => {
      const item = { id: el.id, type: el.type };
      if (el.boothId) item.boothId = el.boothId;
      if (el.zone) item.zone = el.zone;
      if (el.label_lo) item.label_lo = el.label_lo;
      if (el.label_en) item.label_en = el.label_en;
      item.x = Math.round(Number(el.x) * 10) / 10;
      item.y = Math.round(Number(el.y) * 10) / 10;
      item.width = Math.round(Number(el.width) * 10) / 10;
      item.height = Math.round(Number(el.height) * 10) / 10;
      if (el.color) item.color = el.color;
      if (el.fontSize && el.fontSize !== 12) item.fontSize = el.fontSize;
      const defaultTextColor = el.type === "booth" ? "#425066" : "#334155";
      if (el.textColor && el.textColor.toLowerCase() !== defaultTextColor) {
        item.textColor = el.textColor;
      }
      if (el.shape && el.shape !== "rectangle") item.shape = el.shape;
      if (el.rotation) item.rotation = Math.round(el.rotation * 10) / 10;
      if (el.type === "icon" && el.iconId) item.iconId = el.iconId;
      if (el.type === "path") {
        item.points = el.points.map((point) => ({
          x: Math.round(Number(point.x) * 10) / 10,
          y: Math.round(Number(point.y) * 10) / 10,
        }));
        item.pathWidth = Math.round(Number(el.pathWidth) * 10) / 10;
      }
      return item;
    }),
  };
}

/**
 * Updates the shared in-memory layout. Set persist=true only after an editor
 * action is intentionally saved locally.
 */
export function setMapLayout(layout, persist = false) {
  activeLayout = normalizeMapLayout(layout);

  if (persist) {
    localStorage.setItem(
      MAP_SETTINGS_KEY,
      JSON.stringify(compactMapLayout(activeLayout)),
    );
  }

  return activeLayout;
}

export function saveMapLayout(layout) {
  return setMapLayout(layout, true);
}

export function resetMapLayout() {
  localStorage.removeItem(MAP_SETTINGS_KEY);
  activeLayout = defaultMapLayout();
  return activeLayout;
}
