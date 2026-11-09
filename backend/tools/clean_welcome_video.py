"""Clean a welcome video before adding it to the library: removes the small AI-generator sparkle mark in the bottom-right corner
and re-encodes the clip so it plays smoothly in the browser.

    python tools/clean_welcome_video.py INPUT.mp4 OUTPUT.mp4 [--ffmpeg path\\to\\ffmpeg.exe] [--mask FILE.png | --box X,Y,W,H | --keep-mark]

What it does (needs ffmpeg with libx264; none of it touches the application code):
  * The mark is removed with ffmpeg's `removelogo` and an exact mask of the sparkle (tools/welcome_wm_mask_1280x720.png, made from
    the mark's constant shape across many frames, grown a few pixels to cover its soft edge). Only the star's own pixels are
    refilled from their surroundings, so almost nothing of the picture is touched. The mask fits 1280x720 clips. For another size
    give --mask with a full-frame black/white PNG, or --box x,y,w,h for a rectangle fill (`delogo`, coarser), or --keep-mark.
  * H.264 High, yuv420p, about 3-4 Mbps (the clips were ~6 Mbps), a keyframe every 2 s, AAC 128 kb/s, and the MP4 index (moov) at
    the front so playback starts without waiting for the whole file.
  * Generator metadata is dropped.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_MASK = Path(__file__).with_name("welcome_wm_mask_1280x720.png")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--mask", help="full-frame PNG, white where the mark is")
    group.add_argument("--box", help="x,y,w,h rectangle to fill instead of a mask")
    group.add_argument("--keep-mark", action="store_true", help="re-encode only")
    args = ap.parse_args()

    src, dst = Path(args.input), Path(args.output)
    if not src.is_file():
        print(f"Input not found: {src}", file=sys.stderr)
        return 1
    if src.resolve() == dst.resolve():
        print("Output must be a different file from the input", file=sys.stderr)
        return 1

    vf = []
    mask_dir = None
    src, dst = src.resolve(), dst.resolve()
    if not args.keep_mark:
        if args.box:
            x, y, w, h = (int(v) for v in args.box.split(","))
            vf.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
        else:
            mask = Path(args.mask) if args.mask else DEFAULT_MASK
            if not mask.is_file():
                print(f"Mask not found: {mask}", file=sys.stderr)
                return 1
            # a drive letter's colon breaks ffmpeg's filter syntax on Windows, so ffmpeg runs in the mask's folder and gets its bare name
            vf.append(f"removelogo=f={mask.name}")
            mask_dir = mask.resolve().parent
    cmd = [
        args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
        *(["-vf", ",".join(vf)] if vf else []),
        "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-maxrate", "4M", "-bufsize", "8M",
        "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p", "-g", "48", "-keyint_min", "24", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-map_metadata", "-1", "-movflags", "+faststart",
        str(dst),
    ]
    dst.parent.mkdir(parents=True, exist_ok=True)
    code = subprocess.call(cmd, cwd=mask_dir)
    if code == 0:
        print(f"{src.name}: {src.stat().st_size / 1e6:.1f} MB -> {dst.stat().st_size / 1e6:.1f} MB ({dst})")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
