import { getMapLayout } from "../shared/map-layout.js";

/*
 * Route planning uses the walkway rectangles drawn by Map Builder.
 *
 * Each walkway becomes a centre line: horizontal for wide rectangles and
 * vertical for tall rectangles. Intersections and touching endpoints become
 * graph nodes. Dijkstra then finds the shortest connected walkway route.
 *
 * The first/last short segment connects the entrance and booth to their
 * closest walkway. This means old maps still work even if a doorway or booth
 * is not placed directly on top of a walkway.
 */

function point(x, y) {
  return { x, y };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function samePoint(first, second) {
  return (
    Math.abs(first.x - second.x) < 0.1 && Math.abs(first.y - second.y) < 0.1
  );
}

function elementCenter(element) {
  return point(element.x + element.width / 2, element.y + element.height / 2);
}

function walkwaySegment(walkway, index) {
  const middle = elementCenter(walkway);
  const horizontal = walkway.width >= walkway.height;
  const halfLength = (horizontal ? walkway.width : walkway.height) / 2;
  const angle = ((Number(walkway.rotation) || 0) * Math.PI) / 180 +
    (horizontal ? 0 : Math.PI / 2);
  const delta = point(Math.cos(angle) * halfLength, Math.sin(angle) * halfLength);
  return {
    id: "walkway-" + index,
    start: point(middle.x - delta.x, middle.y - delta.y),
    end: point(middle.x + delta.x, middle.y + delta.y),
    nodes: [],
  };
}

function pathSegments(path, index) {
  return path.points.slice(1).map((end, pointIndex) => ({
    id: `path-${index}-${pointIndex}`,
    start: path.points[pointIndex],
    end,
    nodes: [],
  }));
}

function projectOntoSegment(location, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared
    ? Math.max(0, Math.min(1, ((location.x - segment.start.x) * dx + (location.y - segment.start.y) * dy) / lengthSquared))
    : 0;
  return point(segment.start.x + dx * progress, segment.start.y + dy * progress);
}

function segmentIntersection(first, second) {
  const r = point(first.end.x - first.start.x, first.end.y - first.start.y);
  const s = point(second.end.x - second.start.x, second.end.y - second.start.y);
  const cross = r.x * s.y - r.y * s.x;
  const offset = point(second.start.x - first.start.x, second.start.y - first.start.y);
  if (Math.abs(cross) < 0.0001) {
    return [first.start, first.end, second.start, second.end]
      .find((candidate) => samePoint(projectOntoSegment(candidate, first), candidate) && samePoint(projectOntoSegment(candidate, second), candidate)) || null;
  }
  const firstProgress = (offset.x * s.y - offset.y * s.x) / cross;
  const secondProgress = (offset.x * r.y - offset.y * r.x) / cross;
  return firstProgress >= -0.001 && firstProgress <= 1.001 && secondProgress >= -0.001 && secondProgress <= 1.001
    ? point(first.start.x + firstProgress * r.x, first.start.y + firstProgress * r.y)
    : null;
}

function addSegmentNode(segment, location) {
  if (!segment.nodes.some((node) => samePoint(node, location))) {
    segment.nodes.push(location);
  }
}

function connect(graph, first, second) {
  const firstId = graph.addNode(first);
  const secondId = graph.addNode(second);
  const length = distance(first, second);

  graph.edges.get(firstId).push({ id: secondId, length });
  graph.edges.get(secondId).push({ id: firstId, length });
  return { firstId, secondId };
}

function createGraph(segments) {
  const nodes = [];
  const edges = new Map();

  const graph = {
    addNode(location) {
      const existing = nodes.findIndex((node) => samePoint(node, location));
      if (existing >= 0) return existing;
      nodes.push(location);
      edges.set(nodes.length - 1, []);
      return nodes.length - 1;
    },
    nodes,
    edges,
  };

  segments.forEach((segment) => {
    addSegmentNode(segment, segment.start);
    addSegmentNode(segment, segment.end);
  });

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segments.length;
      secondIndex += 1
    ) {
      const intersection = segmentIntersection(
        segments[firstIndex],
        segments[secondIndex],
      );
      if (!intersection) continue;
      addSegmentNode(segments[firstIndex], intersection);
      addSegmentNode(segments[secondIndex], intersection);
    }
  }

  segments.forEach((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    segment.nodes.sort((first, second) =>
      (first.x - segment.start.x) * dx + (first.y - segment.start.y) * dy -
      ((second.x - segment.start.x) * dx + (second.y - segment.start.y) * dy),
    );

    for (let index = 1; index < segment.nodes.length; index += 1) {
      connect(graph, segment.nodes[index - 1], segment.nodes[index]);
    }
  });

  return graph;
}

function nearestWalkwayPoint(location, segments) {
  let nearest = null;

  segments.forEach((segment) => {
    const projected = projectOntoSegment(location, segment);
    const length = distance(location, projected);

    if (!nearest || length < nearest.length) {
      nearest = { segment, point: projected, length };
    }
  });

  return nearest;
}

