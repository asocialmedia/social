"use client";

// oxlint-disable react/todo -- Canvas failures must be caught so the sender keeps the unsent photo.
// oxlint-disable jsx-a11y/prefer-tag-over-role -- A canvas needs image semantics; tool groups contain interactive controls.

import {
  Check,
  Crop,
  FlipHorizontal2,
  Highlighter,
  Palette,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PointerEvent, ReactNode, Ref } from "react";

import {
  DEFAULT_PHOTO_ADJUSTMENTS,
  MAX_PHOTO_STROKES,
  MAX_PHOTO_STROKE_POINTS,
  PHOTO_LOOKS,
  drawPhotoStrokes,
  photoPointToSource,
  renderPhotoEdits,
} from "../lib/photo-editing";
import type {
  PhotoAdjustments,
  PhotoCropAction,
  PhotoGeometry,
  PhotoLook,
  PhotoStroke,
} from "../lib/photo-editing";

export interface PhotoEditorSnapshot {
  canvas: HTMLCanvasElement;
  geometry: PhotoGeometry;
}
export interface PhotoEditorHandle {
  exportCanvas: () => HTMLCanvasElement;
}
type EditorTool = "edit" | "looks" | "markup";
type EditMode = "crop" | "adjust";
type PhotoCropRatio = Extract<
  PhotoCropAction,
  "free" | "square" | "portrait" | "wide"
>;

const COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#202020" },
  { label: "Orange", value: "#ff5c35" },
  { label: "Yellow", value: "#facc15" },
  { label: "Blue", value: "#38bdf8" },
  { label: "Purple", value: "#c084fc" },
];
const TOOLS = [
  { Icon: Crop, id: "edit", label: "Edit" },
  { Icon: Palette, id: "looks", label: "Looks" },
  { Icon: Pencil, id: "markup", label: "Markup" },
] as const;
const CROP_RATIOS: readonly [PhotoCropRatio, string][] = [
  ["free", "Free"],
  ["square", "1:1"],
  ["portrait", "4:5"],
  ["wide", "16:9"],
];

