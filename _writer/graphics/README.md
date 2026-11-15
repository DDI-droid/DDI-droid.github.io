# Manim graphics for the blog

Author blog diagrams and animations here with Manim Community Edition. The Python environment lives beside the writer in `_writer/.venv/` and is ignored by Git; install packages there, not into the system Python.

The current environment is Windows Python 3.12 with Manim Community Edition 0.22.0 and `imageio-ffmpeg` 0.6.0. Its pinned direct dependencies are in `requirements.txt`.

From PowerShell in `_writer`:

```powershell
uv venv --python "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" .venv
uv pip install --python .venv\Scripts\python.exe -r graphics\requirements.txt
.venv\Scripts\manim.exe render --renderer=cairo --format=png --transparent --save_last_frame --resolution=1800,700 --media_dir "$env:TEMP\manim-output" graphics\query_oracle_code.py QueryOracleCode
```

Manim's CLI saves the still under `manim-output\images\query_oracle_code\`. Trim only its transparent border and copy it to the post's asset folder:

```powershell
.venv\Scripts\python.exe graphics\prepare_image.py "$env:TEMP\manim-output\images\query_oracle_code\query-oracle-code.png" "..\assets\img\posts\<post-slug>\<image-name>.png"
```

For short looping animations, use `--format=gif`; for smoother 3D or longer motion, prefer MP4/WebM to keep the file size down. Keep the Manim source with the writer so each asset can be rerendered. Use transparent backgrounds unless a graphic needs its own backdrop.
