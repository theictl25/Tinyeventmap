import {
  $,
  SVG_NS,
  zones,
  MAP_CONFIG,
  desktopQuery,
  reducedMotion,
} from "../shared/config.js";
import {
  state,
  booths,
  boothElements,
  boothById,
  featuredShops,
  updateBoothByIdMap,
} from "../shared/state.js";
import { t } from "./i18n.js";
import {
  getMapLayout,
  getIconImages,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
} from "../shared/map-layout.js";

function mapSize() {
  const layout = getMapLayout();
  return { width: layout.width, height: layout.height };
}

function getMaxScaleMultiplier(size) {
  const dimensionRatio = Math.max(
    size.width / DEFAULT_MAP_WIDTH,
    size.height / DEFAULT_MAP_HEIGHT,
    1,
  );
  return MAP_CONFIG.maxScaleMultiplier * dimensionRatio;
}

export function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  if (text !== undefined) element.textContent = text;
  return element;
}

export function addBooth(
  zone,
  number,
  x,
  y,
  width = 64,
  height = 44,
  shape = "rectangle",
  color = "#eff2f6",
  fontSize = 12,
  textColor = "#425066",
  boothId = "",
  mapLabel = "",
  rotation = 0,
  points = null,
  fillOpacity = 1,
  border = {},
) {
  const id = String(boothId || zone + String(number).padStart(2, "0")).trim();
  const shop = featuredShops[id] || {};
  const defaultName = id;
  const DEFAULT_LOGO = new URL("./assets/default_logo.png", document.baseURI)
    .href;
  const rawLogo = String(shop?.logo ?? "").trim();
  const hasCustomLogo = Boolean(
    rawLogo &&
    !rawLogo.includes("default_logo.png") &&
    rawLogo !== DEFAULT_LOGO,
  );

  booths.push({
    id,
    mapLabel: String(mapLabel || id).trim(),
    zone,
    x,
    y,
    width,
    height,
    shape,
    name: shop?.name || defaultName,
    category: shop?.category || "Other",
    logo: rawLogo || DEFAULT_LOGO,
    customLogo: hasCustomLogo ? rawLogo : "",
    images: Array.isArray(shop?.images) ? shop.images : [],
    color,
    fontSize,
    textColor,
    rotation,
    points,
    fillOpacity,
    border,
    description: shop?.description || t("defaultDesc"),
    hours: shop?.hours || t("defaultHours"),
    facebook: String(shop?.facebook ?? "").trim(),
    featured: Boolean(shop),
  });
}

function findShop(item) {
  const keys = [item.id, item.boothId, item.iconId]
    .filter(Boolean)
    .flatMap((key) => [key, String(key).toUpperCase()]);
  for (const key of keys) {
    if (featuredShops[key]) return featuredShops[key];
  }
  return null;
}

export function buildMapData(populateCategoryDropdownCb) {
  booths.length = 0;

  const layout = getMapLayout();
  layout.elements
    .filter((element) => element.type === "booth")
    .forEach((booth) => {
      const id = booth.boothId || booth.id;
      const zone = booth.zone;
      const number = Number(id.replace(/\D/g, "")) || 1;
      addBooth(
        zone,
        number,
        booth.x,
        booth.y,
        booth.width,
        booth.height,
        booth.shape,
        booth.color,
        booth.fontSize,
        booth.textColor,
        id,
        (state.lang === "lo" ? booth.label_lo : booth.label_en) ||
          booth.label_en ||
          booth.label_lo ||
          id,
        booth.rotation,
        booth.points,
        booth.fillOpacity,
        {
          width: booth.borderWidth,
          radius: booth.borderRadius,
          color: booth.borderColor,
        },
      );
    });

  updateBoothByIdMap();

  layout.elements
    .filter(
      (element) =>
        element.type === "stage" ||
        element.type === "other" ||
        element.type === "icon",
    )
    .forEach((item) => {
      const id = item.id;
      const rawShop = findShop(item) || {};
      const defaultLabel =
        (state.lang === "lo" ? item.label_lo : item.label_en) ||
        item.label_en ||
        item.label_lo ||
        (item.type === "stage"
          ? state.lang === "lo"
            ? "ເວທີຫຼັກ"
            : "Main Stage"
          : state.lang === "lo"
            ? "ອື່ນໆ"
            : "Other");
      const name = rawShop.name || defaultLabel;
      const category =
        rawShop.category ||
        (item.type === "stage"
          ? state.lang === "lo"
            ? "ເວທີ"
            : "Stage"
          : state.lang === "lo"
            ? "ຈຸດບໍລິການ"
            : "Facility");
      const description =
        rawShop.description ||
        (item.type === "stage"
          ? state.lang === "lo"
            ? "ເວທີຫຼັກສຳລັບການສະແດງ ແລະ ກິດຈະກຳຕ່າງໆພາຍໃນງານ"
            : "Main stage for performances, presentations and event activities."
          : state.lang === "lo"
            ? "ຈຸດບໍລິການ ແລະ ສິ່ງອຳນວຍຄວາມສະດວກພາຍໃນງານ"
            : "Facility and point of interest inside the event.");
      const hours =
        rawShop.hours ||
        (state.lang === "lo" ? "ເປີດຕາມເວລາງານ" : "Open during event hours");

      const poiItem = {
        id,
        type: item.type,
        mapLabel: defaultLabel,
        zone: item.zone || "",
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        shape: item.shape || "rectangle",
        name,
        category,
        logo: rawShop.logo || getIconImages()[item.iconId] || "",
        customLogo: rawShop.logo || getIconImages()[item.iconId] || "",
        images: Array.isArray(rawShop.images) ? rawShop.images : [],
        color: item.color || "#dbeafe",
        fontSize: item.fontSize || 12,
        textColor: item.textColor || "#334155",
        rotation: item.rotation || 0,
        fillOpacity: item.fillOpacity ?? 1,
        border: {
          width: item.borderWidth,
          radius: item.borderRadius,
          color: item.borderColor,
        },
        description,
        hours,
        facebook: String(rawShop.facebook ?? "").trim(),
        featured: Boolean(rawShop && rawShop.name),
        points: item.points || null,
      };

      boothById.set(id, poiItem);
      boothById.set(id.toUpperCase(), poiItem);
      if (item.boothId) {
        boothById.set(item.boothId, poiItem);
        boothById.set(item.boothId.toUpperCase(), poiItem);
      }
    });

  if (populateCategoryDropdownCb) populateCategoryDropdownCb();
}

