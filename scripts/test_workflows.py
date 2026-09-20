#!/usr/bin/env python3
"""Workflow import / mapping / Comfy URL helpers. Failures print and exit 1."""
from __future__ import annotations

import json
import sys
import tempfile
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workflows  # noqa: E402

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


API_WF = {
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "wai.safetensors"},
        "_meta": {"title": "Load Checkpoint"},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "ORIGINAL POS", "clip": ["4", 1]},
        "_meta": {"title": "CLIP Text Encode (Prompt)"},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": "ORIGINAL NEG", "clip": ["4", 1]},
    },
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 1,
            "steps": 20,
            "cfg": 7,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "ComfyUI", "images": ["8", 0]},
    },
    "40": {
        "class_type": "ControlNetLoader",
        "inputs": {"control_net_name": "keep_me.safetensors"},
    },
}

UI_WF = {
    "last_node_id": 9,
    "last_link_id": 8,
    "nodes": [
        {"id": 6, "type": "CLIPTextEncode", "widgets_values": ["hello"]},
        {"id": 4, "type": "CheckpointLoaderSimple"},
    ],
    "links": [[1, 4, 1, 6, 0, "CLIP"]],
    "groups": [],
    "version": 0.4,
}


# --- classify --------------------------------------------------------------

ok("API dict is api format", workflows.classify_workflow(API_WF) == "api")
ok("UI nodes+links is ui format", workflows.classify_workflow(UI_WF) == "ui")
ok("empty dict is invalid", workflows.classify_workflow({}) == "invalid")
ok("list is invalid", workflows.classify_workflow([]) == "invalid")
ok("None is invalid", workflows.classify_workflow(None) == "invalid")
ok("string is invalid", workflows.classify_workflow("{not json object}") == "invalid")

try:
    workflows.require_api_workflow(UI_WF)
    ok("UI format raises", False)
except workflows.WorkflowError as exc:
    msg = str(exc)
    ok("UI format error names the format", "API" in msg and "一般" in msg, msg)
    ok("UI format error mentions Export", "匯出" in msg or "Export" in msg, msg)
    ok("UI format has code", getattr(exc, "code", None) == "ui_format")
else:
    ok("UI format raises", False)

try:
    workflows.require_api_workflow({"foo": 1})
    ok("garbage raises invalid", False)
except workflows.WorkflowError as exc:
    ok("garbage code is invalid", getattr(exc, "code", None) == "invalid", str(exc))


# --- apply mapping ---------------------------------------------------------

mapping = {
    "positive": {"node": "6", "input": "text", "mode": "control"},
    "negative": {"node": "7", "input": "text", "mode": "keep"},
    "seed": {"node": "3", "input": "seed", "mode": "keep"},
    "checkpoint": {"node": "4", "input": "ckpt_name", "mode": "keep"},
}
original = deepcopy(API_WF)
runtime = workflows.apply_mapping(
    original,
    mapping,
    {"positive": "1girl, masterpiece", "negative": "SHOULD NOT APPLY", "seed": 99, "checkpoint": "other.safetensors"},
)
ok("original positive unchanged", original["6"]["inputs"]["text"] == "ORIGINAL POS")
ok("runtime positive replaced", runtime["6"]["inputs"]["text"] == "1girl, masterpiece")
ok("keep negative", runtime["7"]["inputs"]["text"] == "ORIGINAL NEG")
ok("keep seed", runtime["3"]["inputs"]["seed"] == 1)
ok("keep checkpoint", runtime["4"]["inputs"]["ckpt_name"] == "wai.safetensors")
ok("unmapped ControlNet survives", runtime["40"]["class_type"] == "ControlNetLoader")
ok("unmapped ControlNet value kept", runtime["40"]["inputs"]["control_net_name"] == "keep_me.safetensors")
ok("runtime is a copy", runtime is not original)
ok("clip link not rewritten", runtime["6"]["inputs"]["clip"] == ["4", 1])

full = {
    "positive": {"node": "6", "input": "text", "mode": "control"},
    "negative": {"node": "7", "input": "text", "mode": "control"},
    "seed": {"node": "3", "input": "seed", "mode": "control"},
    "checkpoint": {"node": "4", "input": "ckpt_name", "mode": "control"},
}
rt2 = workflows.apply_mapping(
    API_WF,
    full,
    {"positive": "POS", "negative": "NEG", "seed": 42, "checkpoint": "b.safetensors"},
)
ok("control negative", rt2["7"]["inputs"]["text"] == "NEG")
ok("control seed", rt2["3"]["inputs"]["seed"] == 42)
ok("control checkpoint", rt2["4"]["inputs"]["ckpt_name"] == "b.safetensors")

