"""Build the compact occultation animations used on the group website.

The renderer keeps the observational content literal: each displayed image is
an input video/FITS frame, and each light-curve point is read from the supplied
aperture-photometry table.  The script only performs display stretching,
baseline normalisation, annotation and layout.

Three 16:9 assets are produced:

``pizarro-star-disappearance.gif``
    A deliberately minimal hero animation that concentrates on the marked star.
``pizarro-event-site.gif``
    Pizarro star frames and its normalised aperture-photometry series.
``fy22-event-site.gif``
    1993 FY22 FITS frames and its normalised aperture-photometry series.

Flux is dimensionless.  For each event, ``F_norm = F / median(F_baseline)``.
The baseline and occultation bounds are display parameters inherited from the
event reductions; this script does not estimate disappearance or reappearance
times.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import median

import numpy as np
from astropy.io import fits
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageSequence
from scipy.ndimage import gaussian_filter


WIDTH = 960
HEIGHT = 540

NAVY = (11, 43, 80)
INK = (21, 34, 56)
BLUE = (21, 91, 157)
PALE_BLUE = (157, 201, 238)
SOFT = (242, 245, 248)
WHITE = (255, 255, 255)
MUTED = (82, 97, 114)
RULE = (204, 213, 223)
GRID = (222, 228, 234)

PIZARRO_D_S = 2.530
PIZARRO_R_S = 4.313
PIZARRO_BASELINE_MARGIN_S = 0.35

FY22_SER_FIRST_CSV_FRAME = 1500
FY22_WINDOW_START = 1765
FY22_WINDOW_END = 1840
FY22_BASELINE_BEFORE = 1785
FY22_BASELINE_AFTER = 1830
FY22_EVENT_START = 1790
FY22_EVENT_END = 1825
# The PyMovie centroid is measured in the vertically flipped display frame.
# The supplied FITS display therefore places the same source at y = 253 px.
FY22_TARGET = (732, 253)


@dataclass(frozen=True)
class Sample:
    """One time-ordered display sample.

    Parameters
    ----------
    key
        Source frame number.  Pizarro uses video-frame numbering; FY22 uses
        the frame number in the PyMovie light-curve table.
    flux
        Dimensionless flux normalised by the out-of-event median.
    occulted
        ``True`` when the sample lies inside the adopted occultation interval.
    """

    key: int
    flux: float
    occulted: bool


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load the page's plain sans-serif visual equivalent."""

    filename = "Arial Bold.ttf" if bold else "Arial.ttf"
    path = Path("/System/Library/Fonts/Supplemental") / filename
    return ImageFont.truetype(path, size) if path.exists() else ImageFont.load_default()


FONT_SMALL = load_font(14, True)
FONT_META = load_font(16)
FONT_STATUS = load_font(27, True)
FONT_HERO = load_font(48, True)


def load_pizarro(csv_path: Path, gif_path: Path) -> tuple[list[Sample], list[Image.Image]]:
    """Load Pizarro flux samples and the synchronized marked GIF frames."""

    rows: list[tuple[int, float, float]] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            rows.append((int(row["frame"]), float(row["seconds_from_first"]), float(row["target_aperture_flux"])))

    baseline_values = [
        flux
        for _, elapsed_s, flux in rows
        if elapsed_s < PIZARRO_D_S - PIZARRO_BASELINE_MARGIN_S
        or elapsed_s > PIZARRO_R_S + PIZARRO_BASELINE_MARGIN_S
    ]
    baseline = median(baseline_values)
    samples = [
        Sample(key, flux / baseline, PIZARRO_D_S <= elapsed_s <= PIZARRO_R_S)
        for key, elapsed_s, flux in rows
    ]
    with Image.open(gif_path) as source:
        frames = [recolour_pizarro_marker(frame.convert("RGB")) for frame in ImageSequence.Iterator(source)]
    return samples, synchronize_frames(frames, len(samples))


def recolour_pizarro_marker(frame: Image.Image) -> Image.Image:
    """Replace the existing yellow target marker with the site's pale blue."""

    array = np.asarray(frame).copy()
    yellow = (array[:, :, 0] > 180) & (array[:, :, 1] > 150) & (array[:, :, 2] < 110)
    array[yellow] = PALE_BLUE
    return Image.fromarray(array)


