import { useEffect, useRef, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  MousePointer, Square, Circle, Lasso, Wand2, Crop, Pipette, Brush, Pencil, Eraser, Stamp, Bandage, Hand, Search,
  Type, Shapes, PaintBucket, Blend, Droplet, Sun, Moon, Sparkles, Fingerprint, ArrowLeftRight, Undo2, Hexagon,
  WandSparkles, PenTool, Ruler, Crosshair, History, Replace, ScanEye, PaintbrushVertical, Slash, Plus, Minus,
  RotateCw, FlipHorizontal, Maximize2, Split, Move, Grid, Layers, BarChart2, PieChart, Scissors, Eye,
  Sliders, Sparkle, LayoutGrid, Palette, Orbit, Compass, Columns, Check, MoreHorizontal, X, ArrowUpRight, Package,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId } from '../core/store';

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  category: 'select' | 'draw' | 'type' | 'paint' | 'modify' | 'symbols-graphs' | 'navigate' | 'raster';
  icon: ReactNode;
  hint: string;
}

const I = 16;

// Authentic Adobe Illustrator custom vector SVG icons
function DirectSelectIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none">
      <path d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z" fill="white" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function GroupSelectIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none">
      <path d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z" fill="white" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18 16V22M15 19H21" stroke="#ff9a00" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CurvatureIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17C7 7 13 7 21 17" />
      <circle cx="12" cy="9.5" r="2.5" fill="currentColor" />
      <circle cx="4" cy="17" r="1.5" />
      <circle cx="20" cy="17" r="1.5" />
    </svg>
  );
}

function AnchorPointIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18L12 6L18 18" />
      <rect x="10.5" y="4.5" width="3" height="3" fill="currentColor" />
    </svg>
  );
}

function ShapeBuilderIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="11" r="5.5" />
      <circle cx="15" cy="11" r="5.5" />
      <path d="M12 18V22M10 20H14" />
    </svg>
  );
}

function ArtboardIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="1" />
      <line x1="2" y1="5" x2="5" y2="5" />
      <line x1="19" y1="5" x2="22" y2="5" />
      <line x1="2" y1="19" x2="5" y2="19" />
      <line x1="19" y1="19" x2="22" y2="19" />
      <line x1="5" y1="2" x2="5" y2="5" />
      <line x1="19" y1="2" x2="19" y2="5" />
      <line x1="5" y1="19" x2="5" y2="22" />
      <line x1="19" y1="19" x2="19" y2="22" />
    </svg>
  );
}

function SpiralIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 12A2 2 0 0 0 10 10A4 4 0 0 0 14 6A6 6 0 0 0 8 14A8 8 0 0 0 18 16" />
    </svg>
  );
}

function ArcIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 20A16 16 0 0 1 20 4" />
    </svg>
  );
}

function PolarGridIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function MeshIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 11C8 10 16 14 21 13" />
      <path d="M11 3C10 8 14 16 13 21" />
    </svg>
  );
}

function WidthIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 12H20" strokeWidth="1.2" />
      <path d="M9 7C11 12 11 12 9 17" strokeWidth="2.2" />
      <path d="M15 7C13 12 13 12 15 17" strokeWidth="2.2" />
    </svg>
  );
}

function PerspectiveGridIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 19L12 4L21 19Z" />
      <line x1="7.5" y1="11.5" x2="16.5" y2="11.5" />
      <line x1="12" y1="4" x2="12" y2="19" />
    </svg>
  );
}

function SymbolSprayerIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="9" width="8" height="12" rx="1.5" />
      <path d="M7 9V5C7 4.5 7.5 4 8 4H10C10.5 4 11 4.5 11 5V9" />
      <circle cx="17" cy="6" r="1" fill="currentColor" />
      <circle cx="20" cy="9" r="1.5" fill="currentColor" />
      <circle cx="17" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function KnifeIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20L14 10" />
      <path d="M14 10L19 5C20.5 6.5 20.5 8 19 9.5L11 17.5L4 20Z" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

function ShaperIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 3A9 9 0 0 0 3 12A9 9 0 0 0 12 21A9 9 0 0 0 21 12" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeDasharray="none" />
    </svg>
  );
}

function GradientIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="gi_rail" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="3" y="5" width="18" height="14" rx="2" fill="url(#gi_rail)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ImageTraceIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="13" height="13" rx="2" strokeDasharray="2.5 2.5" />
      <path d="M8 21C9 15 14 12 21 12" />
      <rect x="6.5" y="19.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="19.5" y="10.5" width="3" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Complete 100+ Adobe Illustrator Tool Definitions Catalog */
