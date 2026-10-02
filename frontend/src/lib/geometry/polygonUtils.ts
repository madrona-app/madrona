import { logger } from '../logger';
/**
 * Polygon geometry utilities for floor plan calculations.
 *
 * Supports both rectangular (Phase 1) and polygon (Phase 2) floor plans.
 */

export interface Vertex {
  id: string;
  x: number; // cm
  y: number; // cm
}

export interface WallOpening {
  type: 'door' | 'window';
  offset_cm: number; // Distance from start of wall
  width_cm: number;
  height_cm: number;
  sill_height_cm?: number; // For windows, height from floor
}

export interface Wall {
  id: string;
  start_vertex: string;
  end_vertex: string;
  height_cm: number;
  openings: WallOpening[];
}

export interface Column {
  id: string;
  x: number;
  y: number;
  radius_cm: number;
  shape: 'circular' | 'square';
}

export interface BackgroundImage {
  url: string;
  scale_factor: number;
  offset_x: number;
  offset_y: number;
  opacity: number;
}

export interface PolygonGeometry {
  type: 'polygon';
  vertices: Vertex[];
  walls: Wall[];
  columns: Column[];
  background_image?: BackgroundImage;
  units: 'cm' | 'in';
}

export interface RectangularGeometry {
  type: 'rectangular';
  width_cm: number;
  depth_cm: number;
  walls: {
    north: { length: number };
    south: { length: number };
    east: { length: number };
    west: { length: number };
  };
}

export type FloorPlanGeometry = PolygonGeometry | RectangularGeometry;

/**
 * Check if geometry is rectangular (Phase 1) format
 */
export function isRectangular(geometry: FloorPlanGeometry): geometry is RectangularGeometry {
  return geometry.type === 'rectangular';
}

/**
 * Check if geometry is polygon (Phase 2) format
 */
export function isPolygon(geometry: FloorPlanGeometry): geometry is PolygonGeometry {
  return geometry.type === 'polygon';
}

/**
 * Convert rectangular geometry to polygon format for unified processing
 */
export function rectangularToPolygon(rect: RectangularGeometry): PolygonGeometry {
  const { width_cm, depth_cm } = rect;

  // Create vertices for rectangular room (clockwise from origin)
  const vertices: Vertex[] = [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: width_cm, y: 0 },
    { id: 'v3', x: width_cm, y: depth_cm },
    { id: 'v4', x: 0, y: depth_cm },
  ];

  // Map cardinal walls to polygon walls
  // North = back wall (v1 to v2), South = front wall (v3 to v4)
  // East = right wall (v2 to v3), West = left wall (v4 to v1)
  const walls: Wall[] = [
    { id: 'north', start_vertex: 'v1', end_vertex: 'v2', height_cm: 300, openings: [] },
    { id: 'east', start_vertex: 'v2', end_vertex: 'v3', height_cm: 300, openings: [] },
    { id: 'south', start_vertex: 'v3', end_vertex: 'v4', height_cm: 300, openings: [] },
    { id: 'west', start_vertex: 'v4', end_vertex: 'v1', height_cm: 300, openings: [] },
  ];

  return {
    type: 'polygon',
    vertices,
    walls,
    columns: [],
    units: 'cm',
  };
}

/**
 * Normalize any geometry to polygon format
 */
export function normalizeGeometry(geometry: FloorPlanGeometry): PolygonGeometry {
  if (isPolygon(geometry)) {
    return geometry;
  }
  return rectangularToPolygon(geometry);
}

/**
 * Calculate the length of a wall segment
 */
export function calculateWallLength(
  wall: Wall,
  vertices: Vertex[]
): number {
  const start = vertices.find((v) => v.id === wall.start_vertex);
  const end = vertices.find((v) => v.id === wall.end_vertex);

  if (!start || !end) {
    logger.warn(`Wall ${wall.id} references missing vertices`);
    return 0;
  }

  return Math.sqrt(
    Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
  );
}

/**
 * Calculate the angle of a wall in radians (0 = pointing right/+X)
 */
export function calculateWallAngle(
  wall: Wall,
  vertices: Vertex[]
): number {
  const start = vertices.find((v) => v.id === wall.start_vertex);
  const end = vertices.find((v) => v.id === wall.end_vertex);

  if (!start || !end) {
    return 0;
  }

  return Math.atan2(end.y - start.y, end.x - start.x);
}

/**
 * Calculate the midpoint of a wall
 */