def parse_time_seconds(value: str) -> float:
    """Convert a bracketed PyMovie UTC time to seconds after midnight."""

    clean = value.strip().strip("[]")
    hms, fraction = clean.split(".")
    hour, minute, second = (int(part) for part in hms.split(":"))
    return hour * 3600 + minute * 60 + second + float(f"0.{fraction}")


def load_fy22(csv_path: Path, fits_dir: Path) -> tuple[list[Sample], list[Image.Image]]:
    """Load the reduced FY22 window and matching raw FITS frames.

    FITS frame number ``n`` corresponds to PyMovie CSV frame
    ``n + FY22_SER_FIRST_CSV_FRAME - 1`` in the supplied extraction.
    """

    header: list[str] | None = None
    rows: list[tuple[int, float, float]] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.reader(handle):
            if not row or row[0].startswith("#"):
                continue
            if row[0] == "FrameNum":
                header = row
                continue
            if header is None:
                raise ValueError("FY22 light-curve header was not found.")
            frame_i = header.index("FrameNum")
            time_i = header.index("timeInfo")
            signal_i = header.index("signal-star")
            frame_number = int(float(row[frame_i]))
            if FY22_WINDOW_START <= frame_number <= FY22_WINDOW_END:
                rows.append((frame_number, parse_time_seconds(row[time_i]), float(row[signal_i])))

    baseline_values = [flux for key, _, flux in rows if key < FY22_BASELINE_BEFORE or key > FY22_BASELINE_AFTER]
    baseline = median(baseline_values)
    samples = [
        Sample(key, flux / baseline, FY22_EVENT_START <= key <= FY22_EVENT_END)
        for key, _, flux in rows
    ]

    frames: list[Image.Image] = []
    for key, _, _ in rows:
        fits_number = key - FY22_SER_FIRST_CSV_FRAME + 1
        data = fits.getdata(fits_dir / f"lights_{fits_number:05d}.fit").astype(np.float32)
        frames.append(mark_fy22_target(stretch_fits(data)))
    return samples, frames


def stretch_fits(frame: np.ndarray) -> Image.Image:
    """Map a 16-bit FITS frame to an 8-bit grayscale display image.

    A robust median/MAD stretch prevents a few saturated pixels from setting
    the display range.  The high-frequency enhancement only aids visibility;
    aperture photometry is never recomputed from the stretched image.
    """

    centre = float(np.median(frame))
    sigma = float(1.4826 * np.median(np.abs(frame - centre)))
    lo = centre - 0.9 * sigma
    hi = centre + 5.8 * sigma
    scaled = np.clip((frame - lo) / max(hi - lo, 1.0), 0.0, 1.0)
    mapped = np.arcsinh(5.5 * scaled) / np.arcsinh(5.5)
    base = (42 + 172 * mapped).astype(np.uint8)
    softened = np.asarray(Image.fromarray(base).filter(ImageFilter.GaussianBlur(0.75))).astype(np.float32)
    wide = gaussian_filter(softened, sigma=2.2)
    high_frequency = np.clip(softened - wide, 0.0, None)
    threshold = np.percentile(high_frequency, 99.75)
    white = np.percentile(high_frequency, 99.985)
    stars = np.clip((high_frequency - threshold) / max(white - threshold, 1e-6), 0.0, 1.0)
    stars = np.arcsinh(10.0 * stars) / np.arcsinh(10.0)
    final = np.clip(softened + 70.0 * stars, 0.0, 255.0).astype(np.uint8)
    image = Image.fromarray(final).filter(ImageFilter.GaussianBlur(0.35))
    return Image.merge("RGB", (image, image, image))


def mark_fy22_target(frame: Image.Image) -> Image.Image:
    """Draw the same ring-and-four-ticks marker used by the Pizarro frames."""

    marked = frame.copy()
    draw = ImageDraw.Draw(marked)
    x, y = FY22_TARGET
    radius = 32
    gap = 8
    tick = 15
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=PALE_BLUE, width=3)
    draw.line((x - radius - gap - tick, y, x - radius - gap, y), fill=PALE_BLUE, width=3)
    draw.line((x + radius + gap, y, x + radius + gap + tick, y), fill=PALE_BLUE, width=3)
    draw.line((x, y - radius - gap - tick, x, y - radius - gap), fill=PALE_BLUE, width=3)
    draw.line((x, y + radius + gap, x, y + radius + gap + tick), fill=PALE_BLUE, width=3)
    return marked