function zoneStyle(zone) {
  const fallback = zones[zone] || {
    background: "#eff2f6",
    border: "#94a3b8",
    text: "#334155",
  };
  const color = getMapLayout().zoneColors?.[zone];
  return color ? { ...fallback, background: color } : fallback;
}

function mapShape(item, attributes) {
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const b = item.border || {
    width: item.borderWidth,
    radius: item.borderRadius,
    color: item.borderColor,
  };

  let el;
  if (item.type === "walkway") {
    return svgElement("rect", {
      ...attributes,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      stroke: "none",
    });
  } else if (
    item.shape === "polygon" &&
    Array.isArray(item.points) &&
    item.points.length >= 3
  ) {
    el = svgElement("polygon", {
      ...attributes,
      points: item.points.map((p) => `${p.x},${p.y}`).join(" "),
      "stroke-linejoin": "round",
    });
  } else if (item.shape === "circle") {
    el = svgElement("ellipse", {
      ...attributes,
      cx: centerX,
      cy: centerY,
      rx: item.width / 2,
      ry: item.height / 2,
    });
  } else if (item.shape === "triangle") {
    el = svgElement("polygon", {
      ...attributes,
      points: `${centerX},${item.y} ${item.x + item.width},${item.y + item.height} ${item.x},${item.y + item.height}`,
    });
  } else if (item.shape === "hexagon") {
    el = svgElement("polygon", {
      ...attributes,
      points: `${item.x + item.width * 0.25},${item.y} ${item.x + item.width * 0.75},${item.y} ${item.x + item.width},${centerY} ${item.x + item.width * 0.75},${item.y + item.height} ${item.x + item.width * 0.25},${item.y + item.height} ${item.x},${centerY}`,
    });
  } else {
    el = svgElement("rect", {
      ...attributes,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rx: b.radius ?? 8,
    });
  }

  const style = [];
  if (b.width !== undefined) style.push(`stroke-width:${b.width}px`);
  if (b.color) style.push(`stroke:${b.color}`);
  if (style.length) el.setAttribute("style", style.join(";"));
  return el;
}

function mapPathData(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const radius = 18;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const beforeLength = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
    );
    const afterLength = Math.hypot(next.x - current.x, next.y - current.y);
    const before = Math.min(radius, beforeLength / 2);
    const after = Math.min(radius, afterLength / 2);
    const start = {
      x:
        current.x +
        ((previous.x - current.x) / Math.max(1, beforeLength)) * before,
      y:
        current.y +
        ((previous.y - current.y) / Math.max(1, beforeLength)) * before,
    };
    const end = {
      x: current.x + ((next.x - current.x) / Math.max(1, afterLength)) * after,
      y: current.y + ((next.y - current.y) / Math.max(1, afterLength)) * after,
    };
    d += ` L ${start.x} ${start.y} Q ${current.x} ${current.y} ${end.x} ${end.y}`;
  }
  const last = points.at(-1);
  return `${d} L ${last.x} ${last.y}`;
}

function appendBlossom(group, cx, cy, size) {
  const petal = size * 0.45;
  [
    [0, -size],
    [size, 0],
    [0, size],
    [-size, 0],
    [size * 0.7, -size * 0.7],
  ].forEach(([x, y]) => {
    group.append(
      svgElement("circle", {
        cx: cx + x,
        cy: cy + y,
        r: petal,
        fill: "#fecdd3",
      }),
    );
  });
  group.append(
    svgElement("circle", { cx, cy, r: size * 0.38, fill: "#facc15" }),
  );
}

