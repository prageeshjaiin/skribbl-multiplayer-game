import { useRef, useEffect, useCallback } from 'react';
import { socket } from '../socket';
import type { Point, Stroke, DrawStartPayload, DrawMovePayload, DrawEndPayload } from '../types';

interface DrawingCanvasProps {
  roomId: string;
  isDrawer: boolean;
  currentColor: string;
  currentBrushSize: number;
  isEraser: boolean;
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
}

export function DrawingCanvas({
  roomId,
  isDrawer,
  currentColor,
  currentBrushSize,
  isEraser,
  strokes,
  onStrokesChange,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep ref to strokes to avoid stale closures in event listeners
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;

  // Active in-progress stroke for local drawer
  const activeStrokeRef = useRef<Stroke | null>(null);

  // Active in-progress strokes for remote drawers (keyed by strokeId)
  const remoteStrokesRef = useRef<Record<string, Stroke>>({});

  // Canvas display dimensions
  const dimensionsRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 800,
    height: 500,
    dpr: window.devicePixelRatio || 1,
  });

  /**
   * Redraw all strokes from scratch on the canvas context.
   */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensionsRef.current;

    // Reset transform and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply High-DPI scaling
    ctx.scale(dpr, dpr);

    // Canvas background fill (pure white)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Render every completed stroke
    for (const stroke of strokesRef.current) {
      renderStroke(ctx, stroke, width, height);
    }

    // Render active local stroke if any
    if (activeStrokeRef.current) {
      renderStroke(ctx, activeStrokeRef.current, width, height);
    }

    // Render active remote strokes if any
    for (const strokeId in remoteStrokesRef.current) {
      renderStroke(ctx, remoteStrokesRef.current[strokeId], width, height);
    }
  }, []);

  /**
   * Helper to draw a single stroke onto the 2D context.
   */
  const renderStroke = (
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    width: number,
    height: number
  ) => {
    if (!stroke.points || stroke.points.length === 0) return;

    const scaledSize = Math.max(1, stroke.size * (width / 800));

    ctx.save();
    ctx.lineWidth = scaledSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.isEraser ? '#ffffff' : stroke.color;

    if (stroke.points.length === 1) {
      // Draw a single dot
      const pt = stroke.points[0];
      const px = pt.x * width;
      const py = pt.y * height;
      ctx.beginPath();
      ctx.fillStyle = stroke.isEraser ? '#ffffff' : stroke.color;
      ctx.arc(px, py, scaledSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      const firstPt = stroke.points[0];
      ctx.moveTo(firstPt.x * width, firstPt.y * height);

      for (let i = 1; i < stroke.points.length; i++) {
        const pt = stroke.points[i];
        ctx.lineTo(pt.x * width, pt.y * height);
      }
      ctx.stroke();
    }

    ctx.restore();
  };

  /**
   * Incrementally draw a line segment between two points on the live canvas.
   */
  const drawSegment = (
    from: Point,
    to: Point,
    color: string,
    size: number,
    isEraserTool: boolean
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensionsRef.current;
    const scaledSize = Math.max(1, size * (width / 800));

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.lineWidth = scaledSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isEraserTool ? '#ffffff' : color;

    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Handle responsive resize and high-DPI adaptation without layout thrashing.
   */
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const targetCanvasWidth = Math.round(width * dpr);
      const targetCanvasHeight = Math.round(height * dpr);

      // Avoid reallocating canvas buffer if dimensions did not change
      if (
        canvas.width === targetCanvasWidth &&
        canvas.height === targetCanvasHeight
      ) {
        return;
      }

      dimensionsRef.current = { width, height, dpr };
      canvas.width = targetCanvasWidth;
      canvas.height = targetCanvasHeight;

      redraw();
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [redraw]);

  /**
   * Block unwanted browser gestures (pinch-to-zoom, wheel-zoom, double-tap zoom) on the canvas.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Prevent wheel zoom (Ctrl+wheel / trackpad pinch) over canvas
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    // Prevent double-touch pinch zoom
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    // Prevent Safari gesture zoom
    const handleGesture = (e: Event) => {
      e.preventDefault();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('gesturestart', handleGesture);
    canvas.addEventListener('gesturechange', handleGesture);
    canvas.addEventListener('gestureend', handleGesture);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('gesturestart', handleGesture);
      canvas.removeEventListener('gesturechange', handleGesture);
      canvas.removeEventListener('gestureend', handleGesture);
    };
  }, []);

  /**
   * Request initial canvas state from backend on mount or when roomId changes.
   */
  useEffect(() => {
    socket.emit('get_canvas_state', { roomId }, (response: any) => {
      if (response?.success && Array.isArray(response.data)) {
        onStrokesChange(response.data);
      }
    });
  }, [roomId, onStrokesChange]);

  /**
   * Socket.IO real-time remote drawing event listeners.
   */
  useEffect(() => {
    function handleRemoteDrawStart(data: {
      strokeId: string;
      point: Point;
      color: string;
      size: number;
      isEraser: boolean;
    }) {
      if (activeStrokeRef.current && activeStrokeRef.current.id === data.strokeId) {
        return;
      }

      const remoteStroke: Stroke = {
        id: data.strokeId,
        points: [data.point],
        color: data.color,
        size: data.size,
        isEraser: data.isEraser,
      };

      remoteStrokesRef.current[data.strokeId] = remoteStroke;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { width, height, dpr } = dimensionsRef.current;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        renderStroke(ctx, remoteStroke, width, height);
        ctx.restore();
      }
    }

    function handleRemoteDrawMove(data: { strokeId: string; point: Point }) {
      if (activeStrokeRef.current && activeStrokeRef.current.id === data.strokeId) {
        return;
      }

      const remoteStroke = remoteStrokesRef.current[data.strokeId];
      if (!remoteStroke) return;

      const lastPoint = remoteStroke.points[remoteStroke.points.length - 1];
      remoteStroke.points.push(data.point);

      if (lastPoint) {
        drawSegment(
          lastPoint,
          data.point,
          remoteStroke.color,
          remoteStroke.size,
          remoteStroke.isEraser
        );
      }
    }

    function handleRemoteDrawEnd(data: { strokeId: string }) {
      if (activeStrokeRef.current && activeStrokeRef.current.id === data.strokeId) {
        return;
      }

      const completedRemoteStroke = remoteStrokesRef.current[data.strokeId];
      if (completedRemoteStroke) {
        delete remoteStrokesRef.current[data.strokeId];
        const nextStrokes = [...strokesRef.current, completedRemoteStroke];
        onStrokesChange(nextStrokes);
      }
    }

    function handleRemoteUndo() {
      const nextStrokes = strokesRef.current.slice(0, -1);
      onStrokesChange(nextStrokes);
    }

    function handleRemoteClear() {
      remoteStrokesRef.current = {};
      activeStrokeRef.current = null;
      onStrokesChange([]);
    }

    function handleRemoteCanvasState(stateStrokes: Stroke[]) {
      if (Array.isArray(stateStrokes)) {
        onStrokesChange(stateStrokes);
      }
    }

    socket.on('draw_start', handleRemoteDrawStart);
    socket.on('draw_move', handleRemoteDrawMove);
    socket.on('draw_end', handleRemoteDrawEnd);
    socket.on('draw_undo', handleRemoteUndo);
    socket.on('canvas_clear', handleRemoteClear);
    socket.on('canvas_state', handleRemoteCanvasState);

    return () => {
      socket.off('draw_start', handleRemoteDrawStart);
      socket.off('draw_move', handleRemoteDrawMove);
      socket.off('draw_end', handleRemoteDrawEnd);
      socket.off('draw_undo', handleRemoteUndo);
      socket.off('canvas_clear', handleRemoteClear);
      socket.off('canvas_state', handleRemoteCanvasState);
    };
  }, [onStrokesChange]);

  // Whenever strokes prop changes, redraw the canvas
  useEffect(() => {
    redraw();
  }, [strokes, redraw]);

  /**
   * Convert PointerEvent client coordinates to normalized (0.0 to 1.0) coordinates.
   */
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const normX = Math.max(0, Math.min(1, clientX / rect.width));
    const normY = Math.max(0, Math.min(1, clientY / rect.height));

    return { x: normX, y: normY };
  };

  /**
   * Pointer Events: pointerdown
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer) return;

    // Only allow primary mouse button, touch, or pen
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // Prevent default browser touch actions (scrolling, gesture zooming)
    e.preventDefault();

    // Capture pointer to track outside canvas borders during fast strokes
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored if capture unsupported
    }

    const pt = getNormalizedPoint(e);
    if (!pt) return;

    const strokeId = Math.random().toString(36).substring(2, 11);
    const newStroke: Stroke = {
      id: strokeId,
      points: [pt],
      color: currentColor,
      size: currentBrushSize,
      isEraser,
    };

    activeStrokeRef.current = newStroke;

    // Draw starting dot on local canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { width, height, dpr } = dimensionsRef.current;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        renderStroke(ctx, newStroke, width, height);
        ctx.restore();
      }
    }

    // Emit draw_start to server
    const payload: DrawStartPayload = {
      roomId,
      strokeId,
      point: pt,
      color: currentColor,
      size: currentBrushSize,
      isEraser,
    };
    socket.emit('draw_start', payload);
  };

  /**
   * Pointer Events: pointermove
   */
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !activeStrokeRef.current) return;

    e.preventDefault();

    const pt = getNormalizedPoint(e);
    if (!pt) return;

    const currentStroke = activeStrokeRef.current;
    const lastPoint = currentStroke.points[currentStroke.points.length - 1];

    currentStroke.points.push(pt);

    if (lastPoint) {
      // Draw smooth line segment on local canvas immediately (zero latency)
      drawSegment(
        lastPoint,
        pt,
        currentStroke.color,
        currentStroke.size,
        currentStroke.isEraser
      );
    }

    // Emit draw_move to server
    const payload: DrawMovePayload = {
      roomId,
      strokeId: currentStroke.id,
      point: pt,
    };
    socket.emit('draw_move', payload);
  };

  /**
   * Pointer Events: pointerup / pointercancel
   */
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !activeStrokeRef.current) return;

    e.preventDefault();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture already released
    }

    const completedStroke = activeStrokeRef.current;
    activeStrokeRef.current = null;

    // Append completed stroke to local list
    const nextStrokes = [...strokesRef.current, completedStroke];
    onStrokesChange(nextStrokes);

    // Emit draw_end to server
    const payload: DrawEndPayload = {
      roomId,
      strokeId: completedStroke.id,
    };
    socket.emit('draw_end', payload);
  };

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${isDrawer ? 'canvas-drawer' : 'canvas-viewer'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
