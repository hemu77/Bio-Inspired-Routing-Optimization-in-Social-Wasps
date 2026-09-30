"""Looping README previews from the validated viewer, not a second simulation.

Start `npm run dev` in web first, then run this file from the repository root.
Frames are evenly sampled in actual model time; GIF seconds are presentation only.
"""
import json
import subprocess
from pathlib import Path
from PIL import Image


def export():
    root = Path(__file__).resolve().parent
    frames_dir = root / "outputs" / "readme-gif-frames"
    subprocess.run(["node", str(root / "web" / "export_readme_frames.mjs"), str(frames_dir)], check=True)
    output = root / "docs" / "replays"
    output.mkdir(parents=True, exist_ok=True)
    evidence = []
    for method in ("tsp", "biased", "random", "greedy"):
        directory = frames_dir / method
        sampling = json.loads((directory / "sampling.json").read_text())
        # Exactly the expected captures: a previous longer export cannot leak in.
        frames = [Image.open(directory / f"{i:03}.png").convert("RGB")
                  for i in range(len(sampling["ticks"]))]
        # One shared palette avoids frame-to-frame color flicker.
        assert all(frame.size == (720, 600) for frame in frames)
        colors = Image.new("RGB", (720, 600 * 3))
        for i, frame in enumerate((frames[0], frames[len(frames)//2], frames[-1])):
            colors.paste(frame, (0, 600*i))
        palette = colors.quantize(colors=256)
        indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
        durations = [90] * len(indexed)
        durations[0], durations[-1] = 450, 1800
        target = output / f"{method}.gif"
        indexed[0].save(target, save_all=True, append_images=indexed[1:],
                        duration=durations, loop=0, disposal=1, optimize=False)
        with Image.open(target) as gif:
            assert gif.info["loop"] == 0 and gif.n_frames > 1
            assert gif.size == (720, 600)
            gif.seek(gif.n_frames-1)
            assert gif.info["duration"] == 1800
            # Round-trip endpoint pixels must equal our indexed terminal capture.
            assert gif.convert("RGB").tobytes() == indexed[-1].convert("RGB").tobytes()
        sampling.update(file=f"{method}.gif", bytes=target.stat().st_size,
                        looping=True, playback="sampled; not real time")
        evidence.append(sampling)
        print(f"{target.name}: loop verified; {target.stat().st_size / 1024:.0f} KiB")
    (output / "manifest.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    export()
