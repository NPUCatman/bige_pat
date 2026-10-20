#!/usr/bin/env python3
"""Build the local beagle skin from ../gif without changing the source GIFs.

Requires Python 3.10+, Pillow, and FFmpeg/ffprobe with libvpx-vp9 support.
Run: python scripts/build_bige_assets.py
Override binary discovery with --ffmpeg PATH and --ffprobe PATH if necessary.
"""

from __future__ import annotations

import argparse
from fractions import Fraction
from functools import reduce
import hashlib
import json
from math import ceil, gcd
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'dsh-pet'
SOURCE = ROOT / 'gif'
ASSETS = APP / 'assets'
CANVAS = (640, 360)
HIT_BOX = (200, 50, 440, 335)
MAX_CONTENT = (232, 260)
FEET_Y = 330
MIN_DURATION_MS = 1000
LABELS = {
    '安静待机': 'Quiet idle',
    '霸气到来': 'Confident arrival',
    '呆滞': 'Blank stare',
    '焦急': 'Anxious',
    '拒绝': 'Refuse',
    '你真棒': 'Thumbs up',
    '需要token': 'Needs token',
    '正常挂机中': 'Resting',
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, **kwargs)
    except subprocess.CalledProcessError as error:
        message = error.stderr.decode('utf-8', errors='replace')
        raise RuntimeError(f'{Path(command[0]).name} failed: {message}') from error


def binary(value: str, name: str) -> str:
    found = shutil.which(value)
    if found:
        return found
    path = Path(value)
    if path.is_file():
        return str(path.resolve())
    raise SystemExit(f'{name} not found: {value}; install FFmpeg or pass --{name}.')