lora_wf = deepcopy(API_WF)
lora_wf["12"] = {
    "class_type": "LoraLoader",
    "inputs": {
        "lora_name": "old.safetensors",
        "strength_model": 0.5,
        "strength_clip": 0.5,
        "model": ["4", 0],
        "clip": ["4", 1],
    },
}
rt3 = workflows.apply_mapping(
    lora_wf,
    {
        "positive": {"node": "6", "input": "text", "mode": "control"},
        "loras": [
            {
                "node": "12",
                "input": "lora_name",
                "strengthInput": "strength_model",
                "mode": "control",
            }
        ],
    },
    {
        "positive": "x",
        "loras": [(r"Character\foo.safetensors", 0.8)],
    },
)
ok("control lora name", rt3["12"]["inputs"]["lora_name"] == r"Character\foo.safetensors")
ok("control lora strength", rt3["12"]["inputs"]["strength_model"] == 0.8)
ok("lora keep leaves name", workflows.apply_mapping(
    lora_wf,
    {
        "positive": {"node": "6", "input": "text", "mode": "control"},
        "loras": [{"node": "12", "input": "lora_name", "mode": "keep"}],
    },
    {"positive": "x", "loras": [(r"Character\foo.safetensors", 0.8)]},
)["12"]["inputs"]["lora_name"] == "old.safetensors")

try:
    workflows.apply_mapping(API_WF, {"positive": {"node": "999", "input": "text", "mode": "control"}}, {"positive": "x"})
    ok("missing node raises", False)
except workflows.WorkflowError as exc:
    ok("missing node code", getattr(exc, "code", None) == "missing_node", str(exc))

try:
    workflows.apply_mapping(API_WF, {"positive": {"node": "6", "input": "nope", "mode": "control"}}, {"positive": "x"})
    ok("missing input raises", False)
except workflows.WorkflowError as exc:
    ok("missing input code", getattr(exc, "code", None) == "missing_input", str(exc))

ok(
    "no mapping returns copy equal to original",
    workflows.apply_mapping(API_WF, {}, {"positive": "x"})["6"]["inputs"]["text"] == "ORIGINAL POS",
)

ok(
    "positive mapping required for generate",
    workflows.mapping_ready({"positive": {"node": "6", "input": "text", "mode": "control"}}) is True,
)
ok(
    "empty mapping not ready",
    workflows.mapping_ready({}) is False,
)
ok(
    "keep-only positive not ready",
    workflows.mapping_ready({"positive": {"node": "6", "input": "text", "mode": "keep"}}) is False,
)


# --- Comfy URL -------------------------------------------------------------

ok("plain host gets http", workflows.normalize_comfy_url("127.0.0.1:8188") == "http://127.0.0.1:8188")
ok("default local ok", workflows.normalize_comfy_url("http://127.0.0.1:8188") == "http://127.0.0.1:8188")
ok("lan ip ok", workflows.normalize_comfy_url("http://192.168.1.50:8188") == "http://192.168.1.50:8188")
ok("https ok", workflows.normalize_comfy_url("https://gpu.local:8188") == "https://gpu.local:8188")
ok("strips trailing slash", workflows.normalize_comfy_url("http://127.0.0.1:8188/") == "http://127.0.0.1:8188")
ok("empty is default", workflows.normalize_comfy_url("  ") == "http://127.0.0.1:8188")

def raises_url(raw, code):
    try:
        workflows.normalize_comfy_url(raw)
        return False, ""
    except workflows.WorkflowError as exc:
        return getattr(exc, "code", None) == code, str(exc)

good, detail = raises_url("file:///etc/passwd", "bad_url")
ok("file scheme rejected", good, detail)
good, detail = raises_url("http://user:pass@127.0.0.1:8188", "bad_url")
ok("userinfo rejected", good, detail)
good, detail = raises_url("javascript:alert(1)", "bad_url")
ok("javascript rejected", good, detail)
good, detail = raises_url("ftp://127.0.0.1:21", "bad_url")
ok("ftp rejected", good, detail)


# --- object_info combo -----------------------------------------------------

info = {
    "CheckpointLoaderSimple": {
        "input": {"required": {"ckpt_name": [["illustrious\\a.safetensors", "b.safetensors"], {}]}}
    },
    "LoraLoader": {
        "input": {"required": {"lora_name": [["style\\x.safetensors"], {}]}}
    },
}
ok(
    "combo checkpoints",
    workflows.combo_list(info, "CheckpointLoaderSimple", "ckpt_name")
    == ["illustrious\\a.safetensors", "b.safetensors"],
)
ok(
    "combo loras",
    workflows.combo_list(info, "LoraLoader", "lora_name") == ["style\\x.safetensors"],
)
ok("combo missing node empty", workflows.combo_list({}, "Nope", "x") == [])


