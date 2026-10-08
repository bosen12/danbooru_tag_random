#!/usr/bin/env python3
"""fetch_lora_manager.py：什麼時候算裝了、什麼時候裝、裝哪裡。不碰真的 ComfyUI、不真的下載。"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_lora_manager as fl  # noqa: E402

failed = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if not cond:
        failed += 1
        print(f"FAIL {name}" + (f"\n  {detail}" if detail else ""))
    else:
        print(f"ok   {name}")


tmp = Path(tempfile.mkdtemp())
# 這台機器存的 ComfyUI 網址（畫面上改過的、環境變數）會蓋過 config：測試不吃它們。
os.environ.pop("COMFY_API", None)
os.environ["APP_SETTINGS"] = str(tmp / "settings.json")
portable = tmp / "ComfyUI_windows_portable"
root = portable / "ComfyUI"
(root / "models" / "checkpoints" / "ill").mkdir(parents=True)
(root / "custom_nodes").mkdir()
config = {"comfy": {"api": "http://127.0.0.1:1", "checkpointDir": str(root / "models" / "checkpoints" / "ill")}}
fl.up.load_config = lambda: config

answers: dict = {}
fl.pose.comfy_get = lambda base, path, timeout=8: answers.get(path.split("?")[0])
installs = []


def fake_install(r, name, git, zip_url, label):
    installs.append((r, name, git))
    d = r / "custom_nodes" / name
    d.mkdir(parents=True)
    (d / "__init__.py").write_text("")
    return True


fl.pose.install_custom_node = fake_install

# ComfyUI 沒開、資料夾裡也沒有。
ok("沒裝：--check 回 3", fl.main(["--check"]) == 3)
ok("沒裝：裝進 custom_nodes/comfyui-lora-manager", fl.main([]) == 0 and installs == [(root, "comfyui-lora-manager", fl.NODE_GIT)], str(installs))
ok("裝好了但 ComfyUI 還沒重開：--check 回 4", fl.main(["--check"]) == 4)
installs.clear()
ok("裝過了不重裝", fl.main([]) == 0 and installs == [], str(installs))

# ComfyUI 開著而且回得出 LoRA 清單：什麼都不做。
answers.update({"/system_stats": {}, "/api/lm/loras/list": {"items": [], "total": 0}})
ok("ComfyUI 有 LoRA Manager：--check 回 0", fl.main(["--check"]) == 0)

# 停用的（.disabled）不算裝了。
(root / "custom_nodes" / "comfyui-lora-manager").rename(root / "custom_nodes" / "comfyui-lora-manager.disabled")
answers.clear()
ok("停用的不算裝了", fl.main(["--check"]) == 3)

# 遠端 ComfyUI（Tailscale）不歸這台管；設了 NO_LORA_MANAGER_FETCH 也不做。
config["comfy"]["api"] = "http://100.64.0.2:8188"
ok("遠端 ComfyUI：不裝", fl.main(["--check"]) == 0)
config["comfy"]["api"] = "http://127.0.0.1:1"
os.environ["NO_LORA_MANAGER_FETCH"] = "1"
ok("NO_LORA_MANAGER_FETCH 就什麼都不做", fl.main(["--check"]) == 0)
del os.environ["NO_LORA_MANAGER_FETCH"]

# 找不到 ComfyUI（沒 config、ComfyUI 也沒開）：不裝也不報錯。
config["comfy"].pop("checkpointDir")
fl.up.comfy_folders = lambda base: {}
ok("找不到 ComfyUI：不裝", fl.main(["--check"]) == 0 and fl.main([]) == 0)

print()
print("ok" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
