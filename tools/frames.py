#!/usr/bin/env python3
"""
Pull frames out of a video so they can be reviewed as images.

Video cannot be watched directly here -- only images can. But a video is
frames, and a full ffmpeg (h264/hevc/vp9/av1) is available through
imageio-ffmpeg, so a screen recording can be reviewed by sampling it.

    python3 tools/frames.py clip.mov                 12 frames, evenly spread
    python3 tools/frames.py clip.mov --n 24          more frames
    python3 tools/frames.py clip.mov --from 3 --to 6 just that window
    python3 tools/frames.py clip.mov --fps 10        every 0.1s in the window
    python3 tools/frames.py clip.mov --sheet         also write a contact sheet

Frames land in shots/video/<clipname>/ and are cropped to the game viewport
when the recording is a phone capture with browser chrome around it (pass
--nocrop to keep the whole frame).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

import imageio_ffmpeg
from PIL import Image

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def probe(path):
    """Duration and dimensions, read from ffmpeg's own stderr banner."""
    out = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True).stderr
    dur = None
    size = None
    for line in out.splitlines():
        if 'Duration:' in line and dur is None:
            t = line.split('Duration:')[1].split(',')[0].strip()
            h, m, s = t.split(':')
            dur = int(h) * 3600 + int(m) * 60 + float(s)
        if ' Video: ' in line and size is None:
            for tok in line.split(','):
                tok = tok.strip().split(' ')[0]
                if 'x' in tok:
                    a, _, b = tok.partition('x')
                    if a.isdigit() and b.isdigit():
                        size = (int(a), int(b))
                        break
    return dur, size


def extract(path, outdir, times):
    """One ffmpeg seek per frame: accurate, and cheap at these counts."""
    os.makedirs(outdir, exist_ok=True)
    files = []
    for i, t in enumerate(times):
        dst = os.path.join(outdir, f'f{i:03d}_{t:07.3f}s.png')
        subprocess.run(
            [FFMPEG, '-y', '-ss', f'{t:.3f}', '-i', path,
             '-frames:v', '1', '-q:v', '2', dst],
            capture_output=True)
        if os.path.exists(dst):
            files.append(dst)
    return files


def autocrop_bounds(img):
    """
    Find the game viewport inside a phone screen recording.

    A capture from a browser has white/grey chrome above and below the page.
    The game itself is a dense colourful block, so the content rows are the
    ones that are neither near-white nor near-uniform. Conservative: if it
    cannot find a convincing band it returns None and the frame is left alone.
    """
    g = img.convert('RGB')
    w, h = g.size
    small = g.resize((min(w, 160), min(h, 320)))
    sw, sh = small.size
    px = small.load()

    def rowish(y):
        vals = [px[x, y] for x in range(0, sw, 4)]
        mean = sum(sum(v) for v in vals) / (3 * len(vals))
        spread = max(max(v) - min(v) for v in vals)
        return mean, spread

    rows = [rowish(y) for y in range(sh)]
    content = [y for y, (m, s) in enumerate(rows) if not (m > 235 and s < 40)]
    if len(content) < sh * 0.25:
        return None
    top, bot = min(content), max(content)
    if bot - top < sh * 0.3:
        return None
    return (0, int(top * h / sh), w, int((bot + 1) * h / sh))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--n', type=int, default=12)
    ap.add_argument('--from', dest='t0', type=float, default=None)
    ap.add_argument('--to', dest='t1', type=float, default=None)
    ap.add_argument('--fps', type=float, default=None)
    ap.add_argument('--sheet', action='store_true')
    ap.add_argument('--nocrop', action='store_true')
    ap.add_argument('--max-width', type=int, default=560)
    a = ap.parse_args()

    if not os.path.exists(a.video):
        sys.exit(f'no such file: {a.video}')

    dur, size = probe(a.video)
    if dur is None:
        sys.exit('could not read the video -- unsupported container or codec?')

    t0 = 0.0 if a.t0 is None else max(0.0, a.t0)
    t1 = dur if a.t1 is None else min(dur, a.t1)
    if t1 <= t0:
        sys.exit(f'empty window: {t0} .. {t1} (duration {dur:.2f}s)')

    if a.fps:
        step = 1.0 / a.fps
        times = []
        t = t0
        while t < t1 and len(times) < 400:
            times.append(t)
            t += step
    else:
        n = max(1, a.n)
        times = [t0 + (t1 - t0) * (i + 0.5) / n for i in range(n)]

    name = os.path.splitext(os.path.basename(a.video))[0]
    outdir = os.path.join('shots', 'video', name)
    if os.path.isdir(outdir):
        shutil.rmtree(outdir)

    files = extract(a.video, outdir, times)
    if not files:
        sys.exit('ffmpeg produced no frames')

    # Crop + downscale in place, so every frame is cheap to read.
    box = None
    for i, f in enumerate(files):
        im = Image.open(f)
        if not a.nocrop:
            if box is None:
                box = autocrop_bounds(im)
            if box:
                im = im.crop(box)
        if im.width > a.max_width:
            im = im.resize((a.max_width, round(im.height * a.max_width / im.width)),
                           Image.LANCZOS)
        im.save(f, optimize=True)

    print(json.dumps({
        'video': a.video,
        'duration_s': round(dur, 2),
        'source_size': size,
        'window': [round(t0, 2), round(t1, 2)],
        'frames': len(files),
        'cropped_to': box,
        'dir': outdir,
    }, indent=1))

    if a.sheet:
        ims = [Image.open(f) for f in files]
        cols = min(4, len(ims))
        rows = (len(ims) + cols - 1) // cols
        cw, ch = ims[0].size
        sheet = Image.new('RGB', (cols * cw, rows * ch), (12, 14, 34))
        for i, im in enumerate(ims):
            sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
        if sheet.width > 1400:
            sheet = sheet.resize((1400, round(sheet.height * 1400 / sheet.width)),
                                 Image.LANCZOS)
        sp = os.path.join(outdir, '_sheet.png')
        sheet.save(sp, optimize=True)
        print('sheet:', sp)

    for f in files:
        print(f)


if __name__ == '__main__':
    main()