def synchronize_frames(frames: list[Image.Image], sample_count: int) -> list[Image.Image]:
    """Map a frame sequence onto a sample sequence by relative position."""

    if not frames:
        raise ValueError("The input animation contains no image frames.")
    if sample_count == 1:
        return [frames[0]]
    return [frames[round(index * (len(frames) - 1) / (sample_count - 1))] for index in range(sample_count)]


def contain_on(image: Image.Image, size: tuple[int, int], background: tuple[int, int, int] = NAVY) -> Image.Image:
    """Letterbox an image without changing its aspect ratio."""

    panel = Image.new("RGB", size, background)
    fitted = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    panel.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return panel


def fill_on(image: Image.Image, size: tuple[int, int], centering: tuple[float, float]) -> Image.Image:
    """Crop a star field to a fixed panel without geometrically stretching it."""

    return ImageOps.fit(image, size, Image.Resampling.LANCZOS, centering=centering)


def render_hero_frame(star_frame: Image.Image, occulted: bool) -> Image.Image:
    """Render the minimal star-disappearance hero frame."""

    canvas = Image.new("RGB", (WIDTH, HEIGHT), SOFT)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH - 1, HEIGHT - 1), outline=RULE)

    # The full Pizarro crop preserves the observational context and target ring.
    star_panel = contain_on(star_frame, (560, 466), NAVY)
    canvas.paste(star_panel, (36, 37))

    draw.text((638, 94), "WATCH THE", font=FONT_SMALL, fill=BLUE)
    draw.text((638, 132), "MARKED STAR", font=FONT_SMALL, fill=BLUE)
    draw.line((638, 180, 890, 180), fill=RULE, width=1)
    draw.text((638, 226), "A STAR", font=FONT_HERO, fill=NAVY)
    draw.text((638, 280), "DISAPPEARS", font=FONT_HERO, fill=NAVY)
    state = "DISAPPEARED" if occulted else "VISIBLE"
    state_colour = BLUE if occulted else MUTED
    draw.text((638, 388), state, font=FONT_STATUS, fill=state_colour)
    draw.ellipse((638, 436, 648, 446), fill=state_colour)
    draw.text((664, 430), "LIVE FRAME", font=FONT_SMALL, fill=MUTED)
    return canvas


def plot_flux(draw: ImageDraw.ImageDraw, samples: list[Sample], current_index: int, box: tuple[int, int, int, int]) -> None:
    """Draw a common light-curve panel for both event animations."""

    x0, y0, x1, y1 = box
    draw.rectangle(box, fill=WHITE, outline=RULE)
    plot = (x0 + 42, y0 + 48, x1 - 22, y1 - 42)
    px0, py0, px1, py1 = plot
    for fraction in (0.0, 0.5, 1.0):
        y = py1 - fraction * (py1 - py0)
        draw.line((px0, y, px1, y), fill=GRID)
    event_indices = [index for index, sample in enumerate(samples) if sample.occulted]
    if event_indices:
        left = px0 + event_indices[0] / max(len(samples) - 1, 1) * (px1 - px0)
        right = px0 + event_indices[-1] / max(len(samples) - 1, 1) * (px1 - px0)
        draw.rectangle((left, py0, right, py1), fill=(230, 238, 246))

    flux_min, flux_max = -0.12, 1.20

    def point(index: int, flux: float) -> tuple[float, float]:
        x = px0 + index / max(len(samples) - 1, 1) * (px1 - px0)
        clipped = max(flux_min, min(flux_max, flux))
        y = py1 - (clipped - flux_min) / (flux_max - flux_min) * (py1 - py0)
        return x, y

    full = [point(index, sample.flux) for index, sample in enumerate(samples)]
    draw.line(full, fill=(150, 164, 179), width=2, joint="curve")
    visible = full[: current_index + 1]
    if len(visible) > 1:
        draw.line(visible, fill=BLUE, width=3, joint="curve")
    cx, cy = full[current_index]
    draw.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=BLUE, outline=WHITE, width=2)
    draw.text((x0 + 20, y0 + 17), "NORMALISED FLUX", font=FONT_SMALL, fill=MUTED)
    draw.text((px0 - 10, py0), "1.0", font=FONT_META, fill=MUTED, anchor="ra")
    draw.text((px0 - 10, py1), "0.0", font=FONT_META, fill=MUTED, anchor="ra")