def union_box(boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def load_gif(path: Path) -> tuple[list[Image.Image], list[int], tuple[int, int]]:
    frames, durations = [], []
    with Image.open(path) as gif:
        size = gif.size
        for i in range(gif.n_frames):
            gif.seek(i)
            # Pillow applies the GIF's disposal/compositing rules before conversion.
            frames.append(gif.convert('RGBA').copy())
            durations.append(int(gif.info.get('duration', 100)) or 100)
    if not frames or any(frame.getchannel('A').getbbox() is None for frame in frames):
        raise ValueError(f'GIF has an empty frame: {path.name}')
    return frames, durations, size


def fit_frame(frame: Image.Image, box: tuple[int, int, int, int],
              output_size: tuple[int, int], max_size: tuple[int, int],
              feet: int) -> tuple[Image.Image, dict]:
    width, height = box[2] - box[0], box[3] - box[1]
    scale = min(max_size[0] / width, max_size[1] / height)
    resized_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    cropped = frame.crop(box).resize(resized_size, Image.Resampling.LANCZOS)
    offset = ((output_size[0] - resized_size[0]) // 2, feet - resized_size[1])
    result = Image.new('RGBA', output_size, (0, 0, 0, 0))
    result.alpha_composite(cropped, offset)
    return result, {'scale': scale, 'resized_size': resized_size, 'offset': offset}


def normalize(frames: list[Image.Image]) -> tuple[list[Image.Image], tuple, dict]:
    box = union_box([frame.getchannel('A').getbbox() for frame in frames])
    normalized = [fit_frame(frame, box, CANVAS, MAX_CONTENT, FEET_Y)[0]
                  for frame in frames]
    parameters = fit_frame(frames[0], box, CANVAS, MAX_CONTENT, FEET_Y)[1]
    normalized_box = union_box([frame.getchannel('A').getbbox() for frame in normalized])
    if not (HIT_BOX[0] <= normalized_box[0] < normalized_box[2] <= HIT_BOX[2]
            and HIT_BOX[1] <= normalized_box[1] < normalized_box[3] <= HIT_BOX[3]):
        raise ValueError(f'Content outside hit box: {normalized_box}')
    parameters['normalized_alpha_bbox'] = normalized_box
    return normalized, box, parameters


def encode(ffmpeg: str, ffprobe: str, name: str, frames: list[Image.Image],
           durations: list[int], output: Path) -> dict:
    tick_ms = reduce(gcd, durations)
    cycle_ms = sum(durations)
    loops = max(1, ceil(MIN_DURATION_MS / cycle_ms))
    ticks = [index for index, duration in enumerate(durations)
             for _ in range(duration // tick_ms)] * loops
    frame_rate = Fraction(1000, tick_ms)
    with tempfile.TemporaryDirectory(prefix='bige-assets-') as temporary:
        temp = Path(temporary)
        for index, frame in enumerate(frames):
            frame.save(temp / f'source-{index:04d}.png')
        for index, source_index in enumerate(ticks):
            source = temp / f'source-{source_index:04d}.png'
            target = temp / f'frame-{index:05d}.png'
            try:
                os.link(source, target)
            except OSError:
                shutil.copyfile(source, target)
        command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                   '-fflags', '+bitexact', '-framerate', str(frame_rate),
                   '-i', str(temp / 'frame-%05d.png'), '-an',
                   '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                   '-lossless', '1', '-b:v', '0', '-auto-alt-ref', '0',
                   '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1',
                   '-threads', '2', '-flags:v', '+bitexact',
                   '-map_metadata', '-1', '-metadata:s:v:0', 'alpha_mode=1',
                   str(output)]
        run(command)
    probe = json.loads(run([ffprobe, '-v', 'error', '-count_frames',
                           '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate:stream_tags=alpha_mode:format=duration',
                           '-of', 'json', str(output)]).stdout)
    stream = probe['streams'][0]
    expected_ms = cycle_ms * loops
    actual_ms = round(float(probe['format']['duration']) * 1000)
    if (stream.get('codec_name') != 'vp9' or stream.get('width') != CANVAS[0]
            or stream.get('height') != CANVAS[1]
            or {key.lower(): value for key, value in stream.get('tags', {}).items()}.get('alpha_mode') != '1'
            or int(stream.get('nb_read_frames', -1)) != len(ticks)
            or abs(actual_ms - expected_ms) > 1):
        raise ValueError(f'Invalid encoded video {name}: {probe}')
    # FFmpeg's native VP9 decoder can ignore alpha. Force libvpx-vp9 to validate
    # the actual decoded alpha plane, in addition to checking the container tag.
    raw = run([ffmpeg, '-hide_banner', '-loglevel', 'error',
               '-c:v', 'libvpx-vp9', '-i', str(output),
               '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']).stdout
    frame_bytes = CANVAS[0] * CANVAS[1] * 4
    if len(raw) != len(ticks) * frame_bytes:
        raise ValueError(f'Decode frame count differs for {name}')
    decoded_boxes, max_alpha_error = [], 0
    for index, source_index in enumerate(ticks):
        decoded = Image.frombytes('RGBA', CANVAS,
                                  raw[index * frame_bytes:(index + 1) * frame_bytes])
        alpha = decoded.getchannel('A')
        if alpha.getextrema() != (0, 255):
            raise ValueError(f'Decoded transparency is missing for {name}')
        source_alpha = frames[source_index].getchannel('A')
        alpha_error = ImageChops.difference(alpha, source_alpha).getextrema()[1]
        max_alpha_error = max(max_alpha_error, alpha_error)
        # FFmpeg's RGBA -> yuva420p conversion can round fractional alpha by 1.
        # Reject any shape/bounds change or a larger alpha change.
        if alpha_error > 1 or alpha.getbbox() != source_alpha.getbbox():
            raise ValueError(f'Alpha shape changed while encoding {name}, frame {index}')
        decoded_boxes.append(alpha.getbbox())
    return {'source_cycle_ms': cycle_ms, 'repeat_cycles': loops,
            'output_duration_ms': expected_ms, 'tick_ms': tick_ms,
            'output_fps': str(frame_rate), 'output_frames': len(ticks),
            'probe': probe, 'decoded_alpha_verified': True,
            'max_decoded_alpha_error_255': max_alpha_error,
            'decoded_alpha_bbox': union_box(decoded_boxes),
            'sha256': sha256(output), 'path': output.relative_to(ROOT).as_posix()}


def font(size: int) -> tuple[ImageFont.ImageFont, bool]:
    choices = [Path('C:/Windows/Fonts/msyh.ttc'),
               Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
               Path('/System/Library/Fonts/PingFang.ttc')]
    for choice in choices:
        if choice.is_file():
            return ImageFont.truetype(str(choice), size), True
    return ImageFont.load_default(), False


def make_paw(closed: bool) -> Image.Image:
    # Original vector-drawn beagle paw; 16,16 remains the application's hotspot.
    result = Image.new('RGBA', (128, 128))
    draw = ImageDraw.Draw(result)
    dark, fill = '#3a251c', '#d5a66c'
    toes = [(21, 22, 47, 60), (51, 13, 77, 52), (81, 22, 107, 60)]
    if closed:
        toes = [(25, 35, 51, 64), (51, 28, 77, 60), (77, 35, 103, 64)]
    for toe in toes:
        draw.ellipse(toe, fill=fill, outline=dark, width=5)
    draw.ellipse((29, 54, 99, 110), fill=fill, outline=dark, width=5)
    draw.ellipse((45, 68, 83, 96), fill='#f4d0b7')
    return result.resize((32, 32), Image.Resampling.LANCZOS)


def make_graphics(records: list[dict], representatives: dict[str, Image.Image],
                  boxes: dict[str, tuple]) -> list[dict]:
    outputs = []
    memes, pics = ASSETS / 'memes', ASSETS / 'pic'
    memes.mkdir(parents=True, exist_ok=True)
    pics.mkdir(parents=True, exist_ok=True)

    def save(image: Image.Image, destination: Path, source: str | None, kind: str) -> None:
        image.save(destination)
        outputs.append({'path': destination.relative_to(ROOT).as_posix(),
                        'sha256': sha256(destination), 'size': image.size,
                        'source': source, 'kind': kind})

    for name, frame in representatives.items():
        meme, _ = fit_frame(frame, boxes[name], (320, 320), (288, 280), 300)
        save(meme, memes / f'{name}.png', f'gif/{name}.gif', 'static-meme')

    logo = Image.new('RGBA', (256, 256))
    draw = ImageDraw.Draw(logo)
    draw.rounded_rectangle((3, 3, 253, 253), radius=56, fill='#fff0d4',
                           outline='#b7773f', width=6)
    mascot, _ = fit_frame(representatives['你真棒'], boxes['你真棒'],
                          (256, 256), (224, 208), 231)
    logo.alpha_composite(mascot)
    save(logo, ASSETS / 'logo.png', 'gif/你真棒.gif', 'application-logo')

    icons = {'done': ('你真棒', '#4a9a72', '+'),
             'error': ('焦急', '#c95b50', '!'),
             'truncated': ('呆滞', '#b98333', '...'),
             'approval': ('拒绝', '#b98333', '!'),
             'question': ('需要token', '#5d83b2', '?'),
             'test': ('霸气到来', '#8a6cac', '*')}
    marker_font, _ = font(35)
    for name, (source, color, marker) in icons.items():
        icon = Image.new('RGBA', (192, 192))
        draw = ImageDraw.Draw(icon)
        draw.ellipse((4, 4, 188, 188), fill='#fff5e5', outline=color, width=6)
        character, _ = fit_frame(representatives[source], boxes[source],
                                 (192, 192), (153, 145), 170)
        icon.alpha_composite(character)
        draw = ImageDraw.Draw(icon)
        draw.ellipse((135, 130, 190, 185), fill=color, outline='white', width=3)
        box = draw.textbbox((0, 0), marker, font=marker_font)
        draw.text((162 - (box[2] - box[0]) / 2, 156 - (box[3] - box[1]) / 2 - box[1]),
                  marker, font=marker_font, fill='white')
        save(icon, pics / f'notify-{name}.png', f'gif/{source}.gif', 'notification')
    save(make_paw(False), pics / 'cursor-grab.png', None, 'beagle-paw-cursor')
    save(make_paw(True), pics / 'cursor-grabbing.png', None, 'beagle-paw-cursor')

    # A complete skin preview uses the same baseline and hit box as the app.
    preview = Image.new('RGB', (1280, 1680), '#f5f0e8')
    preview_draw = ImageDraw.Draw(preview)
    heading_font, cjk = font(25)
    note_font, _ = font(18)
    for index, record in enumerate(records):
        x, y = (index % 2) * 640, (index // 2) * 420
        card = Image.new('RGBA', CANVAS, '#f5f0e8')
        cd = ImageDraw.Draw(card)
        cd.rectangle(HIT_BOX, outline='#ddd4c6', width=1)
        cd.line((180, FEET_Y, 460, FEET_Y), fill='#b9a78c', width=1)
        name = record['name']
        normalized, _ = fit_frame(representatives[name], boxes[name],
                                   CANVAS, MAX_CONTENT, FEET_Y)
        card.alpha_composite(normalized)
        preview.paste(card.convert('RGB'), (x, y))
        label = name if cjk else LABELS[name]
        preview_draw.text((x + 22, y + 362), label, font=heading_font, fill='#4c3629')
        video = record['video']
        preview_draw.text((x + 22, y + 394),
                          f"{record['source_frames']} frames / {video['source_cycle_ms']} ms"
                          f"  ->  {video['output_duration_ms']} ms", font=note_font, fill='#725d4e')
    (ROOT / 'docs').mkdir(parents=True, exist_ok=True)
    save(preview, ROOT / 'docs' / 'bige-preview.png', None, 'skin-preview')
    return outputs


def make_aliases() -> tuple[list[dict], dict]:
    # The engine classifies completion behavior by animation name. Independent
    # names retain that behavior while reusing the eight supplied animations.
    mapping_path = ROOT / 'scripts' / 'bige-animation-map.json'
    mapping = json.loads(mapping_path.read_text(encoding='utf-8'))
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError('Animation map must be a nonempty object.')
    aliases = []
    for name, source in mapping.items():
        if (not isinstance(name, str) or not name or name in ('.', '..')
                or any(character in name for character in '/\\:')
                or source not in LABELS):
            raise ValueError(f'Invalid animation alias: {name!r} -> {source!r}')
        original = ASSETS / 'webm' / f'{source}.webm'
        destination = ASSETS / 'webm' / f'{name}.webm'
        if destination != original:
            shutil.copyfile(original, destination)
        aliases.append({'name': name, 'source_animation': source,
                        'source_gif': f'gif/{source}.gif',
                        'path': destination.relative_to(ROOT).as_posix(),
                        'sha256': sha256(destination)})
    return aliases, {'path': mapping_path.relative_to(ROOT).as_posix(),
                     'sha256': sha256(mapping_path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    ffmpeg, ffprobe = binary(args.ffmpeg, 'ffmpeg'), binary(args.ffprobe, 'ffprobe')
    paths = sorted(SOURCE.glob('*.gif'))
    if {path.stem for path in paths} != set(LABELS):
        raise SystemExit('Expected the eight named beagle GIFs; update LABELS deliberately for new sources.')
    webm = ASSETS / 'webm'
    webm.mkdir(parents=True, exist_ok=True)
    records, representatives, boxes = [], {}, {}
    for path in paths:
        frames, durations, size = load_gif(path)
        normalized, box, parameters = normalize(frames)
        video = encode(ffmpeg, ffprobe, path.stem, normalized, durations,
                       webm / f'{path.stem}.webm')
        records.append({'name': path.stem, 'source': path.relative_to(ROOT).as_posix(),
                        'source_sha256': sha256(path), 'source_size': size,
                        'source_frames': len(frames), 'source_durations_ms': durations,
                        'source_alpha_union_bbox': box, 'transform': parameters,
                        'video': video})
        representatives[path.stem], boxes[path.stem] = frames[0], box
        print(f'{path.name}: {len(frames)} source frames / {sum(durations)} ms -> '
              f'{video["output_frames"]} video frames / {video["output_duration_ms"]} ms; alpha verified')
    aliases, mapping = make_aliases()
    graphics = make_graphics(records, representatives, boxes)
    manifest = {'schema_version': 1,
                'generator': 'scripts/build_bige_assets.py',
                'dependencies': {'Pillow': __import__('PIL').__version__,
                                 'ffmpeg': run([ffmpeg, '-version']).stdout.decode().splitlines()[0],
                                 'ffprobe': run([ffprobe, '-version']).stdout.decode().splitlines()[0]},
                'parameters': {'canvas': CANVAS, 'hit_box': HIT_BOX,
                               'max_content': MAX_CONTENT, 'feet_y': FEET_Y,
                               'minimum_duration_ms': MIN_DURATION_MS,
                               'background': 'transparent; source alpha preserved; no white removal',
                               'placement': 'One union crop, scale and offset per entire animation',
                               'timing': 'CFR at the GCD of source frame durations; repeat whole cycles only',
                               'codec': 'VP9 lossless mode; RGBA converted to yuva420p',
                               'alpha_validation': 'same bounds; transparency 0..255; max rounding error 1/255'},
                'animation_map': mapping, 'animations': records,
                'animation_files': aliases, 'graphics': graphics}
    (ASSETS / 'bige-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Built {len(records)} transparent videos / {len(aliases)} animation names '
          f'and {len(graphics)} graphics; source GIFs unchanged.')


if __name__ == '__main__':
    main()