export const TOOLS: Record<ToolId, ToolDef> = {
  // 1. SELECT
  'master-select': { id: 'master-select', label: 'Master Selection Tool', key: '⇧V', category: 'select', icon: <ScanEye size={I} />, hint: 'Master Smart Selection: Reads and copies text from images, selects objects, and extracts content.' },
  move: { id: 'move', label: 'Selection Tool', key: 'V', category: 'select', icon: <MousePointer size={I} />, hint: 'Selects, moves, rotates and transforms entire objects and groups.' },
  'direct-select': { id: 'direct-select', label: 'Direct Selection Tool', key: 'A', category: 'select', icon: <DirectSelectIcon />, hint: 'Selects individual anchor points and curve handles.' },
  'group-select': { id: 'group-select', label: 'Group Selection Tool', key: 'A', category: 'select', icon: <GroupSelectIcon />, hint: 'Selects an object within a group; click again to select its parent group.' },
  wand: { id: 'wand', label: 'Magic Wand Tool', key: 'Y', category: 'select', icon: <Wand2 size={I} />, hint: 'Selects objects sharing similar fill color, stroke weight, or appearance.' },
  lasso: { id: 'lasso', label: 'Lasso Tool', key: 'Q', category: 'select', icon: <Lasso size={I} />, hint: 'Draws a freehand selection loop to select anchor points.' },

  // 2. DRAW (Pen, Anchors & Lines)
  pen: { id: 'pen', label: 'Pen Tool', key: 'P', category: 'draw', icon: <PenTool size={I} />, hint: 'Draws precise Bézier vector paths with corner and curve points.' },
  'add-anchor': { id: 'add-anchor', label: 'Add Anchor Point Tool', key: '+', category: 'draw', icon: <Plus size={I} />, hint: 'Adds new anchor points onto an existing vector path.' },
  'delete-anchor': { id: 'delete-anchor', label: 'Delete Anchor Point Tool', key: '-', category: 'draw', icon: <Minus size={I} />, hint: 'Deletes anchor points from a path without breaking continuity.' },
  'anchor-point': { id: 'anchor-point', label: 'Anchor Point Tool', key: '⇧C', category: 'draw', icon: <AnchorPointIcon />, hint: 'Converts smooth curves to sharp corners or pulls new tangent handles.' },
  curvature: { id: 'curvature', label: 'Curvature Tool', key: '⇧P', category: 'draw', icon: <CurvatureIcon />, hint: 'Creates smooth harmonic curves intuitively without tangent handles.' },
  line: { id: 'line', label: 'Line Segment Tool', key: '\\', category: 'draw', icon: <Slash size={I} />, hint: 'Draws individual straight line vector segments.' },
  arc: { id: 'arc', label: 'Arc Tool', key: '\\', category: 'draw', icon: <ArcIcon />, hint: 'Draws open or closed curved arc segments.' },
  spiral: { id: 'spiral', label: 'Spiral Tool', key: '\\', category: 'draw', icon: <SpiralIcon />, hint: 'Draws logarithmic or Archimedean spiral curves.' },
  'rect-grid': { id: 'rect-grid', label: 'Rectangular Grid Tool', key: '\\', category: 'draw', icon: <Grid size={I} />, hint: 'Draws Cartesian rectangular coordinate grids.' },
  'polar-grid': { id: 'polar-grid', label: 'Polar Grid Tool', key: '\\', category: 'draw', icon: <PolarGridIcon />, hint: 'Draws concentric polar circular coordinate grids.' },

  // 3. GEOMETRIC SHAPES
  shape: { id: 'shape', label: 'Shape Tool', key: 'M', category: 'draw', icon: <Shapes size={I} />, hint: 'Draws vector geometric shapes.' },
  'shape-rect': { id: 'shape-rect', label: 'Rectangle Tool', key: 'M', category: 'draw', icon: <Square size={I} />, hint: 'Draws vector rectangles and squares (Shift).' },
  'shape-round-rect': { id: 'shape-round-rect', label: 'Rounded Rectangle Tool', key: 'M', category: 'draw', icon: <Square size={I} className="rounded" />, hint: 'Draws rectangles with adjustable live corner radii.' },
  'shape-ellipse': { id: 'shape-ellipse', label: 'Ellipse Tool', key: 'L', category: 'draw', icon: <Circle size={I} />, hint: 'Draws vector ellipses and circles (Shift).' },
  'shape-polygon': { id: 'shape-polygon', label: 'Polygon Tool', key: 'M', category: 'draw', icon: <Hexagon size={I} />, hint: 'Draws regular multi-sided polygons.' },
  'shape-star': { id: 'shape-star', label: 'Star Tool', key: 'M', category: 'draw', icon: <Sparkles size={I} />, hint: 'Draws multi-pointed stars with inner and outer radii.' },
  flare: { id: 'flare', label: 'Flare Tool', key: 'M', category: 'draw', icon: <Sun size={I} />, hint: 'Creates lens flare vector effects with rings and rays.' },

  // 4. TYPE
  text: { id: 'text', label: 'Type Tool', key: 'T', category: 'type', icon: <Type size={I} />, hint: 'Creates horizontal point type or area text blocks.' },
  'area-type': { id: 'area-type', label: 'Area Type Tool', key: 'T', category: 'type', icon: <Columns size={I} />, hint: 'Flows text strictly within any closed vector path.' },
  'path-type': { id: 'path-type', label: 'Type on a Path Tool', key: 'T', category: 'type', icon: <Orbit size={I} />, hint: 'Flows text dynamically along the contour of any vector path.' },
  'vertical-type': { id: 'vertical-type', label: 'Vertical Type Tool', key: 'T', category: 'type', icon: <Type size={I} className="rotate-90" />, hint: 'Creates vertical top-to-bottom Asian lettering.' },
  'vertical-area-type': { id: 'vertical-area-type', label: 'Vertical Area Type Tool', key: 'T', category: 'type', icon: <Columns size={I} className="rotate-90" />, hint: 'Flows vertical typography inside a vector shape.' },
  'vertical-path-type': { id: 'vertical-path-type', label: 'Vertical Type on a Path Tool', key: 'T', category: 'type', icon: <Orbit size={I} className="rotate-90" />, hint: 'Flows vertical typography along a path curve.' },
  'touch-type': { id: 'touch-type', label: 'Touch Type Tool', key: '⇧T', category: 'type', icon: <Sliders size={I} />, hint: 'Directly moves, scales, and rotates single characters in live text.' },

  // 5. PAINT & BRUSHES
  brush: { id: 'brush', label: 'Paintbrush Tool', key: 'B', category: 'paint', icon: <Brush size={I} />, hint: 'Draws freehand vector paths with calligraphic stroke styles.' },
  'blob-brush': { id: 'blob-brush', label: 'Blob Brush Tool', key: '⇧B', category: 'paint', icon: <PaintbrushVertical size={I} />, hint: 'Paints closed filled paths that automatically merge with matching fills.' },
  pencil: { id: 'pencil', label: 'Pencil Tool', key: 'N', category: 'paint', icon: <Pencil size={I} />, hint: 'Draws freehand vector paths that automatically fit into smooth Béziers.' },
  smooth: { id: 'smooth', label: 'Smooth Tool', key: 'N', category: 'paint', icon: <Sparkle size={I} />, hint: 'Drags over rough vector paths to reduce anchors and smooth curves.' },
  'path-eraser': { id: 'path-eraser', label: 'Path Eraser Tool', key: 'N', category: 'paint', icon: <Eraser size={I} />, hint: 'Erases path segments along the trajectory of your drag.' },
  join: { id: 'join', label: 'Join Tool', key: 'N', category: 'paint', icon: <Split size={I} />, hint: 'Scribbles over intersecting or gap endpoints to join paths.' },
  shaper: { id: 'shaper', label: 'Shaper Tool', key: '⇧N', category: 'paint', icon: <ShaperIcon />, hint: 'Recognizes rough hand-drawn gestures into clean geometric vector shapes.' },

  // 6. TRANSFORM & RESHAPE
  rotate: { id: 'rotate', label: 'Rotate Tool', key: 'R', category: 'modify', icon: <RotateCw size={I} />, hint: 'Rotates vector artwork around a designated origin point.' },
  reflect: { id: 'reflect', label: 'Reflect Tool', key: 'O', category: 'modify', icon: <FlipHorizontal size={I} />, hint: 'Flips and mirrors vector artwork across an axis.' },
  scale: { id: 'scale', label: 'Scale Tool', key: 'S', category: 'modify', icon: <Maximize2 size={I} />, hint: 'Resizes objects proportionally or non-uniformly from a center anchor.' },
  shear: { id: 'shear', label: 'Shear Tool', key: 'S', category: 'modify', icon: <Move size={I} />, hint: 'Slants and skews vector paths along an axis.' },
  reshape: { id: 'reshape', label: 'Reshape Tool', key: 'S', category: 'modify', icon: <Sliders size={I} />, hint: 'Stretches curve segments without breaking tangent continuity.' },
  'free-transform': { id: 'free-transform', label: 'Free Transform Tool', key: 'E', category: 'modify', icon: <Maximize2 size={I} />, hint: 'Transforms bounds with interactive perspective and free distort.' },
  'puppet-warp': { id: 'puppet-warp', label: 'Puppet Warp Tool', key: 'E', category: 'modify', icon: <Crosshair size={I} />, hint: 'Places pins on vector artwork to organically bend and deform.' },
  width: { id: 'width', label: 'Width Tool', key: '⇧W', category: 'modify', icon: <WidthIcon />, hint: 'Interactively expands or contracts stroke profile widths along paths.' },
  warp: { id: 'warp', label: 'Warp Tool', key: '⇧R', category: 'modify', icon: <Fingerprint size={I} />, hint: 'Liquifies and pushes vector paths in the direction of cursor drag.' },
  twirl: { id: 'twirl', label: 'Twirl Tool', key: '⇧R', category: 'modify', icon: <RotateCw size={I} />, hint: 'Swirls vector vertices in a vortex around the cursor.' },
  pucker: { id: 'pucker', label: 'Pucker Tool', key: '⇧R', category: 'modify', icon: <Circle size={I} className="scale-75" />, hint: 'Pinches path vertices inward toward the cursor.' },
  bloat: { id: 'bloat', label: 'Bloat Tool', key: '⇧R', category: 'modify', icon: <Circle size={I} className="scale-125" />, hint: 'Deflates path vertices outward away from the cursor.' },
  scallop: { id: 'scallop', label: 'Scallop Tool', key: '⇧R', category: 'modify', icon: <Hexagon size={I} />, hint: 'Carves curved scallop teeth along vector borders.' },
  crystallize: { id: 'crystallize', label: 'Crystallize Tool', key: '⇧R', category: 'modify', icon: <Sparkles size={I} />, hint: 'Extrudes sharp starburst spikes outward from vector edges.' },
  wrinkle: { id: 'wrinkle', label: 'Wrinkle Tool', key: '⇧R', category: 'modify', icon: <Fingerprint size={I} />, hint: 'Adds random organic ripples and noise to vector edges.' },

  // 7. CUT & BOOLEAN
  'shape-builder': { id: 'shape-builder', label: 'Shape Builder Tool', key: '⇧M', category: 'modify', icon: <ShapeBuilderIcon />, hint: 'Merges overlapping shape fragments (drag) or subtracts them (⌥-drag).' },
  eraser: { id: 'eraser', label: 'Eraser Tool', key: '⇧E', category: 'modify', icon: <Eraser size={I} />, hint: 'Vector eraser that slices through paths and divides filled shapes.' },
  scissors: { id: 'scissors', label: 'Scissors Tool', key: 'C', category: 'modify', icon: <Scissors size={I} />, hint: 'Cuts paths at clicked anchor points or segment locations.' },
  knife: { id: 'knife', label: 'Knife Tool', key: 'C', category: 'modify', icon: <KnifeIcon />, hint: 'Freehand slices across vector shapes to divide them into pieces.' },

  // 8. COLOR, MESH & SHADING
  mesh: { id: 'mesh', label: 'Mesh Tool', key: 'U', category: 'paint', icon: <MeshIcon />, hint: 'Creates gradient mesh grids for photorealistic vector shading.' },
  gradient: { id: 'gradient', label: 'Gradient Tool', key: 'G', category: 'paint', icon: <GradientIcon />, hint: 'Edits vector linear and radial gradients directly on the canvas.' },
  eyedropper: { id: 'eyedropper', label: 'Eyedropper Tool', key: 'I', category: 'paint', icon: <Pipette size={I} />, hint: 'Samples and transfers fill, stroke, typography, and styling attributes.' },
  ruler: { id: 'ruler', label: 'Measure Tool', key: 'I', category: 'paint', icon: <Ruler size={I} />, hint: 'Measures distances, angles, and coordinates on the canvas.' },
  blend: { id: 'blend', label: 'Blend Tool', key: 'W', category: 'paint', icon: <Blend size={I} />, hint: 'Generates intermediate vector shape and color morph steps.' },
  'image-trace': { id: 'image-trace', label: 'Image Trace Tool', key: '⇧I', category: 'paint', icon: <ImageTraceIcon />, hint: 'Click a picture to turn it into vector paths (Auto picks the settings); drag to trace one part; ⌥-click to pick exact trace colours.' },
  bucket: { id: 'bucket', label: 'Live Paint Bucket', key: 'K', category: 'paint', icon: <PaintBucket size={I} />, hint: 'Fills enclosed facet regions in complex line art.' },
  'live-paint-select': { id: 'live-paint-select', label: 'Live Paint Selection Tool', key: '⇧L', category: 'paint', icon: <Check size={I} />, hint: 'Selects individual faces and edges of Live Paint groups.' },

  // 9. SYMBOLS
  'symbol-sprayer': { id: 'symbol-sprayer', label: 'Symbol Sprayer Tool', key: '⇧S', category: 'symbols-graphs', icon: <SymbolSprayerIcon />, hint: 'Sprays instances of vector symbols onto the canvas.' },
  'symbol-shifter': { id: 'symbol-shifter', label: 'Symbol Shifter Tool', key: '⇧S', category: 'symbols-graphs', icon: <Move size={I} />, hint: 'Moves sprayed symbol instances around.' },
  'symbol-scruncher': { id: 'symbol-scruncher', label: 'Symbol Scruncher Tool', key: '⇧S', category: 'symbols-graphs', icon: <Crosshair size={I} />, hint: 'Pulls symbol instances closer together or pushes them apart.' },
  'symbol-sizer': { id: 'symbol-sizer', label: 'Symbol Sizer Tool', key: '⇧S', category: 'symbols-graphs', icon: <Maximize2 size={I} />, hint: 'Dynamically scales symbol instances.' },
  'symbol-spinner': { id: 'symbol-spinner', label: 'Symbol Spinner Tool', key: '⇧S', category: 'symbols-graphs', icon: <RotateCw size={I} />, hint: 'Rotates symbol instances dynamically.' },
  'symbol-stainer': { id: 'symbol-stainer', label: 'Symbol Stainer Tool', key: '⇧S', category: 'symbols-graphs', icon: <Palette size={I} />, hint: 'Tints symbol instances with current foreground color.' },
  'symbol-screener': { id: 'symbol-screener', label: 'Symbol Screener Tool', key: '⇧S', category: 'symbols-graphs', icon: <Eye size={I} />, hint: 'Adjusts opacity of symbol instances.' },
  'symbol-styler': { id: 'symbol-styler', label: 'Symbol Styler Tool', key: '⇧S', category: 'symbols-graphs', icon: <Sparkles size={I} />, hint: 'Applies active graphic styles to symbol instances.' },

  // 10. GRAPHS & CHARTS
  'graph-column': { id: 'graph-column', label: 'Column Graph Tool', key: 'J', category: 'symbols-graphs', icon: <BarChart2 size={I} />, hint: 'Generates vertical column bar charts from vector data.' },
  'graph-stacked-column': { id: 'graph-stacked-column', label: 'Stacked Column Graph Tool', key: 'J', category: 'symbols-graphs', icon: <BarChart2 size={I} />, hint: 'Generates stacked vertical column charts.' },
  'graph-bar': { id: 'graph-bar', label: 'Bar Graph Tool', key: 'J', category: 'symbols-graphs', icon: <BarChart2 size={I} className="rotate-90" />, hint: 'Generates horizontal bar charts.' },
  'graph-stacked-bar': { id: 'graph-stacked-bar', label: 'Stacked Bar Graph Tool', key: 'J', category: 'symbols-graphs', icon: <BarChart2 size={I} className="rotate-90" />, hint: 'Generates horizontal stacked bar charts.' },
  'graph-line': { id: 'graph-line', label: 'Line Graph Tool', key: 'J', category: 'symbols-graphs', icon: <Slash size={I} />, hint: 'Generates vector line graphs.' },
  'graph-area': { id: 'graph-area', label: 'Area Graph Tool', key: 'J', category: 'symbols-graphs', icon: <Square size={I} />, hint: 'Generates vector area charts.' },
  'graph-scatter': { id: 'graph-scatter', label: 'Scatter Graph Tool', key: 'J', category: 'symbols-graphs', icon: <Crosshair size={I} />, hint: 'Generates XY scatter plot charts.' },
  'graph-pie': { id: 'graph-pie', label: 'Pie Graph Tool', key: 'J', category: 'symbols-graphs', icon: <PieChart size={I} />, hint: 'Generates circular pie charts.' },
  'graph-radar': { id: 'graph-radar', label: 'Radar Graph Tool', key: 'J', category: 'symbols-graphs', icon: <PolarGridIcon />, hint: 'Generates spider/radar graphs.' },

  // 11. LAYOUT, SLICES & NAVIGATION
  slice: { id: 'slice', label: 'Slice Tool', key: '⇧K', category: 'navigate', icon: <Crop size={I} />, hint: 'Divides artwork into web export slices.' },
  'slice-select': { id: 'slice-select', label: 'Slice Select Tool', key: '⇧K', category: 'navigate', icon: <MousePointer size={I} />, hint: 'Selects and configures web export slices.' },
  artboard: { id: 'artboard', label: 'Artboard Tool', key: '⇧O', category: 'navigate', icon: <ArtboardIcon />, hint: 'Creates, resizes, duplicates and arranges multi-artboards.' },
  packaging: { id: 'packaging', label: 'Packaging Dieline Tool', key: '⇧D', category: 'navigate', icon: <Package size={I} />, hint: 'Generates and edits box dielines, crease nets, and cut contours.' },
  hand: { id: 'hand', label: 'Hand Tool', key: 'H', category: 'navigate', icon: <Hand size={I} />, hint: 'Pans the canvas view. Hold Space for quick pan.' },
  'print-tiling': { id: 'print-tiling', label: 'Print Tiling Tool', key: 'H', category: 'navigate', icon: <LayoutGrid size={I} />, hint: 'Adjusts printable boundary page tiles.' },
  zoom: { id: 'zoom', label: 'Zoom Tool', key: 'Z', category: 'navigate', icon: <Search size={I} />, hint: 'Click to zoom in, ⌥-click to zoom out (up to 64,000%).' },
  'perspective-grid': { id: 'perspective-grid', label: 'Perspective Grid Tool', key: '⇧P', category: 'navigate', icon: <PerspectiveGridIcon />, hint: 'Displays 1-point, 2-point, or 3-point perspective grid.' },
  'perspective-select': { id: 'perspective-select', label: 'Perspective Selection Tool', key: '⇧V', category: 'navigate', icon: <ArrowUpRight size={I} />, hint: 'Transforms objects in perspective planes.' },

  // Secondary utilities
  'marquee-rect': { id: 'marquee-rect', label: 'Rectangular Marquee', key: 'M', category: 'raster', icon: <Square size={I} />, hint: 'Rectangular selection.' },
  'marquee-ellipse': { id: 'marquee-ellipse', label: 'Elliptical Marquee', key: 'M', category: 'raster', icon: <Circle size={I} />, hint: 'Elliptical selection.' },
  'poly-lasso': { id: 'poly-lasso', label: 'Polygonal Lasso', key: 'L', category: 'raster', icon: <Hexagon size={I} />, hint: 'Polygon selection points.' },
  crop: { id: 'crop', label: 'Crop Tool', key: 'C', category: 'raster', icon: <Crop size={I} />, hint: 'Crops canvas boundaries.' },
  clone: { id: 'clone', label: 'Clone Stamp', key: 'S', category: 'raster', icon: <Stamp size={I} />, hint: 'Clones pixel areas.' },
  heal: { id: 'heal', label: 'Spot Healing Brush', key: 'J', category: 'raster', icon: <Bandage size={I} />, hint: 'Retouching.' },
  smudge: { id: 'smudge', label: 'Smudge Tool', key: 'R', category: 'raster', icon: <Fingerprint size={I} />, hint: 'Smudges pixels.' },
  dodge: { id: 'dodge', label: 'Dodge Tool', key: 'O', category: 'raster', icon: <Sun size={I} />, hint: 'Lightens pixels.' },
  burn: { id: 'burn', label: 'Burn Tool', key: 'O', category: 'raster', icon: <Moon size={I} />, hint: 'Darkens pixels.' },
  sponge: { id: 'sponge', label: 'Sponge Tool', key: 'O', category: 'raster', icon: <Droplet size={I} />, hint: 'Saturates/desaturates.' },
  blur: { id: 'blur', label: 'Blur Tool', key: 'R', category: 'raster', icon: <Blend size={I} />, hint: 'Softens details.' },
  sharpen: { id: 'sharpen', label: 'Sharpen Tool', key: 'R', category: 'raster', icon: <Sparkles size={I} />, hint: 'Sharpens details.' },
  'marquee-row': { id: 'marquee-row', label: 'Single Row Marquee', key: 'M', category: 'raster', icon: <Slash size={I} />, hint: 'Row marquee.' },
  'marquee-col': { id: 'marquee-col', label: 'Single Column Marquee', key: 'M', category: 'raster', icon: <Slash size={I} className="rotate-90" />, hint: 'Column marquee.' },
  'quick-select': { id: 'quick-select', label: 'Quick Selection', key: 'W', category: 'raster', icon: <WandSparkles size={I} />, hint: 'Quick selection.' },
  'magic-eraser': { id: 'magic-eraser', label: 'Magic Eraser', key: 'E', category: 'raster', icon: <Eraser size={I} />, hint: 'Erases matching pixels.' },
  'bg-eraser': { id: 'bg-eraser', label: 'Background Eraser', key: 'E', category: 'raster', icon: <Eraser size={I} />, hint: 'Erases background.' },
  'color-replace': { id: 'color-replace', label: 'Color Replacement', key: 'B', category: 'raster', icon: <Replace size={I} />, hint: 'Recolors pixels.' },
  'red-eye': { id: 'red-eye', label: 'Red Eye Tool', key: 'J', category: 'raster', icon: <ScanEye size={I} />, hint: 'Removes red eye.' },
  'history-brush': { id: 'history-brush', label: 'History Brush', key: 'Y', category: 'raster', icon: <History size={I} />, hint: 'Paints historical state.' },
  'heal-brush': { id: 'heal-brush', label: 'Healing Brush', key: 'J', category: 'raster', icon: <PaintbrushVertical size={I} />, hint: 'Blends texture.' },
  'color-sampler': { id: 'color-sampler', label: 'Color Sampler', key: 'I', category: 'raster', icon: <Crosshair size={I} />, hint: 'Pins color readouts.' },
};

