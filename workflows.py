#!/usr/bin/env python3
"""User ComfyUI API-workflow profiles. Original JSON is never mutated at generate time."""
from __future__ import annotations

import copy
import json
import os
import re
import unicodedata
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("WORKFLOW_DATA_DIR") or ROOT / "data" / "workflows")
SETTINGS_PATH = Path(os.environ.get("APP_SETTINGS") or ROOT / "data" / "settings.json")
DEFAULT_COMFY_API = "http://127.0.0.1:8188"
MAX_WORKFLOW_BYTES = 5 * 1024 * 1024
_ID_RE = re.compile(r"[^a-z0-9]+")


class WorkflowError(ValueError):
    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.code = code


def classify_workflow(data) -> str:
    if not isinstance(data, dict) or not data:
        return "invalid"
    nodes = data.get("nodes")
    links = data.get("links")
    if isinstance(nodes, list) and isinstance(links, list):
        return "ui"
    api_nodes = 0
    for key, node in data.items():
        if str(key).startswith("_"):
            continue
        if not isinstance(node, dict) or not node.get("class_type"):
            continue
        if not isinstance(node.get("inputs"), dict):
            continue
        api_nodes += 1
    return "api" if api_nodes else "invalid"


def require_api_workflow(data) -> dict:
    kind = classify_workflow(data)
    if kind == "ui":
        raise WorkflowError(
            "這是一般 ComfyUI workflow，不是 API 格式。"
            "請在 ComfyUI 用「檔案 → 匯出工作流 (API)」再匯入。",
            "ui_format",
        )
    if kind != "api":
        raise WorkflowError("不是有效的 ComfyUI API workflow JSON。", "invalid")
    return data


def _node(workflow: dict, nid: str):
    if not isinstance(workflow, dict):
        return None
    if nid in workflow:
        return workflow[nid]
    if str(nid) in workflow:
        return workflow[str(nid)]
    return None


def mapping_ready(mapping) -> bool:
    pos = (mapping or {}).get("positive") or {}
    if not isinstance(pos, dict):
        return False
    if (pos.get("mode") or "control") == "keep":
        return False
    return bool(pos.get("node") and pos.get("input"))


def apply_mapping(workflow: dict, mapping: dict | None, values: dict | None) -> dict:
    require_api_workflow(workflow)
    runtime = copy.deepcopy(workflow)
    mapping = mapping or {}
    values = values or {}

    def patch(field: str, value, spec=None):
        spec = spec if spec is not None else mapping.get(field)
        if not isinstance(spec, dict):
            return
        if (spec.get("mode") or "keep") == "keep":
            return
        if value is None:
            return
        nid = str(spec.get("node") or "")
        inp = str(spec.get("input") or "")
        node = _node(runtime, nid)
        if not isinstance(node, dict):
            raise WorkflowError(f"mapping 指向不存在的 node {nid}", "missing_node")
        inputs = node.get("inputs")
        if not isinstance(inputs, dict) or inp not in inputs:
            raise WorkflowError(f"node {nid} 沒有 input「{inp}」", "missing_input")
        inputs[inp] = value

    patch("positive", values.get("positive"))
    patch("negative", values.get("negative"))
    if "seed" in values:
        patch("seed", values.get("seed"))
    patch("checkpoint", values.get("checkpoint"))

    lora_specs = mapping.get("loras")
    lora_vals = values.get("loras") or []
    if isinstance(lora_specs, list):
        for i, spec in enumerate(lora_specs):
            if not isinstance(spec, dict):
                continue
            if (spec.get("mode") or "keep") == "keep":
                continue
            if i >= len(lora_vals):
                continue
            pair = lora_vals[i]
            name, strength = (pair[0], pair[1]) if isinstance(pair, (list, tuple)) and len(pair) >= 2 else (pair, None)
            patch("lora", name, spec)
            strength_input = spec.get("strengthInput")
            if strength_input and strength is not None:
                patch("lora-strength", float(strength), {**spec, "input": strength_input})
    return runtime


def normalize_comfy_url(raw: str | None) -> str:
    text = str(raw or "").strip()
    if not text:
        return DEFAULT_COMFY_API
    if "://" not in text:
        # javascript:alert(1) 這種沒有 // 的 scheme，不要誤加成 http://javascript:alert(1)
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", text) and not text.lower().startswith("localhost"):
            raise WorkflowError("ComfyUI 網址只接受 http 或 https。", "bad_url")
        text = "http://" + text
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme not in ("http", "https"):
        raise WorkflowError("ComfyUI 網址只接受 http 或 https。", "bad_url")
    if parsed.username or parsed.password:
        raise WorkflowError("ComfyUI 網址不能帶帳號密碼。", "bad_url")
    if not parsed.hostname:
        raise WorkflowError("ComfyUI 網址缺少主機名稱。", "bad_url")
    host = parsed.hostname
    try:
        port = parsed.port
    except ValueError as exc:
        raise WorkflowError("ComfyUI 網址不是有效的 http(s) 位址。", "bad_url") from exc
    if port:
        netloc = f"{host}:{port}"
    else:
        netloc = host
    path = parsed.path.rstrip("/")
    if path in ("", "/"):
        path = ""
    return urllib.parse.urlunparse((parsed.scheme, netloc, path, "", "", "")).rstrip("/")


def combo_list(object_info: dict | None, class_type: str, field: str) -> list[str]:
    node = (object_info or {}).get(class_type) or {}
    spec = ((node.get("input") or {}).get("required") or {}).get(field) or []
    names = spec[0] if spec and isinstance(spec[0], list) else []
    return [str(n) for n in names if n]


