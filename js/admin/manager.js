import {
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_NEW_ZONE_COLOR,
  DEFAULT_ZONE_COLORS,
  ELEMENT_TYPES,
  ELEMENT_SHAPES,
  compactMapLayout,
  defaultMapLayout,
  getMapLayout,
  normalizeMapLayout,
  saveMapLayout,
  cleanIconId,
  getIconImages,
  canBePolygon,
} from "../shared/map-layout.js";
import {
  loadMapLayoutFromGoogleSheet,
  loadIconImagesFromGoogleSheet,
} from "../shared/api.js";
import {
  initialiseManagerLanguage,
  managerLanguage,
  managerT,
  onManagerLanguageChange,
} from "./manager-i18n.js";

const canvas = document.querySelector("#manager-preview");
const palette = document.querySelector("#element-palette");
const inspector = document.querySelector("#element-inspector");
const message = document.querySelector("#manager-message");
const widthInput = document.querySelector("#map-width");
const heightInput = document.querySelector("#map-height");
const gridInput = document.querySelector("#grid-size");
const backgroundImageInput = document.querySelector("#background-image-url");
const backgroundFileInput = document.querySelector("#background-image-file");
const backgroundOpacityInput = document.querySelector("#background-opacity");
const backgroundOpacityValue = document.querySelector(
  "#background-opacity-value",
);
const backgroundLockedInput = document.querySelector("#background-locked");
const backgroundHelp = document.querySelector("#background-help");
const zoomLabel = document.querySelector("#manager-zoom-label");
const mapLoading = document.querySelector("#manager-map-loading");
const mapLoadingText = document.querySelector("#manager-map-loading-text");
const previewDialog = document.querySelector("#map-preview-dialog");
const previewImage = document.querySelector("#map-preview-image");
const layersList = document.querySelector("#layers-list");
const MANAGER_DRAFT_KEY = "eventmap_manager_draft_v1";

function readManagerDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(MANAGER_DRAFT_KEY) || "null");
    if (!draft?.layout || typeof draft.layout !== "object") return null;
    const history = (entries) =>
      Array.isArray(entries)
        ? entries.slice(-50).map((entry) => normalizeMapLayout(entry))
        : [];
    return {
      layout: normalizeMapLayout(draft.layout),
      undoStack: history(draft.undoStack),
      redoStack: history(draft.redoStack),
    };
  } catch {
    return null;
  }
}

function saveManagerDraft() {
  try {
    localStorage.setItem(
      MANAGER_DRAFT_KEY,
      JSON.stringify({ layout, undoStack, redoStack }),
    );
  } catch {
    // A full or unavailable browser storage must not interrupt map editing.
  }
}

function clearManagerDraft() {
  try {
    localStorage.removeItem(MANAGER_DRAFT_KEY);
  } catch {
    // Keep editing available even when browser storage is unavailable.
  }
}

let draftSaveQueued = false;
function scheduleDraftSave() {
  if (draftSaveQueued) return;
  draftSaveQueued = true;
  queueMicrotask(() => {
    draftSaveQueued = false;
    saveManagerDraft();
  });
}

const restoredDraft = readManagerDraft();
let layout = structuredClone(
  restoredDraft?.layout ?? normalizeMapLayout(getMapLayout()),
);
let selectedId = null;
let selectedIds = new Set();
let draggedLayerIds = [];
let copiedElements = [];
let interaction = null;
let editStart = null;
let undoStack = restoredDraft?.undoStack ?? [];
let redoStack = restoredDraft?.redoStack ?? [];
let camera = { scale: 1, x: 0, y: 0 };
const pointers = new Map();
let panMode = false;
let spaceHeld = false;
let cameraPaintFrame = null;
let pageScrollFrame = null;
let pendingPageScroll = 0;
let loadingTouch = null;
let backgroundOpacityStart = null;
let lastAddedPoint = null; // { id, index }

const layoutSourceCopy = {
  en: {
    load: "Load from Google Sheet",
    default: "Use default layout",
    confirm: "Replace this editor map? Unsaved changes will be lost.",
    loading: "Loading map layout from Google Sheet…",
    loaded: "Google Sheet layout loaded. Save to publish changes.",
    defaultLoaded: "Default layout loaded. Save to publish changes.",
    loadFailed: "Could not load the Google Sheet layout:",
  },
  lo: {
    load: "ໂຫຼດຈາກ Google Sheet",
    default: "ໃຊ້ແຜນທີ່ຕົ້ນສະບັບ",
    confirm: "ແທນທີ່ແຜນທີ່ໃນໜ້າແກ້ໄຂບໍ? ການແກ້ໄຂທີ່ຍັງບໍ່ບັນທຶກຈະຫາຍໄປ.",
    loading: "ກຳລັງໂຫຼດແຜນທີ່ຈາກ Google Sheet…",
    loaded: "ໂຫຼດແຜນທີ່ຈາກ Google Sheet ແລ້ວ. ກົດບັນທຶກເພື່ອເຜີຍແຜ່.",
    defaultLoaded: "ໂຫຼດແຜນທີ່ຕົ້ນສະບັບແລ້ວ. ກົດບັນທຶກເພື່ອເຜີຍແຜ່.",
    loadFailed: "ບໍ່ສາມາດໂຫຼດແຜນທີ່ຈາກ Google Sheet:",
  },
};

function layoutCopy() {
  return layoutSourceCopy[managerLanguage()];
}

function setMapLoading(isLoading) {
  if (!mapLoading) return;
  if (mapLoadingText) mapLoadingText.textContent = layoutCopy().loading;
  mapLoading.hidden = !isLoading;
}

mapLoading?.addEventListener(
  "wheel",
  (event) => {
    // While the overlay is visible, keep the map locked but let the page
    // continue to scroll instead of sending the wheel event to the SVG map.
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
      delta *= window.innerHeight;
    event.preventDefault();
    window.scrollBy({ top: delta, left: 0, behavior: "auto" });
  },
  { passive: false },
);

mapLoading?.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  loadingTouch = { pointerId: event.pointerId, clientY: event.clientY };
  mapLoading.setPointerCapture(event.pointerId);
  event.preventDefault();
});
mapLoading?.addEventListener("pointermove", (event) => {
  if (!loadingTouch || loadingTouch.pointerId !== event.pointerId) return;
  schedulePageScroll(loadingTouch.clientY - event.clientY);
  loadingTouch.clientY = event.clientY;
  event.preventDefault();
});
mapLoading?.addEventListener("pointerup", (event) => {
  if (loadingTouch?.pointerId === event.pointerId) loadingTouch = null;
});
mapLoading?.addEventListener("pointercancel", () => {
  loadingTouch = null;
});

const snapshot = () => structuredClone(layout);
const selected = () => layout.elements.find((item) => item.id === selectedId);
const selectedItems = () =>
  layout.elements.filter((item) => selectedIds.has(item.id));
function selectOnly(id) {
  selectedId = id;
  selectedIds = id ? new Set([id]) : new Set();
}
function toggleSelected(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    selectedId = selectedIds.values().next().value || null;
  } else {
    selectedIds.add(id);
    selectedId = id;
  }
}
function syncSelection() {
  const ids = new Set(layout.elements.map((item) => item.id));
  selectedIds = new Set([...selectedIds].filter((id) => ids.has(id)));
  if (!selectedIds.has(selectedId)) {
    selectedId = selectedIds.values().next().value || null;
  }
}
function deleteSelectedElements() {
  if (!selectedIds.size) return;
  remember();
  layout.elements = layout.elements.filter((item) => !selectedIds.has(item.id));
  selectOnly(null);
  renderAll();
}
function nextElementId(type) {
  let count = 1;
  while (layout.elements.some((item) => item.id === `${type}-${count}`)) {
    count += 1;
  }
  return `${type}-${count}`;
}
function nextBoothId(zone) {
  const normalizedZone =
    String(zone || "A")
      .trim()
      .toUpperCase() || "A";
  const highestNumber = layout.elements
    .filter((item) => item.type === "booth" && item.zone === normalizedZone)
    .reduce((highest, item) => {
      const number = Number(String(item.boothId || item.id).replace(/\D/g, ""));
      return Number.isFinite(number) ? Math.max(highest, number) : highest;
    }, 0);
  return normalizedZone + String(highestNumber + 1).padStart(2, "0");
}
function copySelectedElements() {
  const items = selectedItems();
  if (!items.length) return false;
  copiedElements = structuredClone(items);
  return true;
}
function pasteCopiedElements() {
  if (!copiedElements.length) return;

  const before = snapshot();
  const grid = Number(layout.gridSize || 5);
  const left = Math.min(...copiedElements.map((item) => item.x));
  const top = Math.min(...copiedElements.map((item) => item.y));
  const right = Math.max(...copiedElements.map((item) => item.x + item.width));
  const bottom = Math.max(
    ...copiedElements.map((item) => item.y + item.height),
  );
  const requestedOffset = grid * 4;
  const offsetX =
    right + requestedOffset <= layout.width
      ? requestedOffset
      : Math.max(-left, -requestedOffset);
  const offsetY =
    bottom + requestedOffset <= layout.height
      ? requestedOffset
      : Math.max(-top, -requestedOffset);
  const pasted = copiedElements.map((source) => {
    const copy = structuredClone(source);
    copy.id = nextElementId(copy.type);
    copy.x = Math.max(0, Math.min(layout.width - copy.width, copy.x + offsetX));
    copy.y = Math.max(
      0,
      Math.min(layout.height - copy.height, copy.y + offsetY),
    );
    if (hasPoints(copy)) {
      copy.points = copy.points.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      }));
      syncPathBounds(copy);
    }
    if (copy.type === "booth") copy.boothId = nextBoothId(copy.zone);
    layout.elements.push(copy);
    return copy;
  });
  selectedIds = new Set(pasted.map((item) => item.id));
  selectedId = pasted.at(-1)?.id || null;
  remember(before);
  renderAll();
}
const snap = (value) =>
  Math.round(value / Number(layout.gridSize || 5)) *
  Number(layout.gridSize || 5);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