/** Full Illustrator Advanced Toolbar Slots (Flyout Groups) */
export const ADVANCED_GROUPS: ToolId[][] = [
  ['master-select', 'move', 'direct-select', 'group-select', 'wand', 'lasso'],
  ['pen', 'add-anchor', 'delete-anchor', 'anchor-point', 'curvature'],
  ['line', 'arc', 'spiral', 'rect-grid', 'polar-grid'],
  ['shape-rect', 'shape-round-rect', 'shape-ellipse', 'shape-polygon', 'shape-star', 'flare'],
  ['text', 'area-type', 'path-type', 'vertical-type', 'vertical-area-type', 'vertical-path-type', 'touch-type'],
  ['brush', 'blob-brush'],
  ['pencil', 'smooth', 'path-eraser', 'join', 'shaper'],
  ['eraser', 'scissors', 'knife'],
  ['rotate', 'reflect'],
  ['scale', 'shear', 'reshape'],
  ['width', 'warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'],
  ['free-transform', 'puppet-warp'],
  ['shape-builder', 'bucket', 'live-paint-select'],
  ['perspective-grid', 'perspective-select'],
  ['mesh', 'gradient'],
  ['eyedropper', 'ruler', 'color-sampler'],
  ['image-trace'],
  ['blend'],
  ['symbol-sprayer', 'symbol-shifter', 'symbol-scruncher', 'symbol-sizer', 'symbol-spinner', 'symbol-stainer', 'symbol-screener', 'symbol-styler'],
  ['graph-column', 'graph-stacked-column', 'graph-bar', 'graph-stacked-bar', 'graph-line', 'graph-area', 'graph-scatter', 'graph-pie', 'graph-radar'],
  ['slice', 'slice-select'],
  ['artboard', 'packaging'],
  ['hand', 'print-tiling'],
  ['zoom'],
];

