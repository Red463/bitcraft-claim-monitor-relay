import L from "leaflet";

import type { BrowserResourcePartition } from "./mapResourceBinaryState.mjs";
import { planPackedResourceDrawAtZoom } from "./packedResourceCanvasPlan.mjs";
import { RESOURCE_NODE_FALLBACK_COLOUR } from "./resourceNodeColours.mjs";

export class PackedResourceCanvasLayer extends L.Layer {
  #map: L.Map | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #frame = 0;
  #partitions: ReadonlyMap<string, BrowserResourcePartition> = new Map();
  #regions: readonly string[] = [];
  #colours: Readonly<Record<string, string>> = {};
  #visible = true;

  setResources(partitions: ReadonlyMap<string, BrowserResourcePartition>, regions: readonly string[], colours: Readonly<Record<string, string>>) {
    this.#partitions = partitions;
    this.#regions = regions;
    this.#colours = colours;
    this.#scheduleDraw();
  }

  setVisible(visible: boolean) {
    this.#visible = visible;
    if (this.#canvas) this.#canvas.style.display = visible ? "" : "none";
    this.#scheduleDraw();
  }

  onAdd(map: L.Map) {
    this.#map = map;
    this.#canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated native-map-dense-canvas") as HTMLCanvasElement;
    (map.getPane("native-map-resources") ?? map.getPanes().overlayPane).appendChild(this.#canvas);
    map.on("move zoom resize", this.#scheduleDraw, this);
    this.#scheduleDraw();
    return this;
  }

  onRemove(map: L.Map) {
    cancelAnimationFrame(this.#frame);
    map.off("move zoom resize", this.#scheduleDraw, this);
    this.#canvas?.remove();
    this.#canvas = null;
    this.#map = null;
    return this;
  }

  #scheduleDraw = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#draw());
  };

  #draw() {
    if (!this.#map || !this.#canvas || !this.#visible) return;
    const size = this.#map.getSize();
    const topLeft = this.#map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.#canvas, topLeft);
    this.#canvas.width = size.x;
    this.#canvas.height = size.y;
    const context = this.#canvas.getContext("2d");
    if (!context) return;
    const bounds = this.#map.getBounds().pad(0.1);
    const plan = planPackedResourceDrawAtZoom(this.#partitions, this.#regions, this.#map.getZoom(), {
      minX: bounds.getWest(),
      minZ: bounds.getSouth(),
      maxX: bounds.getEast(),
      maxZ: bounds.getNorth(),
    });
    let pointIndex = 0;
    context.lineWidth = 1.25;
    context.strokeStyle = "rgba(3, 8, 12, .92)";
    for (const { partition, coordinates, startIndex, endIndex } of plan.partitions) {
      context.fillStyle = this.#colours[partition.resourceId] ?? RESOURCE_NODE_FALLBACK_COLOUR;
      let partitionHasVisiblePoint = false;
      for (let index = startIndex; index < endIndex; index += 1) {
        const packed = coordinates[index];
        const x = packed & 0xffff;
        const z = packed >>> 16;
        if (plan.viewport && (x < plan.viewport.minX || x > plan.viewport.maxX)) continue;
        const draw = pointIndex % plan.stride === 0;
        pointIndex += 1;
        if (!draw) continue;
        const point = L.latLng(z, x);
        const pixel = this.#map.latLngToContainerPoint(point);
        if (!partitionHasVisiblePoint) {
          context.beginPath();
          partitionHasVisiblePoint = true;
        }
        context.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
      }
      if (partitionHasVisiblePoint) {
        context.stroke();
        context.fill();
      }
    }
  }
}