function updateHistoryControls() {
  document.querySelector("#undo-map").disabled = !undoStack.length;
  document.querySelector("#redo-map").disabled = !redoStack.length;
}
function remember(before = snapshot()) {
  if (!undoStack.length || !equal(undoStack.at(-1), before)) {
    undoStack.push(before);
    redoStack = [];
  }
  if (undoStack.length > 50) undoStack.shift();
  updateHistoryControls();
  scheduleDraftSave();
}
function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(snapshot());
  layout = previous;
  syncSelection();
  saveManagerDraft();
  renderAll();
}
function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshot());
  layout = next;
  syncSelection();
  saveManagerDraft();
  renderAll();
}
function itemLabel(item) {
  const translated =
    managerLanguage() === "lo"
      ? item.label_lo || item.label_en
      : item.label_en || item.label_lo;
  return translated || item.boothId || item.id;
}

function splitGraphemes(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

function graphemeLength(text) {
  return splitGraphemes(text).length;
}

function wrapItemLabel(item, verticalWalkway) {
  const ownLabel = () =>
    (managerLanguage() === "lo"
      ? item.label_lo || item.label_en
      : item.label_en || item.label_lo) || "";
  const rawLabel =
    item.type === "tree"
      ? ""
      : item.type === "icon"
        ? ownLabel() // ไม่ถอยไปใช้ id เหมือนองค์ประกอบอื่น
        : String(itemLabel(item) || "");
  const label = rawLabel
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
  if (!label) return [];

  const fontSize = Math.max(1, Number(item.fontSize) || 12);
  const availableWidth = (verticalWalkway ? item.height : item.width) - 10;
  const maximumCharacters = Math.max(
    3,
    Math.floor(availableWidth / (fontSize * 0.6)),
  );
  const lines = [];

  label.split(/\r?\n/).forEach((paragraph) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return;
    const words = trimmed.split(/\s+/).filter(Boolean);
    let line = "";

    words.forEach((word) => {
      const candidates = splitGraphemes(word);
      const chunks = [];
      while (candidates.length) {
        chunks.push(candidates.splice(0, maximumCharacters).join(""));
      }

      chunks.forEach((chunk) => {
        const next = line ? `${line} ${chunk}` : chunk;
        if (graphemeLength(next) <= maximumCharacters) {
          line = next;
        } else {
          if (line) lines.push(line);
          line = chunk;
        }
      });
    });

    if (line) lines.push(line);
  });

  return lines;
}

function itemLabelMarkup(item, centerX, centerY, verticalWalkway) {
  const lines = wrapItemLabel(item, verticalWalkway);
  if (!lines.length) return "";

  const fontSize = Math.max(1, Number(item.fontSize) || 12);
  const lineHeight = fontSize * 1.2;
  const firstLineY =
    centerY - (lineHeight * (lines.length - 1)) / 2 + fontSize * 0.35;

  return (
    '<text x="' +
    centerX +
    '" y="' +
    firstLineY +
    '" text-anchor="middle" font-size="' +
    fontSize +
    '" fill="' +
    escapeHTML(item.textColor) +
    '"' +
    (verticalWalkway
      ? ' transform="rotate(-90 ' + centerX + " " + centerY + ')"'
      : "") +
    ">" +
    lines
      .map(
        (line, index) =>
          '<tspan x="' +
          centerX +
          '" dy="' +
          (index ? lineHeight : 0) +
          '">' +
          escapeHTML(line) +
          "</tspan>",
      )
      .join("") +
    "</text>"
  );
}
function getMaxScale() {
  const dimensionRatio = Math.max(
    (layout?.width || DEFAULT_MAP_WIDTH) / DEFAULT_MAP_WIDTH,
    (layout?.height || DEFAULT_MAP_HEIGHT) / DEFAULT_MAP_HEIGHT,
    1,
  );
  return 20 * dimensionRatio;
}
function clampCamera() {
  camera.scale = Math.min(getMaxScale(), Math.max(1, camera.scale));
  const viewWidth = layout.width / camera.scale,
    viewHeight = layout.height / camera.scale;
  camera.x = Math.min(
    Math.max(camera.x, 0),
    Math.max(0, layout.width - viewWidth),
  );
  camera.y = Math.min(
    Math.max(camera.y, 0),
    Math.max(0, layout.height - viewHeight),
  );
}
function updateViewBox() {
  clampCamera();
  canvas.setAttribute(
    "viewBox",
    [
      camera.x,
      camera.y,
      layout.width / camera.scale,
      layout.height / camera.scale,
    ].join(" "),
  );
  zoomLabel.textContent = Math.round(camera.scale * 100) + "%";
  document.querySelector("#manager-zoom-out").disabled = camera.scale <= 1;
  const zoomInBtn = document.querySelector("#manager-zoom-in");
  if (zoomInBtn) zoomInBtn.disabled = camera.scale >= getMaxScale();
}
function scheduleCameraPaint() {
  if (cameraPaintFrame !== null) return;
  cameraPaintFrame = requestAnimationFrame(() => {
    cameraPaintFrame = null;
    updateViewBox();
  });
}
function schedulePageScroll(delta) {
  pendingPageScroll += delta;
  if (pageScrollFrame !== null) return;
  pageScrollFrame = requestAnimationFrame(() => {
    window.scrollBy({ top: pendingPageScroll, left: 0, behavior: "auto" });
    pendingPageScroll = 0;
    pageScrollFrame = null;
  });
}
function eventPoint(event) {
  const point = canvas.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(canvas.getScreenCTM().inverse());
}
function startPan(event) {
  return {
    kind: "pan",
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    camera: { ...camera },
  };
}
function panToPointer(event, start) {
  const viewWidth = layout.width / start.camera.scale;
  const viewHeight = layout.height / start.camera.scale;
  const screenScale = Math.min(
    canvas.clientWidth / viewWidth,
    canvas.clientHeight / viewHeight,
  );

  // Use fixed screen-space movement. SVG coordinates from eventPoint() change
  // as the viewBox moves, which causes visible feedback and jerky panning.
  camera.x = start.camera.x - (event.clientX - start.clientX) / screenScale;
  camera.y = start.camera.y - (event.clientY - start.clientY) / screenScale;
}
function itemFill(item) {
  return item.color;
}
function normalizeRotation(value) {
  const rotation = Number(value);
  return Number.isFinite(rotation) ? ((rotation % 360) + 360) % 360 : 0;
}
function angleFromCenter(point, center) {
  return Math.atan2(point.y - center.y, point.x - center.x);
}
function rotatePoint(point, center, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  };
}
function pathMarkup(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const radius = 18;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const before = Math.min(
      radius,
      Math.hypot(current.x - previous.x, current.y - previous.y) / 2,
    );
    const after = Math.min(
      radius,
      Math.hypot(next.x - current.x, next.y - current.y) / 2,
    );
    const start = {
      x:
        current.x +
        ((previous.x - current.x) /
          Math.max(
            1,
            Math.hypot(previous.x - current.x, previous.y - current.y),
          )) *
          before,
      y:
        current.y +
        ((previous.y - current.y) /
          Math.max(
            1,
            Math.hypot(previous.x - current.x, previous.y - current.y),
          )) *
          before,
    };
    const end = {
      x:
        current.x +
        ((next.x - current.x) /
          Math.max(1, Math.hypot(next.x - current.x, next.y - current.y))) *
          after,
      y:
        current.y +
        ((next.y - current.y) /
          Math.max(1, Math.hypot(next.x - current.x, next.y - current.y))) *
          after,
    };
    d += ` L ${start.x} ${start.y} Q ${current.x} ${current.y} ${end.x} ${end.y}`;
  }
  const last = points.at(-1);
  return `${d} L ${last.x} ${last.y}`;
}

const hasPoints = (item) =>
  item?.type === "path" ||
  (item?.shape === "polygon" &&
    Array.isArray(item.points) &&
    item.points.length >= 3);

const tx = (key, en, lo) => {
  const value = managerT(key);
  if (value && value !== key) return value;
  return managerLanguage() === "lo" ? lo : en;
};

function bakeRotation(item) {
  const rot = Number(item.rotation) || 0;
  if (!rot || !hasPoints(item)) return;
  const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
  const angle = (rot * Math.PI) / 180;
  item.points = item.points.map((p) => rotatePoint(p, center, angle));
  item.rotation = 0;
  syncPathBounds(item);
}

function syncPathBounds(item) {
  if (!hasPoints(item) || !item.points?.length) return;
  const xs = item.points.map((point) => point.x);
  const ys = item.points.map((point) => point.y);
  item.x = Math.min(...xs);
  item.y = Math.min(...ys);
  item.width = Math.max(1, Math.max(...xs) - item.x);
  item.height = Math.max(1, Math.max(...ys) - item.y);
}

