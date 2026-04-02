// Pre-computed tracking keyframes for product hotspots on each video.
// Each product has keyframes: [timeSeconds, topPercent, leftPercent]
// The system interpolates between keyframes as the video plays.

export interface TrackingKeyframe {
  t: number;   // time in seconds
  top: number; // % from top
  left: number; // % from left
}

export interface ProductTrack {
  keyframes: TrackingKeyframe[];
}

export interface VideoTrackingData {
  videoDuration: number; // approximate loop duration in seconds
  products: ProductTrack[];
}

// girl2.mp4 — Lily Wittman, white t-shirt, arms crossed, slight movement
// Products: Zara bag (hip/side), Windsor sunglasses (face), Diesel phone case (hand), Pavoi necklace (neck)
const girl2Tracking: VideoTrackingData = {
  videoDuration: 8,
  products: [
    // Product 0: Zara Rock Style Flap Shoulder Bag — tracks near left hip/arm area
    {
      keyframes: [
        { t: 0.0, top: 58, left: 28 },
        { t: 1.0, top: 57, left: 27 },
        { t: 2.0, top: 56, left: 26 },
        { t: 3.0, top: 55, left: 25 },
        { t: 4.0, top: 56, left: 26 },
        { t: 5.0, top: 57, left: 27 },
        { t: 6.0, top: 58, left: 28 },
        { t: 7.0, top: 58, left: 28 },
        { t: 8.0, top: 58, left: 28 },
      ],
    },
    // Product 1: Windsor Major Shade Cat Eye Sunglasses — tracks near face/forehead
    {
      keyframes: [
        { t: 0.0, top: 18, left: 42 },
        { t: 1.0, top: 17, left: 43 },
        { t: 2.0, top: 16, left: 44 },
        { t: 3.0, top: 15, left: 45 },
        { t: 4.0, top: 16, left: 44 },
        { t: 5.0, top: 17, left: 43 },
        { t: 6.0, top: 18, left: 42 },
        { t: 7.0, top: 18, left: 42 },
        { t: 8.0, top: 18, left: 42 },
      ],
    },
    // Product 2: Diesel Oval D Glitter Case — tracks near hand/wrist area
    {
      keyframes: [
        { t: 0.0, top: 65, left: 50 },
        { t: 1.0, top: 64, left: 49 },
        { t: 2.0, top: 63, left: 48 },
        { t: 3.0, top: 62, left: 47 },
        { t: 4.0, top: 63, left: 48 },
        { t: 5.0, top: 64, left: 49 },
        { t: 6.0, top: 65, left: 50 },
        { t: 7.0, top: 65, left: 50 },
        { t: 8.0, top: 65, left: 50 },
      ],
    },
    // Product 3: Pavoi Cross Pendant Necklace — tracks on neck/chest
    {
      keyframes: [
        { t: 0.0, top: 38, left: 40 },
        { t: 1.0, top: 37, left: 41 },
        { t: 2.0, top: 36, left: 42 },
        { t: 3.0, top: 35, left: 43 },
        { t: 4.0, top: 36, left: 42 },
        { t: 5.0, top: 37, left: 41 },
        { t: 6.0, top: 38, left: 40 },
        { t: 7.0, top: 38, left: 40 },
        { t: 8.0, top: 38, left: 40 },
      ],
    },
  ],
};

// guy.mp4 — Garrett, casual outfit
// Products: Vince shirt (torso), Suitsupply jeans (legs), Dior sneakers (feet), Fujifilm camera (hand/chest)
const guyTracking: VideoTrackingData = {
  videoDuration: 8,
  products: [
    // Product 0: Vince Patchwork Shirt — tracks on upper torso
    {
      keyframes: [
        { t: 0.0, top: 32, left: 48 },
        { t: 1.0, top: 31, left: 49 },
        { t: 2.0, top: 30, left: 50 },
        { t: 3.0, top: 31, left: 51 },
        { t: 4.0, top: 32, left: 50 },
        { t: 5.0, top: 33, left: 49 },
        { t: 6.0, top: 32, left: 48 },
        { t: 7.0, top: 32, left: 48 },
        { t: 8.0, top: 32, left: 48 },
      ],
    },
    // Product 1: Suitsupply Jeans — tracks on mid-thigh area
    {
      keyframes: [
        { t: 0.0, top: 62, left: 42 },
        { t: 1.0, top: 61, left: 43 },
        { t: 2.0, top: 60, left: 44 },
        { t: 3.0, top: 61, left: 43 },
        { t: 4.0, top: 62, left: 42 },
        { t: 5.0, top: 63, left: 41 },
        { t: 6.0, top: 62, left: 42 },
        { t: 7.0, top: 62, left: 42 },
        { t: 8.0, top: 62, left: 42 },
      ],
    },
    // Product 2: Dior Sneakers — tracks at foot level
    {
      keyframes: [
        { t: 0.0, top: 85, left: 45 },
        { t: 1.0, top: 84, left: 46 },
        { t: 2.0, top: 84, left: 47 },
        { t: 3.0, top: 85, left: 46 },
        { t: 4.0, top: 85, left: 45 },
        { t: 5.0, top: 86, left: 44 },
        { t: 6.0, top: 85, left: 45 },
        { t: 7.0, top: 85, left: 45 },
        { t: 8.0, top: 85, left: 45 },
      ],
    },
    // Product 3: Fujifilm Camera — tracks in hand/upper body area
    {
      keyframes: [
        { t: 0.0, top: 25, left: 60 },
        { t: 1.0, top: 24, left: 61 },
        { t: 2.0, top: 23, left: 62 },
        { t: 3.0, top: 24, left: 61 },
        { t: 4.0, top: 25, left: 60 },
        { t: 5.0, top: 26, left: 59 },
        { t: 6.0, top: 25, left: 60 },
        { t: 7.0, top: 25, left: 60 },
        { t: 8.0, top: 25, left: 60 },
      ],
    },
  ],
};

// Map video filename to tracking data
const trackingMap: Record<string, VideoTrackingData> = {
  'girl2.mp4': girl2Tracking,
  'guy.mp4': guyTracking,
};

/**
 * Interpolate position at a given time from keyframes.
 * Loops back to start when video loops.
 */
export function getPositionAtTime(
  track: ProductTrack,
  time: number,
  videoDuration: number
): { top: number; left: number } {
  const loopedTime = time % videoDuration;
  const kf = track.keyframes;

  // Find surrounding keyframes
  let i = 0;
  while (i < kf.length - 1 && kf[i + 1].t <= loopedTime) i++;

  if (i >= kf.length - 1) {
    return { top: kf[kf.length - 1].top, left: kf[kf.length - 1].left };
  }

  const a = kf[i];
  const b = kf[i + 1];
  const progress = (loopedTime - a.t) / (b.t - a.t);

  // Smooth interpolation (ease in-out)
  const t = progress * progress * (3 - 2 * progress);

  return {
    top: a.top + (b.top - a.top) * t,
    left: a.left + (b.left - a.left) * t,
  };
}

export function getTrackingData(videoFilename: string): VideoTrackingData | null {
  return trackingMap[videoFilename] || null;
}
