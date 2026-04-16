"""
Post-process video to match target aspect ratio.

Veo only supports 16:9 and 9:16. Feed cards use 3:4.
This module crops generated 9:16 video to 3:4 using ffmpeg.
"""

import subprocess
import tempfile
from pathlib import Path


# Target aspect ratio for feed cards (width:height)
TARGET_ASPECT = (3, 4)


def crop_to_aspect(video_bytes: bytes, target_w: int = 3, target_h: int = 4) -> bytes:
    """Crop video to target aspect ratio, centered.

    Takes a 9:16 (720x1280) video and crops to 3:4 (720x960),
    removing equal amounts from top and bottom.

    Args:
        video_bytes: Raw MP4 bytes from Veo.
        target_w: Target aspect width (default 3).
        target_h: Target aspect height (default 4).

    Returns:
        Cropped MP4 bytes.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = Path(tmpdir) / "input.mp4"
        output_path = Path(tmpdir) / "output.mp4"

        input_path.write_bytes(video_bytes)

        # Probe input dimensions
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                str(input_path),
            ],
            capture_output=True, text=True, check=True,
        )
        width, height = map(int, probe.stdout.strip().split(","))

        # Calculate crop dimensions (keep width, adjust height)
        target_ratio = target_w / target_h
        current_ratio = width / height

        if abs(current_ratio - target_ratio) < 0.01:
            # Already close enough to target
            return video_bytes

        if current_ratio < target_ratio:
            # Video is narrower than target (e.g., 9:16 → 3:4)
            # Keep width, reduce height
            new_height = int(width / target_ratio)
            new_height = new_height - (new_height % 2)  # ensure even
            crop_filter = f"crop={width}:{new_height}"
        else:
            # Video is wider than target (e.g., 16:9 → 3:4)
            # Keep height, reduce width
            new_width = int(height * target_ratio)
            new_width = new_width - (new_width % 2)  # ensure even
            crop_filter = f"crop={new_width}:{height}"

        # Run ffmpeg crop
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(input_path),
                "-vf", crop_filter,
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(output_path),
            ],
            capture_output=True, text=True, check=True,
        )

        return output_path.read_bytes()