function applyShapeChange(item) {
  if (item.shape === "polygon" && canBePolygon(item.type)) {
    if (!Array.isArray(item.points) || item.points.length < 3) {
      item.points = [
        { x: item.x, y: item.y },
        { x: item.x + item.width, y: item.y },
        { x: item.x + item.width, y: item.y + item.height },
        { x: item.x, y: item.y + item.height },
      ];
      // ฝังการหมุนเดิมลงในจุด แล้วตั้ง rotation เป็น 0
      const rot = Number(item.rotation) || 0;
      if (rot) {
        const center = {
          x: item.x + item.width / 2,
          y: item.y + item.height / 2,
        };
        const angle = (rot * Math.PI) / 180;
        item.points = item.points.map((p) => rotatePoint(p, center, angle));
        item.rotation = 0;
      }
    }
    syncPathBounds(item);
  } else if (item.type !== "path") {
    delete item.points;
  }
}

function addPolygonPoint(item) {
  // แทรกจุดใหม่กลางด้านที่ยาวที่สุด
  const pts = item.points;
  let best = 0,
    bestLen = -1;
  pts.forEach((p, i) => {
    const n = pts[(i + 1) % pts.length];
    const len = Math.hypot(n.x - p.x, n.y - p.y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  });
  const a = pts[best],
    b = pts[(best + 1) % pts.length];
  pts.splice(best + 1, 0, {
    x: Math.round(((a.x + b.x) / 2) * 10) / 10,
    y: Math.round(((a.y + b.y) / 2) * 10) / 10,
  });
  return best + 1;
}

function ensureZoneColor(zone) {
  layout.zoneColors ||= {};
  const key = String(zone || "")
    .trim()
    .toUpperCase();
  if (key)
    layout.zoneColors[key] ||=
      DEFAULT_ZONE_COLORS[key] || DEFAULT_NEW_ZONE_COLOR;
}
function blossomMarkup(cx, cy, size) {
  const petal = size * 0.45;
  const petals = [
    [0, -size],
    [size, 0],
    [0, size],
    [-size, 0],
    [size * 0.7, -size * 0.7],
  ];
  return (
    petals
      .map(
        ([x, y]) =>
          '<circle cx="' +
          (cx + x) +
          '" cy="' +
          (cy + y) +
          '" r="' +
          petal +
          '" fill="#fecdd3"/>',
      )
      .join("") +
    '<circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="' +
    size * 0.38 +
    '" fill="#facc15"/>'
  );
}

function strokeAttrs(item) {
  const width = item.borderWidth ?? 1.5;
  const color = item.borderColor || "#64748b";
  return (
    ' style="stroke:' +
    escapeHTML(color) +
    ";stroke-width:" +
    width +
    'px;stroke-linejoin:round"'
  );
}

function shapeMarkup(item, fill) {
  const x = item.x,
    y = item.y,
    width = item.width,
    height = item.height;
  const centerX = x + width / 2,
    centerY = y + height / 2;

  if (item.type === "path") {
    return (
      '<path d="' +
      pathMarkup(item.points) +
      '" fill="none" stroke="' +
      fill +
      '" stroke-width="' +
      item.pathWidth +
      '" stroke-linecap="round" stroke-linejoin="round"/>'
    );
  }

  if (item.type === "tree") {
    const size = Math.min(width, height);
    const crown = (cx, cy, radius, opacity = 1) =>
      '<circle cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      radius +
      '" fill="' +
      fill +
      '" fill-opacity="' +
      opacity +
      '"/>';
    return (
      '<path d="M ' +
      (x + width * 0.43) +
      " " +
      (y + height * 0.46) +
      " C " +
      (x + width * 0.45) +
      " " +
      (y + height * 0.66) +
      ", " +
      (x + width * 0.36) +
      " " +
      (y + height * 0.84) +
      ", " +
      (x + width * 0.39) +
      " " +
      (y + height) +
      " L " +
      (x + width * 0.72) +
      " " +
      (y + height) +
      " C " +
      (x + width * 0.69) +
      " " +
      (y + height * 0.82) +
      ", " +
      (x + width * 0.59) +
      " " +
      (y + height * 0.63) +
      ", " +
      (x + width * 0.61) +
      " " +
      (y + height * 0.46) +
      ' Z" fill="#8b6b53"/>' +
      crown(x + width * 0.5, y + height * 0.24, size * 0.24) +
      crown(x + width * 0.28, y + height * 0.43, size * 0.25, 0.96) +
      crown(x + width * 0.72, y + height * 0.45, size * 0.28, 0.92) +
      crown(x + width * 0.5, y + height * 0.59, size * 0.3, 0.94) +
      crown(x + width * 0.14, y + height * 0.61, size * 0.18, 0.9) +
      crown(x + width * 0.88, y + height * 0.62, size * 0.18, 0.9) +
      blossomMarkup(x + width * 0.31, y + height * 0.3, size * 0.06) +
      blossomMarkup(x + width * 0.62, y + height * 0.53, size * 0.07) +
      blossomMarkup(x + width * 0.84, y + height * 0.63, size * 0.06)
    );
  }
  if (item.type === "walkway") {
    return (
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      width +
      '" height="' +
      height +
      '" fill="' +
      fill +
      '"/>'
    );
  }
  if (item.type === "label") {
    // พื้นที่โปร่งใสไว้ให้คลิก/ลากได้ ไม่วาดกล่องสี
    return (
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      width +
      '" height="' +
      height +
      '" fill="transparent"/>'
    );
  }
  if (item.type === "icon") {
    const src = getIconImages()[item.iconId];
    const hit =
      '<rect x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      width +
      '" height="' +
      height +
      '" fill="transparent"/>';
    if (src) {
      return (
        hit +
        '<image href="' +
        escapeHTML(src) +
        '" x="' +
        x +
        '" y="' +
        y +
        '" width="' +
        width +
        '" height="' +
        height +
        '" preserveAspectRatio="xMidYMid meet" pointer-events="none"/>'
      );
    }
    // ยังไม่มีรูป: กรอบเส้นประ + แสดงรหัสที่รออยู่
    return (
      hit +
      '<rect x="' +
      (x + 2) +
      '" y="' +
      (y + 2) +
      '" width="' +
      (width - 4) +
      '" height="' +
      (height - 4) +
      '" rx="8" fill="#fff" fill-opacity="0.6" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 4"/>' +
      '<text x="' +
      centerX +
      '" y="' +
      (centerY + 4) +
      '" text-anchor="middle" font-size="11" fill="#64748b">' +
      escapeHTML(item.iconId || "?") +
      "</text>"
    );
  }
  if (
    item.shape === "polygon" &&
    Array.isArray(item.points) &&
    item.points.length >= 3
  ) {
    return (
      '<polygon points="' +
      item.points.map((p) => p.x + "," + p.y).join(" ") +
      '" rx="' +
      (item.borderRadius ?? 6) +
      '" fill="' +
      fill +
      '"' +
      strokeAttrs(item) +
      "/>"
    );
  }
  if (item.shape === "circle")
    return (
      '<ellipse cx="' +
      centerX +
      '" cy="' +
      centerY +
      '" rx="' +
      width / 2 +
      '" ry="' +
      height / 2 +
      '" fill="' +
      fill +
      '"' +
      strokeAttrs(item) +
      "/>"
    );
  if (item.shape === "triangle")
    return (
      '<polygon points="' +
      centerX +
      "," +
      y +
      " " +
      (x + width) +
      "," +
      (y + height) +
      " " +
      x +
      "," +
      (y + height) +
      '" rx="' +
      (item.borderRadius ?? 6) +
      '" fill="' +
      fill +
      '"' +
      strokeAttrs(item) +
      "/>"
    );
  if (item.shape === "hexagon")
    return (
      '<polygon points="' +
      (x + width * 0.25) +
      "," +
      y +
      " " +
      (x + width * 0.75) +
      "," +
      y +
      " " +
      (x + width) +
      "," +
      centerY +
      " " +
      (x + width * 0.75) +
      "," +
      (y + height) +
      " " +
      (x + width * 0.25) +
      "," +
      (y + height) +
      " " +
      x +
      "," +
      centerY +
      '" rx="' +
      (item.borderRadius ?? 6) +
      '" fill="' +
      fill +
      '"' +
      strokeAttrs(item) +
      "/>"
    );
  return (
    '<rect x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    width +
    '" height="' +
    height +
    '" rx="' +
    (item.borderRadius ?? 6) +
    '" fill="' +
    fill +
    '"' +
    strokeAttrs(item) +
    "/>"
  );
}
function renderCanvas() {
  updateViewBox();
  const grid = Number(layout.gridSize || 5);
  const background = layout.backgroundImage
    ? '<image class="manager-map-background" href="' +
      escapeHTML(layout.backgroundImage) +
      '" x="0" y="0" width="' +
      layout.width +
      '" height="' +
      layout.height +
      '" opacity="' +
      layout.backgroundOpacity +
      '" preserveAspectRatio="none" pointer-events="none"/>'
    : "";
  let html =
    '<defs><pattern id="grid" width="' +
    grid +
    '" height="' +
    grid +
    '" patternUnits="userSpaceOnUse"><path d="M ' +
    grid +
    " 0 L 0 0 0 " +
    grid +
    '" fill="none" stroke="#d9dee8" stroke-width="1"/></pattern></defs><rect width="' +
    layout.width +
    '" height="' +
    layout.height +
    '" fill="' +
    (layout.backgroundTransparent ? "none" : "#fff") +
    '"/>' +
    background +
    '<rect class="builder-background" width="' +
    layout.width +
    '" height="' +
    layout.height +
    '" fill="url(#grid)"/>';
  layout.elements.forEach((item) => {
    const active = selectedIds.has(item.id);
    const labelCenterX = item.x + item.width / 2;
    const labelCenterY = item.y + item.height / 2;
    const labelTextY =
      item.type === "landmark"
        ? item.y + item.height * 0.88
        : item.type === "icon"
          ? item.y + item.height + (Number(item.fontSize) || 12) + 2
          : labelCenterY;
    const verticalWalkway = item.type === "walkway" && item.height > item.width;
    const handleSize = Math.max(
      10,
      Math.min(40, Math.round(Math.min(item.width, item.height) * 0.14)),
    );
    const half = handleSize / 2;
    const handle =
      !active || selectedIds.size !== 1 || hasPoints(item)
        ? ""
        : ["nw", "ne", "sw", "se"]
            .map((corner) => {
              const right = corner.includes("e");
              const bottom = corner.includes("s");
              const handleX = item.x + (right ? item.width : 0);
              const handleY = item.y + (bottom ? item.height : 0);
              const attributes =
                ' class="resize-handle" data-resize-id="' +
                escapeHTML(item.id) +
                '" data-resize-corner="' +
                corner +
                '"';
              return (
                "<rect" +
                attributes +
                ' x="' +
                (handleX - half) +
                '" y="' +
                (handleY - half) +
                '" width="' +
                handleSize +
                '" height="' +
                handleSize +
                '" rx="' +
                Math.round(handleSize * 0.2) +
                '"/>'
              );
            })
            .join("");

    const pathPointRadius =
      item.type === "path"
        ? Math.max(
            3,
            Math.min(
              Math.round((item.pathWidth || 28) * 0.35 * 10) / 10,
              Math.max(3, (item.pathWidth || 28) / 2 - 2),
            ),
          )
        : Math.max(7, half);
    const pathPoints =
      active && selectedIds.size === 1 && hasPoints(item)
        ? item.points
            .map(
              (point, index) =>
                '<circle class="path-point-handle" data-path-point-id="' +
                escapeHTML(item.id) +
                '" data-path-point-index="' +
                index +
                '" cx="' +
                point.x +
                '" cy="' +
                point.y +
                '" r="' +
                pathPointRadius +
                '"/>',
            )
            .join("")
        : "";
    const rotationHandle =
      active && selectedIds.size === 1
        ? '<line class="rotation-handle-line" x1="' +
          labelCenterX +
          '" y1="' +
          (item.y - half) +
          '" x2="' +
          labelCenterX +
          '" y2="' +
          (item.y - half - handleSize * 2) +
          '"/><circle class="rotation-handle" data-rotate-id="' +
          escapeHTML(item.id) +
          '" cx="' +
          labelCenterX +
          '" cy="' +
          (item.y - half - handleSize * 2 - half) +
          '" r="' +
          Math.max(6, half) +
          '"/>'
        : "";
    const rotation = Number(item.rotation) || 0;
    html +=
      '<g class="builder-item type-' +
      escapeHTML(item.type) +
      (active ? " selected" : "") +
      '" data-id="' +
      escapeHTML(item.id) +
      '"' +
      (rotation
        ? ' transform="rotate(' +
          rotation +
          " " +
          labelCenterX +
          " " +
          labelCenterY +
          ')"'
        : "") +
      '">' +
      (canBePolygon(item.type) && item.fillOpacity < 1
        ? '<g fill-opacity="' +
          item.fillOpacity +
          '">' +
          shapeMarkup(item, escapeHTML(itemFill(item))) +
          "</g>"
        : shapeMarkup(item, escapeHTML(itemFill(item)))) +
      (item.type === "label" && active
        ? '<rect x="' +
          item.x +
          '" y="' +
          item.y +
          '" width="' +
          item.width +
          '" height="' +
          item.height +
          '" fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4 3" pointer-events="none"/>'
        : "") +
      (item.type === "path"
        ? ""
        : itemLabelMarkup(item, labelCenterX, labelCenterY, verticalWalkway)) +
      handle +
      pathPoints +
      rotationHandle +
      "</g>";
  });
  canvas.innerHTML = html;
}
function renderInspector() {
  const item = selected();
  if (selectedIds.size > 1) {
    inspector.innerHTML =
      "<h2>" +
      managerT("properties") +
      "</h2><p>" +
      managerT("multiSelectHint") +
      "</p>";
    return;
  }
  if (!item) {
    inspector.innerHTML =
      "<h2>" +
      managerT("properties") +
      "</h2><p>" +
      managerT("selectElement") +
      "</p>";
    return;
  }
  const field = (label, key, type = "text", min = "") =>
    "<label>" +
    label +
    '<input type="' +
    type +
    '" ' +
    min +
    ' data-key="' +
    key +
    '" value="' +
    escapeHTML(item[key] ?? "") +
    '"></label>';
  const multilineField = (label, key) =>
    "<label>" +
    label +
    '<textarea rows="2" data-key="' +
    key +
    '">' +
    escapeHTML(item[key] ?? "") +
    "</textarea></label>";
  const shapeField =
    "<label>" +
    managerT("shape") +
    '<select data-key="shape">' +
    ELEMENT_SHAPES.filter((s) => s !== "polygon" || canBePolygon(item.type))
      .map(
        (shape) =>
          '<option value="' +
          shape +
          '"' +
          (item.shape === shape ? " selected" : "") +
          ">" +
          managerT("shapes." + shape) +
          "</option>",
      )
      .join("") +
    "</select></label>";
  inspector.innerHTML =
    "<h2>" +
    managerT("properties") +
    '</h2><div class="selected-element-title">' +
    managerT("types." + item.type) +
    ": " +
    escapeHTML(item.id) +
    "</div>" +
    multilineField(managerT("laoName"), "label_lo") +
    multilineField(managerT("englishName"), "label_en") +
    (item.type === "icon"
      ? field(managerT("iconId"), "iconId") +
        '<p class="path-editor-help">' +
        managerT("iconFolderHint") +
        " ICON_" +
        escapeHTML(item.iconId || "…") +
        "</p>"
      : "") +
    (item.type === "booth"
      ? field(managerT("boothId"), "boothId") + field(managerT("zone"), "zone")
      : "") +
    (item.type === "walkway"
      ? '<button class="button" type="button" id="rotate-walkway">' +
        managerT("rotateWalkway") +
        "</button>"
      : "") +
    (item.type !== "tree" && item.type !== "walkway" && item.type !== "path"
      ? shapeField
      : "") +
    (item.type === "path"
      ? field(managerT("pathWidth"), "pathWidth", "number", 'min="1"') +
        '<div class="path-editor-actions"><button class="button" type="button" id="add-path-point">' +
        managerT("addPathPoint") +
        '</button><button class="button" type="button" id="remove-path-point">' +
        managerT("removePathPoint") +
        '</button></div><p class="path-editor-help">' +
        managerT("pathEditorHelp") +
        "</p>"
      : hasPoints(item)
        ? '<div class="path-editor-actions"><button class="button" type="button" id="add-path-point">' +
          tx("addPolygonPoint", "+ Add corner", "+ ເພີ່ມມຸມ") +
          '</button><button class="button" type="button" id="remove-path-point">' +
          tx("removePolygonPoint", "− Remove corner", "− ລຶບມຸມ") +
          '</button></div><p class="path-editor-help">' +
          tx(
            "polygonHelp",
            "Drag the round handles to move each corner.",
            "ລາກຈຸດວົງມົນເພື່ອຍ້າຍແຕ່ລະມຸມ.",
          ) +
          "</p>"
        : field("X", "x", "number", 'min="0"') +
          field("Y", "y", "number", 'min="0"') +
          field(managerT("width"), "width", "number", 'min="1"') +
          field(managerT("height"), "height", "number", 'min="1"')) +
    (item.type === "label" ? "" : field(managerT("color"), "color", "color")) +
    (canBePolygon(item.type)
      ? "<label>" +
        tx("fillOpacity", "Fill opacity", "ຄວາມໂປ່ງໃສຂອງສີ") +
        ": " +
        Math.round((item.fillOpacity ?? 1) * 100) +
        '%<input type="range" min="0" step="5" data-key="fillOpacity" value="' +
        Math.round((item.fillOpacity ?? 1) * 100) +
        '"></label>'
      : "") +
    (canBePolygon(item.type)
      ? field(
          tx("borderWidth", "Border width", "ຄວາມໜາເສັ້ນຂອບ"),
          "borderWidth",
          "number",
          'min="0" step="0.5"',
        ) +
        (item.shape === "rectangle" || !item.shape
          ? field(
              tx("borderRadius", "Corner radius", "ຄວາມໂຄ້ງມຸມ"),
              "borderRadius",
              "number",
              'min="0"',
            )
          : "") +
        field(
          "<label>" +
            tx("borderColor", "Border color", "ສີເສັ້ນຂອບ") +
            '<input type="color" data-key="borderColor" value="' +
            escapeHTML(item.borderColor || "#64748b") +
            '"></label>',
        )
      : "") +
    (item.type !== "tree"
      ? field(managerT("fontSize"), "fontSize", "number", 'min="1"') +
        field(managerT("textColor"), "textColor", "color")
      : "") +
    '<button class="button danger" id="delete-element">' +
    managerT("deleteElement") +
    "</button>";
}
function renderSettings() {
  widthInput.value = layout.width;
  heightInput.value = layout.height;
  gridInput.value = layout.gridSize;
  backgroundImageInput.value = layout.backgroundImage || "";
  backgroundOpacityInput.value = Math.round(layout.backgroundOpacity * 100);
  backgroundOpacityValue.value = `${backgroundOpacityInput.value}%`;
  backgroundOpacityValue.textContent = backgroundOpacityValue.value;
  backgroundLockedInput.checked = layout.backgroundLocked;
  const t = document.querySelector("#background-transparent");
  if (t) t.checked = Boolean(layout.backgroundTransparent);
}
function renderLayers() {
  layersList.replaceChildren();
  const layerOrder = [...layout.elements].reverse();
  layerOrder.forEach((item) => {
    const row = document.createElement("div");
    row.className = "layer-row" + (selectedIds.has(item.id) ? " selected" : "");
    row.draggable = true;
    row.dataset.id = item.id;
    row.innerHTML =
      '<span class="layer-drag-handle" aria-hidden="true">⠿</span><button class="layer-select" type="button" aria-pressed="' +
      String(selectedIds.has(item.id)) +
      '"><span class="layer-swatch" style="background:' +
      escapeHTML(item.color) +
      '"></span><span><strong>' +
      escapeHTML(itemLabel(item).replace(/\r?\n/g, " ")) +
      "</strong><small>" +
      managerT("types." + item.type) +
      "</small></span></button>";
    row.querySelector(".layer-select").addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey)
        toggleSelected(item.id);
      else selectOnly(item.id);
      renderAll();
    });
    row.addEventListener("dragstart", (event) => {
      draggedLayerIds = selectedIds.has(item.id)
        ? layerOrder
            .filter((entry) => selectedIds.has(entry.id))
            .map((entry) => entry.id)
        : [item.id];
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedLayerIds.join(","));
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      draggedLayerIds = [];
      document
        .querySelectorAll(".layer-row")
        .forEach((entry) => entry.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!draggedLayerIds.includes(item.id)) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const movedIds = draggedLayerIds.length
        ? draggedLayerIds
        : event.dataTransfer.getData("text/plain").split(",").filter(Boolean);
      if (!movedIds.length || movedIds.includes(item.id)) return;
      const before = snapshot();
      const moved = layerOrder.filter((entry) => movedIds.includes(entry.id));
      const reordered = layerOrder.filter(
        (entry) => !movedIds.includes(entry.id),
      );
      const targetIndex = reordered.findIndex((entry) => entry.id === item.id);
      if (targetIndex < 0) return;
      reordered.splice(targetIndex, 0, ...moved);
      // Layers display front-to-back, while SVG draws layout.elements
      // back-to-front. Reverse once to preserve that existing data model.
      layout.elements = reordered.reverse();
      remember(before);
      renderAll();
    });
    layersList.append(row);
  });
}
function renderAll() {
  renderSettings();
  renderCanvas();
  renderInspector();
  renderLayers();
  updateHistoryControls();
  document.querySelector("#center-element").disabled = !layout.elements.length;
}
function renderPalette() {
  palette.replaceChildren();
  Object.keys(ELEMENT_TYPES)
    // Path is now the standard walkway editor. Keep old rectangle walkways
    // renderable and routable, but do not offer them for new map designs.
    .filter((type) => type !== "walkway")
    .forEach((type) => {
      const button = document.createElement("button");
      button.className = "button";
      button.textContent = "+ " + managerT("types." + type);
      button.addEventListener("click", () => addElement(type));
      palette.append(button);
    });
}
function addElement(type) {
  const before = snapshot(),
    meta = ELEMENT_TYPES[type];
  const count = layout.elements.filter((item) => item.type === type).length + 1,
    id = type + "-" + count;
  layout.elements.push({
    id,
    type,
    boothId: type === "booth" ? "NEW" + count : "",
    zone: type === "booth" ? "A" : "",
    label_lo: "",
    label_en:
      type === "path" || type === "icon" ? "" : managerT("types." + type),
    x: snap(layout.width / 2 - meta.width / 2),
    y: snap(layout.height / 2 - meta.height / 2),
    width: meta.width,
    height: meta.height,
    color: meta.color,
    fontSize: type === "label" ? 18 : 12,
    textColor:
      type === "booth" ? "#425066" : type === "label" ? "#1e293b" : "#334155",
    shape: "rectangle",
    ...(type === "icon" ? { iconId: "" } : {}),
    ...(type === "path"
      ? {
          points: [
            {
              x: snap(layout.width / 2 - meta.width / 2),
              y: snap(layout.height / 2),
            },
            {
              x: snap(layout.width / 2 + meta.width / 2),
              y: snap(layout.height / 2),
            },
          ],
          pathWidth: 28,
        }
      : {}),
  });
  selectOnly(id);
  remember(before);
  renderAll();
}
function zoomAt(nextScale, clientX, clientY) {
  const oldScale = camera.scale,
    scale = Math.min(getMaxScale(), Math.max(1, nextScale));
  if (scale === oldScale) return;
  const anchor =
    clientX === undefined
      ? { x: layout.width / 2, y: layout.height / 2 }
      : eventPoint({ clientX, clientY });
  camera.x = anchor.x - ((anchor.x - camera.x) * oldScale) / scale;
  camera.y = anchor.y - ((anchor.y - camera.y) * oldScale) / scale;
  camera.scale = scale;
  updateViewBox();
}
function scrollMapByWheel(delta, horizontal = false) {
  const viewWidth = layout.width / camera.scale;
  const viewHeight = layout.height / camera.scale;
  const screenScale = Math.min(
    canvas.clientWidth / viewWidth,
    canvas.clientHeight / viewHeight,
  );

  if (!Number.isFinite(screenScale) || screenScale <= 0) return;
  if (horizontal) camera.x += delta / screenScale;
  else camera.y += delta / screenScale;
  updateViewBox();
}
function newBlankMap() {
  if (!confirm(managerT("newBlankMap"))) return;
  remember();
  layout = {
    width: 800,
    height: 900,
    gridSize: 5,
    zoneColors: { ...DEFAULT_ZONE_COLORS },
    elements: [],
  };
  selectOnly(null);
  camera = { scale: 1, x: 0, y: 0 };
  message.textContent = "";
  renderAll();
}
function replaceEditorLayout(nextLayout, persistDraft = true) {
  layout = structuredClone(normalizeMapLayout(nextLayout));
  selectOnly(null);
  undoStack = [];
  redoStack = [];
  camera = { scale: 1, x: 0, y: 0 };
  if (persistDraft) saveManagerDraft();
  else clearManagerDraft();
  renderAll();
}