/** Basic Streamlined Toolbar Slots */
export const BASIC_GROUPS: ToolId[][] = [
  ['master-select', 'move', 'direct-select'],
  ['pen', 'curvature', 'anchor-point'],
  ['shape-rect', 'shape-ellipse', 'shape-polygon', 'line'],
  ['text'],
  ['brush', 'pencil'],
  ['eraser', 'scissors'],
  ['rotate', 'scale'],
  ['width'],
  ['shape-builder'],
  ['gradient', 'eyedropper'],
  ['image-trace'],
  ['artboard'],
  ['hand', 'zoom'],
];

export function toolLabel(id: ToolId) {
  return TOOLS[id]?.label ?? id;
}

export function toolHint(id: ToolId) {
  return TOOLS[id]?.hint ?? '';
}

/** Drawer component displaying ALL Illustrator tools categorized with search */
export function AllToolsDrawer({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'all' | 'select' | 'draw' | 'type' | 'paint' | 'modify' | 'symbols-graphs' | 'navigate'>('all');
  const [query, setQuery] = useState('');

  const allToolList = useMemo(() => Object.values(TOOLS), []);

  const filtered = useMemo(() => {
    return allToolList.filter((t) => {
      const matchCat = tab === 'all' || t.category === tab;
      const matchQuery = !query || t.label.toLowerCase().includes(query.toLowerCase()) || t.key.toLowerCase().includes(query.toLowerCase()) || t.hint.toLowerCase().includes(query.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [allToolList, tab, query]);

  return (
    <div className="all-tools-drawer">
      <div className="all-tools-header">
        <div className="all-tools-title">
          <span className="brand-mark" />
          <h3>All Tools Catalog ({allToolList.length})</h3>
        </div>
        <button className="all-tools-close" onClick={onClose} title="Close All Tools">
          <X size={16} />
        </button>
      </div>

      <div className="all-tools-search-box">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Filter tools by name, shortcut, or feature…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && <button className="clear-btn" onClick={() => setQuery('')}>×</button>}
      </div>

      <div className="all-tools-tabs">
        {(['all', 'select', 'draw', 'type', 'paint', 'modify', 'symbols-graphs', 'navigate'] as const).map((cat) => (
          <button
            key={cat}
            className={`all-tools-tab-btn ${tab === cat ? 'active' : ''}`}
            onClick={() => setTab(cat)}
          >
            {cat === 'all' ? 'All (100+)' : cat === 'symbols-graphs' ? 'Symbols & Charts' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      <div className="all-tools-grid">
        {filtered.map((t) => (
          <button
            key={t.id}
            className={`all-tool-card ${s.tool === t.id ? 'active' : ''}`}
            onClick={() => {
              store.setTool(t.id);
              onClose();
            }}
            title={`${t.label} (${t.key})\n${t.hint}`}
          >
            <div className="all-tool-card-icon">{t.icon}</div>
            <div className="all-tool-card-info">
              <div className="all-tool-card-name">
                <span>{t.label}</span>
                {t.key && <kbd className="kbd">{t.key}</kbd>}
              </div>
              <p className="all-tool-card-hint">{t.hint}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="all-tools-footer">
        <div className="all-tools-mode-toggle">
          <span>Toolbar Preset:</span>
          <button
            className={`preset-btn ${s.toolbarMode === 'advanced' ? 'active' : ''}`}
            onClick={() => store.setToolbarMode('advanced')}
          >
            Advanced
          </button>
          <button
            className={`preset-btn ${s.toolbarMode === 'basic' ? 'active' : ''}`}
            onClick={() => store.setToolbarMode('basic')}
          >
            Basic
          </button>
        </div>
        <span className="all-tools-count">Showing {filtered.length} of {allToolList.length} tools</span>
      </div>
    </div>
  );
}

/**
 * How many columns the tool bar needs so every tool fits above the color controls: 1 normally,
 * 2 or 3 on short windows (like Photoshop's double-column toolbar).
 */
function useRailColumns(count: number) {
  const railRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const fit = () => {
      const avail = rail.clientHeight - (bottomRef.current?.offsetHeight ?? 0) - 16;
      const tools = toolsRef.current;
      // Height of one column: every slot plus the separators between groups
      const seps = tools ? tools.querySelectorAll('.tool-slot.sep').length : 0;
      const need = count * 27 + seps * 9;
      const next = avail > 0 ? Math.max(1, Math.min(3, Math.ceil(need / avail))) : 1;
      setCols((c) => (c === next ? c : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [count]);
  return { cols, railRef, toolsRef, bottomRef };
}

/** Puts a flyout beside the whole tool bar, opening upwards for tools in the lower half. */
function flyoutPlacement(index: number, cols: number, tools: HTMLElement | null): React.CSSProperties {
  const col = index % cols;
  const style: React.CSSProperties = { left: `calc(100% + 6px + ${(cols - 1 - col) * 32}px)` };
  const slot = tools?.children[index] as HTMLElement | undefined;
  if (slot && tools && slot.offsetTop > tools.clientHeight / 2 && slot.offsetTop > 240) {
    style.top = 'auto';
    style.bottom = -4;
  }
  return style;
}

export function ToolRail() {
  const s = useStore();
  const [flyout, setFlyout] = useState<number | null>(null);
  const [remembered, setRemembered] = useState<Record<number, ToolId>>({});
  const [activeChip, setActiveChip] = useState<'fill' | 'stroke'>('fill');

  const groups = s.toolbarMode === 'basic' ? BASIC_GROUPS : ADVANCED_GROUPS;

  const strokeColor = s.opts.shapeStrokeColor || '#000000';
  const { cols, railRef, toolsRef, bottomRef } = useRailColumns(groups.length);

  return (
    <div className={`tool-rail cols-${cols}`} ref={railRef} onMouseLeave={() => setFlyout(null)}>
      {/* Tool Slots with Flyout Groupings (more columns when the window is short) */}
      <div className="rail-tools" ref={toolsRef} style={{ gridTemplateColumns: `repeat(${cols}, 30px)` }}>
      {groups.map((group, gi) => {
        const activeInGroup = group.includes(s.tool);
        const shown = activeInGroup ? s.tool : remembered[gi] ?? group[0];
        const t = TOOLS[shown] ?? TOOLS.move;
        return (
          <div key={gi} className="tool-slot">
            <button
              className={`tool-btn ${activeInGroup ? 'active' : ''}`}
              title={`${t.label} (${t.key})\n${t.hint}`}
              onClick={() => store.setTool(shown)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (group.length > 1) setFlyout(gi);
              }}
              onPointerDown={(e) => {
                if (group.length < 2) return;
                const timer = window.setTimeout(() => setFlyout(gi), 350);
                const clear = () => window.clearTimeout(timer);
                e.currentTarget.addEventListener('pointerup', clear, { once: true });
                e.currentTarget.addEventListener('pointerleave', clear, { once: true });
              }}
            >
              {t.icon}
              {group.length > 1 && <span className="tool-corner" />}
            </button>
            {flyout === gi && (
              <div className="tool-flyout" style={flyoutPlacement(gi, cols, toolsRef.current)}>
                {group.map((id) => (
                  <button
                    key={id}
                    className={`flyout-item ${s.tool === id ? 'active' : ''}`}
                    onClick={() => {
                      store.setTool(id);
                      setRemembered({ ...remembered, [gi]: id });
                      setFlyout(null);
                    }}
                  >
                    {TOOLS[id]?.icon ?? <Square size={I} />}
                    <span>{TOOLS[id]?.label ?? id}</span>
                    <kbd className="kbd">{TOOLS[id]?.key ?? ''}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>

      <div className="rail-spacer" />
      <div className="rail-bottom" ref={bottomRef}>

      {/* Adobe Illustrator Dual Fill / Stroke Swatch Box */}
      <div className="ai-swatches-box" title="Fill & Stroke controls (X to toggle, ⇧X to swap, D for default, / for None)">
        <button
          className={`ai-swatch-chip ai-fill-chip ${activeChip === 'fill' ? 'ai-swatch-active' : ''}`}
          style={{ background: s.opts.shapeFill ? s.fg : 'transparent' }}
          aria-label="Fill color"
          title={`Fill: ${s.opts.shapeFill ? s.fg : 'None'} (Click to pick color)`}
          onClick={() => {
            setActiveChip('fill');
            store.set({ dialog: { type: 'colorPicker', target: 'fg' } });
          }}
        >
          {!s.opts.shapeFill && <span className="ai-none-slash" />}
        </button>

        <button
          className={`ai-swatch-chip ai-stroke-chip ${activeChip === 'stroke' ? 'ai-swatch-active' : ''}`}
          aria-label="Stroke color"
          title={`Stroke: ${s.opts.shapeStrokeWidth > 0 ? strokeColor : 'None'} (Click to pick stroke color)`}
          onClick={() => {
            setActiveChip('stroke');
            store.set({ dialog: { type: 'colorPicker', target: 'bg' } });
          }}
        >
          <div className="ai-stroke-inner" style={{ borderColor: s.opts.shapeStrokeWidth > 0 ? strokeColor : 'transparent' }}>
            {s.opts.shapeStrokeWidth <= 0 && <span className="ai-none-slash" />}
          </div>
        </button>

        <button
          className="ai-swatch-swap"
          title="Swap Fill and Stroke (⇧X)"
          onClick={() => {
            const oldFill = s.fg;
            const oldStroke = s.opts.shapeStrokeColor;
            store.set({ fg: oldStroke });
            store.setOpts({ shapeStrokeColor: oldFill });
          }}
        >
          <ArrowLeftRight size={10} />
        </button>

        <button
          className="ai-swatch-default"
          title="Default Fill and Stroke: White fill, Black 1px stroke (D)"
          onClick={() => {
            store.set({ fg: '#ffffff', bg: '#000000' });
            store.setOpts({ shapeFill: true, shapeStrokeWidth: 1, shapeStrokeColor: '#000000' });
          }}
        >
          <Undo2 size={9} />
        </button>
      </div>

      {/* Mini Color / Gradient / None Buttons */}
      <div className="ai-mini-actions">
        <button
          className="ai-mini-btn"
          title="Color (,)"
          onClick={() => store.setOpts({ shapeFill: true })}
        >
          <span className="mini-color-block" style={{ background: s.fg }} />
        </button>
        <button
          className="ai-mini-btn"
          title="Gradient (.)"
          onClick={() => store.setTool('gradient')}
        >
          <span className="mini-grad-block" />
        </button>
        <button
          className="ai-mini-btn"
          title="None (/)"
          onClick={() => {
            if (activeChip === 'fill') store.setOpts({ shapeFill: false });
            else store.setOpts({ shapeStrokeWidth: 0 });
          }}
        >
          <span className="ai-none-slash-mini" />
        </button>
      </div>

      {/* Draw Modes (Normal, Behind, Inside) */}
      <div className="ai-draw-modes" title="Drawing Modes (⇧D)">
        <button
          className={`ai-mode-btn ${s.drawMode === 'normal' ? 'active' : ''}`}
          title="Draw Normal"
          onClick={() => store.setDrawMode('normal')}
        >
          <Square size={12} />
        </button>
        <button
          className={`ai-mode-btn ${s.drawMode === 'behind' ? 'active' : ''}`}
          title="Draw Behind"
          onClick={() => store.setDrawMode('behind')}
        >
          <Layers size={12} />
        </button>
        <button
          className={`ai-mode-btn ${s.drawMode === 'inside' ? 'active' : ''}`}
          title="Draw Inside (Clip)"
          onClick={() => store.setDrawMode('inside')}
        >
          <Square size={12} className="dashed-border" />
        </button>
      </div>

      {/* Change Screen Mode & Edit Toolbar */}
      <div className="ai-bottom-utils">
        <button
          className="tool-btn"
          title="Change Screen Mode (F)"
          onClick={() => store.toggleScreenMode()}
        >
          <Maximize2 size={13} />
        </button>

        {/* The iconic Adobe Illustrator 'Edit Toolbar' (...) button */}
        <button
          className={`tool-btn ai-edit-toolbar-btn ${s.allToolsOpen ? 'active' : ''}`}
          title="Edit Toolbar — View & Search All 100+ Tools (…)"
          onClick={() => store.toggleAllTools()}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      </div>

      {/* Slide-out All Tools Drawer */}
      {s.allToolsOpen && <AllToolsDrawer onClose={() => store.toggleAllTools(false)} />}
    </div>
  );
}