function shortestPath(graph, startId, targetId) {
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const queue = new Set(graph.nodes.map((_, index) => index));

  while (queue.size) {
    let currentId = null;
    queue.forEach((nodeId) => {
      if (
        currentId === null ||
        (distances.get(nodeId) ?? Infinity) <
          (distances.get(currentId) ?? Infinity)
      ) {
        currentId = nodeId;
      }
    });

    if (currentId === null || !Number.isFinite(distances.get(currentId))) break;
    queue.delete(currentId);
    if (currentId === targetId) break;

    graph.edges.get(currentId).forEach((edge) => {
      if (!queue.has(edge.id)) return;
      const nextDistance = distances.get(currentId) + edge.length;
      if (nextDistance < (distances.get(edge.id) ?? Infinity)) {
        distances.set(edge.id, nextDistance);
        previous.set(edge.id, currentId);
      }
    });
  }

  if (!distances.has(targetId)) return null;

  const path = [];
  for (
    let nodeId = targetId;
    nodeId !== undefined;
    nodeId = previous.get(nodeId)
  ) {
    path.unshift(graph.nodes[nodeId]);
  }

  return { points: path, length: distances.get(targetId) };
}

function directFallback(entrances, booth) {
  const target = elementCenter(booth);

  return (
    entrances
      .map((entrance, index) => {
        const start = elementCenter(entrance);
        const bend = point(start.x, target.y);
        const points = [start, bend, target];
        const length = distance(start, bend) + distance(bend, target);
        return { entrance: index + 1, points, length, followsWalkway: false };
      })
      .sort((first, second) => first.length - second.length)[0] || null
  );
}

// ---- เพิ่มฟังก์ชันนี้ก่อน findRouteToBooth ----

function routeFromPoint(start, target, segments) {
  const targetConnection = nearestWalkwayPoint(target, segments);
  addSegmentNode(targetConnection.segment, targetConnection.point);

  const startConnection = nearestWalkwayPoint(start, segments);
  addSegmentNode(startConnection.segment, startConnection.point);

  const routeGraph = createGraph(segments);
  const startId = routeGraph.addNode(startConnection.point);
  const targetId = routeGraph.addNode(targetConnection.point);
  const route = shortestPath(routeGraph, startId, targetId);
  if (!route) return null;

  const points = [start, ...route.points, target].filter(
    (location, i, all) => i === 0 || !samePoint(location, all[i - 1]),
  );

  return {
    points,
    length: startConnection.length + route.length + targetConnection.length,
    followsWalkway: true,
  };
}

function directFromPoint(start, target) {
  const bend = point(start.x, target.y);
  return {
    points: [start, bend, target],
    length: distance(start, bend) + distance(bend, target),
    followsWalkway: false,
  };
}

/**
 * @param {object} booth   บูทปลายทาง
 * @param {object} [origin] บูทหรือพิกัด {x,y} ที่ใช้เป็นจุดเริ่ม (ถ้าไม่ส่ง = ใช้ทางเข้าใกล้สุด)
 */
export function findRouteToBooth(booth, origin = null) {
  const layout = getMapLayout();
  const entrances = layout.elements.filter((e) => e.type === "entrance");
  const walkways = layout.elements.filter((e) => e.type === "walkway");
  const paths = layout.elements.filter((e) => e.type === "path" && e.points?.length >= 2);
  const segments = [
    ...walkways.map(walkwaySegment),
    ...paths.flatMap(pathSegments),
  ];
  const target = elementCenter(booth);

  // ---- โหมดใหม่: เริ่มจากบูทที่ผู้ใช้เลือก ----
  if (origin) {
    const start =
      origin.width !== undefined
        ? elementCenter(origin)
        : point(origin.x, origin.y);

    if (!segments.length) {
      return { entrance: null, ...directFromPoint(start, target) };
    }
    const route =
      routeFromPoint(start, target, segments) || directFromPoint(start, target);
    return { entrance: null, ...route };
  }

  // ---- โหมดเดิม (ไม่เปลี่ยน) ----
  if (!entrances.length) return null;
  if (!segments.length) return directFallback(entrances, booth);
  const targetConnection = nearestWalkwayPoint(target, segments);
  addSegmentNode(targetConnection.segment, targetConnection.point);

  const candidates = entrances
    .map((entrance, index) => {
      const start = elementCenter(entrance);
      const entranceConnection = nearestWalkwayPoint(start, segments);
      addSegmentNode(entranceConnection.segment, entranceConnection.point);

      const routeGraph = createGraph(segments);
      const routeStartId = routeGraph.addNode(entranceConnection.point);
      const routeTargetId = routeGraph.addNode(targetConnection.point);
      const route = shortestPath(routeGraph, routeStartId, routeTargetId);
      if (!route) return null;

      const points = [start, ...route.points, target].filter(
        (location, i, all) => i === 0 || !samePoint(location, all[i - 1]),
      );

      return {
        entrance: index + 1,
        points,
        length:
          entranceConnection.length + route.length + targetConnection.length,
        followsWalkway: true,
      };
    })
    .filter(Boolean);

  return (
    candidates.sort((a, b) => a.length - b.length)[0] ||
    directFallback(entrances, booth)
  );
}