const transparentBgLabel = document.createElement("label");
transparentBgLabel.className =
  backgroundLockedInput.closest("label")?.className || "";
const transparentBgInput = document.createElement("input");
transparentBgInput.type = "checkbox";
transparentBgInput.id = "background-transparent";
const transparentBgText = document.createElement("span");
transparentBgLabel.append(transparentBgInput, " ", transparentBgText);
(
  backgroundLockedInput.closest("label") || backgroundOpacityInput.parentElement
).insertAdjacentElement("afterend", transparentBgLabel);

function updateTransparentLabel() {
  transparentBgText.textContent = tx(
    "transparentBackground",
    "Transparent map background",
    "ພື້ນຫຼັງແຜນທີ່ໂປ່ງໃສ",
  );
}
onManagerLanguageChange(updateTransparentLabel);
updateTransparentLabel();

transparentBgInput.addEventListener("change", () => {
  applyBackgroundChange(() => {
    layout.backgroundTransparent = transparentBgInput.checked;
  });
});

function addLayoutSourceButtons() {
  const newMapButton = document.querySelector("#new-map");
  if (!newMapButton) return;

  const loadButton = document.createElement("button");
  loadButton.id = "load-sheet-layout";
  loadButton.className = "button";
  loadButton.type = "button";

  const defaultButton = document.createElement("button");
  defaultButton.id = "load-default-layout";
  defaultButton.className = "button";
  defaultButton.type = "button";

  newMapButton.insertAdjacentElement("afterend", defaultButton);
  defaultButton.insertAdjacentElement("afterend", loadButton);

  const updateLabels = () => {
    const copy = layoutCopy();
    loadButton.textContent = copy.load;
    defaultButton.textContent = copy.default;
  };

  loadButton.addEventListener("click", () => loadGoogleSheetLayout(true));
  defaultButton.addEventListener("click", () => {
    if (!confirm(layoutCopy().confirm)) return;
    replaceEditorLayout(defaultMapLayout());
    message.textContent = layoutCopy().defaultLoaded;
  });

  onManagerLanguageChange(updateLabels);
  updateLabels();
}