function appendTree(group, item) {
  const x = item.x;
  const y = item.y;
  const width = item.width;
  const height = item.height;
  const circle = (cx, cy, r, opacity = 1) =>
    group.append(
      svgElement("circle", {
        cx,
        cy,
        r,
        fill: item.color,
        "fill-opacity": opacity,
      }),
    );

  group.append(
    svgElement("path", {
      d: `M ${x + width * 0.43} ${y + height * 0.46} C ${x + width * 0.45} ${y + height * 0.66}, ${x + width * 0.36} ${y + height * 0.84}, ${x + width * 0.39} ${y + height} L ${x + width * 0.72} ${y + height} C ${x + width * 0.69} ${y + height * 0.82}, ${x + width * 0.59} ${y + height * 0.63}, ${x + width * 0.61} ${y + height * 0.46} Z`,
      fill: "#8b6b53",
    }),
  );
  circle(x + width * 0.5, y + height * 0.24, Math.min(width, height) * 0.24);
  circle(
    x + width * 0.28,
    y + height * 0.43,
    Math.min(width, height) * 0.25,
    0.96,
  );
  circle(
    x + width * 0.72,
    y + height * 0.45,
    Math.min(width, height) * 0.28,
    0.92,
  );
  circle(
    x + width * 0.5,
    y + height * 0.59,
    Math.min(width, height) * 0.3,
    0.94,
  );
  circle(
    x + width * 0.14,
    y + height * 0.61,
    Math.min(width, height) * 0.18,
    0.9,
  );
  circle(
    x + width * 0.88,
    y + height * 0.62,
    Math.min(width, height) * 0.18,
    0.9,
  );
  appendBlossom(
    group,
    x + width * 0.31,
    y + height * 0.3,
    Math.min(width, height) * 0.06,
  );
  appendBlossom(
    group,
    x + width * 0.62,
    y + height * 0.53,
    Math.min(width, height) * 0.07,
  );
  appendBlossom(
    group,
    x + width * 0.84,
    y + height * 0.63,
    Math.min(width, height) * 0.06,
  );
}
function appendIcon(group, item) {
  const src = getIconImages()[item.iconId];
  if (!src) return;
  // พื้นที่รับการกดเท่าขนาดไอคอน
  group.append(
    svgElement("rect", {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fill: "transparent",
    }),
  );
  const image = svgElement("image", {
    href: src,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    preserveAspectRatio: "xMidYMid meet",
    "pointer-events": "none",
  });
  image.addEventListener("error", () => image.remove());
  group.append(image);
}

export function addZoneLabel(zone, x, y) {
  const color = zoneStyle(zone);
  const group = svgElement("g");
  const labelText = state.lang === "lo" ? `ໂຊນ ${zone}` : `Zone ${zone}`;

  group.append(
    svgElement("rect", {
      x: x - 39,
      y: y - 18,
      width: 78,
      height: 28,
      rx: 7,
      fill: color.background,
    }),
    svgElement(
      "text",
      {
        x,
        y,
        "text-anchor": "middle",
        fill: color.text,
        "font-size": 15,
        "font-weight": 700,
      },
      labelText,
    ),
  );

  $("#zone-labels").append(group);
}

let selectBoothRef = null;
let clearSelectionRef = null;

export function setSelectBoothHandler(handler) {
  selectBoothRef = handler;
}