export function calculateWallMidpoint(
  wall: Wall,
  vertices: Vertex[]
): { x: number; y: number } {
  const start = vertices.find((v) => v.id === wall.start_vertex);
  const end = vertices.find((v) => v.id === wall.end_vertex);

  if (!start || !end) {
    return { x: 0, y: 0 };
  }

  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

/**
 * Calculate the normal vector of a wall (pointing inward)
 * Returns a normalized vector perpendicular to the wall
 */
export function calculateWallNormal(
  wall: Wall,
  vertices: Vertex[]
): { x: number; y: number } {
  const angle = calculateWallAngle(wall, vertices);

  // Normal is perpendicular to wall direction
  // We rotate 90 degrees counter-clockwise for inward-facing normal
  return {
    x: -Math.sin(angle),
    y: Math.cos(angle),
  };
}

/**
 * Get the centroid of a polygon (average of all vertices)
 */
export function calculatePolygonCentroid(vertices: Vertex[]): { x: number; y: number } {
  if (vertices.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = vertices.reduce(
    (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / vertices.length,
    y: sum.y / vertices.length,
  };
}

/**
 * Calculate the area of a polygon using the shoelace formula
 */
export function calculatePolygonArea(vertices: Vertex[]): number {
  if (vertices.length < 3) {
    return 0;
  }

  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }

  return Math.abs(area / 2);
}

/**
 * Calculate bounding box of a polygon
 */
export function calculateBoundingBox(vertices: Vertex[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (vertices.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if a point is inside a polygon using ray casting
 */
export function isPointInPolygon(
  point: { x: number; y: number },
  vertices: Vertex[]
): boolean {
  let inside = false;
  const n = vertices.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    if (
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Convert 2D floor plan coordinates to 3D world coordinates
 *
 * Floor plan: X = horizontal (left-right), Y = vertical (front-back)
 * Three.js: X = horizontal (left-right), Y = up, Z = depth (front-back, negative = into screen)
 *
 * @param x Floor plan X coordinate (cm)
 * @param y Floor plan Y coordinate (cm)
 * @param centroid Center of the floor plan
 * @returns 3D world coordinates in meters, centered at origin
 */
export function floorPlanTo3D(
  x: number,
  y: number,
  centroid: { x: number; y: number }
): { x: number; z: number } {
  // Convert cm to meters and center around origin
  return {
    x: (x - centroid.x) / 100,
    z: (y - centroid.y) / 100,
  };
}

/**
 * Convert 3D world coordinates back to 2D floor plan coordinates
 */
export function threeDToFloorPlan(
  x: number,
  z: number,
  centroid: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: x * 100 + centroid.x,
    y: z * 100 + centroid.y,
  };
}

/**
 * Calculate position along a wall for artwork placement
 *
 * @param wall The wall definition
 * @param vertices All vertices
 * @param positionAlongWall Distance from start of wall (cm)
 * @param heightFromFloor Height from floor (cm)
 * @param distanceFromWall Distance from wall surface (cm)
 * @returns 3D position and rotation for the artwork
 */
export function calculateArtworkPosition(
  wall: Wall,
  vertices: Vertex[],
  centroid: { x: number; y: number },
  positionAlongWall: number,
  heightFromFloor: number,
  distanceFromWall: number = 1
): {
  position: { x: number; y: number; z: number };
  rotationY: number;
} {
  const start = vertices.find((v) => v.id === wall.start_vertex);
  const end = vertices.find((v) => v.id === wall.end_vertex);

  if (!start || !end) {
    return {
      position: { x: 0, y: heightFromFloor / 100, z: 0 },
      rotationY: 0,
    };
  }

  const wallLength = calculateWallLength(wall, vertices);
  const wallAngle = calculateWallAngle(wall, vertices);

  // Calculate position along wall (as ratio)
  const t = Math.min(positionAlongWall / wallLength, 1);

  // Interpolate position along wall
  const wallX = start.x + t * (end.x - start.x);
  const wallY = start.y + t * (end.y - start.y);

  // Get normal vector (pointing inward)
  const normal = calculateWallNormal(wall, vertices);

  // Offset from wall surface
  const offsetX = normal.x * distanceFromWall;
  const offsetY = normal.y * distanceFromWall;

  // Convert to 3D coordinates
  const pos3D = floorPlanTo3D(wallX + offsetX, wallY + offsetY, centroid);

  return {
    position: {
      x: pos3D.x,
      y: heightFromFloor / 100, // Convert cm to meters
      z: pos3D.z,
    },
    // Rotate artwork to face into the room (perpendicular to wall)
    // Wall angle determines which way the artwork faces
    rotationY: wallAngle,
  };
}

/**
 * Generate a unique ID for new vertices/walls
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Snap a coordinate to a grid
 */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap an angle to common angles (0, 45, 90, etc.)
 */
export function snapToAngle(
  angle: number,
  snapAngles: number[] = [0, 45, 90, 135, 180, 225, 270, 315],
  threshold: number = 5
): number {
  const degrees = (angle * 180) / Math.PI;
  const normalizedDegrees = ((degrees % 360) + 360) % 360;

  for (const snapAngle of snapAngles) {
    if (Math.abs(normalizedDegrees - snapAngle) < threshold) {
      return (snapAngle * Math.PI) / 180;
    }
  }

  return angle;
}

/**
 * Calculate distance between two points
 */
export function distance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Find the closest point on a line segment to a given point
 */
export function closestPointOnSegment(
  point: { x: number; y: number },
  segmentStart: { x: number; y: number },
  segmentEnd: { x: number; y: number }
): { x: number; y: number; t: number } {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return { ...segmentStart, t: 0 };
  }

  let t = ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return {
    x: segmentStart.x + t * dx,
    y: segmentStart.y + t * dy,
    t,
  };
}


/**
 * Constrain artwork position to wall bounds
 */
export function constrainToWallBounds(
  positionX: number,
  positionY: number,
  artworkWidth: number,
  artworkHeight: number,
  wallLength: number,
  ceilingHeight: number,
  frameWidth: number = 0
): { x: number; y: number } {
  const totalWidth = artworkWidth + frameWidth * 2;
  const totalHeight = artworkHeight + frameWidth * 2;

  // X bounds: artwork must stay within wall
  const minX = totalWidth / 2;
  const maxX = Math.max(minX, wallLength - totalWidth / 2);

  // Y bounds: above floor, below ceiling
  const minY = totalHeight / 2;
  const maxY = Math.max(minY, ceilingHeight - totalHeight / 2);

  return {
    x: Math.max(minX, Math.min(maxX, positionX)),
    y: Math.max(minY, Math.min(maxY, positionY)),
  };
}