async function loadGoogleSheetLayout(confirmReplace = false) {
  if (confirmReplace && !confirm(layoutCopy().confirm)) return;

  const loadButton = document.querySelector("#load-sheet-layout");
  if (loadButton) loadButton.disabled = true;
  message.textContent = layoutCopy().loading;
  setMapLoading(true);

  try {
    const sheetLayout = await loadMapLayoutFromGoogleSheet();
    replaceEditorLayout(sheetLayout, confirmReplace);
    message.textContent = layoutCopy().loaded;
  } catch (error) {
    message.textContent = `${layoutCopy().loadFailed} ${error.message}`;
  } finally {
    if (loadButton) loadButton.disabled = false;
    setMapLoading(false);
  }
}
async function toDataUrl(url) {
  if (!url || typeof url !== "string" || url.startsWith("data:")) return url;

  let absoluteUrl = url;
  try {
    absoluteUrl = new URL(url, window.location.href).href;
  } catch (_) {}

  try {
    const res = await fetch(absoluteUrl, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = img.naturalWidth || img.width || 100;
        tempCanvas.height = img.naturalHeight || img.height || 100;
        const ctx = tempCanvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(tempCanvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = absoluteUrl;
  });
}

async function exportPNG() {
  const exportButton = document.querySelector("#export-map");
  if (exportButton) exportButton.disabled = true;
  message.textContent = managerT("exporting") || "Exporting PNG...";

  const width = Number(layout.width) || DEFAULT_MAP_WIDTH;
  const height = Number(layout.height) || DEFAULT_MAP_HEIGHT;

  try {
    const svg = canvas.cloneNode(true);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    // Remove editing UI handles, rotation lines, and grid pattern
    svg
      .querySelectorAll(
        ".resize-handle, .path-point-handle, .rotation-handle, .rotation-handle-line, .builder-background",
      )
      .forEach((node) => node.remove());
    svg
      .querySelectorAll(".selected")
      .forEach((node) => node.classList.remove("selected"));
    svg
      .querySelectorAll('[stroke-dasharray="4 3"]')
      .forEach((node) => node.remove());

    // Inject SVG stylesheet so shapes, borders, and text fonts render identically to the preview
    const style = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style",
    );
    style.textContent = `
      .builder-item.type-tree rect, .builder-item.type-tree ellipse, .builder-item.type-tree polygon, .builder-item.type-tree path {
        stroke: none !important;
      }
      .builder-item.type-walkway rect {
        stroke: none !important;
      }
      .builder-item.type-path path {
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      text {
        font-family: Inter, "Noto Sans Lao", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
    `;
    svg.insertBefore(style, svg.firstChild);

    // Inline images as data URLs so SVG loaded as an Image does not trigger cross-origin/network restrictions
    const images = Array.from(svg.querySelectorAll("image"));
    await Promise.all(
      images.map(async (img) => {
        const rawHref =
          img.getAttribute("href") || img.getAttribute("xlink:href");
        if (!rawHref || rawHref.startsWith("data:")) return;
        try {
          const dataUrl = await toDataUrl(rawHref);
          if (dataUrl) {
            img.setAttribute("href", dataUrl);
            img.removeAttribute("xlink:href");
          } else {
            img.remove();
          }
        } catch (e) {
          console.warn("Could not inline image for map export:", rawHref, e);
          img.remove();
        }
      }),
    );

    const source = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([source], {
      type: "image/svg+xml;charset=utf-8",
    });
    const blobUrl = URL.createObjectURL(svgBlob);

    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Failed to render map image"));
        image.src = blobUrl;
      });

      const scale = 2;
      const output = document.createElement("canvas");
      const context = output.getContext("2d");
      output.width = width * scale;
      output.height = height * scale;
      if (!layout.backgroundTransparent) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, output.width, output.height);
      }
      context.drawImage(image, 0, 0, output.width, output.height);

      const triggerDownload = (downloadUrl) => {
        const link = document.createElement("a");
        link.download = "event-map.png";
        link.href = downloadUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      await new Promise((resolve, reject) => {
        if (output.toBlob) {
          output.toBlob((blob) => {
            if (blob) {
              const pngUrl = URL.createObjectURL(blob);
              triggerDownload(pngUrl);
              setTimeout(() => URL.revokeObjectURL(pngUrl), 2000);
              resolve();
            } else {
              try {
                const dataUrl = output.toDataURL("image/png");
                triggerDownload(dataUrl);
                resolve();
              } catch (err) {
                reject(err);
              }
            }
          }, "image/png");
        } else {
          try {
            const dataUrl = output.toDataURL("image/png");
            triggerDownload(dataUrl);
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      });

      message.textContent = managerT("exported");
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    console.error("Export PNG failed:", error);
    message.textContent =
      `${managerT("exportFailed") || "Failed to export image."} ${error.message || ""}`.trim();
  } finally {
    if (exportButton) exportButton.disabled = false;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
    startedAt: performance.now(),
  });
  const pathPoint = event.target.closest("[data-path-point-id]"),
    rotationHandle = event.target.closest("[data-rotate-id]"),
    handle = event.target.closest("[data-resize-id]"),
    group = event.target.closest("[data-id]"),
    point = eventPoint(event);
  const isContinuingPageScroll = interaction?.kind === "page-scroll";
  const canStartPinch =
    !isContinuingPageScroll ||
    (!interaction.moved && performance.now() - interaction.startedAt < 180);
  if (pointers.size === 2 && canStartPinch) {
    const [first, second] = [...pointers.values()];
    const midpoint = {
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    };
    const anchor = eventPoint(midpoint);
    interaction = {
      kind: "pinch",
      distance: Math.max(
        1,
        Math.hypot(
          first.clientX - second.clientX,
          first.clientY - second.clientY,
        ),
      ),
      scale: camera.scale,
      mapX: anchor.x,
      mapY: anchor.y,
    };
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  // A second accidental touch while vertically scrolling must not turn the
  // gesture into a zoom. Keep the original one-finger page scroll active.
  if (pointers.size > 1) return;
  const editingSelectedTouch =
    event.pointerType === "touch" &&
    camera.scale <= 1 &&
    !panMode &&
    (Boolean(pathPoint) ||
      Boolean(rotationHandle) ||
      Boolean(handle) ||
      selectedIds.has(group?.dataset.id));
  // At 100%, a touch on a new element still scrolls the page. After the
  // element is selected, its next drag (or a resize handle) edits the map.
  if (
    event.pointerType === "touch" &&
    camera.scale <= 1 &&
    !editingSelectedTouch
  ) {
    interaction = {
      kind: "touch-pending",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientY: event.clientY,
      targetId:
        pathPoint?.dataset.pathPointId ||
        rotationHandle?.dataset.rotateId ||
        handle?.dataset.resizeId ||
        group?.dataset.id ||
        null,
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (!handle && !group && selectedIds.size) {
    selectOnly(null);
    renderAll();
  }
  // Pan mode always locks elements. Holding Space only starts panning once
  // there is a zoomed area to move around.
  if (panMode || (spaceHeld && camera.scale > 1)) {
    event.preventDefault();
    interaction = startPan(event);
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (rotationHandle) {
    event.preventDefault();
    const target = layout.elements.find(
      (item) => item.id === rotationHandle.dataset.rotateId,
    );
    if (!target) return;
    selectOnly(target.id);
    const center = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    interaction = {
      kind: "rotate",
      pointerId: event.pointerId,
      center,
      startAngle: angleFromCenter(point, center),
      item: structuredClone(target),
      before: snapshot(),
    };
    canvas.setPointerCapture(event.pointerId);
    renderCanvas();
    renderInspector();
    renderLayers();
    return;
  }
  if (pathPoint) {
    event.preventDefault();
    const path = layout.elements.find(
      (item) => item.id === pathPoint.dataset.pathPointId,
    );
    if (!path || !hasPoints(path)) return;
    bakeRotation(path);
    selectOnly(path.id);
    interaction = {
      kind: "path-point",
      pointerId: event.pointerId,
      index: Number(pathPoint.dataset.pathPointIndex),
      before: snapshot(),
    };
    canvas.setPointerCapture(event.pointerId);
    renderCanvas();
    renderInspector();
    renderLayers();
    return;
  }
  if (handle) {
    event.preventDefault();
    selectOnly(handle.dataset.resizeId);
    const item = selected(),
      before = snapshot();
    interaction = {
      kind: "resize",
      pointerId: event.pointerId,
      start: point,
      item: { ...item },
      corner: handle.dataset.resizeCorner,
      before,
    };
    canvas.setPointerCapture(event.pointerId);
    renderCanvas();
    renderInspector();
    renderLayers();
    return;
  }
  if (group) {
    event.preventDefault();
    const clickedId = group.dataset.id;
    const isMultiSelect = event.ctrlKey || event.metaKey || event.shiftKey;

    if (isMultiSelect) {
      toggleSelected(clickedId);
      renderAll();
      return;
    }

    // The first click is selection only. A later press-and-drag on the
    // selected element moves it, avoiding accidental moves while inspecting.
    if (!selectedIds.has(clickedId)) {
      selectOnly(clickedId);
      renderAll();
      return;
    }

    const items = selectedItems(),
      before = snapshot();
    interaction = {
      kind: "drag",
      pointerId: event.pointerId,
      start: point,
      items: structuredClone(items),
      before,
    };
    canvas.setPointerCapture(event.pointerId);
    renderCanvas();
    renderInspector();
    renderLayers();
    return;
  }
  if (camera.scale > 1) {
    event.preventDefault();
    interaction = startPan(event);
    canvas.setPointerCapture(event.pointerId);
  } else if (event.pointerType === "touch") {
    interaction = {
      kind: "page-scroll",
      pointerId: event.pointerId,
      clientY: event.clientY,
      startedAt: performance.now(),
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  } else if (selectedIds.size) {
    selectOnly(null);
    renderAll();
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (interaction?.kind === "pinch" && pointers.size >= 2) {
    const [first, second] = [...pointers.values()];
    const distance = Math.max(
      1,
      Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY,
      ),
    );
    const midpoint = {
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    };
    const scale = Math.min(
      getMaxScale(),
      Math.max(1, (interaction.scale * distance) / interaction.distance),
    );
    camera.scale = scale;
    camera.x = midpoint.clientX - canvas.getBoundingClientRect().left;
    camera.y = midpoint.clientY - canvas.getBoundingClientRect().top;
    const viewWidth = layout.width / scale,
      viewHeight = layout.height / scale;
    camera.x = interaction.mapX - (camera.x / canvas.clientWidth) * viewWidth;
    camera.y = interaction.mapY - (camera.y / canvas.clientHeight) * viewHeight;
    event.preventDefault();
    scheduleCameraPaint();
    return;
  }
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.kind === "touch-pending") {
    const distance = Math.hypot(
      event.clientX - interaction.startX,
      event.clientY - interaction.startY,
    );
    if (distance <= 6) return;
    interaction = {
      kind: "page-scroll",
      pointerId: event.pointerId,
      clientY: interaction.clientY,
      startedAt: performance.now(),
      moved: true,
    };
  }
  if (interaction.kind === "page-scroll") {
    const delta = interaction.clientY - event.clientY;
    if (Math.abs(delta) > 2) interaction.moved = true;
    schedulePageScroll(delta);
    interaction.clientY = event.clientY;
    return;
  }
  const item = selected();
  if (interaction.kind === "drag" && interaction.items.length) {
    const point = eventPoint(event);
    const requestedX = snap(point.x - interaction.start.x);
    const requestedY = snap(point.y - interaction.start.y);
    const minX = Math.max(...interaction.items.map((entry) => -entry.x));
    const maxX = Math.min(
      ...interaction.items.map((entry) => layout.width - entry.width - entry.x),
    );
    const minY = Math.max(...interaction.items.map((entry) => -entry.y));
    const maxY = Math.min(
      ...interaction.items.map(
        (entry) => layout.height - entry.height - entry.y,
      ),
    );
    const deltaX = Math.max(minX, Math.min(maxX, requestedX));
    const deltaY = Math.max(minY, Math.min(maxY, requestedY));
    interaction.items.forEach((entry) => {
      const target = layout.elements.find((element) => element.id === entry.id);
      if (!target) return;
      if (hasPoints(target)) {
        target.points = entry.points.map((pathPoint) => ({
          x: pathPoint.x + deltaX,
          y: pathPoint.y + deltaY,
        }));
        syncPathBounds(target);
      } else {
        target.x = entry.x + deltaX;
        target.y = entry.y + deltaY;
      }
    });
    renderCanvas();
  } else if (interaction.kind === "path-point" && hasPoints(item)) {
    const point = eventPoint(event);
    const index = interaction.index;
    const sn = event.altKey ? (v) => v : snap;
    item.points[index] = {
      x: Math.max(0, Math.min(layout.width, sn(point.x))),
      y: Math.max(0, Math.min(layout.height, sn(point.y))),
    };
    syncPathBounds(item);
    renderCanvas();
  } else if (interaction.kind === "rotate" && item) {
    const currentAngle = angleFromCenter(eventPoint(event), interaction.center);
    const delta = currentAngle - interaction.startAngle;
    if (hasPoints(item)) {
      item.points = interaction.item.points.map((pathPoint) =>
        rotatePoint(pathPoint, interaction.center, delta),
      );
      item.rotation = 0;
      syncPathBounds(item);
    } else {
      item.rotation = normalizeRotation(
        (Number(interaction.item.rotation) || 0) + (delta * 180) / Math.PI,
      );
    }
    renderCanvas();
  } else if (interaction.kind === "resize" && item) {
    const point = eventPoint(event);
    const start = interaction.item;
    const corner = interaction.corner;
    if (
      item.type === "tree" ||
      item.type === "landmark" ||
      item.type === "icon"
    ) {
      const resizeFromRight = corner.includes("e");
      const resizeFromBottom = corner.includes("s");
      const anchorX = resizeFromRight ? start.x : start.x + start.width;
      const anchorY = resizeFromBottom ? start.y : start.y + start.height;
      const requestedWidth = Math.abs(point.x - anchorX);
      const requestedHeight = Math.abs(point.y - anchorY);
      const widthDelta = requestedWidth / start.width - 1;
      const heightDelta = requestedHeight / start.height - 1;
      const useWidth = Math.abs(widthDelta) >= Math.abs(heightDelta);
      const basis = useWidth ? start.width : start.height;
      const requestedScale =
        Math.max(
          10,
          snap(basis * (1 + (useWidth ? widthDelta : heightDelta))),
        ) / basis;
      const minScale = Math.max(10 / start.width, 10 / start.height);
      const maxScale = Math.min(
        (resizeFromRight ? layout.width - anchorX : anchorX) / start.width,
        (resizeFromBottom ? layout.height - anchorY : anchorY) / start.height,
      );
      const scale = Math.max(minScale, Math.min(maxScale, requestedScale));
      item.width = start.width * scale;
      item.height = start.height * scale;
      item.x = resizeFromRight ? anchorX : anchorX - item.width;
      item.y = resizeFromBottom ? anchorY : anchorY - item.height;
    } else {
      const right = start.x + start.width;
      const bottom = start.y + start.height;
      const left = corner.includes("w")
        ? Math.max(0, Math.min(right - 10, snap(point.x)))
        : start.x;
      const top = corner.includes("n")
        ? Math.max(0, Math.min(bottom - 10, snap(point.y)))
        : start.y;
      const nextRight = corner.includes("e")
        ? Math.min(layout.width, Math.max(left + 10, snap(point.x)))
        : right;
      const nextBottom = corner.includes("s")
        ? Math.min(layout.height, Math.max(top + 10, snap(point.y)))
        : bottom;
      item.x = left;
      item.y = top;
      item.width = nextRight - left;
      item.height = nextBottom - top;
    }
    renderCanvas();
  } else if (interaction.kind === "pan") {
    panToPointer(event, interaction);
    scheduleCameraPaint();
  }
});
canvas.addEventListener("pointerup", (event) => {
  pointers.delete(event.pointerId);
  if (
    !interaction ||
    (interaction.pointerId !== event.pointerId && interaction.kind !== "pinch")
  )
    return;
  if (interaction.kind === "touch-pending") {
    if (interaction.targetId) {
      selectOnly(interaction.targetId);
    } else {
      selectOnly(null);
    }
    interaction = null;
    renderAll();
    return;
  }
  if (interaction.before) remember(interaction.before);
  if (interaction.kind === "pinch" && pointers.size === 1) {
    const [remaining] = pointers.entries();
    interaction = startPan({ pointerId: remaining[0], ...remaining[1] });
    return;
  }
  interaction = null;
  renderInspector();
});
canvas.addEventListener("pointercancel", (event) => {
  pointers.delete(event.pointerId);
  interaction = null;
});
canvas.addEventListener(
  "wheel",
  (event) => {
    // Scrolling moves through a zoomed map. Hold Ctrl (or Command on macOS)
    // to zoom while keeping the pointer position as the zoom anchor.
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
      delta *= window.innerHeight;
    delta = Math.max(-120, Math.min(120, delta));
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(
        camera.scale * Math.exp(-delta * 0.0025),
        event.clientX,
        event.clientY,
      );
      return;
    }
    // At 100% the entire map is already visible, so keep normal page
    // scrolling available. Once zoomed in, the wheel pans the map instead.
    if (camera.scale <= 1) {
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      return;
    }
    scrollMapByWheel(delta, event.shiftKey);
  },
  { passive: false },
);
canvas.addEventListener("dblclick", (event) => {
  event.preventDefault();
  zoomAt(camera.scale * 1.25, event.clientX, event.clientY);
});

inspector.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-key]")) editStart = snapshot();
});
inspector.addEventListener("input", (event) => {
  const item = selected(),
    key = event.target.dataset.key;
  if (!item || !key) return;
  item[key] = ["x", "y", "width", "height", "fontSize", "pathWidth"].includes(
    key,
  )
    ? key === "fontSize"
      ? Math.max(1, Number(event.target.value) || 12)
      : key === "pathWidth"
        ? Math.max(1, Number(event.target.value) || 28)
        : Math.max(1, Number(event.target.value) || 1)
    : key === "zone"
      ? event.target.value.trim().toUpperCase()
      : event.target.value;
  if (key === "zone") ensureZoneColor(item.zone);
  if (key === "fillOpacity") {
    item.fillOpacity = Math.min(
      1,
      Math.max(0, Number(event.target.value) / 100),
    );
  }
  if (key === "borderWidth")
    item.borderWidth = Math.max(0, Number(event.target.value) || 0);
  if (key === "borderRadius")
    item.borderRadius = Math.max(0, Number(event.target.value) || 0);
  if (key === "iconId") item.iconId = cleanIconId(event.target.value);
  renderCanvas();
});
inspector.addEventListener("change", (event) => {
  const item = selected(),
    key = event.target.dataset.key;
  if (item && key) {
    item[key] = ["x", "y", "width", "height", "fontSize", "pathWidth"].includes(
      key,
    )
      ? key === "fontSize"
        ? Math.max(1, Number(event.target.value) || 12)
        : key === "pathWidth"
          ? Math.max(1, Number(event.target.value) || 28)
          : Math.max(1, Number(event.target.value) || 1)
      : key === "zone"
        ? event.target.value.trim().toUpperCase()
        : event.target.value;
    if (key === "zone") ensureZoneColor(item.zone);
    if (key === "fillOpacity") {
      item.fillOpacity = Math.min(
        1,
        Math.max(0, Number(event.target.value) / 100),
      );
    }
    if (key === "borderWidth")
      item.borderWidth = Math.max(0, Number(event.target.value) || 0);
    if (key === "borderRadius")
      item.borderRadius = Math.min(
        100,
        Math.max(0, Number(event.target.value) || 0),
      );
    if (key === "shape") applyShapeChange(item);
    renderCanvas();
  }
  if (editStart && !equal(editStart, layout)) remember(editStart);
  editStart = null;
  if (
    key === "zone" ||
    key === "iconId" ||
    key === "shape" ||
    key === "fillOpacity"
  )
    renderAll();
});
inspector.addEventListener("click", (event) => {
  if (event.target.id === "add-path-point") {
    const item = selected();
    if (!item || !hasPoints(item)) return;
    const before = snapshot();
    if (item.type === "path") {
      const end = item.points.at(-1);
      const previous = item.points.at(-2) || end;
      item.points.push({
        x: Math.max(
          0,
          Math.min(
            layout.width,
            snap(end.x + (end.x - previous.x || layout.gridSize * 8)),
          ),
        ),
        y: Math.max(
          0,
          Math.min(layout.height, snap(end.y + (end.y - previous.y))),
        ),
      });
    } else {
      lastAddedPoint = { id: item.id, index: addPolygonPoint(item) };
    }
    syncPathBounds(item);
    remember(before);
    renderAll();
    return;
  }
  if (event.target.id === "remove-path-point") {
    const item = selected();
    const minPoints = item?.type === "path" ? 2 : 3;
    if (!item || !hasPoints(item) || item.points.length <= minPoints) return;
    const before = snapshot();
    if (
      item.type !== "path" &&
      lastAddedPoint?.id === item.id &&
      lastAddedPoint.index < item.points.length
    ) {
      item.points.splice(lastAddedPoint.index, 1);
    } else {
      // ไม่มีจุดที่เพิ่งเพิ่ม: ลบจุดสุดท้ายเหมือนเดิม
      item.points.pop();
    }
    lastAddedPoint = null;
    syncPathBounds(item);
    remember(before);
    renderAll();
    return;
  }
  if (event.target.id === "rotate-walkway") {
    const item = selected();
    if (!item || item.type !== "walkway") return;
    const before = snapshot();
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    [item.width, item.height] = [item.height, item.width];
    item.x = Math.max(
      0,
      Math.min(layout.width - item.width, centerX - item.width / 2),
    );
    item.y = Math.max(
      0,
      Math.min(layout.height - item.height, centerY - item.height / 2),
    );
    remember(before);
    renderAll();
    return;
  }
  if (event.target.id === "delete-element") {
    deleteSelectedElements();
  }
});
[widthInput, heightInput, gridInput].forEach((input) => {
  input.addEventListener("focusin", () => {
    editStart = snapshot();
  });
  input.addEventListener("input", () => {
    layout.width = Math.max(100, Number(widthInput.value) || 800);
    layout.height = Math.max(100, Number(heightInput.value) || 900);
    layout.gridSize = Math.max(5, Number(gridInput.value) || 5);
    renderCanvas();
  });
  input.addEventListener("change", () => {
    if (editStart && !equal(editStart, layout)) remember(editStart);
    editStart = null;
    renderAll();
  });
});
function applyBackgroundChange(change) {
  const before = snapshot();
  change();
  if (!equal(before, layout)) remember(before);
  renderAll();
}