# --- inspect / ckpt name ---------------------------------------------------

nodes = workflows.inspect_nodes(API_WF)
ids = [n["id"] for n in nodes]
ok("inspect lists all nodes", set(ids) == set(API_WF), str(ids))
clip = next(n for n in nodes if n["id"] == "6")
ok("inspect title from _meta", clip["title"] == "CLIP Text Encode (Prompt)", clip)
text_in = next(i for i in clip["inputs"] if i["name"] == "text")
ok("inspect widget input", text_in["kind"] == "widget" and text_in["value"] == "ORIGINAL POS", text_in)
clip_in = next(i for i in clip["inputs"] if i["name"] == "clip")
ok("inspect link input", clip_in["kind"] == "link", clip_in)
ok("ckpt_name_of", workflows.ckpt_name_of(API_WF) == "wai.safetensors")
ok("save image nodes", workflows.image_output_nodes(API_WF) == ["9"])


# --- profile store ---------------------------------------------------------

td = Path(tempfile.mkdtemp())
workflows.DATA_DIR = td / "workflows"
workflows.SETTINGS_PATH = td / "settings.json"

saved = workflows.set_comfy_api("http://192.168.1.50:8188")
ok("set_comfy_api returns normalized", saved == "http://192.168.1.50:8188")
ok("saved_comfy_api persists", workflows.saved_comfy_api() == "http://192.168.1.50:8188")
ok("settings file exists", workflows.SETTINGS_PATH.is_file())

ok("list starts empty", workflows.list_profiles() == [])
prof = workflows.save_profile("My WAI", API_WF, mapping)
ok("save returns id", bool(prof.get("id")), str(prof))
ok("save returns name", prof.get("name") == "My WAI")
ok("list has one", len(workflows.list_profiles()) == 1)
loaded = workflows.get_profile(prof["id"])
ok("loaded workflow intact", loaded["workflow"]["40"]["inputs"]["control_net_name"] == "keep_me.safetensors")
ok("loaded mapping positive node", loaded["mapping"]["positive"]["node"] == "6")

# original on disk must not change when apply_mapping runs
on_disk = json.loads((workflows.DATA_DIR / prof["id"] / "workflow.json").read_text(encoding="utf-8"))
workflows.apply_mapping(loaded["workflow"], loaded["mapping"], {"positive": "MUTATE"})
on_disk2 = json.loads((workflows.DATA_DIR / prof["id"] / "workflow.json").read_text(encoding="utf-8"))
ok("disk workflow not mutated by apply", on_disk == on_disk2)
ok("disk still has original pos", on_disk2["6"]["inputs"]["text"] == "ORIGINAL POS")

dup = workflows.save_profile("My WAI", API_WF, mapping)
ok("name conflict gets new id", dup["id"] != prof["id"], f"{dup['id']} vs {prof['id']}")
ok("name conflict keeps readable name", "My WAI" in dup["name"] or dup["id"] != "my-wai")

try:
    workflows.save_profile("bad", UI_WF, mapping)
    ok("store rejects UI format", False)
except workflows.WorkflowError as exc:
    ok("store UI format code", getattr(exc, "code", None) == "ui_format")

try:
    workflows.update_mapping(prof["id"], {"positive": {"node": "nope", "input": "text", "mode": "control"}})
    ok("stale mapping rejected", False)
except workflows.WorkflowError as exc:
    ok("stale mapping code", getattr(exc, "code", None) == "missing_node", str(exc))

workflows.update_mapping(
    prof["id"],
    {"positive": {"node": "6", "input": "text", "mode": "control"}, "seed": {"node": "3", "input": "seed", "mode": "control"}},
)
after = workflows.get_profile(prof["id"])
ok("update mapping seed control", after["mapping"]["seed"]["mode"] == "control")

ok("delete unknown false", workflows.delete_profile("missing") is False)
ok("delete existing", workflows.delete_profile(prof["id"]) is True)
ok("deleted gone", workflows.get_profile(prof["id"]) is None)

try:
    workflows.save_profile("x" * 200, API_WF)
    # still must succeed with a bounded id
    ok("long name still saves", True)
except Exception as exc:
    ok("long name still saves", False, str(exc))


if failed:
    print(f"\n{failed} failed")
    sys.exit(1)
print("\nok")
