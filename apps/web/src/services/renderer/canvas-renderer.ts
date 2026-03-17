import type { BaseNode } from "./nodes/base-node";

export type RenderLayer = "main" | "backgroundBlur";
export type RenderMode = "preview" | "quality";

export type CanvasRendererParams = {
  width: number;
  height: number;
  fps: number;
  mode?: RenderMode;
  renderScale?: number;
};

export class CanvasRenderer {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  width: number;
  height: number;
  fps: number;
  renderLayer: RenderLayer;
  mode: RenderMode;
  renderScale: number;
  isPlaying: boolean;

  constructor({ width, height, fps, mode = "quality", renderScale = 1 }: CanvasRendererParams) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.renderLayer = "main";
    this.mode = mode;
    this.renderScale = this.clampRenderScale({ renderScale });
    this.isPlaying = false;
    this.canvas = this.createCanvas();
    this.context = this.createContext();
    this.applyBaseTransform();
  }

  private clampRenderScale({ renderScale }: { renderScale: number }): number {
    if (!Number.isFinite(renderScale)) {
      return 1;
    }
    return Math.min(Math.max(renderScale, 0.5), 1);
  }

  private getBackingWidth(): number {
    return Math.max(1, Math.round(this.width * this.renderScale));
  }

  private getBackingHeight(): number {
    return Math.max(1, Math.round(this.height * this.renderScale));
  }

  getRasterWidth(): number {
    return this.getBackingWidth();
  }

  getRasterHeight(): number {
    return this.getBackingHeight();
  }

  private createCanvas(): OffscreenCanvas | HTMLCanvasElement {
    const width = this.getBackingWidth();
    const height = this.getBackingHeight();
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  }

  private createContext():
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D {
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get canvas context");
    }
    return context as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  }

  private rebuildCanvas() {
    this.canvas = this.createCanvas();
    this.context = this.createContext();
    this.applyBaseTransform();
  }

  public prepareContext({
    context,
  }: {
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  }) {
    context.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    context.imageSmoothingEnabled = true;
  }

  private applyBaseTransform() {
    this.prepareContext({ context: this.context });
  }

  setSize({ width, height }: { width: number; height: number }) {
    this.width = width;
    this.height = height;
    this.rebuildCanvas();
  }

  setRenderScale({ renderScale }: { renderScale: number }): boolean {
    const nextRenderScale = this.clampRenderScale({ renderScale });
    if (Math.abs(nextRenderScale - this.renderScale) <= 0.001) {
      return false;
    }
    this.renderScale = nextRenderScale;
    this.rebuildCanvas();
    return true;
  }

  setPlaybackState({ isPlaying }: { isPlaying: boolean }) {
    this.isPlaying = isPlaying;
  }

  private clear() {
    this.applyBaseTransform();
    this.context.clearRect(0, 0, this.width, this.height);
  }

  async render({ node, time }: { node: BaseNode; time: number }) {
    this.clear();
    await node.render({ renderer: this, time });
  }

  async renderToCanvas({
    node,
    time,
    targetCanvas,
  }: {
    node: BaseNode;
    time: number;
    targetCanvas: HTMLCanvasElement;
  }) {
    await this.render({ node, time });

    const ctx = targetCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get target canvas context");
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.drawImage(this.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
  }
}