backgroundImageInput.addEventListener("change", () => {
  const source = backgroundImageInput.value.trim();
  const normalized = normalizeMapLayout({ ...layout, backgroundImage: source });
  if (source && !normalized.backgroundImage) {
    backgroundHelp.textContent = managerT("backgroundHelp");
    return;
  }
  applyBackgroundChange(() => {
    layout.backgroundImage = normalized.backgroundImage;
  });
});

backgroundOpacityInput.addEventListener("input", () => {
  if (!backgroundOpacityStart) backgroundOpacityStart = snapshot();
  layout.backgroundOpacity = Number(backgroundOpacityInput.value) / 100;
  backgroundOpacityValue.value = `${backgroundOpacityInput.value}%`;
  backgroundOpacityValue.textContent = backgroundOpacityValue.value;
  renderCanvas();
});
backgroundOpacityInput.addEventListener("change", () => {
  layout.backgroundOpacity = Number(backgroundOpacityInput.value) / 100;
  if (backgroundOpacityStart && !equal(backgroundOpacityStart, layout)) {
    remember(backgroundOpacityStart);
  }
  backgroundOpacityStart = null;
  renderAll();
});

backgroundLockedInput.addEventListener("change", () => {
  applyBackgroundChange(() => {
    layout.backgroundLocked = backgroundLockedInput.checked;
  });
});