export function setClearSelectionHandler(handler) {
  clearSelectionRef = handler;
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

function wrapItemLabel(
  label,
  width,
  height,
  fontSize,
  verticalWalkway = false,
) {
  const text = String(label || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
  if (!text) return [];

  const size = Math.max(1, Number(fontSize) || 12);
  const availableWidth = (verticalWalkway ? height : width) - 10;
  const maximumCharacters = Math.max(
    3,
    Math.floor(availableWidth / (size * 0.6)),
  );
  const lines = [];

  text.split(/\r?\n/).forEach((paragraph) => {
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

function createItemTextElement({
  lines,
  fontSize,
  textColor,
  centerX,
  centerY,
  verticalWalkway = false,
  className = "",
}) {
  if (!lines || !lines.length) return null;

  const size = Math.max(1, Number(fontSize) || 12);
  const lineHeight = size * 1.2;
  const firstLineY =
    centerY - (lineHeight * (lines.length - 1)) / 2 + size * 0.35;

  const attributes = {
    x: centerX,
    y: firstLineY,
    "text-anchor": "middle",
    "font-size": size,
    fill: textColor || "#425066",
  };

  if (className) {
    attributes.class = className;
  }

  if (verticalWalkway) {
    attributes.transform = `rotate(-90 ${centerX} ${centerY})`;
  }

  const textElement = svgElement("text", attributes);

  lines.forEach((line, index) => {
    textElement.append(
      svgElement(
        "tspan",
        {
          x: centerX,
          dy: index ? lineHeight : 0,
        },
        line,
      ),
    );
  });

  return textElement;
}
function buildBoothGroup(booth) {
  const zoneTextStr = state.lang === "lo" ? "ໂຊນ" : "Zone";
  const color = zoneStyle(booth.zone);
  const group = svgElement("g", {
    class: "booth",
    role: "button",
    tabindex: "0",
    "aria-label": `${booth.id}, ${booth.name}, ${zoneTextStr} ${booth.zone}`,
    "aria-pressed": "false",
    "data-id": booth.id,
    ...(booth.rotation
      ? {
          transform: `rotate(${booth.rotation} ${booth.x + booth.width / 2} ${booth.y + booth.height / 2})`,
        }
      : {}),
  });

  const lines = wrapItemLabel(
    booth.mapLabel,
    booth.width,
    booth.height,
    booth.fontSize,
    false,
  );
  const textElement = createItemTextElement({
    lines,
    fontSize: booth.fontSize,
    textColor: booth.textColor,
    centerX: booth.x + booth.width / 2,
    centerY: booth.y + booth.height / 2,
    verticalWalkway: false,
    className: "booth-label",
  });

  group.append(
    mapShape(booth, {
      fill: booth.color || color.background,
      stroke: "#64748b",
      "fill-opacity": booth.fillOpacity ?? 1,
    }),
  );
  if (booth.customLogo) {
    const pad = Math.max(
      2,
      Math.min(4, Math.floor(Math.min(booth.width, booth.height) * 0.08)),
    );
    const mapLogoUrl = booth.customLogo.includes("drive.google.com")
      ? booth.customLogo.replace(/sz=w\d+/, "sz=w160")
      : booth.customLogo.includes("googleusercontent.com")
        ? booth.customLogo.replace(/=w\d+.*$/, "=w160")
        : booth.customLogo;

    const imageElement = svgElement("image", {
      href: mapLogoUrl,
      x: booth.x + pad,
      y: booth.y + pad,
      width: Math.max(1, booth.width - pad * 2),
      height: Math.max(1, booth.height - pad * 2),
      preserveAspectRatio: "xMidYMid meet",
      class: "booth-logo",
    });

    // Fallback to text label if logo image fails to load
    imageElement.addEventListener("error", () => {
      imageElement.remove();
      if (textElement && !group.contains(textElement)) {
        group.append(textElement);
      }
    });

    group.append(imageElement);
  } else if (textElement) {
    group.append(textElement);
  }

  // group.addEventListener("click", (event) => {
  //   event.preventDefault();
  //   event.stopPropagation();

  //   if (selectBoothRef) {
  //     selectBoothRef(booth.id, true, false);
  //   }
  // });

  group.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();

      if (selectBoothRef) {
        selectBoothRef(booth.id, true, true);
      }
    }
  });

  boothElements.set(booth.id, group);
  return group;
}
export function renderMap(applyFiltersCb) {
  const size = mapSize();
  const layout = getMapLayout();
  const boothByLayoutId = new Map(booths.map((b) => [b.id, b]));
  $("#map-background")?.setAttribute("width", size.width);
  $("#map-background")?.setAttribute("height", size.height);
  const bgRect = $("#map-background");
  if (bgRect) {
    bgRect.setAttribute("fill", layout.backgroundTransparent ? "none" : "#fff");
    // ถ้า CSS ตั้งสีไว้ ให้ inline style ชนะ
    bgRect.style.fill = layout.backgroundTransparent ? "none" : "";
  }
  const backgroundImage = $("#map-background-image");
  if (backgroundImage) {
    backgroundImage.setAttribute("width", size.width);
    backgroundImage.setAttribute("height", size.height);
    backgroundImage.setAttribute("preserveAspectRatio", "none");
    backgroundImage.setAttribute("opacity", String(layout.backgroundOpacity));
    if (layout.backgroundImage) {
      backgroundImage.setAttribute("href", layout.backgroundImage);
      backgroundImage.removeAttribute("hidden");
    } else {
      backgroundImage.removeAttribute("href");
      backgroundImage.setAttribute("hidden", "");
    }
  }
  $("#zone-labels").replaceChildren();
  $("#map-elements").replaceChildren();
  $("#booth-layer").replaceChildren();
  $("#gates").replaceChildren();
  $("#zone-filters").replaceChildren();
  boothElements.clear();

  getMapLayout().elements.forEach((item) => {
    if (item.type === "booth") {
      const booth = boothByLayoutId.get(item.boothId || item.id);
      if (booth) $("#map-elements").append(buildBoothGroup(booth));
      return;
    }
    const isInteractive =
      item.type === "stage" ||
      item.type === "other" ||
      (item.type === "icon" && Boolean(getIconImages()[item.iconId]));
    const itemId = item.id;
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    const rotation = Number(item.rotation) || 0;
    const ownLabel =
      (state.lang === "lo" ? item.label_lo : item.label_en) ||
      item.label_en ||
      item.label_lo;
    const label =
      item.type === "tree"
        ? ""
        : item.type === "icon"
          ? ownLabel || ""
          : ownLabel || item.type;
    const group = svgElement("g", {
      class: `map-element map-${item.type}${isInteractive ? " booth interactive-poi" : ""}`,
      ...(isInteractive
        ? {
            role: "button",
            tabindex: "0",
            "aria-label": label,
            "aria-pressed": "false",
            "data-id": itemId,
          }
        : {}),
      ...(rotation
        ? { transform: `rotate(${rotation} ${centerX} ${centerY})` }
        : {}),
    });
    if (item.type === "tree") {
      appendTree(group, item);
    } else if (item.type === "path") {
      group.append(
        svgElement("path", {
          d: mapPathData(item.points),
          fill: "none",
          stroke: item.color,
          "stroke-width": item.pathWidth,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "pointer-events": "none",
        }),
      );
    } else if (item.type === "icon") {
      appendIcon(group, item);
    } else if (item.type === "label") {
    } else {
      group.append(
        mapShape(item, {
          fill: item.color,
          stroke: "#94a3b8",
          "fill-opacity": item.fillOpacity ?? 1,
        }),
      );
    }
    const verticalWalkway = item.type === "walkway" && item.height > item.width;
    const lines =
      item.type === "path"
        ? []
        : wrapItemLabel(
            label,
            item.width,
            item.height,
            item.fontSize,
            verticalWalkway,
          );
    const textElement = createItemTextElement({
      lines,
      fontSize: item.fontSize,
      textColor: item.textColor || "#334155",
      centerX: item.x + item.width / 2,
      centerY:
        item.type === "icon"
          ? item.y + item.height + (Number(item.fontSize) || 12) + 2
          : item.y + item.height / 2,
      verticalWalkway,
      className: isInteractive ? "booth-label" : "",
    });
    if (textElement) {
      group.append(textElement);
    }
    if (isInteractive) {
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (selectBoothRef) {
            selectBoothRef(itemId, true, true);
          }
        }
      });
      boothElements.set(itemId, group);
    }
    $("#map-elements").append(group);
  });

  /* Legacy gates are intentionally disabled: entrances/exits now come from MapLayout. */
  if (false)
    [
      { x: 255, key: "entrance1", entry: true },
      { x: 355, key: "exit1", entry: false },
      { x: 545, key: "entrance2", entry: true },
      { x: 645, key: "exit2", entry: false },
    ].forEach((gate) => {
      const label = t(gate.key);
      const group = svgElement("g", {
        "aria-label": label,
        role: "img",
      });

      group.append(
        svgElement("rect", {
          x: gate.x - 43,
          y: 837,
          width: 86,
          height: 53,
          rx: 14,
          fill: "#fff",
          stroke: "#e0e5ee",
        }),
        svgElement(
          "text",
          {
            x: gate.x,
            y: 859,
            "text-anchor": "middle",
            "font-size": 26,
            fill: gate.entry ? "#00996b" : "#ed3660",
          },
          gate.entry ? "↑" : "↓",
        ),
        svgElement(
          "text",
          {
            x: gate.x,
            y: 878,
            "text-anchor": "middle",
            "font-size": 10,
            "font-weight": 650,
            fill: "#465269",
          },
          label,
        ),
      );

      $("#gates").append(group);
    });

  // Build filters from the booths currently placed on the map. This lets a
  // newly-created zone appear without needing to edit the frontend config.
  const mapZones = [
    ...new Set(
      booths.map((booth) => String(booth.zone || "").trim()).filter(Boolean),
    ),
  ].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  // A saved selection may no longer exist after the manager changes a map.
  if (state.zone !== "all" && !mapZones.includes(state.zone)) {
    state.zone = "all";
  }

  ["all", ...mapZones].forEach((zone) => {
    const button = document.createElement("button");
    button.className = "zone-chip";
    button.dataset.zone = zone;
    const label =
      zone === "all"
        ? t("zoneAll")
        : state.lang === "lo"
          ? `ໂຊນ ${zone}`
          : `Zone ${zone}`;
    button.textContent = label;

    button.addEventListener("click", () => {
      state.zone = zone;
      if (applyFiltersCb) applyFiltersCb();
    });

    $("#zone-filters").append(button);
  });
}