def render_event_frame(
    samples: list[Sample],
    star_frame: Image.Image,
    current_index: int,
    star_centering: tuple[float, float],
) -> Image.Image:
    """Render one consistent 16:9 event-card frame.

    The star panel is cropped, never stretched.  ``star_centering`` keeps an
    off-axis marked target inside the FY22 crop while Pizarro remains centred.
    """

    canvas = Image.new("RGB", (WIDTH, HEIGHT), SOFT)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH - 1, HEIGHT - 1), outline=RULE)
    draw.text((32, 24), "TARGET STAR", font=FONT_SMALL, fill=BLUE)
    draw.text((582, 24), "APERTURE PHOTOMETRY", font=FONT_SMALL, fill=BLUE)

    star_panel = fill_on(star_frame, (518, 424), star_centering)
    canvas.paste(star_panel, (32, 62))
    plot_flux(draw, samples, current_index, (582, 62, 928, 360))

    state = "STAR DISAPPEARED" if samples[current_index].occulted else "STAR VISIBLE"
    draw.text((582, 405), state, font=FONT_STATUS, fill=NAVY if samples[current_index].occulted else MUTED)
    draw.text((582, 451), "OBSERVED FRAME", font=FONT_SMALL, fill=MUTED)
    draw.line((582, 486, 928, 486), fill=RULE)
    return canvas


def save_gif(frames: list[Image.Image], output: Path, duration_ms: int, end_pause_ms: int = 550) -> None:
    """Save a looping GIF with a deterministic shared palette."""

    output.parent.mkdir(parents=True, exist_ok=True)
    palette = frames[0].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    converted = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    durations = [max(300, duration_ms)] + [duration_ms] * max(len(converted) - 2, 0) + ([end_pause_ms] if len(converted) > 1 else [])
    converted[0].save(
        output,
        save_all=True,
        append_images=converted[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )


def build_assets(pizarro_csv: Path, pizarro_gif: Path, fy22_csv: Path, fy22_fits: Path, output_dir: Path) -> None:
    """Build the hero and the two consistent primary-page event GIFs."""

    pizarro_samples, pizarro_frames = load_pizarro(pizarro_csv, pizarro_gif)
    fy22_samples, fy22_frames = load_fy22(fy22_csv, fy22_fits)

    hero = [render_hero_frame(frame, sample.occulted) for sample, frame in zip(pizarro_samples, pizarro_frames)]
    pizarro_event = [
        render_event_frame(pizarro_samples, frame, index, (0.5, 0.5))
        for index, frame in enumerate(pizarro_frames)
    ]

    # FY22 was recorded at a much higher cadence; every second frame is enough
    # for a web preview while preserving the full curve in every rendered plot.
    fy22_indices = list(range(0, len(fy22_samples), 2))
    if fy22_indices[-1] != len(fy22_samples) - 1:
        fy22_indices.append(len(fy22_samples) - 1)
    fy22_event = [
        render_event_frame(fy22_samples, fy22_frames[index], index, (1.0, 0.5))
        for index in fy22_indices
    ]

    save_gif(hero, output_dir / "pizarro-star-disappearance.gif", 120)
    save_gif(pizarro_event, output_dir / "pizarro-event-site.gif", 120)
    save_gif(fy22_event, output_dir / "fy22-event-site.gif", 80)


def main() -> None:
    """Parse explicit data paths and build all website animations."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pizarro-csv", type=Path, required=True)
    parser.add_argument("--pizarro-gif", type=Path, required=True)
    parser.add_argument("--fy22-csv", type=Path, required=True)
    parser.add_argument("--fy22-fits", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    arguments = parser.parse_args()
    build_assets(
        arguments.pizarro_csv,
        arguments.pizarro_gif,
        arguments.fy22_csv,
        arguments.fy22_fits,
        arguments.output_dir,
    )


if __name__ == "__main__":
    main()