def _is_link(value) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and (isinstance(value[0], (str, int)))
        and isinstance(value[1], int)
    )


def inspect_nodes(workflow: dict) -> list[dict]:
    require_api_workflow(workflow)
    out = []
    for nid, node in workflow.items():
        if str(nid).startswith("_") or not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if not class_type:
            continue
        title = str(((node.get("_meta") or {}).get("title")) or class_type)
        inputs = []
        for name, value in (node.get("inputs") or {}).items():
            inputs.append(
                {
                    "name": str(name),
                    "value": value if not _is_link(value) else value,
                    "kind": "link" if _is_link(value) else "widget",
                }
            )
        out.append({"id": str(nid), "class_type": class_type, "title": title, "inputs": inputs})
    return out


def ckpt_name_of(workflow: dict) -> str | None:
    for node in (workflow or {}).values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") in ("CheckpointLoaderSimple", "CheckpointLoader"):
            name = (node.get("inputs") or {}).get("ckpt_name")
            if name:
                return str(name)
    return None


def image_output_nodes(workflow: dict) -> list[str]:
    ids = []
    for nid, node in (workflow or {}).items():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") in ("SaveImage", "PreviewImage"):
            ids.append(str(nid))
    return ids


def _slug(name: str) -> str:
    text = unicodedata.normalize("NFKC", str(name or "").strip())
    ascii_part = _ID_RE.sub("-", text.lower()).strip("-")
    if ascii_part:
        return ascii_part[:60]
    digest = abs(hash(text)) % 10_000_000
    return f"workflow-{digest}"


def _unique_id(name: str) -> str:
    base = _slug(name) or "workflow"
    cand = base
    n = 2
    while (DATA_DIR / cand).is_dir():
        cand = f"{base}-{n}"
        n += 1
        if n > 999:
            cand = f"{base}-{os.urandom(3).hex()}"
            break
    return cand


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_settings() -> dict:
    try:
        raw = _read_json(SETTINGS_PATH)
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_settings(data: dict) -> None:
    cur = load_settings()
    cur.update(data)
    _write_json(SETTINGS_PATH, cur)


def saved_comfy_api() -> str:
    got = str(load_settings().get("comfyApi") or "").strip()
    return got.rstrip("/") if got else ""


def set_comfy_api(url: str | None) -> str:
    normalized = normalize_comfy_url(url)
    save_settings({"comfyApi": normalized})
    return normalized


def _profile_dir(pid: str) -> Path:
    return DATA_DIR / pid


def list_profiles() -> list[dict]:
    if not DATA_DIR.is_dir():
        return []
    out = []
    for d in sorted(DATA_DIR.iterdir(), key=lambda p: p.name):
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        if not meta_path.is_file():
            continue
        try:
            meta = _read_json(meta_path)
        except (OSError, ValueError):
            continue
        if not isinstance(meta, dict):
            continue
        out.append(
            {
                "id": d.name,
                "name": str(meta.get("name") or d.name),
            }
        )
    return out


def get_profile(pid: str | None):
    if not pid or pid in (".", "..") or "/" in pid or "\\" in pid:
        return None
    folder = _profile_dir(str(pid))
    wf_path = folder / "workflow.json"
    if not wf_path.is_file():
        return None
    try:
        workflow = _read_json(wf_path)
        mapping = _read_json(folder / "mapping.json") if (folder / "mapping.json").is_file() else {}
        meta = _read_json(folder / "meta.json") if (folder / "meta.json").is_file() else {}
    except (OSError, ValueError):
        return None
    if not isinstance(workflow, dict):
        return None
    return {
        "id": folder.name,
        "name": str((meta or {}).get("name") or folder.name),
        "workflow": workflow,
        "mapping": mapping if isinstance(mapping, dict) else {},
    }


def _validate_mapping(workflow: dict, mapping: dict | None) -> dict:
    mapping = mapping if isinstance(mapping, dict) else {}
    dummy = {
        "positive": "",
        "negative": "",
        "seed": 0,
        "checkpoint": "",
        "loras": [("x.safetensors", 1.0)] * 8,
    }
    apply_mapping(workflow, mapping, dummy)
    return mapping


def save_profile(name: str, workflow: dict, mapping: dict | None = None, pid: str | None = None) -> dict:
    require_api_workflow(workflow)
    mapping = _validate_mapping(workflow, mapping)
    label = str(name or "").strip() or "Workflow"
    if pid and get_profile(pid):
        ident = str(pid)
    else:
        ident = _unique_id(label)
    folder = _profile_dir(ident)
    folder.mkdir(parents=True, exist_ok=True)
    _write_json(folder / "workflow.json", workflow)
    _write_json(folder / "mapping.json", mapping)
    _write_json(folder / "meta.json", {"name": label, "id": ident})
    return {"id": ident, "name": label}


def update_mapping(pid: str, mapping: dict) -> dict:
    prof = get_profile(pid)
    if prof is None:
        raise WorkflowError("找不到這個 workflow profile。", "missing_profile")
    mapping = _validate_mapping(prof["workflow"], mapping)
    _write_json(_profile_dir(pid) / "mapping.json", mapping)
    return {"id": pid, "name": prof["name"], "mapping": mapping}


def delete_profile(pid: str) -> bool:
    prof = get_profile(pid)
    if prof is None:
        return False
    folder = _profile_dir(pid)
    for name in ("workflow.json", "mapping.json", "meta.json"):
        try:
            (folder / name).unlink()
        except OSError:
            pass
    try:
        folder.rmdir()
    except OSError:
        pass
    return True