/* =========================================================
   MAP PAN & ZOOM ENGINE
   ========================================================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getViewportCenter() {
  const viewport = $("#viewport");
  return {
    x: viewport.clientWidth / 2,
    y: viewport.clientHeight / 2,
  };
}

function localPoint(event) {
  const viewport = $("#viewport");
  const rect = viewport.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function constrain() {
  const viewport = $("#viewport");
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;

  const size = mapSize();
  const worldWidth = size.width * state.scale;
  const worldHeight = size.height * state.scale;

  if (worldWidth <= width) {
    state.x = (width - worldWidth) / 2;
  } else {
    state.x = clamp(state.x, width - worldWidth, 0);
  }

  if (worldHeight <= height) {
    state.y = (height - worldHeight) / 2;
  } else {
    state.y = clamp(state.y, height - worldHeight, 0);
  }
}

let lastPaintX = null;
let lastPaintY = null;
let lastPaintScale = null;

export function paint() {
  constrain();
  const world = $("#world");
  const zoomLabel = $("#zoom-label");

  if (
    state.x !== lastPaintX ||
    state.y !== lastPaintY ||
    state.scale !== lastPaintScale
  ) {
    if (world) {
      world.setAttribute(
        "transform",
        `translate(${state.x} ${state.y}) scale(${state.scale})`,
      );
    }
    lastPaintX = state.x;
    lastPaintY = state.y;
    lastPaintScale = state.scale;
  }

  const zoomPercent = Math.round((state.scale / state.minScale) * 100);
  if (zoomLabel) zoomLabel.textContent = `${zoomPercent}%`;
}

let animationFrame = 0;

export function stopAnimation() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
}

export function animateTo(x, y, scale, duration = 260) {
  stopAnimation();
  scale = clamp(scale, state.minScale, state.maxScale);

  const target = { x, y, scale };
  const previous = { x: state.x, y: state.y, scale: state.scale };

  state.x = target.x;
  state.y = target.y;
  state.scale = target.scale;
  constrain();
  target.x = state.x;
  target.y = state.y;

  state.x = previous.x;
  state.y = previous.y;
  state.scale = previous.scale;

  if (reducedMotion.matches) {
    Object.assign(state, target);
    paint();
    return;
  }

  const start = { x: state.x, y: state.y, scale: state.scale };
  const startTime = performance.now();

  function frame(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const easing = 1 - Math.pow(1 - progress, 3);

    state.x = start.x + (target.x - start.x) * easing;
    state.y = start.y + (target.y - start.y) * easing;
    state.scale = start.scale + (target.scale - start.scale) * easing;
    paint();

    if (progress < 1) {
      animationFrame = requestAnimationFrame(frame);
    } else {
      animationFrame = 0;
    }
  }

  animationFrame = requestAnimationFrame(frame);
}

export function fitMap() {
  stopAnimation();
  const viewport = $("#viewport");
  if (!viewport) return;

  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;

  const size = mapSize();
  state.minScale = Math.min(width / size.width, height / size.height) * 0.95;
  state.maxScale = state.minScale * getMaxScaleMultiplier(size);
  state.scale = state.minScale;
  state.x = (width - size.width * state.scale) / 2;
  state.y = (height - size.height * state.scale) / 2;

  paint();
}

export function centerBooth(booth) {
  const viewport = $("#viewport");
  if (!viewport) return;

  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;

  const isMobile = !desktopQuery.matches;

  // ให้บูทกินสัดส่วนของ viewport ประมาณนี้ (มือถือน้อยกว่า = ซูมน้อยกว่า)
  const targetFill = isMobile ? 0.22 : 0.3;
  const boothSize = Math.max(booth.width, booth.height, 1);
  const desired = (Math.min(width, height) * targetFill) / boothSize;

  // เพดานซูมเทียบกับ fit scale (มือถือจำกัดไว้ต่ำกว่า)
  const maxFocus = state.minScale * (isMobile ? 1.6 : 2.4);
  const minFocus = state.minScale * 1.15;

  let scale = clamp(desired, minFocus, maxFocus);
  scale = clamp(scale, state.minScale, state.maxScale);

  // ถ้าผู้ใช้ซูมลึกกว่านี้อยู่แล้ว ไม่ต้องซูมเข้าเพิ่ม
  if (state.scale > scale) scale = state.scale;

  const boothCenterX = booth.x + booth.width / 2;
  const boothCenterY = booth.y + booth.height / 2;

  const x = width / 2 - boothCenterX * scale;
  const y = height * (isMobile ? 0.35 : 0.5) - boothCenterY * scale;

  animateTo(x, y, scale);
}

export function zoomAt(factor, pointerX, pointerY) {
  stopAnimation();
  if (!state.scale) return;

  const oldScale = state.scale;
  const newScale = clamp(oldScale * factor, state.minScale, state.maxScale);
  if (newScale === oldScale) return;

  const mapX = (pointerX - state.x) / oldScale;
  const mapY = (pointerY - state.y) / oldScale;

  state.scale = newScale;
  state.x = pointerX - mapX * newScale;
  state.y = pointerY - mapY * newScale;

  paint();
}

export function setupMapInteractions() {
  const viewport = $("#viewport");

  if (!viewport) return;

  // =========================================================
  // ZOOM BUTTONS
  // =========================================================

  $("#zoom-in")?.addEventListener("click", () => {
    const center = getViewportCenter();

    zoomAt(MAP_CONFIG.zoomButtonFactor, center.x, center.y);
  });

  $("#zoom-out")?.addEventListener("click", () => {
    const center = getViewportCenter();

    zoomAt(1 / MAP_CONFIG.zoomButtonFactor, center.x, center.y);
  });

  $("#fit-map")?.addEventListener("click", () => {
    fitMap();
  });

  // =========================================================
  // MOUSE WHEEL
  // =========================================================

  viewport.addEventListener(
    "wheel",
    (event) => {
      let delta = event.deltaY;

      // Normalize wheel delta
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        delta *= 16;
      }

      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        delta *= window.innerHeight;
      }

      delta = clamp(delta, -120, 120);

      const hasDeltaX = Math.abs(event.deltaX || 0) >= 0.01;
      const hasDeltaY = Math.abs(delta) >= 0.01;
      if (!hasDeltaX && !hasDeltaY) return;

      // =====================================================
      // CTRL + SCROLL = ZOOM
      // =====================================================

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();

        const point = localPoint(event);

        const factor = Math.exp(-delta * MAP_CONFIG.wheelSensitivity);

        zoomAt(factor, point.x, point.y);

        return;
      }

      // =====================================================
      // SHIFT + SCROLL = PAN HORIZONTAL
      // =====================================================

      if (event.shiftKey) {
        event.preventDefault();

        stopAnimation();

        state.x -= delta;

        constrain();
        paint();

        return;
      }

      // =====================================================
      // AT MIN SCALE
      // SCROLL DOWN -> PAGE DOWN
      // SCROLL UP   -> PAGE UP
      // =====================================================

      const atMinScale = state.scale <= state.minScale + 0.0001;

      if (atMinScale) {
        event.preventDefault();

        window.scrollBy({
          top: delta,
          left: 0,
          behavior: "auto",
        });

        return;
      }

      // =====================================================
      // NORMAL SCROLL = PAN MAP UP / DOWN
      // =====================================================

      event.preventDefault();

      stopAnimation();

      state.y -= delta;

      if (hasDeltaX) {
        let deltaX = event.deltaX;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
          deltaX *= 16;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
          deltaX *= window.innerWidth;
        }
        state.x -= clamp(deltaX, -120, 120);
      }

      constrain();
      paint();
    },
    {
      passive: false,
    },
  );

  // =========================================================
  // DOUBLE CLICK = ZOOM IN
  // =========================================================

  viewport.addEventListener("dblclick", (event) => {
    event.preventDefault();

    const point = localPoint(event);

    zoomAt(MAP_CONFIG.zoomButtonFactor, point.x, point.y);
  });

  // =========================================================
  // POINTER STATE
  // =========================================================

  const pointers = new Map();

  let gesture = null;
  let tap = null;

  // =========================================================
  // POINTER DOWN
  // Mouse:
  //   Left click = Pan
  //
  // Mobile:
  //   One finger at fit scale = page scroll
  //   One finger after zoom = map pan
  //   Two fingers = pinch zoom
  // =========================================================

  viewport.addEventListener("pointerdown", (event) => {
    // Mouse only accepts left button
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    stopAnimation();

    const point = localPoint(event);

    pointers.set(event.pointerId, point);

    // =====================================================
    // FIRST POINTER
    // =====================================================

    if (pointers.size === 1) {
      const boothElement = event.target.closest(".booth");

      tap = {
        pointerId: event.pointerId,

        point: {
          x: point.x,
          y: point.y,
        },

        id: boothElement?.dataset.id || null,

        moved: false,
      };

      // On mobile, let a one-finger drag scroll the page while the whole
      // map is already visible. Once the user zooms in, the same gesture
      // pans the map instead.
      const shouldScrollPage =
        event.pointerType === "touch" && state.scale <= state.minScale + 0.0001;

      gesture = {
        type: shouldScrollPage ? "page-scroll" : "pan",

        point: {
          x: point.x,
          y: point.y,
        },

        clientY: event.clientY,

        x: state.x,
        y: state.y,
      };
    }

    // =====================================================
    // SECOND POINTER
    // Start Pinch
    // =====================================================

    if (pointers.size >= 2) {
      if (tap) {
        tap.moved = true;
      }

      const points = [...pointers.values()];

      const [a, b] = points;

      const midpoint = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };

      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

      gesture = {
        type: "pinch",

        distance,

        midpoint,

        scale: state.scale,

        mapX: (midpoint.x - state.x) / state.scale,

        mapY: (midpoint.y - state.y) / state.scale,
      };
    }

    // Capture pointer

    viewport.setPointerCapture(event.pointerId);

    viewport.classList.add("dragging");
  });

  // =========================================================
  // POINTER MOVE
  //
  // THIS IS THE IMPORTANT PART
  // ทำให้ Drag Map ได้จริง
  // =========================================================

  viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    const point = localPoint(event);

    pointers.set(event.pointerId, point);

    // =====================================================
    // DETECT DRAG
    // =====================================================

    if (tap) {
      const distance = Math.hypot(point.x - tap.point.x, point.y - tap.point.y);

      if (distance > MAP_CONFIG.dragThreshold) {
        tap.moved = true;
      }
    }

    // =====================================================
    // PINCH
    // =====================================================

    if (pointers.size >= 2) {
      const points = [...pointers.values()];

      const [a, b] = points;

      const midpoint = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };

      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

      if (!gesture || gesture.type !== "pinch") {
        gesture = {
          type: "pinch",

          distance,

          midpoint,

          scale: state.scale,

          mapX: (midpoint.x - state.x) / state.scale,

          mapY: (midpoint.y - state.y) / state.scale,
        };
      }

      // Scale ratio

      const scaleRatio = distance / gesture.distance;

      const newScale = clamp(
        gesture.scale * Math.pow(scaleRatio, MAP_CONFIG.pinchSensitivity),

        state.minScale,

        state.maxScale,
      );

      state.scale = newScale;

      // Keep pinch center fixed

      state.x = midpoint.x - gesture.mapX * state.scale;

      state.y = midpoint.y - gesture.mapY * state.scale;

      constrain();
      paint();

      return;
    }

    // =====================================================
    // MOBILE PAGE SCROLL AT FIT SCALE
    // touch-action remains "none" so pinch zoom can be handled here. We
    // therefore scroll the document ourselves while the map has no extra
    // area to pan.
    if (pointers.size === 1 && gesture?.type === "page-scroll") {
      const deltaY = event.clientY - gesture.clientY;
      window.scrollBy({ top: -deltaY, left: 0, behavior: "auto" });
      gesture.clientY = event.clientY;
      return;
    }

    // NORMAL MAP PAN
    // =====================================================

    if (pointers.size === 1 && gesture?.type === "pan") {
      state.x = gesture.x + point.x - gesture.point.x;

      state.y = gesture.y + point.y - gesture.point.y;

      constrain();
      paint();
    }
  });

  // =========================================================
  // POINTER END
  // =========================================================

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    // =====================================================
    // CHECK CLICK BOOTH
    // =====================================================

    const isTap =
      event.type === "pointerup" &&
      tap &&
      tap.pointerId === event.pointerId &&
      !tap.moved &&
      pointers.size === 1;

    const selectedId = tap?.id || null;

    // Remove pointer

    pointers.delete(event.pointerId);

    // Release pointer capture

    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    // =====================================================
    // NO POINTER LEFT
    // =====================================================

    if (pointers.size === 0) {
      viewport.classList.remove("dragging");

      gesture = null;
      tap = null;
    }

    // =====================================================
    // ONE POINTER REMAINS
    // After pinch -> continue pan
    // =====================================================
    else if (pointers.size === 1) {
      const [point] = pointers.values();

      gesture = {
        type: "pan",

        point: {
          x: point.x,
          y: point.y,
        },

        x: state.x,
        y: state.y,
      };
    }

    // =====================================================
    // SELECT BOOTH
    // =====================================================

    // if (isTap && selectedId && selectBoothRef) {
    //   if (state.selected === selectedId && clearSelectionRef) {
    //     clearSelectionRef();
    //   } else {
    //     selectBoothRef(selectedId, true, false);
    //   }
    // }

    // if (isTap && selectedId && selectBoothRef) {
    //   selectBoothRef(selectedId, true, false);
    // }
    if (isTap && selectedId && selectBoothRef) {
      if (state.selected === selectedId && clearSelectionRef) {
        clearSelectionRef();
      } else {
        selectBoothRef(selectedId, true, true);
      }
    }
  }

  viewport.addEventListener("pointerup", endPointer);

  viewport.addEventListener("pointercancel", endPointer);

  viewport.addEventListener("lostpointercapture", endPointer);

  // =========================================================
  // KEYBOARD
  // =========================================================

  viewport.addEventListener("keydown", (event) => {
    const step = 40;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();

        state.y += step;

        constrain();
        paint();

        break;

      case "ArrowDown":
        event.preventDefault();

        state.y -= step;

        constrain();
        paint();

        break;

      case "ArrowLeft":
        event.preventDefault();

        state.x += step;

        constrain();
        paint();

        break;

      case "ArrowRight":
        event.preventDefault();

        state.x -= step;

        constrain();
        paint();

        break;

      case "+":
      case "=": {
        event.preventDefault();

        const center = getViewportCenter();

        zoomAt(MAP_CONFIG.zoomButtonFactor, center.x, center.y);

        break;
      }

      case "-":
      case "_": {
        event.preventDefault();

        const center = getViewportCenter();

        zoomAt(1 / MAP_CONFIG.zoomButtonFactor, center.x, center.y);

        break;
      }

      case "0":
        event.preventDefault();

        fitMap();

        break;
    }
  });

  // =========================================================
  // RESIZE
  // =========================================================

  const resizeObserver = new ResizeObserver(() => {
    if (!viewport.clientWidth) {
      return;
    }

    const width = viewport.clientWidth;

    const height = viewport.clientHeight;

    const size = mapSize();
    // Preserve an intentional zoom, but keep a fitted map fitted when a
    // device rotates or the browser window changes size.
    const wasFitted =
      state.minScale > 0 && Math.abs(state.scale / state.minScale - 1) < 0.01;
    state.minScale = Math.min(width / size.width, height / size.height) * 0.95;

    state.maxScale = state.minScale * getMaxScaleMultiplier(size);

    state.scale = wasFitted
      ? state.minScale
      : clamp(state.scale, state.minScale, state.maxScale);

    constrain();
    paint();
  });

  resizeObserver.observe(viewport);
}