backgroundFileInput.addEventListener("change", () => {
  const file = backgroundFileInput.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 11000) {
    backgroundHelp.textContent = managerT("backgroundTooLarge");
    backgroundFileInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    applyBackgroundChange(() => {
      layout.backgroundImage = String(reader.result || "");
    });
    backgroundFileInput.value = "";
  });
  reader.readAsDataURL(file);
});

document.querySelector("#fit-background").addEventListener("click", () => {
  if (!layout.backgroundImage) return;
  // Background images always use the complete map boundary. Re-rendering
  // applies that fit after a map-size or image change.
  renderCanvas();
});
document.querySelector("#remove-background").addEventListener("click", () => {
  if (!layout.backgroundImage) return;
  applyBackgroundChange(() => {
    layout.backgroundImage = "";
  });
});
document.querySelector("#save-map").addEventListener("click", () => {
  saveMapLayout(layout);
  document.dispatchEvent(
    new CustomEvent("eventmap:save-layout", {
      detail: compactMapLayout(layout),
    }),
  );
  message.textContent = managerT("saving");
});
document.querySelector("#new-map").addEventListener("click", newBlankMap);
document.querySelector("#pan-mode").addEventListener("click", (event) => {
  panMode = !panMode;
  event.currentTarget.classList.toggle("active", panMode);
  event.currentTarget.setAttribute("aria-pressed", String(panMode));
  canvas.classList.toggle("pan-mode", panMode);
});
document.querySelector("#center-element").addEventListener("click", () => {
  if (!layout.elements.length) return;
  const before = snapshot();
  const left = Math.min(...layout.elements.map((item) => item.x));
  const top = Math.min(...layout.elements.map((item) => item.y));
  const right = Math.max(...layout.elements.map((item) => item.x + item.width));
  const bottom = Math.max(
    ...layout.elements.map((item) => item.y + item.height),
  );
  const offsetX = (layout.width - (right - left)) / 2 - left;
  const offsetY = (layout.height - (bottom - top)) / 2 - top;

  layout.elements.forEach((item) => {
    if (hasPoints(item)) {
      item.points = item.points.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      }));
      syncPathBounds(item);
    } else {
      item.x += offsetX;
      item.y += offsetY;
    }
  });
  remember(before);
  renderAll();
});
document.querySelector("#undo-map").addEventListener("click", undo);
document.querySelector("#redo-map").addEventListener("click", redo);
document.addEventListener("eventmap:layout-saved", () => {
  clearManagerDraft();
  undoStack = [];
  redoStack = [];
  renderAll();
});
document
  .querySelector("#manager-zoom-in")
  .addEventListener("click", () => zoomAt(camera.scale * 1.25));
