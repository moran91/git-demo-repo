"""
Restyle 1moment menu photos to the Morano studio look on Modal GPUs (Qwen-Image-Edit-2511 + 4-step
Lightning LoRA, Apache-2.0). Each result is written to the `qareeb-restyle` Volume as out/<key>.webp,
so a detached run survives this Mac sleeping and a re-run skips finished keys.

  modal run restyle.py --jobs data/jobs.json --limit 5          # sample
  modal run --detach restyle.py --jobs data/jobs.json           # everything
  modal volume get qareeb-restyle out ./out                     # fetch results
"""
import io
import json
import math
import os
import re

import modal

app = modal.App("qareeb-restyle")
hf_cache = modal.Volume.from_name("qareeb-hf-cache", create_if_missing=True)
out_vol = modal.Volume.from_name("qareeb-restyle", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "torch==2.8.0",
        "torchvision==0.23.0",
        "git+https://github.com/huggingface/diffusers",
        "transformers>=4.57",
        "accelerate",
        "peft",
        "safetensors",
        "sentencepiece",
        "pillow",
        "requests",
        "hf_transfer",
        "timm",
        "kornia",
        "einops",
    )
    .env({"HF_HOME": "/cache", "HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_dir(os.path.join(os.path.dirname(__file__), "ref"), "/ref")
)

CREAM = (245, 235, 224)
SIZE = 1024
PROMPT = (
    "Keep the main subject exactly as it is: the same food, drink, packaging, wrapper or plate, with the "
    "same shape, colors, ingredients and details. Do not add any new objects, food, plates, cups or props. "
    "Remove any hands, gloves, logos, watermarks and text overlays, keeping the subject whole. Replace the "
    "background with a plain seamless warm cream studio backdrop (#F5EBE0). Soft, even, diffused light, no "
    "harsh sunlight or light streaks, a subtle soft contact shadow directly under the subject. Clean "
    "professional menu photo, subject centered with generous margin."
)
NEGATIVE = "text, watermark, logo, hands, gloves, fingers, people, extra food, extra plate, props, clutter, busy background, hard sunlight, light streaks, window shadows, blurry"


def square_on_cream(img):
    from PIL import Image

    img = img.convert("RGB")
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), CREAM)
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def load_pipe():
    import torch
    from diffusers import FlowMatchEulerDiscreteScheduler, QwenImageEditPlusPipeline

    scheduler = FlowMatchEulerDiscreteScheduler.from_config({
        "base_image_seq_len": 256, "base_shift": math.log(3), "invert_sigmas": False,
        "max_image_seq_len": 8192, "max_shift": math.log(3), "num_train_timesteps": 1000,
        "shift": 1.0, "shift_terminal": None, "stochastic_sampling": False,
        "time_shift_type": "exponential", "use_beta_sigmas": False, "use_dynamic_shifting": True,
        "use_exponential_sigmas": False, "use_karras_sigmas": False,
    })
    pipe = QwenImageEditPlusPipeline.from_pretrained(
        "Qwen/Qwen-Image-Edit-2511", scheduler=scheduler, torch_dtype=torch.bfloat16
    ).to("cuda")
    pipe.load_lora_weights(
        "lightx2v/Qwen-Image-Edit-2511-Lightning",
        weight_name="Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    )
    pipe.fuse_lora()
    pipe.set_progress_bar_config(disable=True)
    return pipe


@app.function(image=image, volumes={"/cache": hf_cache}, timeout=60 * 60, cpu=4)
def download_weights():
    """Fill the shared HF cache once, so GPU containers only read it."""
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download("Qwen/Qwen-Image-Edit-2511")
    hf_hub_download("lightx2v/Qwen-Image-Edit-2511-Lightning", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors")
    hf_cache.commit()


@app.cls(
    image=image,
    gpu="H100",
    volumes={"/cache": hf_cache, "/out": out_vol},
    timeout=60 * 20,
    scaledown_window=60,
    max_containers=10,
)
class Restyler:
    @modal.enter()
    def load(self):
        self.pipe = load_pipe()

    @modal.method()
    def restyle(self, key: str, url: str, overwrite: bool = False) -> str:
        import requests
        import torch
        from PIL import Image

        dest = f"/out/out/{key}.webp"
        if not overwrite and os.path.exists(dest):
            return f"skip {key}"
        r = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        src = square_on_cream(Image.open(io.BytesIO(r.content)))
        result = self.pipe(
            image=[src],
            prompt=PROMPT,
            num_inference_steps=4,
            true_cfg_scale=1.0,
            height=SIZE,
            width=SIZE,
            generator=torch.Generator("cuda").manual_seed(7),
        ).images[0]
        os.makedirs("/out/out", exist_ok=True)
        result.save(dest, "WEBP", quality=90)
        out_vol.commit()
        return f"ok {key}"


@app.local_entrypoint()
def main(jobs: str = "data/jobs.json", limit: int = 0, overwrite: bool = False):
    download_weights.remote()
    items = json.load(open(jobs))
    if limit:
        items = items[:limit]
    print(f"{len(items)} photos")
    r = Restyler()
    done = failed = 0
    for res in r.restyle.map(
        [j["key"] for j in items], [j["url"] for j in items], [overwrite] * len(items),
        return_exceptions=True, order_outputs=False,
    ):
        if isinstance(res, Exception):
            failed += 1
            print("FAIL", res)
        else:
            done += 1
        if (done + failed) % 50 == 0:
            print(f"{done} done, {failed} failed")
    print(f"finished: {done} done, {failed} failed")


# ---------------------------------------------------------------------------------------------
# Replating: move each studio photo (out/<key>.webp) onto Morano serveware. The Qwen2.5-VL text
# encoder that ships inside the edit pipeline first labels the photo, then a Morano reference
# photo supplies the plate. Pizzas, packaged products and drinks already in a glass are skipped.
# Results: plated/<key>.webp, labels: meta/<key>.json (both in the qareeb-restyle Volume).

# Morano reference photo (ref/<productId>.webp) -> the serveware it shows.
SERVEWARE = {
    "stone_bowl": ("38Vf89SOsLnvjfzmv994", "speckled beige stoneware bowl"),
    "charcoal_plate": ("5ysP67lpJUncTeHRnrIG", "round dark charcoal textured ceramic plate"),
    "terracotta_plate": ("7sLPSoXekELulNgiNUc0", "white round plate with a terracotta rim"),
    "black_bowl": ("8nZuOmNshZJmFmLIW9vT", "wide matte black bowl"),
    "white_tray": ("AR90lJTFQbhC7MMwVLQ2", "white rectangular porcelain serving tray"),
    "cream_plate": ("DMKPpt3r8eXiFBAiFnVd", "round cream ceramic plate"),
    "rustic_bowl": ("E0PQbRtFgWJjvKCwpGxl", "rustic speckled bowl with a dark rim"),
    "white_bowl": ("YormiN8kSxjJwSS19n1H", "glossy white bowl with a thick rounded rim"),
    "pasta_plate": ("dtZaX9vCXXB3DNVgJ2Ya", "wide-rim embossed white pasta plate"),
    "slate_plate": ("gm2gq7dWgHXfSQJp9TrC", "round slate blue-grey textured plate"),
    "basket": ("WWp2y86FzpV4SsfsXC93", "woven wicker basket lined with paper"),
    "glass": ("yy4irywYWheoOLMPURkn", "tall curved hurricane glass"),
}
WET = ["stone_bowl", "black_bowl", "rustic_bowl", "white_bowl", "pasta_plate"]
DRY = ["charcoal_plate", "terracotta_plate", "white_tray", "cream_plate", "slate_plate"]
HANDHELD = ["white_tray", "charcoal_plate", "cream_plate", "slate_plate", "terracotta_plate"]
FRIED = re.compile(r"fries|chips|wings|nuggets|fried|tenders|strips|onion rings|potato", re.I)
CLASSIFY = (
    "Classify this menu photo. Reply exactly as CATEGORY|TEXTURE|DESCRIPTION where CATEGORY is one of: "
    "SERVED (food already on a plate, bowl, board or basket), TAKEAWAY (food in a disposable box, tray, foil, "
    "paper or cup), HANDHELD (sandwich, burger, wrap, pita, toast or shawarma not on a plate), LOOSE (other food "
    "with no dish, e.g. pastries or cakes), PIZZA, PACKAGED (sealed commercial product such as a can, bottle or "
    "packet), GLASS_DRINK (prepared drink in a real glass), CUP_DRINK (prepared drink in a disposable cup). "
    "TEXTURE is WET (saucy, soupy, pasta, rice, salad) or DRY. DESCRIPTION is the food in at most 8 words."
)


def pick_serveware(key: str, category: str, texture: str, desc: str):
    import hashlib

    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    if category in ("PIZZA", "PACKAGED", "GLASS_DRINK"):
        return None
    if category == "CUP_DRINK":
        return "glass"
    if category == "HANDHELD":
        return HANDHELD[h % len(HANDHELD)]
    if texture == "DRY" and FRIED.search(desc) and h % 3 == 0:
        return "basket"
    pool = WET if texture == "WET" else DRY
    return pool[h % len(pool)]


@app.cls(
    image=image,
    gpu="H100",
    volumes={"/cache": hf_cache, "/out": out_vol},
    timeout=60 * 20,
    scaledown_window=60,
    max_containers=10,
)
class Replater:
    @modal.enter()
    def load(self):
        self.pipe = load_pipe()

    def classify(self, img) -> tuple[str, str, str]:
        import torch

        proc, model = self.pipe.processor, self.pipe.text_encoder
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": CLASSIFY}]}]
        text = proc.apply_chat_template(messages, add_generation_prompt=True)
        inputs = proc(text=[text], images=[img.resize((448, 448))], return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=40, do_sample=False)
        answer = proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()
        parts = [x.strip() for x in answer.split("|")] + ["", ""]
        return parts[0].upper(), parts[1].upper(), parts[2]

    @modal.method()
    def replate(self, key: str, overwrite: bool = False, mode: str = "ref") -> str:
        import torch
        from PIL import Image

        dest = f"/out/plated/{key}.webp"
        meta_path = f"/out/meta/{key}.json"
        if not overwrite and os.path.exists(meta_path):
            return f"skip {key}"
        src = Image.open(f"/out/out/{key}.webp").convert("RGB")
        category, texture, desc = self.classify(src)
        ware = pick_serveware(key, category, texture, desc)
        meta = {"category": category, "texture": texture, "desc": desc, "serveware": ware}
        if ware:
            ref_id, ware_desc = SERVEWARE[ware]
            keep = (
                "Keep the food exactly the same: same ingredients, amounts, colors, shapes and details. "
                if ware != "glass" else "Keep the drink exactly the same: same color, ice, straw and garnish. "
            )
            style = (
                "Seamless warm cream studio backdrop (#F5EBE0), soft even diffused light, a soft natural shadow, "
                "45-degree overhead angle, centered with generous margin, professional menu photo. No text, no hands."
            )
            if mode == "ref":
                images = [src, Image.open(f"/out/empty/{ware}.webp").convert("RGB")]
                prompt = (
                    f"Serve the {desc or 'food'} from image 1 in the {ware_desc} shown in image 2. {keep}"
                    "Use only the dish from image 2 and none of its food. Remove any disposable packaging, paper or "
                    f"foil from image 1. {style}"
                )
            else:
                images = [src]
                prompt = (
                    f"Serve this {desc or 'food'} in a {ware_desc}. {keep}Remove any disposable packaging, paper or "
                    f"foil. Do not add other food or props. {style}"
                )
            result = self.pipe(
                image=images, prompt=prompt, num_inference_steps=4, true_cfg_scale=1.0,
                height=SIZE, width=SIZE, generator=torch.Generator("cuda").manual_seed(11),
            ).images[0]
            os.makedirs("/out/plated", exist_ok=True)
            result.save(dest, "WEBP", quality=90)
        os.makedirs("/out/meta", exist_ok=True)
        json.dump(meta, open(meta_path, "w"), ensure_ascii=False)
        out_vol.commit()
        return f"{key} {json.dumps(meta, ensure_ascii=False)}"


@app.function(image=image, gpu="H100", volumes={"/cache": hf_cache, "/out": out_vol}, timeout=60 * 20)
def make_empty_serveware():
    """Morano reference photos with the food removed, so the plate reference carries no food to copy."""
    import torch
    from PIL import Image

    pipe = load_pipe()
    os.makedirs("/out/empty", exist_ok=True)
    for ware, (ref_id, desc) in SERVEWARE.items():
        src = Image.open(f"/ref/{ref_id}.webp").convert("RGB").resize((SIZE, SIZE))
        what = "drink, straw, ice and garnish" if ware == "glass" else "food, sauce and garnish"
        img = pipe(
            image=[src], num_inference_steps=4, true_cfg_scale=1.0, height=SIZE, width=SIZE,
            prompt=f"Remove all the {what}. Show only the clean, empty {desc}, unchanged, on the same background and light.",
            generator=torch.Generator("cuda").manual_seed(3),
        ).images[0]
        img.save(f"/out/empty/{ware}.webp", "WEBP", quality=92)
    out_vol.commit()


# v2 serveware that Morano does not show, derived from Morano's empty pieces so style and light match.
EXTRA_SERVEWARE = {
    "sushi_board": ("charcoal_plate", "long narrow rectangular matte black slate sushi board"),
    "wood_board": ("white_tray", "large rectangular natural oak wooden serving board"),
    "oval_platter": ("white_tray", "large oval white porcelain serving platter"),
    "dessert_plate": ("cream_plate", "small round cream ceramic dessert plate, about 18 cm"),
    "marble_plate": ("cream_plate", "small round white marble dessert plate"),
    "small_bowl": ("stone_bowl", "small speckled beige stoneware bowl, about 12 cm"),
    "latte_cup": ("glass", "empty wide white ceramic latte cup on a matching saucer"),
    "highball": ("glass", "empty tall clear straight highball glass"),
    "shake_glass": ("glass", "empty tall clear fluted milkshake glass"),
}


@app.function(image=image, gpu="H100", volumes={"/cache": hf_cache, "/out": out_vol}, timeout=60 * 20)
def make_extra_serveware():
    import torch
    from PIL import Image

    pipe = load_pipe()
    for name, (base, desc) in EXTRA_SERVEWARE.items():
        src = Image.open(f"/out/empty/{base}.webp").convert("RGB")
        img = pipe(
            image=[src], num_inference_steps=4, true_cfg_scale=1.0, height=SIZE, width=SIZE,
            prompt=f"Replace the dish with a single clean, empty {desc}. Same seamless warm cream background, same soft light and shadow, same camera angle. Nothing on it.",
            generator=torch.Generator("cuda").manual_seed(5),
        ).images[0]
        img.save(f"/out/empty/{name}.webp", "WEBP", quality=92)
    out_vol.commit()


# ---------------------------------------------------------------------------------------------
# v2: plan per item -> keep / composite (food pixels untouched) / edit, then a judge compares before and
# after; up to 3 attempts, otherwise the item keeps its studio photo. Results: plated2/<key>.webp,
# meta2/<key>.json with {"plan", "action", "serveware", "attempts": [...], "final": "plated"|"keep"}.

PLAN_PROMPT = (
    "Describe this menu photo as JSON with exactly these keys: "
    '"food": one of sushi, sushi_box, platter, salad, dip, soup, pasta, noodles_rice, fried, grill, sandwich, wrap, '
    "pita, burger, pastry, cake, dessert, ice_cream, drink_hot, drink_cold, meal_set, pizza, packaged, logo, other; "
    '"vessel": what the food sits in or on: none, paper_wrap, disposable_container, plate, bowl, long_board, tray, pan, '
    "basket, glass, paper_cup, plastic_cup, bottle, can, cone; "
    '"items": single or multiple (multiple = several different foods or drinks shown as separate items, e.g. a '
    "sandwich with fries and a can); "
    '"sweet": true or false. '
    "platter = one large tray or board with many different foods. sushi_box = sushi packed in a box. meal_set = a main "
    "dish together with a drink or a separate side. Reply with the JSON only."
)
JUDGE_PROMPT = (
    "Left: the original menu photo. Right: a new version where the food was moved onto different serveware. "
    "Answer PASS or FAIL, then a short reason. FAIL if any of these is true: the food on the right is a different "
    "dish; the number of pieces or items is different; anything from the left (drink, fries, sauce, salad, side, "
    "garnish) is missing on the right; the bread changed type (pita, wrap, bun, baguette); a plastic box, paper cup, "
    "foil tray or other disposable container is on or inside the new dish; a plate or bowl sits inside another "
    "plate or bowl; the food floats, looks pasted, or is far too small or too big for the dish; the photo looks fake."
)
SIDE_PROMPT = (
    "Does this photo show a drink (can, bottle, cup or glass), small sauce cups, or a separate portion of fries, "
    "salad or dip next to the main food? Answer yes or no."
)
COMPLETE_PROMPT = (
    "Left is the original, right is the new version. Does the right photo contain every food item from the left, "
    "including small sauce cups, dips, sides, garnishes and the same number of pieces? Answer yes or no."
)
CHECKS = [
    ("Is there any foil tray, plastic box or tub, paper cup, paper wrapper, cardboard box or other disposable "
     "container visible in this photo? Answer yes or no.", "container"),
    ("Is there a plate, bowl, pan or tray standing inside or on top of another plate, bowl or board in this photo? "
     "Answer yes or no.", "nested dish"),
]
SWEET_PLATES = ["dessert_plate", "marble_plate", "terracotta_plate", "cream_plate"]
SAVORY_PLATES = ["charcoal_plate", "terracotta_plate", "cream_plate", "slate_plate", "white_tray"]
BOWLS = ["stone_bowl", "black_bowl", "rustic_bowl", "white_bowl"]


def plan_action(key: str, plan: dict):
    """-> (action, serveware choices in retry order). action: keep | composite | edit."""
    import hashlib

    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    rot = lambda pool: [pool[(h + i) % len(pool)] for i in range(len(pool))]
    food, vessel = plan.get("food", "other"), plan.get("vessel", "none")
    sweet = str(plan.get("sweet", "")).lower() == "true" or plan.get("sweet") is True
    pieces = ("sushi", "salad", "dip", "soup", "pasta", "noodles_rice", "fried", "pastry", "cake", "dessert", "platter", "sushi_box")
    if food in ("logo", "packaged", "pizza", "meal_set", "other") or plan.get("side") == "yes":
        return "keep", []
    if plan.get("items") == "multiple" and food not in pieces:
        return "keep", []
    if vessel in ("bottle", "can"):
        return "keep", []
    if vessel == "cone" or food in ("ice_cream", "dessert", "cake") and vessel in ("paper_cup", "plastic_cup"):
        return "keep", []
    if food in ("sushi", "sushi_box") and vessel in ("long_board", "tray"):
        return "keep", []
    if food in ("dessert", "cake", "pastry") and vessel in ("tray", "disposable_container") and plan.get("items") == "multiple":
        return "keep", []  # a whole tray is the product; one plated portion would misstate it
    if food == "drink_hot":
        return ("edit", ["latte_cup"]) if vessel == "paper_cup" else ("keep", [])
    if food == "drink_cold":
        return ("edit", ["highball", "shake_glass"]) if vessel in ("plastic_cup", "paper_cup") else ("keep", [])
    if food == "sushi":
        return ("composite" if vessel == "none" else "edit"), ["sushi_board", "wood_board"]
    if food in ("sushi_box", "platter"):
        return "edit", ["wood_board", "oval_platter"]
    if food in ("salad", "dip", "soup", "pasta", "noodles_rice"):
        pool = ["small_bowl"] + rot(BOWLS) if food == "dip" else rot(BOWLS) + ["pasta_plate"]
        return "edit", pool[:3]
    if food in ("sandwich", "wrap", "pita", "burger", "grill", "fried"):
        pool = ["wood_board", "white_tray"] + rot(SAVORY_PLATES) if food in ("sandwich", "wrap") else rot(SAVORY_PLATES) + ["oval_platter"]
        return ("composite" if vessel in ("none", "paper_wrap") else "edit"), pool[:3]
    if food in ("pastry", "cake", "dessert"):
        pool = rot(SWEET_PLATES) if sweet or food != "pastry" else ["wood_board"] + rot(SAVORY_PLATES)
        return ("composite" if vessel == "none" else "edit"), pool[:3]
    return "keep", []


def parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except Exception:
        return {}


@app.cls(
    image=image,
    gpu="H100",
    volumes={"/cache": hf_cache, "/out": out_vol},
    timeout=60 * 30,
    scaledown_window=60,
    max_containers=10,
)
class ReplaterV2:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForImageSegmentation

        self.pipe = load_pipe()
        self.seg = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True).to("cuda").eval().half()
        self.empty_masks = {}
        self._allow_wrap = False
        self._composite = False

    def ask(self, images, prompt, max_new_tokens=60) -> str:
        import torch

        proc, model = self.pipe.processor, self.pipe.text_encoder
        content = [{"type": "image"} for _ in images] + [{"type": "text", "text": prompt}]
        text = proc.apply_chat_template([{"role": "user", "content": content}], add_generation_prompt=True)
        inputs = proc(text=[text], images=images, return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
        return proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()

    def mask(self, img):
        import numpy as np
        import torch
        from PIL import Image
        from torchvision import transforms

        tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        with torch.no_grad():
            pred = self.seg(tf(img).unsqueeze(0).to("cuda").half())[-1].sigmoid()[0, 0].float().cpu().numpy()
        return Image.fromarray((pred * 255).astype(np.uint8)).resize(img.size)

    def composite(self, src, ware: str):
        import numpy as np
        from PIL import Image, ImageFilter

        plate = Image.open(f"/out/empty/{ware}.webp").convert("RGB").resize((SIZE, SIZE))
        if ware not in self.empty_masks:
            self.empty_masks[ware] = self.mask(plate).getbbox() or (200, 300, 824, 800)
        x0, y0, x1, y1 = self.empty_masks[ware]
        pw, ph = x1 - x0, y1 - y0
        m = self.mask(src).point(lambda v: 255 if v > 128 else int(v * 1.6))
        bb = m.getbbox()
        if not bb:
            return None
        food, fm = src.crop(bb), m.crop(bb)
        fw, fh = food.size
        fill = 0.66 if ware in ("sushi_board", "wood_board", "white_tray", "oval_platter") else 0.62
        s = fill * pw / fw
        if fh * s > 0.95 * ph:
            s = 0.95 * ph / fh
        food, fm = food.resize((max(1, int(fw * s)), max(1, int(fh * s))), Image.LANCZOS), fm.resize((max(1, int(fw * s)), max(1, int(fh * s))), Image.LANCZOS)
        cx, base = (x0 + x1) // 2, y0 + int(ph * 0.72)
        px, py = cx - food.width // 2, base - food.height
        py = max(py, 10)
        # soft contact shadow: the food's footprint squashed under it
        sh = Image.new("L", (SIZE, SIZE), 0)
        foot = fm.resize((food.width, max(4, food.height // 5)))
        sh.paste(foot, (px, py + food.height - foot.height // 2))
        sh = sh.filter(ImageFilter.GaussianBlur(18))
        out = np.asarray(plate).astype(np.float32)
        out *= (1 - 0.35 * (np.asarray(sh).astype(np.float32) / 255))[..., None]
        out = Image.fromarray(out.clip(0, 255).astype(np.uint8))
        out.paste(food, (px, py), fm)
        return out

    def edit(self, src, ware: str, plan: dict, seed: int):
        import torch
        from PIL import Image

        desc = SERVEWARE.get(ware, (None, None))[1] or EXTRA_SERVEWARE[ware][1]
        drink = ware in ("latte_cup", "highball", "shake_glass", "glass")
        keep = (
            "Keep the drink itself exactly the same: same color, ice, foam, straw and garnish. " if drink else
            "Keep every piece of food exactly the same: same dish, same number of pieces, same shapes, bread type, "
            "sauces and sides. Do not remove, add or merge anything. "
        )
        prompt = (
            f"Move the contents of image 1 into the {desc} shown in image 2. {keep}"
            "Remove the original container, box, cup, wrapper or plate completely so nothing disposable remains, "
            "and never put one dish inside another. The food fills the dish generously, the way a restaurant serves it. "
            "Seamless warm cream studio backdrop (#F5EBE0), soft even diffused light, a soft natural shadow, 45-degree "
            "angle, centered, professional menu photo. No text, no hands."
        )
        ref = Image.open(f"/out/empty/{ware}.webp").convert("RGB")
        return self.pipe(image=[src, ref], prompt=prompt, num_inference_steps=4, true_cfg_scale=1.0,
                         height=SIZE, width=SIZE, generator=torch.Generator("cuda").manual_seed(seed)).images[0]

    def judge(self, src, out) -> tuple[bool, str]:
        from PIL import Image

        pair = Image.new("RGB", (1024, 512), "white")
        pair.paste(src.resize((512, 512)), (0, 0))
        pair.paste(out.resize((512, 512)), (512, 0))
        ans = self.ask([pair], JUDGE_PROMPT, 40)
        if not ans.upper().startswith("PASS"):
            return False, ans
        if not self._allow_wrap and not self._composite:
            if self.ask([pair], PROBES["missing"], 3).lower().startswith("yes"):
                return False, "FAIL missing items"
            n_src, n_out = (re.findall(r"\d+", self.ask([im.resize((448, 448))], COUNT_PROMPT, 4)) for im in (src, out))
            if n_src and n_out and int(n_out[0]) != int(n_src[0]):
                return False, f"FAIL item count {n_src[0]}->{n_out[0]}"
            p_src, p_out = (re.findall(r"\d+", self.ask([im.resize((448, 448))], PIECES_PROMPT, 4)) for im in (src, out))
            if p_src and p_out:
                a, b = int(p_src[0]), int(p_out[0])
                if min(a, b) < 20 and abs(a - b) > max(1, 0.3 * a):
                    return False, f"FAIL piece count {a}->{b}"
        small = out.resize((448, 448))
        for q, name in CHECKS:
            if name == "container" and self._allow_wrap:
                continue
            if self.ask([small], q, 3).lower().startswith("yes"):
                return False, f"FAIL {name}"
        return True, ans

    @modal.method()
    def reedit(self, key: str, ware: str) -> str:
        """Redo a composite as a real edit onto its dish; strict checks plus a floating check, else keep."""
        from PIL import Image

        src = Image.open(f"/out/out/{key}.webp").convert("RGB")
        meta = {"attempts": [], "final": "keep"}
        self._allow_wrap, self._composite = False, False
        pool = [ware] + [w for w in ("white_tray", "cream_plate", "charcoal_plate") if w != ware]
        for i, w in enumerate(pool[:3]):
            out = self.edit(src, w, {}, 31 + i)
            ok, why = self.judge(src, out)
            if ok and self.ask([out.resize((448, 448))], RESTING_PROMPT, 3).lower().startswith("yes"):
                ok, why = False, "FAIL floating"
            meta["attempts"].append({"serveware": w, "pass": ok, "why": why})
            if ok:
                os.makedirs("/out/plated3", exist_ok=True)
                out.save(f"/out/plated3/{key}.webp", "WEBP", quality=90)
                meta["final"], meta["serveware"] = "plated", w
                break
        os.makedirs("/out/meta3", exist_ok=True)
        json.dump(meta, open(f"/out/meta3/{key}.json", "w"), ensure_ascii=False)
        out_vol.commit()
        return f"{key} {meta['final']} {[(a['serveware'], a['why'][:24]) for a in meta['attempts']]}"

    @modal.method()
    def ground(self, key: str) -> str:
        """Second pass for composites: seat the pasted food on its dish, then re-check against the studio photo."""
        import torch
        from PIL import Image

        src = Image.open(f"/out/out/{key}.webp").convert("RGB")
        comp = Image.open(f"/out/plated2/{key}.webp").convert("RGB")
        meta = {"attempts": [], "final": "keep"}
        self._allow_wrap, self._composite = False, False
        for seed in (21, 22):
            out = self.pipe(
                image=[comp], prompt=GROUND_PROMPT, num_inference_steps=4, true_cfg_scale=1.0,
                height=SIZE, width=SIZE, generator=torch.Generator("cuda").manual_seed(seed),
            ).images[0]
            os.makedirs("/out/ground_try", exist_ok=True)
            out.save(f"/out/ground_try/{key}_{seed}.webp", "WEBP", quality=85)
            ok, why = self.judge(src, out)
            if ok and self.ask([out.resize((448, 448))], RESTING_PROMPT, 3).lower().startswith("yes"):
                ok, why = False, "FAIL floating"
            meta["attempts"].append({"seed": seed, "pass": ok, "why": why})
            if ok:
                os.makedirs("/out/plated3", exist_ok=True)
                out.save(f"/out/plated3/{key}.webp", "WEBP", quality=90)
                meta["final"] = "plated"
                break
        os.makedirs("/out/meta3", exist_ok=True)
        json.dump(meta, open(f"/out/meta3/{key}.json", "w"), ensure_ascii=False)
        out_vol.commit()
        return f"{key} {meta['final']} {[a['why'][:30] for a in meta['attempts']]}"

    @modal.method()
    def run(self, key: str, overwrite: bool = False) -> str:
        from PIL import Image

        meta_path = f"/out/meta2/{key}.json"
        if not overwrite and os.path.exists(meta_path):
            return f"skip {key}"
        src = Image.open(f"/out/out/{key}.webp").convert("RGB")
        small = src.resize((448, 448))
        plan = parse_json(self.ask([small], PLAN_PROMPT, 80))
        plan["side"] = "yes" if self.ask([small], SIDE_PROMPT, 3).lower().startswith("yes") else "no"
        action, wares = plan_action(key, plan)
        meta = {"plan": plan, "action": action, "attempts": [], "final": "keep"}
        if action != "keep":
            tries = [("composite", wares[0])] if action == "composite" else []
            tries += [("edit", w) for w in (wares * 3)[:3 - len(tries)]]
            for i, (how, ware) in enumerate(tries):
                # a paper wrap on a sandwich is part of the food and survives compositing on purpose
                self._allow_wrap = how == "composite" and plan.get("vessel") == "paper_wrap"
                self._composite = how == "composite"
                out = self.composite(src, ware) if how == "composite" else self.edit(src, ware, plan, 11 + i)
                if out is None:
                    continue
                ok, why = self.judge(src, out)
                meta["attempts"].append({"how": how, "serveware": ware, "pass": ok, "why": why})
                if ok:
                    os.makedirs("/out/plated2", exist_ok=True)
                    out.save(f"/out/plated2/{key}.webp", "WEBP", quality=90)
                    meta["final"], meta["serveware"] = "plated", ware
                    break
        os.makedirs("/out/meta2", exist_ok=True)
        json.dump(meta, open(meta_path, "w"), ensure_ascii=False)
        out_vol.commit()
        return f"{key} {meta['final']} {json.dumps(plan, ensure_ascii=False)} {[(a['how'], a['serveware'], a['pass']) for a in meta['attempts']]}"


PROBES = {
    "complete": COMPLETE_PROMPT,
    "missing": ("Left is the original, right is the new version. Is any item from the left photo missing on the right "
                "photo, such as a drink, can, fries, sauce cup, dip, side salad or garnish? Answer yes or no."),
}
GROUND_PROMPT = (
    "The food is resting directly on the dish, touching its surface: make it sit naturally on the dish with a real "
    "contact shadow underneath and lighting that matches the scene. Keep the food itself exactly the same: same "
    "shape, size, ingredients, bread and wrapping. Keep the dish, the cream background and the camera angle."
)
RESTING_PROMPT = ("Is the food floating above the plate or board, or pasted on without touching it? Answer yes or no.")
PIECES_PROMPT = ("How many separate pieces of food are visible? Count every piece, roll, ball, slice, skewer or "
                 "pastry. If there are more than 20, answer 20. Answer with a single number.")
COUNT_PROMPT = ("How many separate items are in this photo? Count each plate or bowl of food, each drink, each sauce "
                "cup and each separate side as one item. Answer with a single number.")


@app.function(image=image, gpu="H100", volumes={"/cache": hf_cache, "/out": out_vol}, timeout=60 * 20)
def judge_probe(cases: list):
    """cases: [(key, label)] comparing out/<key> with plated/<key> (v1). Prints each probe's answer."""
    from PIL import Image

    r = ReplaterV2._get_user_cls() if hasattr(ReplaterV2, "_get_user_cls") else None
    pipe = load_pipe()

    class Asker:
        pass

    a = Asker()
    a.pipe = pipe
    ask = lambda imgs, q, n=4: ReplaterV2.ask.__wrapped__(a, imgs, q, n) if hasattr(ReplaterV2.ask, "__wrapped__") else None
    import torch

    def ask(images, prompt, max_new_tokens=4):
        proc, model = pipe.processor, pipe.text_encoder
        content = [{"type": "image"} for _ in images] + [{"type": "text", "text": prompt}]
        text = proc.apply_chat_template([{"role": "user", "content": content}], add_generation_prompt=True)
        inputs = proc(text=[text], images=images, return_tensors="pt").to("cuda")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
        return proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()

    rows = []
    for key, label in cases:
        src = Image.open(f"/out/out/{key}.webp").convert("RGB")
        new = Image.open(f"/out/plated/{key}.webp").convert("RGB")
        pair = Image.new("RGB", (1024, 512), "white")
        pair.paste(src.resize((512, 512)), (0, 0))
        pair.paste(new.resize((512, 512)), (512, 0))
        row = {"key": key, "label": label}
        for name, q in PROBES.items():
            row[name] = ask([pair], q)
        row["count"] = f"{ask([src.resize((448, 448))], COUNT_PROMPT)}->{ask([new.resize((448, 448))], COUNT_PROMPT)}"
        rows.append(row)
        print(row)
    return rows


@app.function(volumes={"/out": out_vol})
def drop_meta(names: list):
    for n in names:
        for path in (f"/out/meta2/{n}", f"/out/plated2/{n.replace('.json', '.webp')}"):
            if os.path.exists(path):
                os.remove(path)
    out_vol.commit()
    return len(names)


@app.local_entrypoint()
def drop(names: str):
    print("dropped", drop_meta.remote(open(names).read().split()))


@app.local_entrypoint()
def probe():
    bad = ["112-5815", "112-5813", "112-5809", "112-5810", "110-5782", "110-5789", "105-5422", "114-5921"]
    good = ["120-6197", "115-5967", "5-97", "63-3368", "98-5131", "99-5118", "14-308", "85-4000", "29-798", "80-3899"]
    judge_probe.remote([(k, "missing") for k in bad] + [(k, "ok") for k in good])


@app.local_entrypoint()
def reedit(jobs: str = "data/composites-ware.json", limit: int = 0):
    pairs = json.load(open(jobs))[: limit or None]
    print(f"{len(pairs)} composites")
    for res in ReplaterV2().reedit.map([p[0] for p in pairs], [p[1] for p in pairs], return_exceptions=True, order_outputs=False):
        print(res if not isinstance(res, Exception) else f"FAIL {res}")
    print("finished")


@app.local_entrypoint()
def ground(jobs: str = "data/composites.json", limit: int = 0):
    keys = json.load(open(jobs))[: limit or None]
    print(f"{len(keys)} composites")
    for res in ReplaterV2().ground.map(keys, return_exceptions=True, order_outputs=False):
        print(res if not isinstance(res, Exception) else f"FAIL {res}")
    print("finished")


@app.local_entrypoint()
def replate2(jobs: str = "data/jobs.json", limit: int = 0, overwrite: bool = False):
    download_weights.remote()
    keys = [j["key"] if isinstance(j, dict) else j for j in json.load(open(jobs))]
    if limit:
        keys = keys[:limit]
    print(f"{len(keys)} photos")
    done = failed = 0
    for res in ReplaterV2().run.map(keys, [overwrite] * len(keys), return_exceptions=True, order_outputs=False):
        if isinstance(res, Exception):
            failed += 1
            print("FAIL", res)
        else:
            done += 1
            if len(keys) <= 200:
                print(res)
        if (done + failed) % 50 == 0:
            print(f"{done} done, {failed} failed")
    print(f"finished: {done} done, {failed} failed")


@app.local_entrypoint()
def replate(jobs: str = "data/jobs.json", limit: int = 0, overwrite: bool = False, mode: str = "ref"):
    download_weights.remote()
    keys = [j["key"] for j in json.load(open(jobs))]
    if limit:
        keys = keys[:limit]
    print(f"{len(keys)} photos")
    done = failed = 0
    for res in Replater().replate.map(keys, [overwrite] * len(keys), [mode] * len(keys), return_exceptions=True, order_outputs=False):
        if isinstance(res, Exception):
            failed += 1
            print("FAIL", res)
        else:
            done += 1
            if len(keys) <= 50:
                print(res)
        if (done + failed) % 50 == 0:
            print(f"{done} done, {failed} failed")
    print(f"finished: {done} done, {failed} failed")


@app.function(image=image)
def debug():
    import traceback
    try:
        import torchvision
        print("torchvision", torchvision.__version__)
    except Exception:
        traceback.print_exc()
    from transformers.utils import is_torchvision_available
    print("transformers sees torchvision:", is_torchvision_available())
