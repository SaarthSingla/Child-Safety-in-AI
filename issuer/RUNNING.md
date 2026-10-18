# Running the issuer

## Get the model

The age model (`model/clip_vit_age_v1.safetensors`, about 330 MB) is stored with
[Git LFS](https://git-lfs.com) and is available to project members only. From the
repository folder:

```bash
brew install git-lfs
git lfs install
git lfs pull
```

Check the file is complete; the result must match the hash for it in `manifest.json`:

```bash
shasum -a 256 issuer/model/clip_vit_age_v1.safetensors
```

## Start the server

```bash
cd issuer
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-runtime.txt -r requirements-api.txt
uvicorn api:app --host 0.0.0.0 --port 8000
```

Endpoints: `GET /health`, `POST /issuance/start`, `POST /issue`.

The age model needs a machine with an NVIDIA graphics card for reasonable speed
(`requirements-runtime.txt` pins CUDA builds of PyTorch). The wallet only connects
over HTTPS, so put the server behind HTTPS (for example a reverse proxy or tunnel).