document
  .querySelector("#manager-zoom-out")
  .addEventListener("click", () => zoomAt(camera.scale / 1.25));
document.querySelector("#manager-fit-map").addEventListener("click", () => {
  camera = { scale: 1, x: 0, y: 0 };
  renderCanvas();
});
document.querySelector("#export-map").addEventListener("click", exportPNG);
document.querySelector("#preview-map").addEventListener("click", () => {
  const preview = canvas.cloneNode(true);
  preview.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
  preview
    .querySelectorAll(".resize-handle, .path-point-handle")
    .forEach((node) => node.remove());
  previewImage.replaceChildren(preview);
  previewDialog.showModal();
});
document
  .querySelector("#close-map-preview")
  .addEventListener("click", () => previewDialog.close());
window.addEventListener("keydown", (event) => {
  const isEditingText = event.target.matches(
    "input, textarea, select, [contenteditable='true']",
  );
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    !isEditingText &&
    !previewDialog.open &&
    selectedIds.size
  ) {
    event.preventDefault();
    deleteSelectedElements();
    return;
  }
  if (
    event.code === "Space" &&
    !event.target.matches("input, textarea, button")
  ) {
    spaceHeld = true;
    canvas.classList.add("pan-mode");
    event.preventDefault();
  }
  if ((event.ctrlKey || event.metaKey) && !isEditingText) {
    const key = event.key.toLowerCase();
    if (key === "c" && copySelectedElements()) {
      event.preventDefault();
      return;
    }
    if (key === "v" && copiedElements.length) {
      event.preventDefault();
      pasteCopiedElements();
      return;
    }
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    if (key === "y" || event.shiftKey) redo();
    else undo();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  spaceHeld = false;
  canvas.classList.toggle("pan-mode", panMode);
});
addLayoutSourceButtons();
onManagerLanguageChange(() => {
  renderPalette();
  renderAll();
});
initialiseManagerLanguage();
renderAll();
loadIconImagesFromGoogleSheet()
  .then(renderCanvas)
  .catch(() => {});
if (restoredDraft) {
  message.textContent = managerT("draftRestored");
} else {
  void loadGoogleSheetLayout();
}
