export type AspectRatio = "16:9" | "9:16";
export type QualityTier = "1080p" | "4k-cloud";
export type FrameRate = 30 | 60;
export type MapTheme = "midnight" | "paper";
export type CameraPreset = "cinematic" | "overview";
export type VehicleKind = "plane";
export type ExportFormat = "mp4" | "webm";

export type RoutePoint = [number, number];

export type SceneTimings = {
  introMs: number;
  originHoldMs: number;
  flightMs: number;
  destinationHoldMs: number;
  outroMs: number;
};

export type RenderSpecV1 = {
  version: 1;
  route: {
    from: { name: string; coordinates: RoutePoint };
    to: { name: string; coordinates: RoutePoint };
    distanceKm: number;
  };
  aspectRatio: AspectRatio;
  quality: QualityTier;
  frameRate: FrameRate;
  timings: SceneTimings;
  map: {
    theme: MapTheme;
    styleUrl: string;
    cameraPreset: CameraPreset;
  };
  appearance: {
    routeColor: string;
    routeWidth: number;
    vehicle: VehicleKind;
    vehicleColor: string;
    vehicleScale: number;
    accentColor: string;
    fontFamily: string;
  };
  story: {
    title: string;
    subtitle: string;
    outroTitle: string;
    brand: string;
  };
};

export type RenderProgressPhase =
  | "idle"
  | "preparing"
  | "loading-assets"
  | "encoding"
  | "muxing"
  | "completed"
  | "cancelled"
  | "failed";

export type RenderProgress = {
  phase: RenderProgressPhase;
  progress: number;
  message: string;
  frame?: number;
  totalFrames?: number;
};

export type RenderResult = {
  blob: Blob;
  format: ExportFormat;
  width: number;
  height: number;
  durationMs: number;
};

export type CloudRenderJob = {
  id: string;
  status: "queued" | "rendering" | "completed" | "failed";
  progress: number;
  downloadUrl?: string;
  error?: string;
};

export type LocalRenderOptions = {
  format: ExportFormat;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
};

export interface RenderProvider {
  renderLocal(
    spec: RenderSpecV1,
    options: LocalRenderOptions
  ): Promise<RenderResult>;
  createCloudRender(spec: RenderSpecV1): Promise<{ jobId: string }>;
  getCloudRender(jobId: string): Promise<CloudRenderJob>;
}

export const DEFAULT_TIMINGS: SceneTimings = {
  introMs: 1800,
  originHoldMs: 1200,
  flightMs: 6000,
  destinationHoldMs: 1400,
  outroMs: 1800,
};

export const MAP_THEMES: Record<
  MapTheme,
  { name: string; description: string; styleUrl: string; swatches: string[] }
> = {
  midnight: {
    name: "Midnight Atlas",
    description: "Deep oceans, luminous routes",
    styleUrl: "mapbox://styles/mapbox/dark-v11",
    swatches: ["#08101f", "#172036", "#d6a75c"],
  },
  paper: {
    name: "Ivory Journal",
    description: "Warm editorial cartography",
    styleUrl: "mapbox://styles/mapbox/light-v11",
    swatches: ["#f1ede4", "#d8d0c0", "#c66c49"],
  },
};

export function getOutputSize(aspectRatio: AspectRatio, quality: QualityTier) {
  if (quality === "4k-cloud") {
    return aspectRatio === "16:9"
      ? { width: 3840, height: 2160 }
      : { width: 2160, height: 3840 };
  }
  return aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

export function getTotalDuration(timings: SceneTimings) {
  return (
    timings.introMs +
    timings.originHoldMs +
    timings.flightMs +
    timings.destinationHoldMs +
    timings.outroMs
  );
}
