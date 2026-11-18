#!/usr/bin/env python3
"""用墨池的聊天指令送一次實機請求，印出原始事件和解析結果。"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import assistant


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provider", choices=assistant.CLI_NAMES)
    parser.add_argument("--model", help="留空使用 CLI 預設模型")
    parser.add_argument("--cancel-after", type=float, metavar="秒數",
                        help="在同一次請求中試取消，也可按 Ctrl+C")
    args = parser.parse_args()
    if args.cancel_after is not None and not 0 < args.cancel_after < assistant.TEST_TIMEOUT:
        parser.error(f"--cancel-after 必須大於 0 且小於 {assistant.TEST_TIMEOUT} 秒")

    conn = {"provider": args.provider, "model": args.model}
    chat = {"system": "", "tools": [], "messages": [{"role": "user", "content": "只回覆 ok"}]}
    cancel = assistant._CancelScope()
    child = timer = code = result = error = None
    out = err = b""

    def on_start(proc):
        nonlocal child, timer
        child = proc
        if args.cancel_after is not None:
            def stop_if_running():
                if proc.poll() is None:
                    cancel.stop()

            timer = threading.Timer(args.cancel_after, stop_if_running)
            timer.start()

    started = time.monotonic()
    try:
        with assistant._cli_invocation(conn, chat) as (argv, cwd, prompt_file):
            command = subprocess.list2cmdline(argv) if os.name == "nt" else shlex.join(argv)
            print(f"執行指令 {command}", flush=True)
            print(f"工作目錄 {cwd}", flush=True)
            if prompt_file:
                print(f"標準輸入 {prompt_file}", flush=True)
            code, out, err = assistant._cli_process(
                argv, cwd, cancel, prompt_file=prompt_file, timeout=assistant.TEST_TIMEOUT, on_start=on_start,
            )
        cancel.check()
        result = assistant._cli_reply(args.provider, code, out, err)
    except subprocess.TimeoutExpired as exc:
        out, err = exc.output or b"", exc.stderr or b""
        error = assistant.ERRORS["timeout"]
    except (assistant.AssistantError, OSError) as exc:
        error = str(exc)
    finally:
        if timer is not None:
            timer.cancel()
            timer.join()

    elapsed = time.monotonic() - started
    raw = out.decode("utf-8", "replace")
    if err:
        raw += "\n[stderr]\n" + err.decode("utf-8", "replace")
    print("原始輸出（最多 2000 字）")
    print(raw[:2000])
    if code is None and child is not None:
        code = child.poll()
    print(f"程序結束碼 {code}")
    print(f"解析結果 {json.dumps(result, ensure_ascii=False)}" if error is None else f"解析結果 {error}")
    print(f"耗時 {elapsed:.2f} 秒")
    try:
        cancel.check()
    except assistant.AssistantError:
        stopped = child is not None and code not in (None, 0)
        print("取消成功，CLI 程序已結束。" if stopped else "取消未確認。")
        return 0 if stopped else 1
    if args.cancel_after is not None and code == 0:
        print("取消未發生，CLI 已先回覆。")
    else:
        print("未測試主動取消。")
    return 0 if result == {"say": "ok", "calls": []} else 1


if __name__ == "__main__":
    raise SystemExit(main())