// The same DOM workspace runs in the web dialog and Expo WebView.
export function PhotoEditorWorkspace({
  cropContent,
  getSnapshot,
  onCropAction,
  onError,
  ready,
  disabled = false,
  ref,
}: {
  cropContent: ReactNode;
  getSnapshot: () => PhotoEditorSnapshot;
  onCropAction: (action: PhotoCropAction) => void;
  onError: (message: string | null) => void;
  ready: boolean;
  disabled?: boolean;
  ref?: Ref<PhotoEditorHandle>;
}) {
  const id = useId();
  const [tool, setTool] = useState<EditorTool>("edit");
  const [editMode, setEditMode] = useState<EditMode>("crop");
  const [cropRatio, setCropRatio] = useState<PhotoCropRatio>("free");
  const [look, setLook] = useState<PhotoLook>("original");
  const [adjustments, setAdjustments] = useState<PhotoAdjustments>(
    DEFAULT_PHOTO_ADJUSTMENTS
  );
  const [brush, setBrush] = useState<PhotoStroke["tool"]>("pen");
  const [color, setColor] = useState(COLORS[2].value);
  const [brushSize, setBrushSize] = useState(4);
  const [history, setHistory] = useState<{
    strokes: PhotoStroke[];
    undone: PhotoStroke[];
  }>({ strokes: [], undone: [] });
  const [snapshot, setSnapshot] = useState<PhotoEditorSnapshot | null>(null);
  const [compare, setCompare] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const thumbnailsRef = useRef(new Map<string, HTMLCanvasElement>());
  const gesture = useRef<{
    stroke: PhotoStroke;
    pointerId: number;
    rect: DOMRect;
  } | null>(null);
  const paintFrame = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ height: 1, width: 1 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      if (paintFrame.current !== null) {
        cancelAnimationFrame(paintFrame.current);
      }
    },
    []
  );

  const exportCanvas = useCallback(() => {
    const current = getSnapshot();
    const output = renderPhotoEdits(current.canvas, look, adjustments);
    const context = output.getContext("2d");
    if (!context) {
      throw new Error("Image editing is unavailable on this device");
    }
    drawPhotoStrokes(context, history.strokes, current.geometry);
    return output;
  }, [getSnapshot, look, adjustments, history.strokes]);
  useImperativeHandle(ref, () => ({ exportCanvas }), [exportCanvas]);
  const isCropMode = tool === "edit" && editMode === "crop";

  const selectTool = (next: EditorTool) => {
    if (!ready || disabled || next === tool) {
      return;
    }
    try {
      if (next !== "edit" && isCropMode) {
        setSnapshot(getSnapshot());
      }
      onError(null);
      setCompare(false);
      setTool(next);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Couldn't preview this image"
      );
    }
  };

  const selectEditMode = (next: EditMode) => {
    if (!ready || disabled || (next === editMode && tool === "edit")) {
      return;
    }
    try {
      if (next === "adjust" && tool === "edit" && isCropMode) {
        setSnapshot(getSnapshot());
      }
      onError(null);
      setCompare(false);
      setEditMode(next);
      setTool("edit");
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Couldn't preview this image"
      );
    }
  };

  // Bound previews to 768px; full-resolution pixels are processed only on Save.
  useEffect(() => {
    if (!snapshot || isCropMode) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      try {
        const preview = previewRef.current;
        if (!preview) {
          return;
        }
        const scale = Math.min(
          1,
          768 / Math.max(snapshot.canvas.width, snapshot.canvas.height)
        );
        preview.width = Math.max(1, Math.round(snapshot.canvas.width * scale));
        preview.height = Math.max(
          1,
          Math.round(snapshot.canvas.height * scale)
        );
        const context = preview.getContext("2d");
        if (!context) {
          throw new Error("Couldn't preview this image");
        }
        context.drawImage(snapshot.canvas, 0, 0, preview.width, preview.height);
        if (!compare) {
          const rendered = renderPhotoEdits(preview, look, adjustments);
          context.drawImage(rendered, 0, 0);
        }
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "Couldn't preview this image"
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot, isCropMode, look, adjustments, compare, onError]);

  useEffect(() => {
    if (!snapshot || isCropMode) {
      return;
    }
    const canvas = marksRef.current;
    if (!canvas) {
      return;
    }
    const scale = Math.min(
      1,
      768 / Math.max(snapshot.canvas.width, snapshot.canvas.height)
    );
    canvas.width = Math.max(1, Math.round(snapshot.canvas.width * scale));
    canvas.height = Math.max(1, Math.round(snapshot.canvas.height * scale));
    const context = canvas.getContext("2d");
    if (context) {
      drawPhotoStrokes(context, history.strokes, snapshot.geometry);
    }
    const active = activeRef.current;
    if (active) {
      active.width = canvas.width;
      active.height = canvas.height;
    }
  }, [snapshot, isCropMode, history.strokes]);

  useEffect(() => {
    if (tool !== "looks" || !snapshot) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      try {
        const thumb = document.createElement("canvas");
        thumb.width = 72;
        thumb.height = 72;
        const side = Math.min(snapshot.canvas.width, snapshot.canvas.height);
        thumb
          .getContext("2d")
          ?.drawImage(
            snapshot.canvas,
            (snapshot.canvas.width - side) / 2,
            (snapshot.canvas.height - side) / 2,
            side,
            side,
            0,
            0,
            72,
            72
          );
        for (const preset of PHOTO_LOOKS) {
          const target = thumbnailsRef.current.get(preset.id);
          if (target) {
            target
              .getContext("2d")
              ?.drawImage(
                renderPhotoEdits(thumb, preset.id, DEFAULT_PHOTO_ADJUSTMENTS),
                0,
                0
              );
          }
        }
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : "Couldn't preview these looks"
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot, tool, onError]);

  const finishStroke = (
    event: PointerEvent<HTMLCanvasElement>,
    cancelled = false
  ) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    gesture.current = null;
    if (paintFrame.current !== null) {
      cancelAnimationFrame(paintFrame.current);
      paintFrame.current = null;
    }
    const canvas = activeRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled) {
      setHistory((current) => ({
        strokes: [...current.strokes, active.stroke],
        undone: [],
      }));
    }
  };
  const startStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (
      tool !== "markup" ||
      disabled ||
      !snapshot ||
      gesture.current ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }
    if (history.strokes.length >= MAX_PHOTO_STROKES) {
      onError("Undo or clear a mark to add more.");
      return;
    }
    onError(null);
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    const stroke: PhotoStroke = {
      color,
      points: [photoPointToSource(point, snapshot.geometry)],
      tool: brush,
      width:
        (((brushSize / rect.width) * snapshot.geometry.width) /
          snapshot.geometry.naturalWidth) *
        (brush === "highlight" ? 3 : 1),
    };
    gesture.current = { pointerId: event.pointerId, rect, stroke };
    const context = activeRef.current?.getContext("2d");
    if (context) {
      drawPhotoStrokes(context, [stroke], snapshot.geometry);
    }
  };
  const moveStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId || !snapshot) {
      return;
    }
    const { rect, stroke } = active;
    if (stroke.points.length < MAX_PHOTO_STROKE_POINTS) {
      const point = photoPointToSource(
        {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        },
        snapshot.geometry
      );
      const previous = stroke.points.at(-1);
      if (
        !previous ||
        Math.hypot(point.x - previous.x, point.y - previous.y) > 0.0008
      ) {
        stroke.points.push(point);
      }
    }
    if (paintFrame.current === null) {
      paintFrame.current = requestAnimationFrame(() => {
        paintFrame.current = null;
        const canvas = activeRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
          return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        drawPhotoStrokes(context, [stroke], snapshot.geometry);
      });
    }
  };

  const resetCrop = () => {
    onError(null);
    onCropAction("reset");
    setCompare(false);
    setCropRatio("free");
  };
  const aspect = snapshot ? snapshot.canvas.width / snapshot.canvas.height : 1;
  const displayWidth = Math.max(
    1,
    Math.min(stageSize.width, stageSize.height * aspect)
  );
  return (
    <div className="photo-editor-workspace" aria-busy={disabled}>
      <div className="photo-editor-stage" ref={stageRef}>
        <div
          className="photo-editor-crop"
          style={{ visibility: isCropMode ? "visible" : "hidden" }}
          aria-hidden={!isCropMode}
          inert={!isCropMode || disabled}
        >
          {cropContent}
        </div>
        {!isCropMode && snapshot ? (
          <div
            className="photo-editor-canvas-stack"
            style={{ height: displayWidth / aspect, width: displayWidth }}
          >
            <canvas
              ref={previewRef}
              aria-label="Edited photo preview"
              role="img"
            />
            <canvas
              ref={marksRef}
              className="photo-editor-marks"
              style={{ visibility: compare ? "hidden" : "visible" }}
              aria-hidden="true"
            />
            <canvas
              ref={activeRef}
              className="photo-editor-drawing"
              style={{
                pointerEvents: tool === "markup" && !compare ? "auto" : "none",
              }}
              aria-label="Draw on photo"
              onPointerDown={startStroke}
              onPointerMove={moveStroke}
              onPointerUp={finishStroke}
              onPointerCancel={(event) => finishStroke(event, true)}
              onLostPointerCapture={(event) => finishStroke(event, true)}
            />
          </div>
        ) : null}
        {isCropMode ? null : (
          <button
            type="button"
            className="photo-editor-compare"
            disabled={disabled}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            {compare ? "Show edits" : "Compare"}
          </button>
        )}
      </div>
      <div className="photo-editor-controls">
        <div
          className="photo-editor-tool-bar"
          role="group"
          aria-label="Photo tools"
        >
          {TOOLS.map(({ id: toolId, label, Icon }) => (
            <button
              type="button"
              key={toolId}
              disabled={disabled || !ready}
              aria-pressed={tool === toolId}
              onClick={() => selectTool(toolId)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <fieldset
          disabled={disabled || !ready}
          className="photo-editor-options"
          key={tool}
          aria-label={`${tool} options`}
        >
          {tool === "edit" ? (
            <div className="photo-editor-edit">
              <div
                className="photo-editor-edit-modes"
                role="group"
                aria-label="Edit tools"
              >
                <button
                  type="button"
                  aria-pressed={editMode === "crop"}
                  onClick={() => selectEditMode("crop")}
                >
                  <Crop size={15} />
                  <span>Crop</span>
                </button>
                <button
                  type="button"
                  aria-pressed={editMode === "adjust"}
                  onClick={() => selectEditMode("adjust")}
                >
                  <SlidersHorizontal size={15} />
                  <span>Adjust</span>
                </button>
                <button
                  type="button"
                  className="photo-editor-mode-reset"
                  aria-label={
                    editMode === "crop" ? "Reset crop" : "Reset adjustments"
                  }
                  title={
                    editMode === "crop" ? "Reset crop" : "Reset adjustments"
                  }
                  onClick={
                    editMode === "crop"
                      ? resetCrop
                      : () => setAdjustments(DEFAULT_PHOTO_ADJUSTMENTS)
                  }
                >
                  <RotateCcw size={17} />
                </button>
              </div>
              {editMode === "crop" ? (
                <div className="photo-editor-crop-layout">
                  <div
                    className="photo-editor-crop-actions"
                    role="group"
                    aria-label="Rotate and flip photo"
                  >
                    <button
                      type="button"
                      aria-label="Rotate left"
                      onClick={() => onCropAction("left")}
                    >
                      <RotateCcw size={18} />
                      <span>Left</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Rotate right"
                      onClick={() => onCropAction("right")}
                    >
                      <RotateCw size={18} />
                      <span>Right</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Flip horizontally"
                      onClick={() => onCropAction("flip")}
                    >
                      <FlipHorizontal2 size={18} />
                      <span>Flip</span>
                    </button>
                  </div>
                  <div
                    className="photo-editor-ratios"
                    role="group"
                    aria-label="Crop proportions"
                  >
                    {CROP_RATIOS.map(([action, label]) => (
                      <button
                        type="button"
                        key={action}
                        aria-pressed={cropRatio === action}
                        onClick={() => {
                          setCropRatio(action);
                          onCropAction(action);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="photo-editor-adjustments">
                  {(
                    [
                      ["brightness", "Light"],
                      ["contrast", "Contrast"],
                      ["saturation", "Color"],
                      ["warmth", "Warmth"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} htmlFor={`${id}-${key}`}>
                      <span>{label}</span>
                      <input
                        id={`${id}-${key}`}
                        type="range"
                        min={-50}
                        max={50}
                        step={1}
                        value={adjustments[key]}
                        onChange={(event) =>
                          setAdjustments({
                            ...adjustments,
                            [key]: Number(event.target.value),
                          })
                        }
                      />
                      <output htmlFor={`${id}-${key}`}>
                        {adjustments[key] > 0 ? "+" : ""}
                        {adjustments[key]}
                      </output>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {tool === "looks" ? (
            <div
              className="photo-editor-looks"
              role="group"
              aria-label="Photo filters"
            >
              {PHOTO_LOOKS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  aria-pressed={look === preset.id}
                  onClick={() => setLook(preset.id)}
                >
                  <span className="photo-editor-look-image">
                    <canvas
                      width={72}
                      height={72}
                      ref={(canvas) => {
                        if (canvas) {
                          thumbnailsRef.current.set(preset.id, canvas);
                        } else {
                          thumbnailsRef.current.delete(preset.id);
                        }
                      }}
                      aria-hidden="true"
                    />
                    {look === preset.id ? <Check size={16} /> : null}
                  </span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {tool === "markup" ? (
            <div className="photo-editor-markup">
              <div className="photo-editor-markup-header">
                <div
                  className="photo-editor-brushes"
                  role="group"
                  aria-label="Drawing tool"
                >
                  <button
                    type="button"
                    aria-label="Pen"
                    aria-pressed={brush === "pen"}
                    onClick={() => setBrush("pen")}
                  >
                    <Pencil size={18} />
                    <span>Pen</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Marker"
                    aria-pressed={brush === "highlight"}
                    onClick={() => setBrush("highlight")}
                  >
                    <Highlighter size={18} />
                    <span>Marker</span>
                  </button>
                </div>
                <div
                  className="photo-editor-history"
                  role="group"
                  aria-label="Markup history"
                >
                  <button
                    type="button"
                    aria-label="Undo mark"
                    disabled={!history.strokes.length}
                    onClick={() =>
                      setHistory((current) => ({
                        strokes: current.strokes.slice(0, -1),
                        undone: [
                          ...current.undone,
                          ...current.strokes.slice(-1),
                        ],
                      }))
                    }
                  >
                    <Undo2 size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Redo mark"
                    disabled={!history.undone.length}
                    onClick={() =>
                      setHistory((current) => ({
                        strokes: [
                          ...current.strokes,
                          ...current.undone.slice(-1),
                        ],
                        undone: current.undone.slice(0, -1),
                      }))
                    }
                  >
                    <Redo2 size={18} />
                  </button>
                </div>
              </div>
              <label
                className="photo-editor-brush-size"
                htmlFor={`${id}-brush`}
              >
                <span>Size</span>
                <input
                  id={`${id}-brush`}
                  type="range"
                  min={2}
                  max={14}
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
                <output htmlFor={`${id}-brush`}>{brushSize}</output>
              </label>
              <div className="photo-editor-palette">
                <span className="photo-editor-color-label">Color</span>
                <button
                  type="button"
                  className="photo-editor-text-button"
                  aria-label="Clear markup"
                  disabled={!history.strokes.length}
                  onClick={() =>
                    setHistory((current) => ({
                      strokes: [],
                      undone: [
                        ...current.undone,
                        ...current.strokes.toReversed(),
                      ],
                    }))
                  }
                >
                  Clear
                </button>
                <div
                  className="photo-editor-colors"
                  role="group"
                  aria-label="Markup color"
                >
                  {COLORS.map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      aria-label={item.label}
                      aria-pressed={color === item.value}
                      onClick={() => setColor(item.value)}
                    >
                      <span style={{ backgroundColor: item.value }}>
                        {color === item.value ? (
                          <Check
                            size={13}
                            color={
                              item.value === "#202020" ? "#fff" : "#171717"
                            }
                          />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </fieldset>
      </div>
    </div>
  );
}
