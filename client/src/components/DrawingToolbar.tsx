interface DrawingToolbarProps {
  color: string;
  setColor: (color: string) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  isEraser: boolean;
  setIsEraser: (isEraser: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
  disabled?: boolean;
}

const PALETTE_COLORS = [
  '#000000', // Black
  '#64748b', // Slate Gray
  '#ffffff', // White
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#78350f', // Brown
];

const BRUSH_SIZES = [
  { label: 'S', size: 4, visualRadius: 5 },
  { label: 'M', size: 8, visualRadius: 8 },
  { label: 'L', size: 16, visualRadius: 12 },
  { label: 'XL', size: 28, visualRadius: 16 },
];

export function DrawingToolbar({
  color,
  setColor,
  brushSize,
  setBrushSize,
  isEraser,
  setIsEraser,
  onUndo,
  onClear,
  canUndo,
  disabled = false,
}: DrawingToolbarProps) {
  return (
    <div className={`drawing-toolbar ${disabled ? 'toolbar-disabled' : ''}`}>
      {/* Primary Tool Selection: Brush vs Eraser */}
      <div className="toolbar-group tool-modes">
        <button
          type="button"
          className={`tool-btn ${!isEraser ? 'active-tool' : ''}`}
          onClick={() => setIsEraser(false)}
          title="Brush Tool"
          disabled={disabled}
        >
          <span className="tool-icon">🖌️</span>
          <span className="tool-text">Brush</span>
        </button>

        <button
          type="button"
          className={`tool-btn ${isEraser ? 'active-tool' : ''}`}
          onClick={() => setIsEraser(true)}
          title="Eraser Tool"
          disabled={disabled}
        >
          <span className="tool-icon">🧹</span>
          <span className="tool-text">Eraser</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Brush Size Selector */}
      <div className="toolbar-group size-group">
        <span className="group-label">Size</span>
        <div className="size-buttons">
          {BRUSH_SIZES.map((b) => (
            <button
              key={b.size}
              type="button"
              className={`size-btn ${brushSize === b.size ? 'active-size' : ''}`}
              onClick={() => setBrushSize(b.size)}
              title={`${b.label} (${b.size}px)`}
              disabled={disabled}
            >
              <span
                className="size-dot"
                style={{
                  width: `${b.visualRadius * 1.5}px`,
                  height: `${b.visualRadius * 1.5}px`,
                  backgroundColor: isEraser ? '#64748b' : color,
                }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Color Palette (disabled when using eraser) */}
      <div className="toolbar-group palette-group">
        <span className="group-label">Color</span>
        <div className="palette-grid">
          {PALETTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${color === c && !isEraser ? 'active-color' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => {
                setColor(c);
                setIsEraser(false);
              }}
              title={c}
              disabled={disabled}
            >
              {c === '#ffffff' && <span className="white-border-marker" />}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Action Buttons: Undo & Clear */}
      <div className="toolbar-group action-group">
        <button
          type="button"
          className="btn btn-secondary btn-sm action-btn"
          onClick={onUndo}
          disabled={disabled || !canUndo}
          title="Undo last stroke"
        >
          <span>↩️</span> Undo
        </button>

        <button
          type="button"
          className="btn btn-danger btn-sm action-btn"
          onClick={onClear}
          disabled={disabled}
          title="Clear entire canvas"
        >
          <span>🗑️</span> Clear
        </button>
      </div>
    </div>
  );
}
